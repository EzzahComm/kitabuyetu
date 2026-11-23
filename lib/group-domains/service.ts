import { createHash, randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import type { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/lib/utils/errors';
import type { AuthContext } from '@/types/api.types';
import type { MemberRole } from '@/types/enums';
import { callbackFor, hostnameSchema, permits, type DomainScope } from './protocol';

const random = () => randomBytes(32).toString('base64url');
const hash = (s: string) => createHash('sha256').update(s).digest('base64url');
interface Leader {
  id: string;
  member_id: string;
  group_id: string;
  role: MemberRole;
  auth_version: number;
  session_version: number;
  membership_no: string;
  group_name: string;
  permissions: string[];
}
const leaderQuery = `SELECT gm.id,gm.member_id,gm.group_id,gm.role,gm.auth_version,m.session_version,
    gm.membership_no,g.name AS group_name,COALESCE(r.permissions,'{}') AS permissions
  FROM group_members gm JOIN members m ON m.id=gm.member_id AND m.is_active
  JOIN groups g ON g.id=gm.group_id AND g.status='active' LEFT JOIN roles r ON r.id=gm.role_id
  WHERE gm.status='active' AND gm.role IN ('chairperson','treasurer','secretary')`;
async function leader(db: PoolClient, auth: AuthContext, manage = false) {
  const row = (
    await db.query<Leader>(leaderQuery + ' AND gm.group_id=$1 AND gm.member_id=$2 FOR SHARE OF gm,g,m', [
      auth.groupId,
      auth.userId,
    ])
  ).rows[0];
  if (
    !row ||
    row.id !== auth.membershipId ||
    row.auth_version !== auth.authVersion ||
    row.session_version !== auth.sessionVersion ||
    (manage && row.role !== 'chairperson')
  )
    throw new ForbiddenError(
      manage
        ? 'An active group chairperson must manage the domain. Sign in again if your role changed.'
        : 'Sign in as an active officer of this group.',
    );
  return row;
}
interface Domain {
  id: string;
  group_id: string;
  hostname: string;
  challenge: string;
  verified_until: Date | null;
}
async function configured(db: PoolClient, groupId: string) {
  return (await db.query<Domain>('SELECT * FROM group_domains WHERE group_id=$1', [groupId])).rows[0] ?? null;
}
async function audit(db: PoolClient, auth: AuthContext, action: string, hostname: string) {
  await db.query(
    `INSERT INTO audit_logs(group_id,actor_id,action,resource_type,resource_id,new_values)
    VALUES ($1,$2,$3,'group_domain',$1,$4)`,
    [auth.groupId, auth.userId, 'domain.' + action, JSON.stringify({ hostname })],
  );
}
export async function domainSettings(auth: AuthContext) {
  return withAdminDb(async (db) => {
    await leader(db, auth, true);
    return configured(db, auth.groupId);
  });
}
export async function registerDomain(auth: AuthContext, input: string) {
  const hostname = hostnameSchema.parse(input);
  return withAdminDb(async (db) => {
    await leader(db, auth, true);
    await db.query(
      `INSERT INTO group_domains(group_id,hostname,challenge) VALUES($1,$2,$3)
      ON CONFLICT(group_id) DO NOTHING`,
      [auth.groupId, hostname, random()],
    );
    const row = await configured(db, auth.groupId);
    if (!row || row.hostname !== hostname)
      throw new ConflictError('Disconnect the current domain before registering another.');
    await audit(db, auth, 'register', hostname);
    return row;
  });
}
async function hasProof(hostname: string, challenge: string, lookup: typeof resolveTxt) {
  const records = await lookup('_kitabuyetu.' + hostname).catch(() => []);
  return records.some((parts) => parts.join('') === 'kitabuyetu=' + challenge);
}
async function renew(db: PoolClient, id: string, challenge: string) {
  // Lock against disconnect/replacement. Resuming after a lapse starts a new
  // lease and must not revive codes or tokens issued during the previous one.
  const found = await db.query<{ lapsed: boolean }>(
    'SELECT verified_until<=now() AS lapsed FROM group_domains WHERE id=$1 AND challenge=$2 FOR UPDATE',
    [id, challenge],
  );
  if (!found.rowCount) throw new ConflictError('The configured domain changed. Reload its DNS instructions.');
  if (found.rows[0].lapsed) await db.query('DELETE FROM group_domain_grants WHERE domain_id=$1', [id]);
  return (
    await db.query<Domain>(
      "UPDATE group_domains SET verified_until=now()+interval '30 days',next_dns_check=now()+interval '23 days' WHERE id=$1 RETURNING *",
      [id],
    )
  ).rows[0];
}
export async function verifyDomain(auth: AuthContext, hostname: string, lookup: typeof resolveTxt = resolveTxt) {
  const before = await domainSettings(auth);
  if (!before || before.hostname !== hostname) throw new NotFoundError('Domain');
  if (!(await hasProof(hostname, before.challenge, lookup)))
    throw new ValidationError('The expected DNS TXT record is not visible yet.');
  try {
    return await withAdminDb(async (db) => {
      await leader(db, auth, true);
      // Serialize competing verifications of the same hostname, including expired ownership.
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [hostname]);
      await db.query(`DELETE FROM group_domains WHERE hostname=$1 AND group_id<>$2 AND verified_until<=now()`, [
        hostname,
        auth.groupId,
      ]);
      const row = await renew(db, before.id, before.challenge);
      await audit(db, auth, 'verify', hostname);
      return row;
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ConflictError('Another group has verified this domain.');
    throw e;
  }
}
export async function disconnectDomain(auth: AuthContext, id: string) {
  return withAdminDb(async (db) => {
    await leader(db, auth, true);
    const row = (
      await db.query<{ hostname: string }>('DELETE FROM group_domains WHERE id=$1 AND group_id=$2 RETURNING hostname', [
        id,
        auth.groupId,
      ])
    ).rows[0];
    if (!row) throw new ConflictError('This domain has already changed.');
    await audit(db, auth, 'disconnect', row.hostname);
  });
}
export async function connectedGroup(hostname: string, lookup: typeof resolveTxt = resolveTxt) {
  if (!hostnameSchema.safeParse(hostname).success) return null;
  const find = () =>
    withAdminDb(
      async (db) =>
        (
          await db.query<{
            id: string;
            challenge: string;
            group_id: string;
            group_name: string;
            valid: boolean;
            due: boolean;
          }>(
            `
    SELECT d.id,d.challenge,d.group_id,g.name AS group_name,d.verified_until>now() AS valid,
      (d.next_dns_check IS NULL OR d.next_dns_check<=now()) AS due
    FROM group_domains d JOIN groups g ON g.id=d.group_id AND g.status='active'
    WHERE hostname=$1 AND verified_until IS NOT NULL`,
            [hostname],
          )
        ).rows[0],
    );
  let row = await find();
  if (row?.due) {
    const claimed = await withAdminDb((db) =>
      db.query(
        "UPDATE group_domains SET next_dns_check=now()+interval '5 minutes' WHERE id=$1 AND (next_dns_check IS NULL OR next_dns_check<=now())",
        [row!.id],
      ),
    );
    if (claimed.rowCount && (await hasProof(hostname, row.challenge, lookup))) {
      const { id, challenge } = row;
      await withAdminDb(async (db) => {
        // The domain may have been disconnected while DNS was resolving.
        const same = await db.query(
          'SELECT id FROM group_domains WHERE id=$1 AND verified_until IS NOT NULL FOR UPDATE',
          [id],
        );
        if (same.rowCount) await renew(db, id, challenge);
      });
    }
    row = await find();
  }
  return row?.valid ? { group_id: row.group_id, group_name: row.group_name } : null;
}
export async function consent(
  auth: AuthContext,
  hostname: string,
  grant?: { state: string; code_challenge: string; scope: DomainScope },
) {
  return withAdminDb(async (db) => {
    const officer = await leader(db, auth);
    const domain = (
      await db.query<Domain>(
        'SELECT * FROM group_domains WHERE group_id=$1 AND hostname=$2 AND verified_until>now() FOR SHARE',
        [auth.groupId, hostname],
      )
    ).rows[0];
    if (!domain) throw new ForbiddenError('This website is not connected to your active group.');
    if (!grant) return { role: officer.role };
    const code = random();
    await db.query('DELETE FROM group_domain_grants WHERE domain_id=$1 AND expires_at<=now()', [domain.id]);
    await db.query(
      `INSERT INTO group_domain_grants (code_hash,domain_id,membership_id,auth_version,session_version,scope,pkce,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now()+interval '2 minutes')`,
      [
        hash(code),
        domain.id,
        officer.id,
        officer.auth_version,
        officer.session_version,
        grant.scope,
        grant.code_challenge,
      ],
    );
    await audit(db, auth, 'consent', hostname);
    const callback = new URL(callbackFor(hostname));
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', grant.state);
    return { redirect: callback.toString() };
  });
}
async function liveGrant(db: PoolClient, predicate: string, params: string[]) {
  // The predicate is selected only by the two call sites below.
  return (
    await db.query<Leader & { code_hash: string; scope: DomainScope; hostname: string }>(
      `SELECT l.*,a.code_hash,a.scope,d.hostname
    FROM group_domain_grants a JOIN group_domains d ON d.id=a.domain_id
    JOIN (${leaderQuery}) l ON l.id=a.membership_id AND l.group_id=d.group_id
    AND l.auth_version=a.auth_version AND l.session_version=a.session_version
    WHERE d.verified_until>now() AND a.expires_at>now() AND ${predicate}`,
      params,
    )
  ).rows[0];
}
export async function exchange(hostname: string, code: string, verifier: string) {
  return withAdminDb(async (db) => {
    const row = await liveGrant(db, 'd.hostname=$1 AND a.code_hash=$2 AND a.pkce=$3 AND a.access_hash IS NULL', [
      hostname,
      hash(code),
      hash(verifier),
    ]);
    if (!row) throw new UnauthorizedError('Invalid or expired authorization code.');
    const token = 'kyd_' + random();
    const used = await db.query(
      `UPDATE group_domain_grants SET access_hash=$2,expires_at=now()+interval '15 minutes'
      WHERE code_hash=$1 AND access_hash IS NULL AND expires_at>now()`,
      [row.code_hash, hash(token)],
    );
    if (!used.rowCount) throw new UnauthorizedError('Authorization code was already redeemed.');
    return { access_token: token, token_type: 'Bearer', expires_in: 900, scope: row.scope };
  });
}
export async function domainIdentity(token: string, required: DomainScope): Promise<AuthContext> {
  return withAdminDb(async (db) => {
    const row = await liveGrant(db, 'a.access_hash=$1', [hash(token)]);
    if (!row) throw new UnauthorizedError('The website connection expired or was revoked.');
    if (!permits(row.scope, required)) throw new ForbiddenError('This operation requires additional consent.');
    return {
      userId: row.member_id,
      groupId: row.group_id,
      role: row.role,
      membershipId: row.id,
      membershipNo: row.membership_no,
      authVersion: row.auth_version,
      sessionVersion: row.session_version,
      permissions: row.permissions,
    };
  });
}
