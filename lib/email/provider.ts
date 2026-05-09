import type { IEmailAdapter, EmailPayload, EmailResult } from './adapters/types';
import { ResendAdapter } from './adapters/resend';
import { SmtpAdapter } from './adapters/smtp';
import { SendGridAdapter } from './adapters/sendgrid';
import { SesAdapter } from './adapters/ses';
import { MailgunAdapter } from './adapters/mailgun';
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';

let _adapter: IEmailAdapter | null = null;

function getAdapter(): IEmailAdapter {
  if (_adapter) return _adapter;
  const provider = process.env.EMAIL_PROVIDER ?? 'resend';
  switch (provider) {
    case 'sendgrid': _adapter = new SendGridAdapter(); break;
    case 'ses':      _adapter = new SesAdapter();      break;
    case 'mailgun':  _adapter = new MailgunAdapter();  break;
    case 'smtp':     _adapter = new SmtpAdapter();     break;
    default:         _adapter = new ResendAdapter();   break;
  }
  return _adapter;
}

async function logDryRun(payload: EmailPayload): Promise<void> {
  const from = payload.from ?? process.env.EMAIL_FROM ?? 'noreply@kitabuyetu.com';
  const to   = Array.isArray(payload.to) ? payload.to[0] : payload.to;
  await withAdminDb((db) =>
    db.query(
      `INSERT INTO email_logs
         (group_id, user_id, template_key, category, "to", "from", subject,
          provider, status, reference_id, reference_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'dry_run',$9,$10)`,
      [
        payload.groupId ?? null,
        payload.userId  ?? null,
        payload.templateKey ?? null,
        payload.category    ?? 'transactional',
        to,
        from,
        payload.subject,
        process.env.EMAIL_PROVIDER ?? 'resend',
        payload.referenceId   ?? null,
        payload.referenceType ?? null,
      ],
    ),
  ).catch(() => {});
}

export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  if (process.env.EMAIL_DRY_RUN === 'true') {
    await logDryRun(payload);
    logger.info('[email:dry_run]', payload.to, payload.subject);
    return { success: true, provider: 'dry_run', dryRun: true };
  }
  return getAdapter().send(payload);
}

export async function sendEmailWithFallback(payload: EmailPayload): Promise<EmailResult> {
  if (process.env.EMAIL_DRY_RUN === 'true') {
    await logDryRun(payload);
    return { success: true, provider: 'dry_run', dryRun: true };
  }

  const primary = getAdapter();
  const result  = await primary.send(payload);
  if (result.success) return result;

  // Fall back to SMTP when primary is not SMTP and SMTP is configured
  if (primary.name !== 'smtp' && process.env.SMTP_HOST) {
    console.warn(`[email] ${primary.name} failed, falling back to SMTP:`, result.error);
    return new SmtpAdapter().send(payload);
  }

  return result;
}

export type { EmailPayload, EmailResult, EmailAttachment } from './adapters/types';
