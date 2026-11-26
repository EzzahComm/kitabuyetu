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

export async function processResendEvent(event: ResendWebhookEvent): Promise<void> {
  const messageId = event.data.email_id;
  if (!messageId) return;

  switch (event.type) {
    case 'email.delivered':
    case 'email.sent':
      await withAdminDb((db) =>
        db.query(
          `UPDATE email_logs SET status='sent', sent_at=COALESCE(sent_at, NOW())
           WHERE provider_message_id=$1 AND provider='resend' AND status NOT IN ('bounced', 'complained')`,
          [messageId],
        ),
      );
      break;

    case 'email.opened':
      await withAdminDb((db) =>
        db.query(
          `WITH first_opens AS (
             UPDATE email_logs SET opened_at=NOW()
             WHERE provider_message_id=$1 AND provider='resend' AND opened_at IS NULL
             RETURNING reference_type, reference_id
           )
           UPDATE email_campaigns AS campaign
           SET opened_count=campaign.opened_count+totals.opens
           FROM (
             SELECT reference_id, COUNT(*)::integer AS opens
             FROM first_opens WHERE reference_type='campaign' GROUP BY reference_id
           ) AS totals
           WHERE campaign.id=totals.reference_id`,
          [messageId],
        ),
      );
      break;

    case 'email.clicked':
      await withAdminDb((db) =>
        db.query(
          `UPDATE email_logs SET clicked_at=COALESCE(clicked_at, NOW()) WHERE provider_message_id=$1 AND provider='resend'`,
          [messageId],
        ),
      );
      break;

    case 'email.bounced':
    case 'email.complained':
      await withAdminDb(async (db) => {
        const complained = event.type === 'email.complained';
        const update = complained
          ? `UPDATE email_logs SET status='complained', unsubscribed_at=COALESCE(unsubscribed_at, NOW())
             WHERE provider_message_id=$1 AND provider='resend'`
          : `UPDATE email_logs SET status=CASE WHEN status='complained' THEN status ELSE 'bounced' END,
                   bounced_at=COALESCE(bounced_at, NOW())
             WHERE provider_message_id=$1 AND provider='resend'`;

        // Persist the recipient suppression in the same transaction as the log update.
        await db.query(
          `WITH affected AS (${update} RETURNING group_id, "to")
           INSERT INTO email_suppressions (group_id, email, source)
           SELECT group_id, "to", $2 FROM affected WHERE group_id IS NOT NULL
           ON CONFLICT (group_id, email) WHERE group_id IS NOT NULL DO NOTHING`,
          [messageId, complained ? 'complaint' : 'bounce'],
        );
      });
      break;

    case 'email.delivery_delayed':
      await withAdminDb((db) =>
        db.query(
          `UPDATE email_logs SET status='delayed'
           WHERE provider_message_id=$1 AND provider='resend' AND status NOT IN ('bounced', 'complained')`,
          [messageId],
        ),
      );
      break;
  }
}

// Analytics summary for the analytics dashboard
export async function getEmailAnalytics(
  groupId: string | null,
  days = 30,
): Promise<{
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
    total: Number(t?.total ?? 0),
    sent: Number(t?.sent ?? 0),
    failed: Number(t?.failed ?? 0),
    opened: Number(t?.opened ?? 0),
    bounced: Number(t?.bounced ?? 0),
    byCategory: byCategory.rows.map((r) => ({ category: r.category, count: Number(r.count) })),
    byDay: byDay.rows.map((r) => ({
      date: String(r.date),
      sent: Number(r.sent),
      failed: Number(r.failed),
    })),
  };
}
