import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { withAdminDb, type TenantContext } from '@/lib/db';
import { env } from '@/lib/env';
import { ConflictError, NotFoundError, RateLimitedError } from '@/lib/utils/errors';
import { siteSlug } from '@/lib/websites/content';
import { withWebsiteEditor } from '@/lib/services/organization-websites.service';

export const enquiryInput = z
  .object({
    requestKey: z.string().uuid(),
    email: z.string().trim().email().max(254),
    message: z.string().trim().min(1).max(1500),
    consent: z.literal(true),
    website: z.string().max(200).optional(),
  })
  .strict();

export async function receiveEnquiry(slug: string, input: z.infer<typeof enquiryInput>, address: string) {
  if (!siteSlug.safeParse(slug).success) throw new NotFoundError('Website');
  if (input.website) return;
  return withAdminDb(async (db) => {
    const row = (
      await db.query<{ organization_id: string }>(
        `SELECT organization_id FROM organization_websites
      WHERE slug=$1 AND public.get_published_organization_website($1)->>'acceptEnquiries'='true' FOR UPDATE`,
        [slug],
      )
    ).rows[0];
    if (!row) throw new NotFoundError('Website enquiries');
    const org = row.organization_id;
    const existing = (
      await db.query(
        'SELECT reply_email,message FROM organization_website_enquiries WHERE organization_id=$1 AND request_key=$2',
        [org, input.requestKey],
      )
    ).rows[0];
    if (existing) {
      if (existing.reply_email !== input.email || existing.message !== input.message)
        throw new ConflictError('Use a new request for a different enquiry.');
      return;
    }
    const hash = createHmac('sha256', env.JWT_SECRET)
      .update('website-enquiry:' + org + ':' + address)
      .digest('hex');
    const counts = (
      await db.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE sender_hash=$2)::int AS sender
      FROM organization_website_enquiries WHERE organization_id=$1 AND received_at>now()-interval '1 hour'`,
        [org, hash],
      )
    ).rows[0];
    if (counts.total >= 100 || counts.sender >= 5) throw new RateLimitedError('Please try again later.');
    await db.query(
      `INSERT INTO organization_website_enquiries(organization_id,request_key,sender_hash,reply_email,message)
      VALUES ($1,$2,$3,$4,$5)`,
      [org, input.requestKey, hash, input.email, input.message],
    );
  });
}
export function websiteInbox(ctx: TenantContext) {
  return withWebsiteEditor(
    ctx,
    async (db, org) =>
      (
        await db.query<{ id: string; email: string; message: string; received: string; handled: boolean }>(
          `SELECT id,reply_email AS email,message,received_at AS received,handled_at IS NOT NULL AS handled
    FROM organization_website_enquiries WHERE organization_id=$1 ORDER BY (handled_at IS NULL) DESC,received_at DESC LIMIT 100`,
          [org],
        )
      ).rows,
  );
}
export function handleWebsiteEnquiry(ctx: TenantContext, id: string) {
  return withWebsiteEditor(ctx, async (db, org) => {
    const changed = await db.query(
      `UPDATE organization_website_enquiries SET handled_at=coalesce(handled_at,now())
      WHERE id=$1 AND organization_id=$2`,
      [id, org],
    );
    if (!changed.rowCount) throw new NotFoundError('Enquiry');
  });
}
