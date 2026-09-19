import { withAdminDb } from '@/lib/db';

export interface ResendWebhookEvent {
  type: string;
  data: {
    email_id?: string;
    to?: string[];
    created_at?: string;
    [key: string]: unknown;
  };
}

// Process Resend webhook events
export async function processResendEvent(event: ResendWebhookEvent): Promise<void> {
  const messageId = event.data.email_id;
  if (!messageId) return;

  switch (event.type) {
    case 'email.delivered':
    case 'email.sent':
      await withAdminDb((db) =>
        db.query(
          `UPDATE email_logs SET status='sent', sent_at=COALESCE(sent_at, NOW()) WHERE provider_message_id=$1`,
          [messageId],
        ),
      ).catch(() => {});
      break;

    case 'email.opened':
      await withAdminDb((db) =>
        db.query(
          `UPDATE email_logs SET opened_at=COALESCE(opened_at, NOW()) WHERE provider_message_id=$1`,
          [messageId],
        ),
      ).catch(() => {});
      break;

    case 'email.clicked':
      await withAdminDb((db) =>
        db.query(
          `UPDATE email_logs SET clicked_at=COALESCE(clicked_at, NOW()) WHERE provider_message_id=$1`,
          [messageId],
        ),
      ).catch(() => {});
      break;

    case 'email.bounced':
      await withAdminDb((db) =>
        db.query(
          `UPDATE email_logs SET status='bounced', bounced_at=NOW() WHERE provider_message_id=$1`,
          [messageId],
        ),
      ).catch(() => {});
      await updateCampaignOpenCount(messageId);
      await suppressFromLog(messageId, 'bounce').catch(() => {});
      break;

    case 'email.complained':
      await withAdminDb((db) =>
        db.query(
          `UPDATE email_logs SET status='complained', unsubscribed_at=NOW() WHERE provider_message_id=$1`,
          [messageId],
        ),
      ).catch(() => {});
      await suppressFromLog(messageId, 'complaint').catch(() => {});
      break;

    case 'email.delivery_delayed':
      await withAdminDb((db) =>
        db.query(
          `UPDATE email_logs SET status='delayed' WHERE provider_message_id=$1`,
          [messageId],
        ),
      ).catch(() => {});
      break;
  }
}

/**
 * Phase 9.1: record a real, enforced suppression on bounce/complaint. Looks
 * up the recipient + group from the email_logs row this webhook already
 * updated (no new lookup path). Only group-scoped log rows produce a
 * suppression — email_suppressions requires exactly one of group_id/
 * organization_id (migration 192), and there is no org-level email send yet
 * for a scopeless row to meaningfully attach to.
 */
async function suppressFromLog(providerMessageId: string, source: 'bounce' | 'complaint'): Promise<void> {
  await withAdminDb(async (db) => {
    const { rows } = await db.query<{ to: string; group_id: string | null }>(
      `SELECT "to", group_id FROM email_logs WHERE provider_message_id = $1 LIMIT 1`,
      [providerMessageId],
    );
    const log = rows[0];
    if (!log || !log.group_id) return;

    await db.query(
      `INSERT INTO email_suppressions (group_id, email, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (group_id, email) WHERE group_id IS NOT NULL DO NOTHING`,
      [log.group_id, log.to, source],
    );
  });
}

// Increment campaign opened_count when a campaign email is opened
async function updateCampaignOpenCount(messageId: string): Promise<void> {
  const { rows } = await withAdminDb((db) =>
    db.query(
      `SELECT reference_id FROM email_logs
       WHERE provider_message_id=$1 AND reference_type='campaign' LIMIT 1`,
      [messageId],
    ),
  );
  if (!rows.length || !rows[0].reference_id) return;

  await withAdminDb((db) =>
    db.query(
      `UPDATE email_campaigns SET opened_count=opened_count+1 WHERE id=$1`,
      [rows[0].reference_id],
    ),
  ).catch(() => {});
}

// Analytics summary for the analytics dashboard
export async function getEmailAnalytics(groupId: string | null, days = 30): Promise<{
  total: number;
  sent: number;
  failed: number;
  opened: number;
  bounced: number;
  byCategory: { category: string; count: number }[];
  byDay: { date: string; sent: number; failed: number }[];
}> {
  // Was string-interpolated (`AND group_id = '${groupId}'`) directly into the
  // SQL text instead of a parameterised placeholder — every other query in
  // this file (and the codebase) passes values as $N params. Not currently
  // exploitable (groupId here always comes from a verified JWT via
  // app/api/v1/email/analytics/route.ts, never raw user input), but a
  // fragile pattern that becomes a real injection the moment any future
  // caller passes something less trusted. `days` was already parameterised
  // as $1; groupId now takes $2 the same way, only appended when present.
  const groupFilter = groupId ? `AND group_id = $2` : '';
  const params: unknown[] = groupId ? [days, groupId] : [days];

  const [totals, byCategory, byDay] = await Promise.all([
    withAdminDb((db) =>
      db.query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('sent','dry_run'))                 AS sent,
           COUNT(*) FILTER (WHERE status = 'failed')                            AS failed,
           COUNT(*) FILTER (WHERE opened_at IS NOT NULL)                        AS opened,
           COUNT(*) FILTER (WHERE bounced_at IS NOT NULL OR status = 'bounced') AS bounced,
           COUNT(*)                                                              AS total
         FROM email_logs
         WHERE created_at >= NOW() - ($1 || ' days')::interval ${groupFilter}`,
        params,
      ),
    ),
    withAdminDb((db) =>
      db.query(
        `SELECT category, COUNT(*) AS count
         FROM email_logs
         WHERE created_at >= NOW() - ($1 || ' days')::interval ${groupFilter}
         GROUP BY category ORDER BY count DESC`,
        params,
      ),
    ),
    withAdminDb((db) =>
      db.query(
        `SELECT DATE(created_at) AS date,
                COUNT(*) FILTER (WHERE status IN ('sent','dry_run')) AS sent,
                COUNT(*) FILTER (WHERE status = 'failed')            AS failed
         FROM email_logs
         WHERE created_at >= NOW() - ($1 || ' days')::interval ${groupFilter}
         GROUP BY DATE(created_at) ORDER BY date`,
        params,
      ),
    ),
  ]);

  const t = totals.rows[0];
  return {
    total:      Number(t?.total   ?? 0),
    sent:       Number(t?.sent    ?? 0),
    failed:     Number(t?.failed  ?? 0),
    opened:     Number(t?.opened  ?? 0),
    bounced:    Number(t?.bounced ?? 0),
    byCategory: byCategory.rows.map((r) => ({ category: r.category, count: Number(r.count) })),
    byDay:      byDay.rows.map((r) => ({
      date:   String(r.date),
      sent:   Number(r.sent),
      failed: Number(r.failed),
    })),
  };
}
