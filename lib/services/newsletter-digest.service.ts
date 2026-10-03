/**
 * Admin-composed campaign digest emails to newsletter_subscribers (migration
 * 209). Platform-level — no tenant, no group_id — and deliberately NOT built
 * on email_campaigns/email_campaign_recipients (campaign.service.ts), which
 * are group-tenant-scoped and have no audience model for "every newsletter
 * subscriber". Preview-before-fire: composeDraft() only builds content,
 * sendDigest() is the explicit, separate action that actually dispatches —
 * an admin reviews/edits the draft in between.
 */
import { withAdminDb } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import { campaignsService, type Campaign } from '@/lib/services/campaigns.service';
import { wrapWithBranding, loadBranding } from '@/lib/email/templates/engine';
import { officialAppUrl } from '@/lib/app-links';
import { formatKES } from '@/lib/utils';

export type NewsletterDigestStatus = 'draft' | 'sending' | 'sent' | 'failed';

export interface NewsletterDigest {
  id: string;
  subject: string;
  html_body: string;
  campaign_ids: string[];
  status: NewsletterDigestStatus;
  total_recipients: number | null;
  sent_count: number;
  failed_count: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface NewsletterDigestRecipient {
  id: string;
  digest_id: string;
  subscriber_id: string;
  email: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  error_message: string | null;
  sent_at: Date | null;
}

/**
 * Campaign title/story come from the public, unauthenticated self-serve form
 * (register_campaign RPC) — never trust them as HTML. Every digest embeds
 * them verbatim in an email every subscriber receives, so this is the one
 * place in the digest that MUST escape before interpolating.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function campaignCardHtml(c: Campaign): string {
  const url = `${officialAppUrl}/fundraise/${c.slug}`;
  const rawSnippet = c.story.length > 220 ? `${c.story.slice(0, 220).trim()}…` : c.story;
  const title = escapeHtml(c.title);
  const snippet = escapeHtml(rawSnippet);
  const pct = Math.min(100, Math.round((parseFloat(c.amount_raised) / parseFloat(c.target_amount)) * 100) || 0);
  return `
    <tr><td style="padding:0 0 24px;">
      <h3 style="margin:0 0 8px;font-size:17px;color:#111827;">${title}</h3>
      <p style="margin:0 0 10px;font-size:14px;color:#4b5563;line-height:1.5;">${snippet}</p>
      <div style="background:#e5e7eb;border-radius:999px;height:8px;overflow:hidden;margin:0 0 8px;">
        <div style="background:#1E8E5A;height:8px;width:${pct}%;"></div>
      </div>
      <p style="margin:0 0 14px;font-size:13px;color:#6b7280;">
        ${formatKES(c.amount_raised)} raised of ${formatKES(c.target_amount)} target (${pct}%)
      </p>
      <a href="${url}" style="display:inline-block;background:#1E8E5A;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Give to this campaign</a>
    </td></tr>
    <tr><td style="border-top:1px solid #e5e7eb;padding:0 0 24px;"></td></tr>
  `;
}

/**
 * Builds (but does not persist or send) default subject/body content from
 * currently-active Changi$ha campaigns. The admin route wraps this in
 * createDraft() to actually save it.
 */
export async function composeDigestContent(): Promise<{ subject: string; htmlBody: string; campaignIds: string[] }> {
  const campaigns = await campaignsService.listActiveCampaigns();

  if (campaigns.length === 0) {
    return {
      subject: 'Causes you can support on Kitabu Yetu Changi$ha',
      htmlBody: `<table role="presentation" width="100%"><tr><td><p style="font-size:14px;color:#4b5563;">There are no active campaigns right now — check back soon.</p></td></tr></table>`,
      campaignIds: [],
    };
  }

  const intro = `<tr><td style="padding:0 0 20px;"><p style="margin:0;font-size:14px;color:#4b5563;line-height:1.5;">Here are the Changi$ha campaigns running on Kitabu Yetu this week. Every shilling is recorded and released only after review.</p></td></tr>`;
  const cards = campaigns.map(campaignCardHtml).join('\n');

  return {
    subject: `${campaigns.length} cause${campaigns.length === 1 ? '' : 's'} you can support this week on Kitabu Yetu`,
    htmlBody: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${intro}${cards}</table>`,
    campaignIds: campaigns.map((c) => c.id),
  };
}

export async function createDraft(
  adminUserId: string,
  input: { subject: string; htmlBody: string; campaignIds: string[] },
): Promise<NewsletterDigest> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<NewsletterDigest>(
      `INSERT INTO newsletter_digests (subject, html_body, campaign_ids, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.subject, input.htmlBody, input.campaignIds, adminUserId],
    );
    return rows[0];
  });
}

export async function getDigest(id: string): Promise<NewsletterDigest> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<NewsletterDigest>(`SELECT * FROM newsletter_digests WHERE id = $1`, [id]);
    if (!rows.length) throw new NotFoundError('Digest');
    return rows[0];
  });
}

export async function listDigests(): Promise<NewsletterDigest[]> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<NewsletterDigest>(
      `SELECT * FROM newsletter_digests ORDER BY created_at DESC LIMIT 50`,
    );
    return rows;
  });
}

/** Only while still a draft — a sent/sending digest's content is locked (recipients may already have it). */
export async function updateDraft(id: string, input: { subject: string; htmlBody: string }): Promise<NewsletterDigest> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<NewsletterDigest>(
      `UPDATE newsletter_digests
       SET subject = $1, html_body = $2, updated_at = NOW()
       WHERE id = $3 AND status = 'draft'
       RETURNING *`,
      [input.subject, input.htmlBody, id],
    );
    if (!rows.length) throw new ValidationError('Digest not found or no longer a draft');
    return rows[0];
  });
}

/**
 * Snapshots every currently-active subscriber as a recipient row and flips
 * the digest to 'sending' — mirrors campaign.service.ts's launchCampaign().
 * The actual sends happen in drainDigestRecipients(), picked up by the next
 * 5-min cron tick (lib/jobs/index.ts's hasPendingDigestRecipients() gate),
 * the same launch/drain split and wait as the existing group-level
 * email_campaign_launch/email_campaign_drain pair.
 */
export async function sendDigest(id: string, adminUserId: string): Promise<NewsletterDigest> {
  const digest = await withAdminDb(async (client) => {
    const { rows: existing } = await client.query<NewsletterDigest>(
      `SELECT * FROM newsletter_digests WHERE id = $1 AND status = 'draft' FOR UPDATE`,
      [id],
    );
    if (!existing.length) throw new ValidationError('Digest not found or already sent');

    const { rows: subs } = await client.query<{ id: string; email: string }>(
      `SELECT id, email FROM newsletter_subscribers WHERE unsubscribed_at IS NULL`,
    );
    if (!subs.length) throw new ValidationError('No active subscribers to send to');

    for (const s of subs) {
      await client.query(
        `INSERT INTO newsletter_digest_recipients (digest_id, subscriber_id, email)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [id, s.id, s.email],
      );
    }

    const { rows: updated } = await client.query<NewsletterDigest>(
      `UPDATE newsletter_digests
       SET status = 'sending', total_recipients = $1, started_at = NOW(), updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [subs.length, id],
    );

    await client.query(
      `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
       VALUES (NULL, $1, 'newsletter_digest.send', 'newsletter_digest', $2, $3, $4)`,
      [
        adminUserId,
        id,
        JSON.stringify({ status: 'draft' }),
        JSON.stringify({ status: 'sending', total_recipients: subs.length }),
      ],
    );

    return updated[0];
  });

  return digest;
}

/**
 * Builds the final branded HTML for one recipient: the draft body plus a
 * per-recipient unsubscribe footer (the same /newsletter/unsubscribe page
 * subscribeToNewsletter's confirmation flow already links to).
 */
export async function renderDigestEmail(htmlBody: string, unsubscribeToken: string): Promise<string> {
  const branding = await loadBranding(null);
  const unsubscribeUrl = `${officialAppUrl}/newsletter/unsubscribe?token=${unsubscribeToken}`;
  const withFooterLink = `${htmlBody}
    <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
      <a href="${unsubscribeUrl}" style="color:#9ca3af;">Unsubscribe</a>
    </p>`;
  return wrapWithBranding(withFooterLink, branding);
}

export interface DigestDrainResult {
  processed: number;
  sent: number;
  failed: number;
}

/**
 * Claims a bounded batch of pending recipient rows and sends each — mirrors
 * campaign.service.ts's drainCampaignRecipients() FOR UPDATE SKIP LOCKED
 * idiom so concurrent ticks never double-send the same recipient.
 */
export async function drainDigestRecipients(limit = 40): Promise<DigestDrainResult> {
  const { sendEmailWithFallback } = await import('@/lib/email/provider');

  const { rows } = await withAdminDb((db) =>
    db.query<{
      id: string;
      digest_id: string;
      email: string;
      subscriber_id: string;
      unsubscribe_token: string;
      subject: string;
      html_body: string;
    }>(
      `UPDATE newsletter_digest_recipients ndr
       SET status = 'sending'
       FROM (
         SELECT ndr2.id
         FROM newsletter_digest_recipients ndr2
         JOIN newsletter_digests nd2 ON nd2.id = ndr2.digest_id
         WHERE ndr2.status = 'pending' AND nd2.status = 'sending'
         ORDER BY ndr2.created_at ASC
         LIMIT $1
         FOR UPDATE OF ndr2 SKIP LOCKED
       ) claimed,
       newsletter_digests nd,
       newsletter_subscribers ns
       WHERE ndr.id = claimed.id AND nd.id = ndr.digest_id AND ns.id = ndr.subscriber_id
       RETURNING ndr.id, ndr.digest_id, ndr.email, ndr.subscriber_id, ns.unsubscribe_token,
                 nd.subject, nd.html_body`,
      [limit],
    ),
  );

  let sent = 0;
  let failed = 0;

  for (const r of rows) {
    const html = await renderDigestEmail(r.html_body, r.unsubscribe_token);
    const result = await sendEmailWithFallback({
      to: r.email,
      subject: r.subject,
      html,
      category: 'newsletter_digest',
      referenceId: r.digest_id,
      referenceType: 'newsletter_digest',
    });

    const status = result.success ? 'sent' : 'failed';
    if (result.success) sent++;
    else failed++;

    await withAdminDb((db) =>
      db.query(
        `UPDATE newsletter_digest_recipients
         SET status = $1, error_message = $2, sent_at = CASE WHEN $1 = 'sent' THEN NOW() ELSE NULL END
         WHERE id = $3`,
        [status, result.success ? null : (result.error ?? 'Unknown error'), r.id],
      ),
    ).catch(() => {});

    const col = result.success ? 'sent_count' : 'failed_count';
    await withAdminDb((db) =>
      db.query(`UPDATE newsletter_digests SET ${col} = ${col} + 1, updated_at = NOW() WHERE id = $1`, [r.digest_id]),
    ).catch(() => {});
  }

  if (rows.length) {
    await withAdminDb((db) =>
      db.query(
        `UPDATE newsletter_digests
         SET status = 'sent', completed_at = NOW()
         WHERE id = ANY($1::uuid[])
           AND (sent_count + failed_count) >= COALESCE(total_recipients, 0)
           AND status = 'sending'`,
        [[...new Set(rows.map((r) => r.digest_id))]],
      ),
    ).catch(() => {});
  }

  return { processed: rows.length, sent, failed };
}
