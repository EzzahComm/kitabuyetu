/**
 * Member drill-down on the organization axis —
 * GET /api/admin/organization/members/:id?groupId=…
 *
 * Final tier of Org → Group → Member. Two ids arrive from the client, so most of
 * what is worth asserting is that neither can be used to reach outside the
 * caller's organization, and that the response does not quietly widen PII
 * exposure across an organization boundary.
 *
 * The national_id test deliberately SETS a value first: asserting the absence of
 * a field that happens to be null proves nothing.
 */
import { GET as memberDetailGet } from '@/app/api/admin/organization/members/[id]/route';
import { backofficeHeaders, buildRequest } from './helpers/request';
import { createTestOrganization, createTestGroup } from './helpers/fixtures';
import { rawQuery } from './helpers/db';
import { resetDatabase } from './helpers/cleanup';
import { assignGroupToOrganization } from '@/lib/services/admin-organizations.service';

interface MemberDetail {
  memberId: string; firstName: string; lastName: string;
  phone: string; email: string | null;
  groupId: string; groupName: string; membershipNo: string | null;
  role: string; isActive: boolean; joinedAt: string;
  financials: { savings: number; loanBalance: number; shares: number; contributedThisPeriod: number } | null;
}
interface Body { member: MemberDetail; incomplete: string[] }

const call = (userId: string, organizationId: string, memberId: string, groupId: string | null) =>
  memberDetailGet(
    buildRequest(
      `/api/admin/organization/members/${memberId}${groupId ? `?groupId=${groupId}` : ''}`,
      { headers: backofficeHeaders({ userId, platformRole: 'organization_coordinator', organizationId }) },
    ),
    { params: Promise.resolve({ id: memberId }) },
  );

describe('Organization member drill-down', () => {
  beforeAll(async () => { await resetDatabase(); });
  afterAll(async ()  => { await resetDatabase(); });

  it('returns the membership detail with its financial snapshot', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();
    const { groupId, officerId } = await createTestGroup();
    await assignGroupToOrganization(organizationId, groupId, coordinatorId, 'read');

    const res = await call(coordinatorId, organizationId, officerId, groupId);
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: Body };

    expect(data.incomplete).toEqual([]);
    expect(data.member.memberId).toBe(officerId);
    expect(data.member.groupId).toBe(groupId);
    // The payment account reference (§2.1) lives on the membership, and every
    // real membership has one — a null here would break payment instructions.
    expect(data.member.membershipNo).toBeTruthy();
    // Present, and zeros here are genuine: the fixture records no money.
    expect(data.member.financials).not.toBeNull();
    expect(data.member.financials!.savings).toBe(0);
  });

  it('does not expose national_id across the organization boundary', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();
    const { groupId, officerId } = await createTestGroup();
    await assignGroupToOrganization(organizationId, groupId, coordinatorId, 'read');

    // Set a value so its absence below is meaningful.
    await rawQuery(`UPDATE members SET national_id = $2 WHERE id = $1`, [officerId, '12345678']);

    const res = await call(coordinatorId, organizationId, officerId, groupId);
    const body = JSON.stringify(await res.json());

    expect(body).not.toContain('12345678');
    expect(body).not.toContain('national');
  });

  it("404s for a member in a group the caller's organization does not link", async () => {
    const a = await createTestOrganization();
    const b = await createTestOrganization();
    const { groupId, officerId } = await createTestGroup();
    await assignGroupToOrganization(a.organizationId, groupId, a.coordinatorId, 'read');

    // B never linked this group. Must be 404 — not 403, which would confirm the
    // group exists, and certainly not the member's data.
    const res = await call(b.coordinatorId, b.organizationId, officerId, groupId);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain(officerId);
  });

  it('404s when the member is not in the named group', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();
    const linked = await createTestGroup();
    const other  = await createTestGroup();
    await assignGroupToOrganization(organizationId, linked.groupId, coordinatorId, 'read');

    // Valid linked group + a real member who belongs to a DIFFERENT group.
    const res = await call(coordinatorId, organizationId, other.officerId, linked.groupId);
    expect(res.status).toBe(404);
  });

  it('rejects a missing groupId at the boundary', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();
    const { officerId } = await createTestGroup();

    const res = await call(coordinatorId, organizationId, officerId, null);
    expect(res.status).toBe(422);
  });
});
