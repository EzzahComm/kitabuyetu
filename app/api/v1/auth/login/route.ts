export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { withAdminDb } from '@/lib/db';
import { signAccessToken, signRefreshToken, hashToken, refreshTtlSeconds } from '@/lib/auth/jwt';
import {
  storeRefreshToken, incrementLoginAttempts, clearLoginAttempts,
  isAccountLocked, lockAccount,
} from '@/lib/redis';
import { LoginSchema } from '@/lib/validators/auth.schema';
import { normalizePhone } from '@/lib/utils/phone';
import { ok, handleError, errorResponse } from '@/lib/utils/response';
import type { LoginResponse, NeedsGroupSelection } from '@/types/api.types';

const MAX_ATTEMPTS    = parseInt(process.env.MAX_LOGIN_ATTEMPTS    ?? '5',  10);
const LOCKOUT_MINUTES = parseInt(process.env.LOGIN_LOCKOUT_MINUTES ?? '15', 10);

// Constant-time decoy hash. bcrypt.compare against this when the member lookup
// fails so the response timing doesn't reveal whether the identifier exists.
const DECOY_HASH = '$2a$10$abcdefghijklmnopqrstuuMUbfYNQK3vFq2KCRGzlz7QnxJ.O3.lG';

interface MemberRow {
  id:            string;
  password_hash: string;
  first_name:    string;
  last_name:     string;
  phone:         string;
  email:         string | null;
  platform_role: string;
  is_active:     boolean;
}

interface GroupMembershipRow {
  group_id:      string;
  member_id:     string;
  member_code:   string;
  membership_no: string;
  person_id:     string;
  member_status: string;
  group_role:    string;     // group_members.role
  group_code:    string;
  group_name:    string;
  group_status:  string;     // groups.status
  officer_role:  string | null;
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json();
    const input = LoginSchema.parse(body);

    // Resolve identifier into a (kind, value) pair. Phone is normalised to E.164
    // for lookup against members.phone; emails are lowercased.
    const isEmail   = input.identifier.includes('@');
    const lookupKey = isEmail
      ? input.identifier.trim().toLowerCase()
      : normalizePhone(input.identifier);

    // Lockout key is the lookup key — pivots automatically if the user switches
    // between phone and email between attempts.
    if (await isAccountLocked(lookupKey)) {
      return errorResponse(
        `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`,
        'ACCOUNT_LOCKED',
        429,
      );
    }

    // ── Single round-trip: member + all active memberships ──────────────────
    const result = await withAdminDb(async (client) => {
      const { rows: members } = await client.query<MemberRow>(
        `SELECT id, password_hash, first_name, last_name, phone, email,
                platform_role, is_active
         FROM   members
         WHERE  ${isEmail ? 'lower(email) = $1' : 'phone = $1'}
         LIMIT  1`,
        [lookupKey],
      );

      const member = members[0];
      const hashToVerify = member?.password_hash ?? DECOY_HASH;
      const passwordOk   = await bcrypt.compare(input.password, hashToVerify);

      // Three cases collapsed into one "invalid credentials" path so the
      // attacker can't tell which one fired: no member, deactivated member,
      // wrong password.
      if (!member || !member.is_active || !passwordOk) {
        return { kind: 'invalid' as const };
      }

      const { rows: memberships } = await client.query<GroupMembershipRow>(
        `SELECT
           gm.group_id, gm.member_id, gm.member_code, gm.membership_no, gm.person_id,
           gm.status                  AS member_status,
           gm.role                    AS group_role,
           g.group_code, g.name       AS group_name, g.status AS group_status,
           go.role                    AS officer_role
         FROM   group_members gm
         JOIN   groups g ON g.id = gm.group_id
         LEFT JOIN group_officers go
           ON go.group_id  = gm.group_id
          AND go.member_id = gm.member_id
          AND go.removed_at IS NULL
         WHERE  gm.member_id = $1
           AND  gm.status    = 'active'
           AND  g.status     NOT IN ('suspended','archived')
         ORDER BY g.group_code`,
        [member.id],
      );

      return { kind: 'ok' as const, member, memberships };
    });

    if (result.kind === 'invalid') {
      const attempts = await incrementLoginAttempts(lookupKey);
      if (attempts >= MAX_ATTEMPTS) {
        await lockAccount(lookupKey, LOCKOUT_MINUTES);
      }
      return errorResponse('Invalid phone/email or password', 'INVALID_CREDENTIALS', 401);
    }

    const { member, memberships } = result;

    if (memberships.length === 0) {
      // Credentials are correct but the member has no usable group context
      // (all memberships rejected/suspended, or all groups suspended/archived).
      // Tell the user to contact a group admin — don't enumerate which group.
      return errorResponse(
        'Your account has no active group memberships. Contact your group admin.',
        'NO_ACTIVE_GROUP',
        403,
      );
    }

    // ── Pick the active group ───────────────────────────────────────────────
    let chosen: GroupMembershipRow | undefined;
    if (memberships.length === 1) {
      chosen = memberships[0];
    } else if (input.groupCode) {
      const want = input.groupCode.toUpperCase();
      chosen = memberships.find((m) => m.group_code.toUpperCase() === want);
      if (!chosen) {
        return errorResponse(
          'You are not a member of that group, or the group code is wrong.',
          'GROUP_CODE_MISMATCH',
          403,
        );
      }
    } else {
      // Multi-group user without a chosen code — credentials are valid, but
      // we need them to pick. Don't issue tokens yet; the client re-submits
      // the form with `groupCode` populated.
      await clearLoginAttempts(lookupKey); // they DID auth successfully
      const response: NeedsGroupSelection = {
        needsGroupSelection: true,
        groups: memberships.map((m) => ({
          groupId:    m.group_id,
          groupCode:  m.group_code,
          groupName:  m.group_name,
          groupRole:  m.group_role as any,
          officerRole: m.officer_role ?? undefined,
        })),
      };
      return ok(response);
    }

    await clearLoginAttempts(lookupKey);

    // Update last_login_at (best effort — failure here doesn't block login)
    void withAdminDb((client) =>
      client.query('UPDATE members SET last_login_at = NOW() WHERE id = $1', [member.id]),
    ).catch(() => {});

    // Platform super_admin overrides the per-group role for authorisation.
    const effectiveRole = member.platform_role === 'super_admin'
      ? 'super_admin'
      : chosen.group_role;

    const accessToken = signAccessToken({
      sub:         member.id,
      groupId:     chosen.group_id,
      role:        effectiveRole as any,
      personId:    chosen.person_id,
      groupStatus: chosen.group_status,
    });

    // Pin the chosen group to the refresh token so token refreshes revalidate
    // THIS membership instead of re-deriving one (audit C-1).
    const { token: refreshToken } = signRefreshToken(member.id, 'tenant', chosen.group_id);
    const rtHash = hashToken(refreshToken);
    await storeRefreshToken(rtHash, member.id, refreshTtlSeconds());

    await withAdminDb((client) =>
      client.query(
        // make_interval(secs => N) returns INTERVAL 'N seconds'. Cleaner than
        // the previous `$3::interval * INTERVAL '1 second'` which evaluated to
        // `interval * interval` (an invalid operator in Postgres) — that bug
        // existed in the original code too but only surfaced after the data
        // wipe forced the first cold login of the session.
        `INSERT INTO refresh_tokens (member_id, token_hash, expires_at, ip_address)
         VALUES ($1, $2, NOW() + make_interval(secs => $3::int), $4)`,
        [member.id, rtHash, refreshTtlSeconds(), req.headers.get('x-forwarded-for') ?? null],
      ),
    );

    const response: LoginResponse = {
      accessToken,
      refreshToken,
      member: {
        id:           member.id,
        firstName:    member.first_name,
        lastName:     member.last_name,
        phone:        member.phone,
        email:        member.email,
        platformRole: member.platform_role as any,
        groupRole:    chosen.group_role as any,
        groupId:      chosen.group_id,
        groupName:    chosen.group_name,
        groupCode:    chosen.group_code,
        memberCode:   chosen.member_code,
        membershipNo: chosen.membership_no,
        personId:     chosen.person_id,
        officerRole:  chosen.officer_role ?? undefined,
        groupStatus:  chosen.group_status,
      },
    };

    return ok(response);
  } catch (err) {
    return handleError(err);
  }
}
