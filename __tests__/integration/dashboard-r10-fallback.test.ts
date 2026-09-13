/**
 * R10 on the portfolio dashboard — GET /api/admin/organization/dashboard.
 *
 * The distinction under test is the whole point of the change: an organization
 * that genuinely holds nothing and a query that failed to read must NOT look
 * alike. Before this, both rendered "KES 0", because the service fell back to
 * `?? '0'` per field and the UI did it again — so a coordinator could read a
 * failed query as their groups' money having vanished.
 *
 * After: a real empty org returns a populated `portfolio` of genuine zeros with
 * `incomplete: []`; an unreadable section returns `null` and names itself in
 * `incomplete`, and the UI renders a dash rather than a number.
 *
 * Each test uses its OWN organization on purpose — getDashboard caches on
 * `org-dashboard:<orgId>` for 30s, so sharing one org between cases would let
 * the first result satisfy the second.
 */
import { GET as dashboardGet } from '@/app/api/admin/organization/dashboard/route';
import { backofficeHeaders, buildRequest } from './helpers/request';
import { createTestOrganization, createTestGroup, createTestOrgDisbursement } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';

interface DashboardBody {
  financial:  Record<string, string | number> | null;
  portfolio:  Record<string, string | number> | null;
  programs:   unknown[] | null;
  incomplete: string[];
}

const call = (userId: string, organizationId: string) =>
  dashboardGet(buildRequest('/api/admin/organization/dashboard', {
    headers: backofficeHeaders({ userId, platformRole: 'organization_coordinator', organizationId }),
  }));

describe('Portfolio dashboard — R10 per-metric fallback', () => {
  beforeAll(async () => { await resetDatabase(); });
  afterAll(async ()  => { await resetDatabase(); });

  it('an organization that genuinely holds nothing reports real zeros, NOT an unavailable section', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();

    const res = await call(coordinatorId, organizationId);
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: DashboardBody };

    // Nothing failed, so nothing may be flagged...
    expect(data.incomplete).toEqual([]);
    // ...and the section must be PRESENT rather than null — "empty" is an
    // answer, and it has to be distinguishable from "no answer".
    expect(data.portfolio).not.toBeNull();
    expect(data.portfolio!.linkedGroups).toBe(0);
    expect(parseFloat(String(data.portfolio!.totalSavings))).toBe(0);
    expect(data.financial).not.toBeNull();
  });

  it('reports real figures once the organization actually has a funded group', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();
    const { groupId } = await createTestGroup();
    await createTestOrgDisbursement(organizationId, coordinatorId, groupId, 25_000);

    const res = await call(coordinatorId, organizationId);
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: DashboardBody };

    expect(data.incomplete).toEqual([]);
    expect(data.portfolio).not.toBeNull();
    expect(data.portfolio!.linkedGroups).toBe(1);

    // The wallet was funded and drawn down by the fixture, so these are real
    // movements — proving the financial section carries actual data rather
    // than a zero-filled placeholder.
    expect(data.financial).not.toBeNull();
    expect(parseFloat(String(data.financial!.totalDisbursed))).toBeGreaterThan(0);
  });

  it('never emits a null section without naming it in incomplete', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();

    const res = await call(coordinatorId, organizationId);
    const { data } = await res.json() as { data: DashboardBody };

    // The contract the UI relies on: a section is null IFF it is listed in
    // `incomplete`. Without this, a null would silently render as a dash with
    // no explanation shown to the user.
    for (const [section, value] of Object.entries({
      financial: data.financial, portfolio: data.portfolio, programs: data.programs,
    })) {
      expect(value === null).toBe(data.incomplete.includes(section));
    }
  });
});
