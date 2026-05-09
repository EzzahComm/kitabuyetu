import { withAdminDb } from '@/lib/db';

export interface TemplateVars {
  [key: string]: string | number | boolean | null | undefined;
}

export interface BrandingContext {
  senderName?: string;
  logoUrl?: string;
  primaryColor?: string;
  footerText?: string;
}

// Simple {{variable}} substitution
export function interpolate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key];
    if (val === null || val === undefined) return '';
    return String(val);
  });
}

// Load a template from DB, with optional locale fallback to 'en'
export async function loadDbTemplate(
  templateKey: string,
  groupId: string | null,
  locale = 'en',
): Promise<{ subject: string; body: string } | null> {
  const { rows } = await withAdminDb((db) =>
    db.query(
      `SELECT subject, body FROM email_templates
       WHERE template_key=$1
         AND (group_id=$2 OR group_id IS NULL)
         AND locale=$3
         AND is_active=true
       ORDER BY group_id NULLS LAST
       LIMIT 1`,
      [templateKey, groupId, locale],
    ),
  );
  if (rows.length) return { subject: rows[0].subject, body: rows[0].body };

  // Fallback to 'en' if locale not found
  if (locale !== 'en') {
    const { rows: fallback } = await withAdminDb((db) =>
      db.query(
        `SELECT subject, body FROM email_templates
         WHERE template_key=$1
           AND (group_id=$2 OR group_id IS NULL)
           AND locale='en'
           AND is_active=true
         ORDER BY group_id NULLS LAST
         LIMIT 1`,
        [templateKey, groupId],
      ),
    );
    if (fallback.length) return { subject: fallback[0].subject, body: fallback[0].body };
  }

  return null;
}

// Load group branding from DB
export async function loadBranding(groupId: string | null): Promise<BrandingContext> {
  if (!groupId) return {};
  try {
    const { rows } = await withAdminDb((db) =>
      db.query(
        `SELECT sender_name, logo_url, primary_color, footer_text
         FROM group_email_branding WHERE group_id=$1`,
        [groupId],
      ),
    );
    if (!rows.length) return {};
    return {
      senderName: rows[0].sender_name,
      logoUrl: rows[0].logo_url,
      primaryColor: rows[0].primary_color,
      footerText: rows[0].footer_text,
    };
  } catch {
    return {};
  }
}

// Wrap body content in branded HTML shell
export function wrapWithBranding(content: string, branding: BrandingContext): string {
  const primary = branding.primaryColor ?? '#16a34a';
  const footer = branding.footerText ?? 'Kitabu Yetu — Community Finance Management';
  const logo = branding.logoUrl
    ? `<img src="${branding.logoUrl}" alt="Logo" style="height:40px;margin-bottom:16px;">`
    : `<div style="font-size:20px;font-weight:700;color:${primary};margin-bottom:16px;">Kitabu Yetu</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
        <tr>
          <td style="background:${primary};padding:24px 32px;text-align:center;">
            ${logo}
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            ${content}
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:12px;color:#6b7280;">${footer}</p>
            <p style="margin:8px 0 0;font-size:11px;color:#9ca3af;">
              If you did not expect this email, you can safely ignore it.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Full pipeline: load template → interpolate → wrap with branding
export async function renderTemplate(
  templateKey: string,
  vars: TemplateVars,
  groupId: string | null,
  locale = 'en',
  fallbackHtml?: string,
): Promise<{ subject: string; html: string }> {
  const branding = await loadBranding(groupId);
  const tpl = await loadDbTemplate(templateKey, groupId, locale);

  if (tpl) {
    const subject = interpolate(tpl.subject, vars);
    const body = interpolate(tpl.body, vars);
    const html = wrapWithBranding(body, branding);
    return { subject, html };
  }

  // Fall back to inline default
  if (fallbackHtml) {
    const html = wrapWithBranding(interpolate(fallbackHtml, vars), branding);
    return { subject: vars.subject ? String(vars.subject) : 'Kitabu Yetu', html };
  }

  throw new Error(`Email template '${templateKey}' not found and no fallback provided.`);
}
