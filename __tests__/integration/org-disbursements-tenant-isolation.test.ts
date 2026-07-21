/**
 * Critical #5 (OPTIMIZATION_CLEANUP_AUDIT.md) — "admin" category. The literal
 * `/api/admin/organizations|groups/[id]` routes are `super_admin`-only by
 * design (global access, nothing to scope), so the meaningful admin-tier
 * isolation boundary is `organization_coordinator`, tested here via
 * `POST /api/v1/organization/disbursements/[id]`
 * (organizationFinanceService.approveDisbursement/rejectDisbursement,
 * `WHERE id = $1 AND organization_id = $2 ... FOR UPDATE`).
 */
import { POST } from '@/app/api/v1/organization/disbursements/[id]/route';
import { authHeaders, buildRequest } from './helpers/request';
import {
  createTestGroup, createTestOrganization, createOrgCoordinator, createTestOrgDisbursement,
} from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';

describe('organization disbursements tenant isolation', () => {
  let orgAId: string, coordinatorAId: string;
  let orgBId: string, coordinatorBId: string, secondCoordinatorBId: string;
  let groupBId: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ organizationId: orgAId, coordinatorId: coordinatorAId } = await createTestOrganization());
    ({ organizationId: orgBId, coordinatorId: coordinatorBId } = await createTestOrganization());
    secondCoordinatorBId = await createOrgCoordinator();
    ({ groupId: groupBId } = await createTestGroup('treasurer'));
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it("404s when org A's coordinator tries to approve org B's pending disbursement", async () => {
    const { id } = await createTestOrgDisbursement(orgBId, coordinatorBId, groupBId);

    const res = await POST(
      buildRequest(`/api/v1/organization/disbursements/${id}`, {
        method: 'POST',
        headers: authHeaders({
          userId: coordinatorAId, groupId: groupBId, role: 'organization_coordinator', organizationId: orgAId,
        }),
        body: { action: 'approve' },
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(res.status).toBe(404);
  });

  it("404s when org A's coordinator tries to reject org B's pending disbursement", async () => {
    const { id } = await createTestOrgDisbursement(orgBId, coordinatorBId, groupBId);

    const res = await POST(
      buildRequest(`/api/v1/organization/disbursements/${id}`, {
        method: 'POST',
        headers: authHeaders({
          userId: coordinatorAId, groupId: groupBId, role: 'organization_coordinator', organizationId: orgAId,
        }),
        body: { action: 'reject', reason: 'not my organization' },
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(res.status).toBe(404);
  });

  it("succeeds when org B's second coordinator approves org B's own pending disbursement", async () => {
    const { id } = await createTestOrgDisbursement(orgBId, coordinatorBId, groupBId);

    const res = await POST(
      buildRequest(`/api/v1/organization/disbursements/${id}`, {
        method: 'POST',
        headers: authHeaders({
          userId: secondCoordinatorBId, groupId: groupBId, role: 'organization_coordinator', organizationId: orgBId,
        }),
        body: { action: 'approve' },
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(res.status).toBe(200);
  });

  it('rejects maker-checker violation: the creating coordinator cannot approve their own org disbursement', async () => {
    const { id } = await createTestOrgDisbursement(orgBId, coordinatorBId, groupBId);

    const res = await POST(
      buildRequest(`/api/v1/organization/disbursements/${id}`, {
        method: 'POST',
        headers: authHeaders({
          userId: coordinatorBId, groupId: groupBId, role: 'organization_coordinator', organizationId: orgBId,
        }),
        body: { action: 'approve' },
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(res.status).toBe(403);
  });
});
