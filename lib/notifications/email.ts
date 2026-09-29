import { sendEmailWithFallback } from '@/lib/email/provider';
import type { ChannelResult } from './sms';

/** Admin alert email through the platform's existing email provider. */
export async function sendAdminEmail(
  to: string,
  content: { subject: string; html: string; text: string },
  referenceId: string,
): Promise<ChannelResult> {
  try {
    const res = await sendEmailWithFallback({
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
      category: 'transactional',
      templateKey: 'admin_activity_alert',
      referenceId,
      referenceType: 'platform_activity',
    });
    return { ok: res.success, provider: res.provider, messageId: res.messageId, error: res.error };
  } catch (err) {
    return { ok: false, provider: 'email', error: err instanceof Error ? err.message : String(err) };
  }
}
