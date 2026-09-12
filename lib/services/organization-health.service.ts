/**
 * Portfolio health — the "what needs attention?" layer of the enterprise
 * dashboard (§1.5).
 *
 * §1.5 requires every dashboard to answer three questions in order: what is
 * happening, what needs attention, what do I do next. The portfolio dashboard
 * answered only the first — it showed totals and nothing about risk, so a
 * coordinator could read a healthy-looking page while a third of the portfolio
 * sat in arrears.
 *
 * Deliberately a separate module rather than another method on
 * organization-finance.service.ts: three pull requests are in flight against
 * that file, and a fourth concern wedged between them buys merge conflicts for
 * no structural benefit. Risk/health is also a coherent seam of its own.
 *
 * THE PREDICATES ARE NOT NEW. They are lifted verbatim from
 * analytics.service.ts (the group-level risk view), because two definitions of
 * "overdue" that disagree would be worse than having none — the coordinator
 * would see one number on the portfolio page and a different one after drilling
 * into a group:
 *
 *   active    → status IN ('active','disbursed')
 *   overdue   → next_payment_date < CURRENT_DATE AND status IN ('active','disbursed')
 *   defaulted → status IN ('defaulted','written_off')
 *
 * Verified against the live enum: pending, approved, rejected, disbursed,
 * active, completed, defaulted, written_off.
 */
import { withDb, type TenantContext } from '@/lib/db';
import { organizationService } from './organization.service';
import { ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/logger';

const orgId = (ctx: TenantContext): string => {
  if (!ctx.organizationId) throw new ValidationError('Organization context is required');
  return ctx.organizationId;
};

export interface PortfolioHealth {
  linkedGroups:          number;
  activeLoans:           number;
  /** Loans whose next payment date has passed while still active. */
  overdueLoans:          number;
  overdueOutstanding:    string;
  /** Share of active loans that are overdue, 0-100. Null when there are none. */
  overdueLoanPct:        number | null;
  /** Groups carrying at least one overdue loan. */
  groupsInArrears:       number;
  /** Share of linked groups in arrears, 0-100. Null when none are linked. */
  groupsInArrearsPct:    number | null;
  defaultedLoans:        number;
  defaultedOutstanding:  string;
  /** Members currently marked inactive. A COUNT, not a rate — see below. */
  inactiveMembers:       number;
  /** Members who joined in the last 30 days. */
  newMembers30d:         number;
}

interface HealthRow {
  linked_groups: string; active_loans: string;
  overdue_loans: string; overdue_outstanding: string;
  groups_in_arrears: string; defaulted_loans: string;
  defaulted_outstanding: string; inactive_members: string;
  new_members_30d: string;
}

/** Percentage, or null when the denominator is zero — never a fabricated 0%. */
const pct = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;

export const organizationHealthService = {
  /**
   * Risk indicators across every group this organization actively links.
   *
   * NOT INCLUDED: a member churn rate. `group_members` carries `joined_at` and
   * `is_active` but no `left_at`, so there is no date on which a member ceased
   * to be active and no period over which a rate could honestly be computed.
   * What is returned instead is the current inactive COUNT plus 30-day joins.
   * Deriving a "churn %" from those would be presenting a number the data does
   * not support — the same failure R10 names for money, applied to a ratio.
   * A real rate needs a `left_at` column; backfilling one for past departures
   * would be fiction.
   *
   * R10: returns null rather than throwing when the aggregate cannot be read,
   * so the caller reports it as unavailable instead of rendering zero risk —
   * "no arrears" and "could not check for arrears" must not look alike.
   */
  async getPortfolioHealth(ctx: TenantContext): Promise<PortfolioHealth | null> {
    await organizationService.assertOrganizationCoordinator(ctx);

    try {
      return await withDb(ctx, async (db) => {
        const { rows } = await db.query<HealthRow>(
          // per_group pre-aggregates with correlated subqueries instead of
          // joining loans and group_members together: a flat join fans every
          // loan row across every member row of the same group before the
          // COUNT/SUM runs. Same fan-out class proven live in PR #105 (99x on
          // one group) and guarded the same way in getDashboard.
          `WITH linked AS (
             SELECT DISTINCT nga.group_id
             FROM organization_group_access nga
             WHERE nga.organization_id = $1 AND nga.is_active
           ),
           per_group AS (
             SELECT lk.group_id,
               (SELECT COUNT(*) FROM loans l
                 WHERE l.group_id = lk.group_id
                   AND l.status IN ('active','disbursed')) AS active_loans,
               (SELECT COUNT(*) FROM loans l
                 WHERE l.group_id = lk.group_id
                   AND l.status IN ('active','disbursed')
                   AND l.next_payment_date < CURRENT_DATE) AS overdue_loans,
               (SELECT COALESCE(SUM(l.outstanding_balance), 0) FROM loans l
                 WHERE l.group_id = lk.group_id
                   AND l.status IN ('active','disbursed')
                   AND l.next_payment_date < CURRENT_DATE) AS overdue_outstanding,
               (SELECT COUNT(*) FROM loans l
                 WHERE l.group_id = lk.group_id
                   AND l.status IN ('defaulted','written_off')) AS defaulted_loans,
               (SELECT COALESCE(SUM(l.outstanding_balance), 0) FROM loans l
                 WHERE l.group_id = lk.group_id
                   AND l.status IN ('defaulted','written_off')) AS defaulted_outstanding,
               (SELECT COUNT(*) FROM group_members gm
                 WHERE gm.group_id = lk.group_id
                   AND NOT gm.is_active) AS inactive_members,
               (SELECT COUNT(*) FROM group_members gm
                 WHERE gm.group_id = lk.group_id
                   AND gm.is_active
                   AND gm.joined_at >= CURRENT_DATE - INTERVAL '30 days') AS new_members_30d
             FROM linked lk
           )
           SELECT
             COUNT(*)::text                                          AS linked_groups,
             COALESCE(SUM(active_loans), 0)::text                    AS active_loans,
             COALESCE(SUM(overdue_loans), 0)::text                   AS overdue_loans,
             COALESCE(SUM(overdue_outstanding), 0)::text             AS overdue_outstanding,
             COUNT(*) FILTER (WHERE overdue_loans > 0)::text         AS groups_in_arrears,
             COALESCE(SUM(defaulted_loans), 0)::text                 AS defaulted_loans,
             COALESCE(SUM(defaulted_outstanding), 0)::text           AS defaulted_outstanding,
             COALESCE(SUM(inactive_members), 0)::text                AS inactive_members,
             COALESCE(SUM(new_members_30d), 0)::text                 AS new_members_30d
           FROM per_group`,
          [orgId(ctx)],
        );

        const r = rows[0];
        if (!r) {
          // The aggregate runs over `linked`, so an organization with no linked
          // groups still yields one row of zeros. No row means the read gave no
          // answer — reporting that as "no risk" is the failure to avoid.
          logger.error('[organization-health] portfolio health aggregate returned no row');
          return null;
        }

        const activeLoans  = parseInt(r.active_loans, 10);
        const linkedGroups = parseInt(r.linked_groups, 10);
        const overdueLoans = parseInt(r.overdue_loans, 10);
        const inArrears    = parseInt(r.groups_in_arrears, 10);

        return {
          linkedGroups,
          activeLoans,
          overdueLoans,
          overdueOutstanding:   r.overdue_outstanding,
          overdueLoanPct:       pct(overdueLoans, activeLoans),
          groupsInArrears:      inArrears,
          groupsInArrearsPct:   pct(inArrears, linkedGroups),
          defaultedLoans:       parseInt(r.defaulted_loans, 10),
          defaultedOutstanding: r.defaulted_outstanding,
          inactiveMembers:      parseInt(r.inactive_members, 10),
          newMembers30d:        parseInt(r.new_members_30d, 10),
        };
      });
    } catch (err) {
      logger.error('[organization-health] portfolio health unavailable', err);
      return null;
    }
  },
};
