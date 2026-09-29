import { sendSingleSms, activeSmsProvider } from '@/lib/sms/provider';

export interface ChannelResult {
  ok: boolean;
  provider: string;
  messageId?: string;
  error?: string;
}

/**
 * Admin alert SMS. Goes straight to the provider — deliberately NOT through
 * the group-billed SMS path, so alerts never consume a customer's credits and
 * never depend on a group's own SMS settings or kill switches.
 */
export async function sendAdminSms(phone: string, message: string): Promise<ChannelResult> {
  const provider = activeSmsProvider();
  try {
    const res = await sendSingleSms({ mobile: phone, message });
    return {
      ok: !!res.success,
      provider,
      messageId: res.messageId || undefined,
      error: res.success ? undefined : res.responseDescription || 'SMS provider rejected the message',
    };
  } catch (err) {
    return { ok: false, provider, error: err instanceof Error ? err.message : String(err) };
  }
}
