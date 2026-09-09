import { withAdminDb } from '@/lib/db';

/**
 * Tenant-facing SMS usage analytics (spec §8).
 *
 * CONTAINS NO COST OR MARGIN. §15 is explicit that provider cost is never
 * exposed to customers, so this module must never import
 * sms-pricing.service's getProviderCost or marginFor. What a customer may see
 * is what THEY pay — their own rate — not what we pay. Margin lives in
 * sms-margin.service.ts, behind the admin surface.
 *
 * Reads sms_usage_logs, which is the record of what was actually sent, and
 * sms_credits for what was bought.
 */

export interface FeatureUsage {
  /** notification_type, or null for rows written before it was populated. */
  feature: string | null;
  credits: number;
  messages: number;
}

export interface SmsUsageAnalytics {
  /**
   * Everything the group can actually send with: purchased credits PLUS the
   * unused part of the subscription's bundled allowance.
   *
   * This used to read `billing_accounts.sms_credits` alone, which counts only
   * PURCHASED credits. A group on a starter plan that had bought nothing saw a
   * balance of 0 and an "urgent, very low balance" badge while holding 47
   * unused bundled sends — the panel said the product was out of credit when
   * it was not. `smsService.getBalance()` had the allowance all along; this
   * one number simply never asked for it.
   */
  balance:            number;
  /** The two halves of `balance`, so the panel can show where it comes from. */
  purchasedBalance:   number;
  allowanceRemaining: number;
  creditsPurchased:   number;
  creditsConsumed:    number;
  usageThisMonth:     number;
  usageLastMonth:     number;
  /** Mean daily consumption over the trailing window, x30. Null when there is nothing to project from. */
  projectedMonthly:   number | null;
  /** Whole days of balance left at the current rate. Null when idle (never runs out) or already empty. */
  daysRemaining:      number | null;
  /** What this group's usage has cost THEM, at their own rate. Never provider cost. */
  costThisMonth:      number;
  byFeature:          FeatureUsage[];
  byCampaign:         Array<{ campaignId: string; name: string | null; credits: number; messages: number }>;
  /**
   * True when any consumption predates per-feature attribution. The UI must say
   * so rather than implying those messages were free or uncategorised by
   * choice — ~95% of historical production rows have no notification_type,
   * because the column postdates them.
   */
  hasUnattributedHistory: boolean;
}

/** Days of history used to project forward. Long enough to survive a quiet week. */
const PROJECTION_WINDOW_DAYS = 30;

export async function getUsageAnalytics(groupId: string): Promise<SmsUsageAnalytics> {
  return withAdminDb(async (db) => {
    const [balance, purchased, consumption, byFeature, byCampaign, rate] = await Promise.all([
      // SUM the allowance across ACTIVE subscriptions only, mirroring
      // smsService.getBalance() and reserve_sms_credits — a group holding both
      // products has two, and taking a single row would under-report it.
      db.query<{ sms_credits: string; allowance_included: string; allowance_used: string }>(
        `SELECT ba.sms_credits,
                COALESCE(SUM(s.sms_allowance_included), 0)::int AS allowance_included,
                COALESCE(MAX(ba.sms_allowance_used), 0)::int    AS allowance_used
         FROM billing_accounts ba
         LEFT JOIN subscriptions s ON s.group_id = ba.group_id AND s.status = 'active'
         WHERE ba.group_id = $1
         GROUP BY ba.sms_credits`,
        [groupId],
      ),
      db.query<{ purchased: string }>(
        `SELECT COALESCE(SUM(credits_added), 0) AS purchased
         FROM sms_credits WHERE group_id = $1`, [groupId],
      ),
      db.query<{
        consumed: string; this_month: string; last_month: string; window_credits: string;
      }>(
        // One pass over the consumed rows rather than four round trips.
        // billing_state = 'consumed' only: reserved rows are not yet spent and
        // released ones never were, so counting either would overstate usage.
        `SELECT
           COALESCE(SUM(credits_deducted), 0) AS consumed,
           COALESCE(SUM(credits_deducted) FILTER (
             WHERE settled_at >= date_trunc('month', CURRENT_DATE)), 0) AS this_month,
           COALESCE(SUM(credits_deducted) FILTER (
             WHERE settled_at >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
               AND settled_at <  date_trunc('month', CURRENT_DATE)), 0) AS last_month,
           COALESCE(SUM(credits_deducted) FILTER (
             WHERE settled_at >= CURRENT_DATE - $2::int), 0) AS window_credits
         FROM sms_usage_logs
         WHERE group_id = $1 AND billing_state = 'consumed'`,
        [groupId, PROJECTION_WINDOW_DAYS],
      ),
      db.query<{ feature: string | null; credits: string; messages: string }>(
        `SELECT notification_type AS feature,
                COALESCE(SUM(credits_deducted), 0) AS credits,
                COUNT(*) AS messages
         FROM sms_usage_logs
         WHERE group_id = $1 AND billing_state = 'consumed'
         GROUP BY notification_type
         ORDER BY SUM(credits_deducted) DESC NULLS LAST`,
        [groupId],
      ),
      db.query<{ campaign_id: string; name: string | null; credits: string; messages: string }>(
        `SELECT l.campaign_id, c.name,
                COALESCE(SUM(l.credits_deducted), 0) AS credits,
                COUNT(*) AS messages
         FROM sms_usage_logs l
         LEFT JOIN sms_campaigns c ON c.id = l.campaign_id
         WHERE l.group_id = $1 AND l.billing_state = 'consumed' AND l.campaign_id IS NOT NULL
         GROUP BY l.campaign_id, c.name
         ORDER BY SUM(l.credits_deducted) DESC
         LIMIT 20`,
        [groupId],
      ),
      // The group's OWN rate — what they pay, not what we pay.
      db.query<{ sms_rate: string }>(
        `SELECT COALESCE(MIN(sms_rate), 0.90) AS sms_rate
         FROM subscriptions WHERE group_id = $1 AND status = 'active'`,
        [groupId],
      ),
    ]);

    const purchasedBal   = Number(balance.rows[0]?.sms_credits ?? 0);
    const allowanceLeft  = Math.max(
      Number(balance.rows[0]?.allowance_included ?? 0) - Number(balance.rows[0]?.allowance_used ?? 0),
      0,
    );
    // What the group can send TODAY. Allowance is spent before purchased
    // credits, but for "can I send?" only the sum matters.
    const bal            = purchasedBal + allowanceLeft;
    const windowCredits  = Number(consumption.rows[0].window_credits);
    const thisMonth      = Number(consumption.rows[0].this_month);
    const groupRate      = Number(rate.rows[0]?.sms_rate ?? 0.9);

    // Projection only means something once something has been sent. Reporting
    // "0 days remaining" for a group that has never sent is worse than
    // reporting nothing — it reads as an alarm.
    const dailyRate        = windowCredits / PROJECTION_WINDOW_DAYS;
    const projectedMonthly = windowCredits > 0 ? dailyRate * 30 : null;
    const daysRemaining    = dailyRate > 0 ? Math.floor(bal / dailyRate) : null;

    const features = byFeature.rows.map((r) => ({
      feature:  r.feature,
      credits:  Number(r.credits),
      messages: Number(r.messages),
    }));

    return {
      balance:            bal,
      purchasedBalance:   purchasedBal,
      allowanceRemaining: allowanceLeft,
      creditsPurchased: Number(purchased.rows[0].purchased),
      creditsConsumed:  Number(consumption.rows[0].consumed),
      usageThisMonth:   thisMonth,
      usageLastMonth:   Number(consumption.rows[0].last_month),
      projectedMonthly,
      daysRemaining,
      costThisMonth:    thisMonth * groupRate,
      byFeature:        features,
      byCampaign: byCampaign.rows.map((r) => ({
        campaignId: r.campaign_id,
        name:       r.name,
        credits:    Number(r.credits),
        messages:   Number(r.messages),
      })),
      hasUnattributedHistory: features.some((f) => f.feature === null && f.messages > 0),
    };
  });
}

export const smsAnalyticsService = { getUsageAnalytics };
