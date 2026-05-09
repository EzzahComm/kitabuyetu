import type { IEmailAdapter, EmailPayload, EmailResult } from './types';
import { withAdminDb } from '@/lib/db';

export class SendGridAdapter implements IEmailAdapter {
  readonly name = 'sendgrid';

  async send(payload: EmailPayload): Promise<EmailResult> {
    const apiKey = process.env.SENDGRID_API_KEY ?? '';
    const from = payload.from ?? process.env.EMAIL_FROM ?? 'noreply@kitabuyetu.com';
    const toArr = Array.isArray(payload.to) ? payload.to : [payload.to];

    let logId: string | null = null;
    try {
      const { rows } = await withAdminDb((db) =>
        db.query(
          `INSERT INTO email_logs
             (group_id, user_id, template_key, category, "to", "from", subject,
              provider, status, reference_id, reference_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'sendgrid','queued',$8,$9) RETURNING id`,
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
    } catch {}

    try {
      const body: Record<string, unknown> = {
        personalizations: [{ to: toArr.map((e) => ({ email: e })) }],
        from: { email: from, name: process.env.EMAIL_FROM_NAME ?? 'Kitabu Yetu' },
        subject: payload.subject,
        content: [{ type: 'text/html', value: payload.html ?? '' }],
      };

      if (payload.text) {
        (body.content as unknown[]).unshift({ type: 'text/plain', value: payload.text });
      }

      if (payload.replyTo) {
        body.reply_to = { email: payload.replyTo };
      }

      if (payload.cc) {
        const ccArr = Array.isArray(payload.cc) ? payload.cc : [payload.cc];
        (body.personalizations as Record<string, unknown>[])[0].cc = ccArr.map((e) => ({ email: e }));
      }

      if (payload.attachments?.length) {
        body.attachments = payload.attachments.map((a) => ({
          filename: a.filename,
          content: Buffer.isBuffer(a.content)
            ? a.content.toString('base64')
            : Buffer.from(a.content as string).toString('base64'),
          type: a.contentType ?? 'application/octet-stream',
          disposition: 'attachment',
        }));
      }

      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`SendGrid ${res.status}: ${text}`);
      }

      const messageId = res.headers.get('x-message-id') ?? undefined;

      if (logId) {
        await withAdminDb((db) =>
          db.query(
            `UPDATE email_logs SET status='sent', provider_message_id=$1, sent_at=NOW() WHERE id=$2`,
            [messageId ?? null, logId],
          ),
        ).catch(() => {});
      }

      return { success: true, messageId, provider: this.name };
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
