import { Resend } from 'resend';
import type { IEmailAdapter, EmailPayload, EmailResult } from './types';
import { withAdminDb } from '@/lib/db';

const resend = new Resend(process.env.RESEND_API_KEY);

export class ResendAdapter implements IEmailAdapter {
  readonly name = 'resend';

  async send(payload: EmailPayload): Promise<EmailResult> {
    const from = payload.from ?? process.env.EMAIL_FROM ?? 'noreply@kitabuyetu.com';
    const toArr = Array.isArray(payload.to) ? payload.to : [payload.to];

    let logId: string | null = null;

    // Write a queued log entry first so failures are still recorded
    try {
      const { rows } = await withAdminDb((db) =>
        db.query(
          `INSERT INTO email_logs
             (group_id, user_id, template_key, category, "to", "from", subject,
              provider, status, reference_id, reference_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'resend','queued',$8,$9) RETURNING id`,
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
      // Non-fatal — logging failure must not block delivery
    }

    try {
      const attachments = payload.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content as string, 'base64'),
      }));

      const { data, error } = await resend.emails.send({
        from,
        to: toArr,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        replyTo: payload.replyTo,
        cc: payload.cc ? (Array.isArray(payload.cc) ? payload.cc : [payload.cc]) : undefined,
        bcc: payload.bcc ? (Array.isArray(payload.bcc) ? payload.bcc : [payload.bcc]) : undefined,
        attachments,
        tags: payload.tags ? Object.entries(payload.tags).map(([name, value]) => ({ name, value })) : undefined,
      });

      if (error) throw new Error(error.message);

      if (logId) {
        await withAdminDb((db) =>
          db.query(
            `UPDATE email_logs SET status='sent', provider_message_id=$1, sent_at=NOW() WHERE id=$2`,
            [data?.id ?? null, logId],
          ),
        ).catch(() => {});
      }

      return { success: true, messageId: data?.id, provider: this.name };
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
