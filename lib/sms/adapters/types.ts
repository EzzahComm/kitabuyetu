/**
 * Provider-agnostic SMS surface (SMS-AUDIT-v3 T3-3, G15/V3-07, INV-17).
 *
 * The value types are re-exported from textsms.service.ts rather than
 * redeclared here — that module remains the one place that knows TextSMS's
 * wire format, and every existing test that imports these types from
 * '@/lib/services/textsms.service' keeps working unchanged. This file adds
 * only the interface a provider must satisfy to sit behind lib/sms/provider.ts.
 */
import type {
  SingleSmsInput,
  SmsResponse,
  BulkSmsItem,
  BulkSmsResult,
  DlrResult,
  BalanceResult,
} from '@/lib/services/textsms.service';

export type {
  SingleSmsInput,
  SmsResponse,
  BulkSmsItem,
  BulkSmsResult,
  DlrResult,
  BalanceResult,
};

/**
 * One SMS provider's raw send/poll/balance surface.
 *
 * Modeled on lib/email/adapters/types.ts's IEmailAdapter — same shape of
 * problem (one provider's client imported directly by every call site,
 * `'<provider>'` hardcoded wherever code needed to name it), same shape of
 * fix. TextSmsAdapter is the only implementation today; adding a second
 * provider means adding a second file in this directory and registering it
 * in provider.ts — nothing else should need to change. That claim is the
 * T3-3 closure test itself (re-run the H14 file count: it must drop to one
 * directory).
 */
export interface ISmsAdapter {
  readonly name: string;
  sendSingle(input: SingleSmsInput): Promise<SmsResponse>;
  sendBulk(items: BulkSmsItem[]): Promise<BulkSmsResult>;
  getDlr(messageId: string): Promise<DlrResult>;
  getBalance(): Promise<BalanceResult>;
}
