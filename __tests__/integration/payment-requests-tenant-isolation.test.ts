/**
 * Critical #5 (OPTIMIZATION_CLEANUP_AUDIT.md) — "payments" category. Proves
 * `DELETE /api/v1/payment-requests/[id]` (paymentRequestsService.cancel,
 * `WHERE id = $1 AND group_id = $2`) actually blocks a cross-tenant cancel
 * against a real Postgres instance — not just a mocked query-arg assertion.
 */
import { DELETE } from '@/app/api/v1/payment-requests/[id]/route';
import { authHeaders, buildRequest } from './helpers/request';
import { createTestGroup, createTestPaymentRequest } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';

describe('payment-requests tenant isolation', () => {
  let groupAId: string, treasurerAId: string;
  let groupBId: string, treasurerBId: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ groupId: groupAId, officerId: treasurerAId } = await createTestGroup('treasurer'));
    ({ groupId: groupBId, officerId: treasurerBId } = await createTestGroup('treasurer'));
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it("404s when group A's treasurer tries to cancel group B's payment request", async () => {
    const { id } = await createTestPaymentRequest(groupBId, treasurerBId, treasurerBId);

    const res = await DELETE(
      buildRequest(`/api/v1/payment-requests/${id}`, {
        method: 'DELETE',
        headers: authHeaders({ userId: treasurerAId, groupId: groupAId, role: 'treasurer' }),
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(res.status).toBe(404);
  });

  it("succeeds when group B's own treasurer cancels its own payment request", async () => {
    const { id } = await createTestPaymentRequest(groupBId, treasurerBId, treasurerBId);

    const res = await DELETE(
      buildRequest(`/api/v1/payment-requests/${id}`, {
        method: 'DELETE',
        headers: authHeaders({ userId: treasurerBId, groupId: groupBId, role: 'treasurer' }),
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(res.status).toBe(204);
  });

  it('rejects a non-treasurer role even within the owning group', async () => {
    const { id } = await createTestPaymentRequest(groupBId, treasurerBId, treasurerBId);

    const res = await DELETE(
      buildRequest(`/api/v1/payment-requests/${id}`, {
        method: 'DELETE',
        headers: authHeaders({ userId: treasurerBId, groupId: groupBId, role: 'member' }),
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(res.status).toBe(403);
  });
});
