/**
 * RBAC permission activation, Batch 2 (SIMPLIFICATION_AND_RBAC_AUDIT.md
 * Workstream 4). Meetings/Welfare/Investments had ZERO role check anywhere
 * (route or service level) before this batch — any authenticated member
 * could create meetings, review/disburse welfare, or record investment
 * returns. This proves the new withPermission() gates against real Postgres,
 * using each role's actual seeded roles.permissions array (not a hardcoded
 * duplicate of the catalog) so this test tracks migration 110 automatically.
 */
import { GET as meetingsGet, POST as meetingsPost } from '@/app/api/v1/meetings/route';
import { POST as welfarePost } from '@/app/api/v1/welfare/route';
import { PATCH as welfarePatch } from '@/app/api/v1/welfare/[id]/route';
import { GET as investmentsGet, POST as investmentsPost } from '@/app/api/v1/investments/route';
import { authHeaders, buildRequest } from '../helpers/request';
import { createTestGroup, addGroupOfficer } from '../helpers/fixtures';
import { resetDatabase } from '../helpers/cleanup';
import { rawQuery } from '../helpers/db';

async function permissionsFor(role: string): Promise<string[]> {
  const [row] = await rawQuery<{ permissions: string[] }>(
    `SELECT permissions FROM public.roles WHERE group_id IS NULL AND code = $1`,
    [role],
  );
  return row.permissions;
}

describe('Meetings/Welfare/Investments permission gates (net-new)', () => {
  let groupId: string, memberId: string;
  let memberPerms: string[], secretaryPerms: string[], treasurerPerms: string[];

  beforeAll(async () => {
    await resetDatabase();
    // register_group() founders are always officers — a genuine plain
    // 'member' needs a second, explicitly-added membership.
    const { groupId: gId, officerId: founderId } = await createTestGroup('treasurer');
    groupId  = gId;
    memberId = await addGroupOfficer(gId, founderId, 'member');
    memberPerms    = await permissionsFor('member');
    secretaryPerms = await permissionsFor('secretary');
    treasurerPerms = await permissionsFor('treasurer');
  });

  afterAll(async () => {
    await resetDatabase();
  });

  describe('meetings', () => {
    it('a plain member can list meetings (meetings.view)', async () => {
      const res = await meetingsGet(buildRequest('/api/v1/meetings', {
        headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
      }));
      expect(res.status).toBe(200);
    });

    it('a plain member cannot create a meeting (needs meetings.manage)', async () => {
      const res = await meetingsPost(buildRequest('/api/v1/meetings', {
        method: 'POST',
        headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
        body: { title: 'AGM 2026', scheduledAt: new Date().toISOString() },
      }));
      expect(res.status).toBe(403);
    });

    it('a secretary CAN create a meeting (meetings.manage)', async () => {
      const res = await meetingsPost(buildRequest('/api/v1/meetings', {
        method: 'POST',
        headers: authHeaders({ userId: memberId, groupId, role: 'secretary', permissions: secretaryPerms }),
        body: { title: 'AGM 2026', scheduledAt: new Date().toISOString() },
      }));
      expect(res.status).toBe(201);
    });
  });

  describe('welfare', () => {
    it('a plain member CAN self-request welfare help (welfare.request)', async () => {
      const res = await welfarePost(buildRequest('/api/v1/welfare', {
        method: 'POST',
        headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
        body: { requestType: 'hospital', title: 'Hospital bill assistance', amountRequested: 5000 },
      }));
      expect(res.status).toBe(201);
    });

    it('a plain member cannot review/disburse a welfare request (needs welfare.manage)', async () => {
      const res = await welfarePatch(
        buildRequest(`/api/v1/welfare/00000000-0000-0000-0000-000000000000`, {
          method: 'PATCH',
          headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
          body: { action: 'approve', amountApproved: 5000 },
        }),
        { params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }) },
      );
      expect(res.status).toBe(403);
    });

    it('a treasurer CAN attempt to review a welfare request (passes the permission gate; 404 on the fake id is expected)', async () => {
      const res = await welfarePatch(
        buildRequest(`/api/v1/welfare/00000000-0000-0000-0000-000000000000`, {
          method: 'PATCH',
          headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
          body: { action: 'approve', amountApproved: 5000 },
        }),
        { params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }) },
      );
      expect(res.status).not.toBe(403);
    });
  });

  describe('investments', () => {
    it('a plain member can list investments (investments.view)', async () => {
      const res = await investmentsGet(buildRequest('/api/v1/investments', {
        headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
      }));
      expect(res.status).toBe(200);
    });

    it('a plain member cannot create an investment (needs investments.manage)', async () => {
      const res = await investmentsPost(buildRequest('/api/v1/investments', {
        method: 'POST',
        headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
        body: {
          name: 'Land parcel', investmentType: 'land',
          principalAmount: 100000, startDate: '2026-01-01',
        },
      }));
      expect(res.status).toBe(403);
    });

    it('a treasurer CAN create an investment (investments.manage)', async () => {
      const res = await investmentsPost(buildRequest('/api/v1/investments', {
        method: 'POST',
        headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
        body: {
          name: 'Land parcel', investmentType: 'land',
          principalAmount: 100000, startDate: '2026-01-01',
        },
      }));
      expect(res.status).toBe(201);
    });
  });
});
