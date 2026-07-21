/**
 * Critical #5 (OPTIMIZATION_CLEANUP_AUDIT.md) — "disbursements" category.
 * Proves `POST /api/v1/mpesa/disbursements/[id]` (disbursementsService
 * approve/reject, `WHERE id = $1 AND group_id = $2 ... FOR UPDATE`) actually
 * blocks a cross-tenant action against a real Postgres instance.
 *
 * Only `reject` is used for the same-tenant "succeeds" assertions —
 * `approve` dispatches a real Daraja B2C call on success (fire-and-forget,
 * errors are swallowed internally), which this suite deliberately avoids
 * triggering to stay hermetic. The cross-tenant and maker-checker `approve`
 * cases both 404/403 before dispatch is ever reached, so those are safe.
 */
import { POST } from '@/app/api/v1/mpesa/disbursements/[id]/route';
import { authHeaders, buildRequest } from './helpers/request';
import { createTestGroup, addGroupOfficer, createTestDisbursement } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';

describe('mpesa disbursements tenant isolation', () => {
  let groupAId: string, treasurerAId: string;
  let groupBId: string, initiatorBId: string, secondOfficerBId: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ groupId: groupAId, officerId: treasurerAId } = await createTestGroup('treasurer'));
    ({ groupId: groupBId, officerId: initiatorBId } = await createTestGroup('treasurer'));
    secondOfficerBId = await addGroupOfficer(groupBId, initiatorBId, 'treasurer');
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it("404s when group A's treasurer tries to approve group B's pending disbursement", async () => {
    const { id } = await createTestDisbursement(groupBId, initiatorBId);

    const res = await POST(
      buildRequest(`/api/v1/mpesa/disbursements/${id}`, {
        method: 'POST',
        headers: authHeaders({ userId: treasurerAId, groupId: groupAId, role: 'treasurer' }),
        body: { action: 'approve' },
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(res.status).toBe(404);
  });

  it("404s when group A's treasurer tries to reject group B's pending disbursement", async () => {
    const { id } = await createTestDisbursement(groupBId, initiatorBId);

    const res = await POST(
      buildRequest(`/api/v1/mpesa/disbursements/${id}`, {
        method: 'POST',
        headers: authHeaders({ userId: treasurerAId, groupId: groupAId, role: 'treasurer' }),
        body: { action: 'reject', reason: 'not my group' },
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(res.status).toBe(404);
  });

  it("succeeds when group B's own second officer rejects group B's pending disbursement", async () => {
    const { id } = await createTestDisbursement(groupBId, initiatorBId);

    const res = await POST(
      buildRequest(`/api/v1/mpesa/disbursements/${id}`, {
        method: 'POST',
        headers: authHeaders({ userId: secondOfficerBId, groupId: groupBId, role: 'treasurer' }),
        body: { action: 'reject', reason: 'test rejection' },
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(res.status).toBe(200);
  });

  it('rejects maker-checker violation: the initiator cannot approve their own disbursement', async () => {
    const { id } = await createTestDisbursement(groupBId, initiatorBId);

    const res = await POST(
      buildRequest(`/api/v1/mpesa/disbursements/${id}`, {
        method: 'POST',
        headers: authHeaders({ userId: initiatorBId, groupId: groupBId, role: 'treasurer' }),
        body: { action: 'approve' },
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(res.status).toBe(403);
  });
});
