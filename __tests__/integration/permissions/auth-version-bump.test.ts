/**
 * RBAC permission activation (SIMPLIFICATION_AND_RBAC_AUDIT.md Workstream 4),
 * Batch 1 plumbing. The whole "permissions claim, bounded staleness" design
 * rests on group_members.auth_version actually bumping when a member's role
 * changes (migration 060's trg_gm_bump_auth_version trigger) and on
 * login/refresh actually re-resolving roles.permissions fresh each time —
 * this proves both against real Postgres and the real route handlers, not
 * just the trigger SQL in isolation.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { POST as refreshPost } from '@/app/api/v1/auth/refresh/route';
import { verifyAccessToken } from '@/lib/auth/jwt';
import { assignGroupMemberRole } from '@/lib/services/member-roles.service';
import { buildRequest } from '../helpers/request';
import { rawQuery } from '../helpers/db';
import { resetDatabase } from '../helpers/cleanup';

jest.mock('@/lib/redis', () => ({
  isAccountLocked: jest.fn().mockResolvedValue(false),
  incrementLoginAttempts: jest.fn().mockResolvedValue(1),
  clearLoginAttempts: jest.fn().mockResolvedValue(undefined),
  lockAccount: jest.fn().mockResolvedValue(undefined),
  storeRefreshToken: jest.fn().mockResolvedValue(undefined),
  revokeRefreshToken: jest.fn().mockResolvedValue(undefined),
}));

const PASSWORD = 'Sup3rSecret!';

function uniquePhone(): string {
  return `2547${crypto.randomInt(10_000_000, 100_000_000)}`;
}

async function jsonOf(res: Response): Promise<{ data: Record<string, unknown> }> {
  return res.json() as Promise<{ data: Record<string, unknown> }>;
}

describe('permissions claim tracks live role via auth_version (Batch 1 plumbing)', () => {
  afterEach(async () => {
    await resetDatabase();
  });

  it('demotes treasurer -> member mid-session: auth_version bumps for real, and the next refresh drops treasury.manage', async () => {
    const phone = uniquePhone();
    const passwordHash = await bcrypt.hash(PASSWORD, 4);

    const [{ result }] = await rawQuery<{ result: { group_id: string; member_id: string } }>(
      `SELECT register_group($1::jsonb) AS result`,
      [JSON.stringify({
        groupName: `Auth Version Bump Test ${phone}`,
        groupType: 'chama',
        firstName: 'Test', lastName: 'Treasurer',
        phone, passwordHash, creatorRole: 'treasurer',
      })],
    );
    const { group_id: groupId, member_id: memberId } = result;

    // ── Real login: prove the token's permissions claim reflects treasurer today ──
    const loginRes = await loginPost(buildRequest('/api/v1/auth/login', {
      method: 'POST', body: { identifier: phone, password: PASSWORD },
    }));
    expect(loginRes.status).toBe(200);
    const loginBody = await jsonOf(loginRes);
    const initialAccessToken = loginBody.data.accessToken as string;
    const refreshToken = loginBody.data.refreshToken as string;

    const initialClaims = verifyAccessToken(initialAccessToken);
    expect(initialClaims).toMatchObject({ role: 'treasurer' });
    expect((initialClaims as { permissions?: string[] }).permissions).toContain('treasury.manage');

    const [{ auth_version: authVersionBefore }] = await rawQuery<{ auth_version: number }>(
      `SELECT auth_version FROM group_members WHERE group_id = $1 AND member_id = $2`,
      [groupId, memberId],
    );

    // ── Demote via the real service (super-admin action, mirrors production) ──
    const [{ id: memberRoleId }] = await rawQuery<{ id: string }>(
      `SELECT id FROM public.roles WHERE group_id IS NULL AND code = 'member'`,
    );
    await assignGroupMemberRole({
      actorId: memberId, memberId, groupId, roleId: memberRoleId,
    });

    const [{ auth_version: authVersionAfter }] = await rawQuery<{ auth_version: number }>(
      `SELECT auth_version FROM group_members WHERE group_id = $1 AND member_id = $2`,
      [groupId, memberId],
    );
    // The trigger, not application code, is what must fire here — this is
    // the single most load-bearing assertion in the whole design.
    expect(authVersionAfter).toBeGreaterThan(authVersionBefore);

    // ── Real refresh: the new token must reflect the LIVE role, not the stale claim ──
    const refreshRes = await refreshPost(buildRequest('/api/v1/auth/refresh', {
      method: 'POST', body: { refreshToken },
    }));
    expect(refreshRes.status).toBe(200);
    const refreshBody = await jsonOf(refreshRes);
    const refreshedClaims = verifyAccessToken(refreshBody.data.accessToken as string);

    expect(refreshedClaims).toMatchObject({ role: 'member' });
    const refreshedPermissions = (refreshedClaims as { permissions?: string[] }).permissions ?? [];
    expect(refreshedPermissions).not.toContain('treasury.manage');
    expect(refreshedPermissions).not.toContain('loans.approve');
    expect(refreshedPermissions).toContain('welfare.request');
  });
});
