/**
 * Administrator alert recipients and tunables. Read from the environment at
 * call time (never hard-coded), so a deployment can add recipients without a
 * code change. Both variables accept a comma-separated list.
 *
 *   KITABU_ADMIN_ALERT_PHONE=+254182625807
 *   KITABU_ADMIN_ALERT_EMAIL=info@kitabuyetu.co.ke
 */
import { safeNormalizePhone } from '@/lib/utils/phone';

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export interface AdminRecipients {
  phones: string[];
  emails: string[];
}

export function getAdminRecipients(): AdminRecipients {
  const phones = list(process.env.KITABU_ADMIN_ALERT_PHONE)
    .map((p) => safeNormalizePhone(p))
    .filter((p): p is string => !!p);
  const emails = list(process.env.KITABU_ADMIN_ALERT_EMAIL ?? process.env.EMAIL_ADMIN).filter((e) => e.includes('@'));
  return { phones: [...new Set(phones)], emails: [...new Set(emails.map((e) => e.toLowerCase()))] };
}

/** Amount (KES) at or above which an otherwise-routine transaction is alerted individually. */
export function highValueThreshold(): number {
  const n = Number(process.env.KITABU_HIGH_VALUE_THRESHOLD_KES);
  return Number.isFinite(n) && n > 0 ? n : 100_000;
}

/** Minutes between digest sends for aggregated events. */
export function digestWindowMinutes(): number {
  const n = Number(process.env.KITABU_ADMIN_DIGEST_MINUTES);
  return Number.isFinite(n) && n >= 5 ? n : 60;
}

export const MAX_DELIVERY_ATTEMPTS = 5;
