import { withDb, type TenantContext } from '@/lib/db';
import { NotFoundError } from '@/lib/utils/errors';
import { organizationService } from './organization.service';
import type { ProgramApplicationStatus } from './program-applications.service';
import type { ProgramInvitationStatus } from './program-invitations.service';
import type { ProgramMembershipStatus } from './programs.service';

export interface ProgramReport {
  active: number;
  total: number;
  distinctGroups: number;
  activeViaApplication: number;
  activeViaInvitation: number;
  memberships: Partial<Record<ProgramMembershipStatus, number>>;
  applications: Partial<Record<ProgramApplicationStatus, number>>;
  invitations: Partial<Record<ProgramInvitationStatus, number>>;
  monthlyActivity: { month: string; applications: number; invitations: number; enrolments: number }[];
}

export async function getProgramReport(ctx: TenantContext, programId: string): Promise<ProgramReport> {
  await organizationService.assertOrganizationCoordinator(ctx);
  return withDb(ctx, async (db) => {
    // One statement gives the totals and monthly figures the same snapshot. Stack
    // the three event sets so repeat enrolments and applications never multiply.
    const { rows } = await db.query<ProgramReport>(
      `WITH target AS (
         SELECT id FROM programs WHERE id = $1 AND (organization_id = $2 OR $3::boolean)
       ), activity AS (
         SELECT 'membership' AS kind, m.status::text, m.group_id, m.source::text, m.accepted_at AS event_at
         FROM target p JOIN program_memberships m ON m.program_id = p.id
         UNION ALL
         SELECT 'application', a.status::text, a.group_id, NULL, a.created_at
         FROM target p JOIN program_applications a ON a.program_id = p.id
         UNION ALL
         SELECT 'invitation', i.status::text, i.group_id, NULL, i.created_at
         FROM target p JOIN program_invitations i ON i.program_id = p.id
       ), status_counts AS (
         SELECT kind, status, COUNT(*) AS n FROM activity GROUP BY kind, status
       ), months AS (
         SELECT generate_series(current_month - INTERVAL '5 months', current_month, INTERVAL '1 month') AS month
         FROM (SELECT date_trunc('month', NOW() AT TIME ZONE 'Africa/Nairobi') AS current_month) bounds
       ), monthly_counts AS (
         SELECT date_trunc('month', event_at AT TIME ZONE 'Africa/Nairobi') AS month,
                COUNT(*) FILTER (WHERE kind = 'application') AS applications,
                COUNT(*) FILTER (WHERE kind = 'invitation') AS invitations,
                COUNT(*) FILTER (WHERE kind = 'membership') AS enrolments
         FROM activity
         WHERE event_at >= ((SELECT MIN(month) FROM months) AT TIME ZONE 'Africa/Nairobi') AND event_at <= NOW()
         GROUP BY 1
       )
       SELECT totals.*,
         COALESCE((SELECT jsonb_object_agg(status, n) FROM status_counts WHERE kind = 'membership'), '{}') AS memberships,
         COALESCE((SELECT jsonb_object_agg(status, n) FROM status_counts WHERE kind = 'application'), '{}') AS applications,
         COALESCE((SELECT jsonb_object_agg(status, n) FROM status_counts WHERE kind = 'invitation'), '{}') AS invitations,
         (SELECT jsonb_agg(jsonb_build_object(
            'month', to_char(m.month, 'YYYY-MM'), 'applications', COALESCE(c.applications, 0),
            'invitations', COALESCE(c.invitations, 0), 'enrolments', COALESCE(c.enrolments, 0)
          ) ORDER BY m.month)
          FROM months m LEFT JOIN monthly_counts c USING (month)) AS "monthlyActivity"
       FROM target CROSS JOIN (
         SELECT COUNT(*)::int AS total, (COUNT(*) FILTER (WHERE status = 'active'))::int AS active,
                COUNT(DISTINCT group_id)::int AS "distinctGroups",
                (COUNT(*) FILTER (WHERE status = 'active' AND source = 'application'))::int AS "activeViaApplication",
                (COUNT(*) FILTER (WHERE status = 'active' AND source = 'invitation'))::int AS "activeViaInvitation"
         FROM activity WHERE kind = 'membership'
       ) totals`,
      [programId, ctx.organizationId ?? null, ctx.role === 'super_admin'],
    );
    if (!rows[0]) throw new NotFoundError('Program', programId);
    return rows[0];
  });
}
