import { Resend } from 'resend';
import type { IEmailAdapter, EmailPayload, EmailResult } from './types';
import { withAdminDb } from '@/lib/db';
import { env } from '@/lib/env';

const resend = new Resend(process.env.RESEND_API_KEY);

export class ResendAdapter implements IEmailAdapter {
  readonly name = 'resend';

  async send(payload: EmailPayload): Promise<EmailResult> {
    const from = payload.from ?? env.EMAIL_FROM;
    const toArr = Array.isArray(payload.to) ? payload.to : [payload.to];

    /*
     * Deterministic idempotency key.
     *
     * IMPORTANT:
     * Do NOT use randomUUID() here. A retry must produce the same
     * key so Resend can recognize it as the same email request.
     *
     * referenceId/referenceType identify the business event.
     * recipient + template prevent different users/events from
     * accidentally sharing the same key.
     */
    const recipient = toArr[0]?.trim().toLowerCase() ?? 'unknown';
    const template = payload.templateKey ?? 'generic';
    const reference =
      payload.referenceType && payload.referenceId
        ? `${payload.referenceType}:${payload.referenceId}`
        : null;

    const idempotencyKey = reference
      ? `kitabuyetu/${template}/${reference}/${recipient}`.slice(0, 256)
      : null;

    let logId: string | null = null;

    // Application-level duplicate protection.
    // If this exact business event was already sent to this recipient,
    // do not send it again even if a queue/job retries.
    if (reference && payload.referenceType && payload.referenceId) {
      try {
        const { rows } = await withAdminDb((db) =>
          db.query(
            `SELECT id, provider_message_id
               FROM email_logs
              WHERE provider = 'resend'
                AND status = 'sent'
                AND "to" = $1
                AND template_key = $2
                AND reference_id = $3
                AND reference_type = $4
              ORDER BY sent_at DESC
              LIMIT 1`,
            [
              recipient,
              payload.templateKey ?? null,
              payload.referenceId,
              payload.referenceType,
            ],
          ),
        );

        if (rows[0]) {
          return {
            success: true,
            messageId: rows[0].provider_message_id ?? undefined,
            provider: this.name,
          };
        }
      } catch {
        // Duplicate-check failure must not prevent delivery.
        // Resend idempotency remains the second safety layer.
      }
    }

    // Write a queued log entry first so failures are still recorded.
    try {
      const { rows } = await withAdminDb((db) =>
        db.query(
          `INSERT INTO email_logs
             (group_id, user_id, template_key, category, "to", "from", subject,
              provider, status, reference_id, reference_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'resend','queued',$8,$9)
           RETURNING id`,
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
      // Non-fatal — logging failure must not block delivery.
    }

    try {
      const attachments = payload.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.isBuffer(a.content)
          ? a.content
          : Buffer.from(a.content as string, 'base64'),
      }));

      const { data, error } = await resend.emails.send(
        {
          from,
          to: toArr,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
          replyTo: payload.replyTo,
          cc: payload.cc
            ? Array.isArray(payload.cc)
              ? payload.cc
              : [payload.cc]
            : undefined,
          bcc: payload.bcc
            ? Array.isArray(payload.bcc)
              ? payload.bcc
              : [payload.bcc]
            : undefined,
          attachments,
          tags: payload.tags
            ? Object.entries(payload.tags).map(([name, value]) => ({
                name,
                value,
              }))
            : undefined,
        },
        idempotencyKey
          ? {
              idempotencyKey,
            }
          : undefined,
      );

      if (error) throw new Error(error.message);

      if (logId) {
        await withAdminDb((db) =>
          db.query(
            `UPDATE email_logs
                SET status='sent',
                    provider_message_id=$1,
                    sent_at=NOW()
              WHERE id=$2`,
            [data?.id ?? null, logId],
          ),
        ).catch(() => {});
      }

      return {
        success: true,
        messageId: data?.id,
        provider: this.name,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (logId) {
        await withAdminDb((db) =>
          db.query(
            `UPDATE email_logs
                SET status='failed',
                    error_message=$1
              WHERE id=$2`,
            [message, logId],
          ),
        ).catch(() => {});
      }

      return {
        success: false,
        error: message,
        provider: this.name,
      };
    }
  }
}
