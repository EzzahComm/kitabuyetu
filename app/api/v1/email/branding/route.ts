import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth, withOneOf } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { ok } from '@/lib/utils/response';

const BrandingSchema = z.object({
  senderName:    z.string().min(1).optional(),
  senderEmail:   z.string().email().optional(),
  replyToEmail:  z.string().email().optional(),
  logoUrl:       z.string().optional(),
  primaryColor:  z.string().optional(),
  footerText:    z.string().optional(),
  websiteUrl:    z.string().optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const { rows } = await withAdminDb((db) =>
      db.query(
        `SELECT id, sender_name, sender_email, reply_to_email, logo_url, primary_color, footer_text, website_url
         FROM group_email_branding WHERE group_id = $1`,
        [auth.groupId],
      ),
    );
    return ok(rows[0] ?? null);
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withOneOf(req, ['chairperson', 'super_admin'], async (auth) => {
    const body = BrandingSchema.parse(await req.json());

    await withAdminDb((db) =>
      db.query(
        `INSERT INTO group_email_branding
           (group_id, sender_name, sender_email, reply_to_email, logo_url, primary_color, footer_text, website_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (group_id) DO UPDATE
           SET sender_name    = COALESCE($2, group_email_branding.sender_name),
               sender_email   = COALESCE($3, group_email_branding.sender_email),
               reply_to_email = COALESCE($4, group_email_branding.reply_to_email),
               logo_url       = COALESCE($5, group_email_branding.logo_url),
               primary_color  = COALESCE($6, group_email_branding.primary_color),
               footer_text    = COALESCE($7, group_email_branding.footer_text),
               website_url    = COALESCE($8, group_email_branding.website_url),
               updated_at     = NOW()`,
        [
          auth.groupId,
          body.senderName ?? null,
          body.senderEmail ?? null,
          body.replyToEmail ?? null,
          body.logoUrl ?? null,
          body.primaryColor ?? null,
          body.footerText ?? null,
          body.websiteUrl ?? null,
        ],
      ),
    );

    return ok({ success: true });
  });
}
