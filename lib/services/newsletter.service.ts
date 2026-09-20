/**
 * Public marketing-site newsletter (Phase 10). Platform-level, not tenant —
 * see migration 197 for why this isn't modeled on crm_contacts or the old
 * per-group newsletter_subscribers table it replaces.
 *
 * Writes go through withAdminDb (no TenantContext exists for an anonymous
 * website visitor); RLS still restricts reads to super_admin, so this
 * service is the only path in or out of the table.
 */
import { withAdminDb } from '@/lib/db';
import { NotFoundError } from '@/lib/utils/errors';

export interface NewsletterSubscriber {
  id: string;
  email: string;
  name: string | null;
  source: string;
  unsubscribe_token: string;
  subscribed_at: Date;
  unsubscribed_at: Date | null;
  created_at: Date;
}

export interface NewsletterStats {
  total: number;
  active: number;
  unsubscribed: number;
}

/**
 * Subscribe (or re-subscribe) an email address. Idempotent by design: a
 * repeat submission from the same address just refreshes it rather than
 * erroring, and a previously-unsubscribed address subscribing again clears
 * unsubscribed_at while keeping the same row (and unsubscribe_token).
 */
export async function subscribeToNewsletter(data: {
  email: string;
  name?: string;
  source?: string;
}): Promise<NewsletterSubscriber> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<NewsletterSubscriber>(
      `INSERT INTO newsletter_subscribers (email, name, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (lower(email)) DO UPDATE
         SET unsubscribed_at = NULL,
             name = COALESCE(EXCLUDED.name, newsletter_subscribers.name),
             updated_at = NOW()
       RETURNING *`,
      [data.email, data.name ?? null, data.source ?? 'website'],
    );
    return rows[0];
  });
}

/** Idempotent: unsubscribing an already-unsubscribed token keeps its original timestamp. */
export async function unsubscribeFromNewsletter(token: string): Promise<NewsletterSubscriber> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<NewsletterSubscriber>(
      `UPDATE newsletter_subscribers
       SET unsubscribed_at = COALESCE(unsubscribed_at, NOW()), updated_at = NOW()
       WHERE unsubscribe_token = $1
       RETURNING *`,
      [token],
    );
    if (!rows.length) throw new NotFoundError('Subscription');
    return rows[0];
  });
}

export async function listNewsletterSubscribers(filters?: { activeOnly?: boolean }): Promise<NewsletterSubscriber[]> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<NewsletterSubscriber>(
      filters?.activeOnly
        ? `SELECT * FROM newsletter_subscribers WHERE unsubscribed_at IS NULL ORDER BY subscribed_at DESC`
        : `SELECT * FROM newsletter_subscribers ORDER BY subscribed_at DESC`,
    );
    return rows;
  });
}

export async function getNewsletterStats(): Promise<NewsletterStats> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<{ total: string; active: string }>(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE unsubscribed_at IS NULL) AS active
       FROM newsletter_subscribers`,
    );
    const total = Number(rows[0].total);
    const active = Number(rows[0].active);
    return { total, active, unsubscribed: total - active };
  });
}
