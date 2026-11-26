import { GET } from '@/app/api/admin/organization/group-programs/[id]/reports/route';
import { programsService } from '@/lib/services/programs.service';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import { createTestOrganization, createTestGroup } from './helpers/fixtures';
import { backofficeHeaders, buildRequest } from './helpers/request';
import type { ProgramReport } from '@/lib/services/program-reports.service';

async function read(id: string, organization: Awaited<ReturnType<typeof createTestOrganization>>) {
  const headers = backofficeHeaders({
    userId: organization.coordinatorId,
    organizationId: organization.organizationId,
    platformRole: 'organization_coordinator',
  });
  return GET(buildRequest(`/api/admin/organization/group-programs/${id}/reports`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

describe('Programme enrolment report', () => {
  beforeAll(resetDatabase);
  afterAll(resetDatabase);

  it('separates repeat memberships, recruitment statuses and Nairobi reporting months', async () => {
    const org = await createTestOrganization();
    const group = await createTestGroup();
    const ctx = {
      userId: org.coordinatorId,
      organizationId: org.organizationId,
      groupId: '',
      role: 'organization_coordinator',
    };
    const p = await programsService.createProgram(ctx, { name: 'Recruitment report' });
    const otherProgram = await programsService.createProgram(ctx, { name: 'Separate programme' });

    // Local midnight at the start of the first displayed month falls on the previous UTC date.
    const [{ boundary, month }] = await rawQuery<{ boundary: Date; month: string }>(`
      SELECT first_month AT TIME ZONE 'Africa/Nairobi' AS boundary, to_char(first_month, 'YYYY-MM') AS month
      FROM (SELECT date_trunc('month', NOW() AT TIME ZONE 'Africa/Nairobi') - INTERVAL '5 months' AS first_month) bounds`);
    await rawQuery(
      `INSERT INTO program_memberships (program_id, group_id, status, source, joined_at, accepted_at)
      VALUES ($1,$2,'withdrawn','application',$3::timestamptz - interval '1 second',$3::timestamptz - interval '1 second'),
             ($1,$2,'active','invitation',$3,$3), ($4,$2,'active','application',$3,$3)`,
      [p.id, group.groupId, boundary, otherProgram.id],
    );
    await rawQuery(
      `INSERT INTO program_applications (program_id, group_id, submitted_by, status, created_at)
      VALUES ($1,$2,$3,'withdrawn',$4), ($1,$2,$3,'under_review',$4), ($5,$2,$3,'submitted',$4)`,
      [p.id, group.groupId, group.officerId, boundary, otherProgram.id],
    );
    await rawQuery(
      `INSERT INTO program_invitations (program_id, group_id, invited_by, status, created_at)
      VALUES ($1,$2,$3,'accepted',$4), ($1,$2,$3,'cancelled',$4), ($5,$2,$3,'pending',$4)`,
      [p.id, group.groupId, org.coordinatorId, boundary, otherProgram.id],
    );

    const res = await read(p.id, org);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: ProgramReport };
    expect(data).toMatchObject({
      active: 1,
      total: 2,
      distinctGroups: 1,
      activeViaApplication: 0,
      activeViaInvitation: 1,
    });
    expect(data.memberships).toEqual({ withdrawn: 1, active: 1 });
    expect(data.applications).toEqual({ withdrawn: 1, under_review: 1 });
    expect(data.invitations).toEqual({ accepted: 1, cancelled: 1 });
    expect(data.monthlyActivity).toHaveLength(6);
    expect(data.monthlyActivity[0]).toEqual({ month, applications: 2, invitations: 2, enrolments: 1 });
    data.monthlyActivity
      .slice(1)
      .forEach((row) => expect(row).toMatchObject({ applications: 0, invitations: 0, enrolments: 0 }));
  });

  it('returns an empty report for an owned programme and 404 for a different organization', async () => {
    const org = await createTestOrganization();
    const other = await createTestOrganization();
    const ctx = {
      userId: org.coordinatorId,
      organizationId: org.organizationId,
      groupId: '',
      role: 'organization_coordinator',
    };
    const p = await programsService.createProgram(ctx, { name: 'Empty report' });
    await programsService.transitionStatus(ctx, p.id, 'published');
    const res = await read(p.id, org);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({
      active: 0,
      total: 0,
      distinctGroups: 0,
      memberships: {},
      applications: {},
      invitations: {},
    });
    expect((await read(p.id, other)).status).toBe(404);
    expect((await read('invalid-program', org)).status).toBe(422);
  });
});
