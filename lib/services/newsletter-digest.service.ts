/**
 * Admin-composed marketing emails to newsletter_subscribers (migration 209)
 * — aimed at growing signups and revenue, not promoting individual Changi$ha
 * fundraisers (that's a different, tenant-scoped concept entirely; see
 * campaigns.service.ts). Platform-level — no tenant, no group_id — and
 * deliberately NOT built on email_campaigns/email_campaign_recipients
 * (campaign.service.ts), which are group-tenant-scoped and have no audience
 * model for "every newsletter subscriber". Preview-before-fire: a draft is
 * composed from a starter template, the admin edits it, then explicitly
 * sends — sendDigest() is a separate, deliberate action from createDraft().
 */
import { withAdminDb } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import { wrapWithBranding, loadBranding } from '@/lib/email/templates/engine';
import { officialAppUrl, signUpUrl } from '@/lib/app-links';
import { BRAND } from '@/lib/brand';

const GREEN = BRAND.colors.green;

export type NewsletterDigestStatus = 'draft' | 'sending' | 'sent' | 'failed';

export interface NewsletterDigest {
  id: string;
  subject: string;
  html_body: string;
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

export type MarketingTemplateKey = 'feature_highlight' | 'changisha_spotlight' | 'pricing_nudge';

export interface MarketingTemplateSummary {
  key: MarketingTemplateKey;
  label: string;
  description: string;
}

function ctaButton(text: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;background:${GREEN};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">${text}</a>`;
}

/**
 * Starter content for a marketing send — a deliberate, admin-editable
 * starting point, not auto-generated from live data (there's no "this
 * week's" dataset to pull for a growth email the way there is for the
 * fundraiser digest this replaced). Each pitches a different reason to sign
 * up; the admin picks one, edits the copy, then sends.
 */
const MARKETING_TEMPLATES: Record<
  MarketingTemplateKey,
  { label: string; description: string; subject: string; htmlBody: string }
> = {
  feature_highlight: {
    label: 'Feature highlight',
    description: 'Introduce what Kitabu Yetu does, with a signup CTA.',
    subject: "Your group's records, finally in one place",
    htmlBody: `
      <p style="margin:0 0 16px;font-size:14px;color:#4b5563;line-height:1.6;">
        Most savings groups still keep records in a notebook and an M-Pesa statement matched to names the night before a meeting. Kitabu Yetu puts contributions, loans and statements in one place every member can see for themselves.
      </p>
      <ul style="margin:0 0 20px;padding-left:20px;font-size:14px;color:#4b5563;line-height:1.8;">
        <li>Contributions tracked automatically as members pay by M-Pesa</li>
        <li>Every member gets their own statement, any time</li>
        <li>Officers get real financial reports, not a reconciled spreadsheet</li>
      </ul>
      <p style="margin:0 0 24px;">${ctaButton('Create your free account', signUpUrl())}</p>
    `,
  },
  changisha_spotlight: {
    label: 'Changi$ha spotlight',
    description: 'Pitch fundraising-by-M-Pesa as a reason to sign up.',
    subject: 'Raise money for your cause, in the open, by M-Pesa',
    htmlBody: `
      <p style="margin:0 0 16px;font-size:14px;color:#4b5563;line-height:1.6;">
        Changi$ha is Kitabu Yetu's fundraising tool for harambees and community causes: donors give straight to an M-Pesa paybill, every contribution shows on a public page as it arrives, and funds are only released after review.
      </p>
      <p style="margin:0 0 20px;font-size:14px;color:#4b5563;line-height:1.6;">
        No monthly fee to start a campaign — just a standard platform fee, and the M-Pesa charge, only when you withdraw.
      </p>
      <p style="margin:0 0 24px;">${ctaButton('Start a campaign', `${officialAppUrl}/start-campaign`)}</p>
    `,
  },
  pricing_nudge: {
    label: 'Pricing & signup nudge',
    description: 'Straightforward CTA to see plans and register.',
    subject: 'What it costs to put your group on Kitabu Yetu',
    htmlBody: `
      <p style="margin:0 0 16px;font-size:14px;color:#4b5563;line-height:1.6;">
        Simple, per-group pricing — no hidden fees, no setup cost. See what it costs to move your group's records onto Kitabu Yetu, and sign up when you're ready.
      </p>
      <p style="margin:0 0 24px;">${ctaButton('See pricing & sign up', `${officialAppUrl}/pricing`)}</p>
    `,
  },
};

export function listMarketingTemplates(): MarketingTemplateSummary[] {
  return (Object.keys(MARKETING_TEMPLATES) as MarketingTemplateKey[]).map((key) => ({
    key,
    label: MARKETING_TEMPLATES[key].label,
    description: MARKETING_TEMPLATES[key].description,
  }));
}

/**
 * Builds (but does not persist or send) starter subject/body content from a
 * named template. The admin route wraps this in createDraft() to save it.
 */
export function composeDigestContent(templateKey: MarketingTemplateKey): { subject: string; htmlBody: string } {
  const tpl = MARKETING_TEMPLATES[templateKey];
  if (!tpl) throw new ValidationError(`Unknown template: ${templateKey}`);
  return { subject: tpl.subject, htmlBody: tpl.htmlBody };
}

export async function createDraft(
  adminUserId: string,
  input: { subject: string; htmlBody: string },
): Promise<NewsletterDigest> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<NewsletterDigest>(
      `INSERT INTO newsletter_digests (subject, html_body, created_by)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.subject, input.htmlBody, adminUserId],
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
