/**
 * R11 audit-on-read, organization axis (migration 168).
 *
 * The assertion that matters most here is NOT that a row gets written — it is
 * that the row is then READABLE by the coordinator it concerns. Before
 * migration 168 an organization-level audit row could not be:
 * `audit_logs_select` allowed only `group_id = app_current_group_id()`, and a
 * coordinator has no group, so the audit page rendered empty rather than
 * erroring. Writing rows nobody can read is worse than not writing them,
 * because it looks like it works.
 *
 * Verified against a real Postgres before the migration was written: with one
 * row present, the owner (BYPASSRLS) saw 1 and app_tenant acting as an
 * organization_coordinator saw 0.
 */
import { GET as programsGet } from '@/app/api/admin/organization/programs/route';
import { GET as auditLogsGet } from '@/app/api/admin/organization/audit-logs/route';
import { backofficeHeaders, buildRequest } from './helpers/request';
import { createTestOrganization } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';

interface AuditRow { action: string; resourceType: string; actorId: string | null }
interface Paged { items: AuditRow[]; total: number }

const headersFor = (userId: string, organizationId: string) =>
  backofficeHeaders({ userId, platformRole: 'organization_coordinator', organizationId });

const readBudgetReport = (userId: string, organizationId: string) =>
  programsGet(buildRequest('/api/admin/organization/programs?report=budget', {
    headers: headersFor(userId, organizationId),
  }));

const readPlainList = (userId: string, organizationId: string) =>
  programsGet(buildRequest('/api/admin/organization/programs', {
    headers: headersFor(userId, organizationId),
  }));

const readAuditLog = (userId: string, organizationId: string) =>
  auditLogsGet(buildRequest('/api/admin/organization/audit-logs', {
    headers: headersFor(userId, organizationId),
  }));

describe('R11 — audit on significant organization reads', () => {
  beforeAll(async () => { await resetDatabase(); });
  afterAll(async ()  => { await resetDatabase(); });

  it('records a report view AND the coordinator can actually read it back', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();

    expect((await readBudgetReport(coordinatorId, organizationId)).status).toBe(200);

    const res = await readAuditLog(coordinatorId, organizationId);
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: Paged };

    const row = data.items.find(r => r.action === 'organization.report.budget.view');
    expect(row).toBeDefined();          // written...
    expect(row!.actorId).toBe(coordinatorId);
  });

  it('collapses repeat views inside the dedupe window into one row', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();

    await readBudgetReport(coordinatorId, organizationId);
    await readBudgetReport(coordinatorId, organizationId);
    await readBudgetReport(coordinatorId, organizationId);

    const { data } = await (await readAuditLog(coordinatorId, organizationId)).json() as { data: Paged };
    const rows = data.items.filter(r => r.action === 'organization.report.budget.view');

    // Three reads, one row. Without this a coordinator leaving a polling tab
    // open would bury every real access under hundreds of identical entries.
    expect(rows).toHaveLength(1);
  });

  it('does NOT audit the plain program list — that is what the UI polls', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();

    expect((await readPlainList(coordinatorId, organizationId)).status).toBe(200);

    const { data } = await (await readAuditLog(coordinatorId, organizationId)).json() as { data: Paged };
    expect(data.items.filter(r => r.action.startsWith('organization.report.'))).toHaveLength(0);
  });

  it("does not leak one organization's audit rows to another coordinator", async () => {
    const a = await createTestOrganization();
    const b = await createTestOrganization();

    await readBudgetReport(a.coordinatorId, a.organizationId);

    const { data } = await (await readAuditLog(b.coordinatorId, b.organizationId)).json() as { data: Paged };
    expect(data.items.filter(r => r.actorId === a.coordinatorId)).toHaveLength(0);
  });
});
