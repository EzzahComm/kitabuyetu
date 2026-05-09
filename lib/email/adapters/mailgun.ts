import type { IEmailAdapter, EmailPayload, EmailResult } from './types';
import { withAdminDb } from '@/lib/db';

export class MailgunAdapter implements IEmailAdapter {
  readonly name = 'mailgun';

  async send(payload: EmailPayload): Promise<EmailResult> {
    const apiKey = process.env.MAILGUN_API_KEY ?? '';
    const domain = process.env.MAILGUN_DOMAIN ?? '';
    const region = process.env.MAILGUN_REGION ?? 'us'; // 'us' or 'eu'
    const baseUrl = region === 'eu'
      ? `https://api.eu.mailgun.net/v3/${domain}/messages`
      : `https://api.mailgun.net/v3/${domain}/messages`;

    const from = payload.from ?? process.env.EMAIL_FROM ?? 'noreply@kitabuyetu.com';
    const fromName = process.env.EMAIL_FROM_NAME ?? 'Kitabu Yetu';
    const toArr = Array.isArray(payload.to) ? payload.to : [payload.to];

    let logId: string | null = null;
    try {
      const { rows } = await withAdminDb((db) =>
        db.query(
          `INSERT INTO email_logs
             (group_id, user_id, template_key, category, "to", "from", subject,
              provider, status, reference_id, reference_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'mailgun','queued',$8,$9) RETURNING id`,
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
      const form = new FormData();
      form.append('from', `${fromName} <${from}>`);
      form.append('to', toArr.join(','));
      form.append('subject', payload.subject ?? '');
      if (payload.html) form.append('html', payload.html);
      if (payload.text) form.append('text', payload.text);
      if (payload.replyTo) form.append('h:Reply-To', payload.replyTo);
      if (payload.cc) {
        const ccArr = Array.isArray(payload.cc) ? payload.cc : [payload.cc];
        form.append('cc', ccArr.join(','));
      }

      if (payload.attachments?.length) {
        for (const att of payload.attachments) {
          const buf = Buffer.isBuffer(att.content)
            ? att.content
            : Buffer.from(att.content as string, 'base64');
          form.append('attachment', new Blob([new Uint8Array(buf)], { type: att.contentType ?? 'application/octet-stream' }), att.filename);
        }
      }

      const credentials = Buffer.from(`api:${apiKey}`).toString('base64');
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { Authorization: `Basic ${credentials}` },
        body: form,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Mailgun ${res.status}: ${text}`);
      }

      const json = await res.json() as { id?: string; message?: string };
      const messageId = json.id ?? undefined;

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
