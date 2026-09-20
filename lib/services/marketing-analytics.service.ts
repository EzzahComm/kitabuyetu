/**
 * Cross-channel marketing analytics (Phase 9.6) — ties together bulk
 * campaigns (marketing_campaigns/email_campaigns, Phase 9.2/9.3), the
 * automation engine (sms_trigger_executions/email_trigger_executions,
 * Phase 9.4), and the CRM (crm_contacts/crm_opportunities/crm_activities,
 * Phase 9.1/9.5) into one view.
 *
 * Deliberately separate from lib/services/analytics.service.ts (the
 * financial executive summary behind /analytics) — the roadmap is explicit
 * that marketing metrics stay apart from financial/member scoring, not
 * layered onto the same dashboard.
 *
 * All queries rely on each table's own RLS (group/org scoping) rather than
 * an explicit WHERE — every table here already has it (migrations 052, 183,
 * 192, 194, 195).
 */

import { withDb, type TenantContext } from '@/lib/db';

export interface ChannelCampaignStats {
  campaigns: number;
  recipients: number;
  sent: number;
  failed: number;
  deliveryRate: number; // sent / recipients, 0–1
}

export interface EmailCampaignStats extends ChannelCampaignStats {
  opened: number;
  openRate: number; // opened / sent, 0–1
}

export interface AutomationStats {
  total: number;
  sent: number;
  failed: number;
  suppressed: number;
  pending: number;
}

export interface AutomationVolumePoint {
  date: string; // YYYY-MM-DD
  sms: number;
  email: number;
}

export interface CrmSnapshot {
  totalContacts: number;
  optedInContacts: number;
  optInRate: number; // 0–1
  opportunitiesByStage: Record<string, { count: number; amount: number }>;
  activitiesInPeriod: number;
}

export interface MarketingAnalytics {
  periodDays: number;
  generatedAt: string;
  sms: ChannelCampaignStats;
  email: EmailCampaignStats;
  automation: AutomationStats;
  automationVolume: AutomationVolumePoint[];
  crm: CrmSnapshot;
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export async function getMarketingAnalytics(ctx: TenantContext, days = 30): Promise<MarketingAnalytics> {
  const periodDays = Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 1), 365) : 30;

  return withDb(ctx, async (db) => {
    const [smsRow, emailRow, automationRows, volumeRows, contactRows, opportunityRows, activityRow] = await Promise.all([
      db.query<{ campaigns: string; recipients: string; sent: string; failed: string }>(
        `SELECT COUNT(*) AS campaigns, COALESCE(SUM(recipient_count), 0) AS recipients,
                COALESCE(SUM(sent_count), 0) AS sent, COALESCE(SUM(failed_count), 0) AS failed
         FROM marketing_campaigns
         WHERE channel = 'sms' AND created_at >= NOW() - make_interval(days => $1::int)`,
        [periodDays],
      ),
      db.query<{ campaigns: string; recipients: string; sent: string; failed: string; opened: string }>(
        `SELECT COUNT(*) AS campaigns, COALESCE(SUM(total_recipients), 0) AS recipients,
                COALESCE(SUM(sent_count), 0) AS sent, COALESCE(SUM(failed_count), 0) AS failed,
                COALESCE(SUM(opened_count), 0) AS opened
         FROM email_campaigns
         WHERE created_at >= NOW() - make_interval(days => $1::int)`,
        [periodDays],
      ),
      db.query<{ channel: 'sms' | 'email'; status: string; executions: string }>(
        `SELECT 'sms' AS channel, status::text AS status, COUNT(*) AS executions
           FROM sms_trigger_executions WHERE created_at >= NOW() - make_interval(days => $1::int)
           GROUP BY status
         UNION ALL
         SELECT 'email' AS channel, status::text AS status, COUNT(*) AS executions
           FROM email_trigger_executions WHERE created_at >= NOW() - make_interval(days => $1::int)
           GROUP BY status`,
        [periodDays],
      ),
      db.query<{ channel: 'sms' | 'email'; day: string; cnt: string }>(
        `SELECT channel, day, COUNT(*) AS cnt FROM (
           SELECT 'sms' AS channel, date_trunc('day', created_at) AS day
             FROM sms_trigger_executions
             WHERE created_at >= NOW() - make_interval(days => $1::int) AND status = 'sent'
           UNION ALL
           SELECT 'email' AS channel, date_trunc('day', created_at) AS day
             FROM email_trigger_executions
             WHERE created_at >= NOW() - make_interval(days => $1::int) AND status = 'sent'
         ) x
         GROUP BY channel, day
         ORDER BY day`,
        [periodDays],
      ),
      db.query<{ total: string; opted_in: string }>(
        `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE marketing_opt_in) AS opted_in FROM crm_contacts`,
      ),
      db.query<{ stage: string; count: string; amount: string }>(
        `SELECT stage, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM crm_opportunities GROUP BY stage`,
      ),
      db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM crm_activities WHERE occurred_at >= NOW() - make_interval(days => $1::int)`,
        [periodDays],
      ),
    ]);

    const sms = smsRow.rows[0];
    const smsSent = Number(sms.sent), smsRecipients = Number(sms.recipients);
    const email = emailRow.rows[0];
    const emailSent = Number(email.sent), emailRecipients = Number(email.recipients);

    const automation: AutomationStats = { total: 0, sent: 0, failed: 0, suppressed: 0, pending: 0 };
    for (const r of automationRows.rows) {
      const n = Number(r.executions);
      automation.total += n;
      if (r.status === 'sent') automation.sent += n;
      else if (r.status === 'failed') automation.failed += n;
      else if (r.status === 'suppressed') automation.suppressed += n;
      else if (r.status === 'pending') automation.pending += n;
    }

    // Zero-fill every day in the window for both channels, so the chart
    // doesn't silently skip days with no automation sends.
    const byDate = new Map<string, { sms: number; email: number }>();
    for (let i = 0; i < periodDays; i++) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      byDate.set(d.toISOString().slice(0, 10), { sms: 0, email: 0 });
    }
    for (const r of volumeRows.rows) {
      const key = new Date(r.day).toISOString().slice(0, 10);
      const bucket = byDate.get(key);
      if (bucket) bucket[r.channel] = Number(r.cnt);
    }
    const automationVolume = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));

    const opportunitiesByStage: CrmSnapshot['opportunitiesByStage'] = {};
    for (const r of opportunityRows.rows) {
      opportunitiesByStage[r.stage] = { count: Number(r.count), amount: Number(r.amount) };
    }

    const totalContacts = Number(contactRows.rows[0].total);
    const optedInContacts = Number(contactRows.rows[0].opted_in);

    return {
      periodDays,
      generatedAt: new Date().toISOString(),
      sms: {
        campaigns: Number(sms.campaigns), recipients: smsRecipients, sent: smsSent, failed: Number(sms.failed),
        deliveryRate: rate(smsSent, smsRecipients),
      },
      email: {
        campaigns: Number(email.campaigns), recipients: emailRecipients, sent: emailSent, failed: Number(email.failed),
        deliveryRate: rate(emailSent, emailRecipients),
        opened: Number(email.opened), openRate: rate(Number(email.opened), emailSent),
      },
      automation,
      automationVolume,
      crm: {
        totalContacts, optedInContacts, optInRate: rate(optedInContacts, totalContacts),
        opportunitiesByStage, activitiesInPeriod: Number(activityRow.rows[0].count),
      },
    };
  });
}
