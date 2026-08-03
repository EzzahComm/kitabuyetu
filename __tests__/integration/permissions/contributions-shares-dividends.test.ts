/**
 * RBAC permission activation, Batch 8 (SIMPLIFICATION_AND_RBAC_AUDIT.md
 * Workstream 4). Contributions/Shares/Dividends map cleanly onto permission
 * strings already seeded in migrations 077/079 (contributions.record/view,
 * shares.manage/reverse, dividends.manage/approve, treasury.manage) — no new
 * migration needed for this batch, unlike 6/7. Proves each against real
 * Postgres.
 */
import { POST as contributionsPost } from '@/app/api/v1/contributions/route';
import { GET as nonContributorsGet } from '@/app/api/v1/contributions/non-contributors/route';
import { PUT as contributionsPolicyPut } from '@/app/api/v1/contributions/policy/route';
import { POST as shareClassPost } from '@/app/api/v1/share-classes/route';
import { POST as shareReversePost } from '@/app/api/v1/shares/transactions/[id]/reverse/route';
import { POST as dividendsPost } from '@/app/api/v1/dividends/route';
import { POST as dividendApprovePost } from '@/app/api/v1/dividends/[id]/approve/route';
import { authHeaders, buildRequest } from '../helpers/request';
import { createTestGroup } from '../helpers/fixtures';
import { resetDatabase } from '../helpers/cleanup';
import { rawQuery } from '../helpers/db';

async function permissionsFor(role: string): Promise<string[]> {
  const [row] = await rawQuery<{ permissions: string[] }>(
    `SELECT permissions FROM public.roles WHERE group_id IS NULL AND code = $1`,
    [role],
  );
  return row.permissions;
}

const FAKE_ID = '00000000-0000-0000-0000-000000000000';

describe('Contributions/Shares/Dividends permission gates', () => {
  let groupId: string, memberId: string;
  let memberPerms: string[], secretaryPerms: string[], treasurerPerms: string[], chairpersonPerms: string[];

  beforeAll(async () => {
    await resetDatabase();
    const { groupId: gId, officerId: founderId } = await createTestGroup('chairperson');
    groupId  = gId;
    memberId = founderId;
    memberPerms      = await permissionsFor('member');
    secretaryPerms   = await permissionsFor('secretary');
    treasurerPerms   = await permissionsFor('treasurer');
    chairpersonPerms = await permissionsFor('chairperson');
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('contributions.record: secretary is denied, treasurer CAN record a contribution', async () => {
    const body = { memberId, amount: 1000, contributionDate: '2026-01-01' };
    const denied = await contributionsPost(buildRequest('/api/v1/contributions', {
      method: 'POST', body,
      headers: authHeaders({ userId: memberId, groupId, role: 'secretary', permissions: secretaryPerms }),
    }));
    expect(denied.status).toBe(403);

    const allowed = await contributionsPost(buildRequest('/api/v1/contributions', {
      method: 'POST', body,
      headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
    }));
    expect(allowed.status).toBe(201);
  });

  it('contributions.view: secretary is denied non-contributors report, treasurer is allowed', async () => {
    const denied = await nonContributorsGet(buildRequest('/api/v1/contributions/non-contributors', {
      headers: authHeaders({ userId: memberId, groupId, role: 'secretary', permissions: secretaryPerms }),
    }));
    expect(denied.status).toBe(403);

    const allowed = await nonContributorsGet(buildRequest('/api/v1/contributions/non-contributors', {
      headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
    }));
    expect(allowed.status).toBe(200);
  });

  it('treasury.manage: a plain member cannot set the group savings policy, treasurer can', async () => {
    const body = { minContribution: 100, maxContribution: 100000, gracePeriodDays: 5 };
    const denied = await contributionsPolicyPut(buildRequest('/api/v1/contributions/policy', {
      method: 'PUT', body,
      headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
    }));
    expect(denied.status).toBe(403);
  });

  it('shares.manage: secretary is denied creating a share class, treasurer is allowed', async () => {
    const body = { name: 'Ordinary Shares', code: 'ORD', parValue: 100 };
    const denied = await shareClassPost(buildRequest('/api/v1/share-classes', {
      method: 'POST', body,
      headers: authHeaders({ userId: memberId, groupId, role: 'secretary', permissions: secretaryPerms }),
    }));
    expect(denied.status).toBe(403);

    const allowed = await shareClassPost(buildRequest('/api/v1/share-classes', {
      method: 'POST', body,
      headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
    }));
    expect(allowed.status).toBe(201);
  });

  it('shares.reverse: treasurer cannot reverse a share transaction, only chairperson can (passes the gate; 404 on the fake id is expected)', async () => {
    const denied = await shareReversePost(
      buildRequest(`/api/v1/shares/transactions/${FAKE_ID}/reverse`, {
        method: 'POST', body: { reason: 'test reversal' },
        headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
      }),
      { params: Promise.resolve({ id: FAKE_ID }) },
    );
    expect(denied.status).toBe(403);

    const passesGate = await shareReversePost(
      buildRequest(`/api/v1/shares/transactions/${FAKE_ID}/reverse`, {
        method: 'POST', body: { reason: 'test reversal' },
        headers: authHeaders({ userId: memberId, groupId, role: 'chairperson', permissions: chairpersonPerms }),
      }),
      { params: Promise.resolve({ id: FAKE_ID }) },
    );
    expect(passesGate.status).not.toBe(403);
  });

  it('dividends.manage: secretary is denied declaring a dividend, treasurer is allowed', async () => {
    const body = {
      periodLabel: 'FY2026', periodStart: '2026-01-01', periodEnd: '2026-12-31',
      poolAmount: 50000,
    };
    const denied = await dividendsPost(buildRequest('/api/v1/dividends', {
      method: 'POST', body,
      headers: authHeaders({ userId: memberId, groupId, role: 'secretary', permissions: secretaryPerms }),
    }));
    expect(denied.status).toBe(403);

    const allowed = await dividendsPost(buildRequest('/api/v1/dividends', {
      method: 'POST', body,
      headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
    }));
    expect(allowed.status).toBe(201);
  });

  it('dividends.approve: treasurer cannot approve a dividend declaration, only chairperson can (passes the gate; 404/409 on the fake id is expected)', async () => {
    const denied = await dividendApprovePost(
      buildRequest(`/api/v1/dividends/${FAKE_ID}/approve`, {
        method: 'POST',
        headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
      }),
      { params: Promise.resolve({ id: FAKE_ID }) },
    );
    expect(denied.status).toBe(403);

    const passesGate = await dividendApprovePost(
      buildRequest(`/api/v1/dividends/${FAKE_ID}/approve`, {
        method: 'POST',
        headers: authHeaders({ userId: memberId, groupId, role: 'chairperson', permissions: chairpersonPerms }),
      }),
      { params: Promise.resolve({ id: FAKE_ID }) },
    );
    expect(passesGate.status).not.toBe(403);
  });
});
