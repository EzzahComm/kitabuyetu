import nodemailer from 'nodemailer';
import type { IEmailAdapter, EmailPayload, EmailResult } from './types';
import { withAdminDb } from '@/lib/db';
import { env } from '@/lib/env';

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

export class SmtpAdapter implements IEmailAdapter {
  readonly name = 'smtp';

  async send(payload: EmailPayload): Promise<EmailResult> {
    const from = payload.from ?? env.EMAIL_FROM;
    const toArr = Array.isArray(payload.to) ? payload.to : [payload.to];

    let logId: string | null = null;

    try {
      const { rows } = await withAdminDb((db) =>
        db.query(
          `INSERT INTO email_logs
             (group_id, user_id, template_key, category, "to", "from", subject,
              provider, status, reference_id, reference_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'smtp','queued',$8,$9) RETURNING id`,
          [
            payload.groupId ?? null,
            payload.userId ?? null,
            payload.templateKey ?? null,
            payload.category ?? 'transactional',
            toArr[0],
            from,
            payload.subject,
            payload.referenceId ?? null,
            payload.referenceType ?? null,
          ],
        ),
      );
      logId = rows[0]?.id ?? null;
    } catch {
      // Non-fatal
    }

    try {
      const transport = createTransport();

      const info = await transport.sendMail({
        from,
        to: toArr.join(', '),
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        replyTo: payload.replyTo,
        cc: payload.cc,
        bcc: payload.bcc,
        attachments: payload.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });

      if (logId) {
        await withAdminDb((db) =>
          db.query(
            `UPDATE email_logs SET status='sent', provider_message_id=$1, sent_at=NOW() WHERE id=$2`,
            [info.messageId ?? null, logId],
          ),
        ).catch(() => {});
      }

      return { success: true, messageId: info.messageId, provider: this.name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (logId) {
        await withAdminDb((db) =>
          db.query(
            `UPDATE email_logs SET status='failed', error_message=$1 WHERE id=$2`,
            [message, logId],
          ),
        ).catch(() => {});
      }

      return { success: false, error: message, provider: this.name };
    }
  }
}
