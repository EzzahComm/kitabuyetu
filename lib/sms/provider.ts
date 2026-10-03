/**
 * Provider abstraction for outbound SMS (SMS-AUDIT-v3 T3-3, closes G15/V3-07,
 * INV-17).
 *
 * Before this, textsms.service.ts — a client for exactly one provider's wire
 * format — was imported directly by six call sites across sms.service.ts and
 * notifications.service.ts, and the literal 'textsms' was hardcoded in
 * roughly a dozen more places as a provider identity (cost tables, pricing
 * admin, sms_usage_logs/sms_provider_balances inserts). Every dispatch call
 * now funnels through here instead, which buys three things in one place:
 *
 *  1. A circuit breaker shared across whatever providers exist, so a real
 *     outage fails fast instead of every caller separately discovering it
 *     through a 20-second timeout (see ./circuit-breaker.ts's own header for
 *     why that mattered).
 *  2. A single resolver for "which provider" — today always TextSMS, but
 *     `sms_usage_logs.provider` recording the REAL provider (not a hardcoded
 *     string) is what makes retryFailures() honouring it on retry a genuine
 *     choice rather than a no-op formality.
 *  3. A closure test that is actually checkable: adding a second provider
 *     means adding a second file to ./adapters and one line in the registry
 *     below — nothing calling sendSingleSms/sendBulkSmsChunked/etc. here
 *     should need to change.
 *
 * Modeled directly on lib/email/provider.ts's getAdapter() pattern.
 */
import type {
  ISmsAdapter,
  SingleSmsInput,
  SmsResponse,
  BulkSmsItem,
  BulkSmsResult,
  DlrResult,
  BalanceResult,
} from './adapters/types';
import { TextSmsAdapter } from './adapters/textsms';
import { canAttempt, recordSuccess, recordFailure } from './circuit-breaker';
import { ServiceUnavailableError } from '@/lib/utils/errors';

export const DEFAULT_SMS_PROVIDER = 'textsms';

const adapters: Record<string, ISmsAdapter> = {
  textsms: new TextSmsAdapter(),
};

/**
 * The provider a FRESH send is placed with, absent an explicit override.
 * `SMS_PROVIDER` is intentionally not in lib/env.ts's validated schema yet —
 * there is exactly one adapter registered, so an env var to choose between
 * providers has nothing to choose between. Add it there when a second
 * adapter is registered below.
 */
export function activeSmsProvider(): string {
  return process.env.SMS_PROVIDER ?? DEFAULT_SMS_PROVIDER;
}

function resolveAdapter(name?: string | null): ISmsAdapter {
  const key = name ?? activeSmsProvider();
  const adapter = adapters[key];
  if (!adapter) {
    // A historical row can name a provider that is no longer configured
    // (retired, renamed). Silently sending it through whatever adapter IS
    // configured would attribute the message to the wrong sender-ID/account
    // relationship — fail closed instead. This is the opposite posture from
    // the feature-flag kill switch's fail-OPEN-on-unknown-key rule
    // (messaging-billing.ts): that guards against an operator's own lookup
    // breaking sends; this guards against a provider-identity mismatch
    // resolving to the wrong provider, which must never happen quietly.
    throw new ServiceUnavailableError(`SMS provider "${key}" is not configured`);
  }
  return adapter;
}

/**
 * Whether a call to this provider is currently allowed through. Exposed so a
 * caller that has its own retry budget (retryFailures' max_retries) can skip
 * an attempt entirely while the circuit is open, rather than let it throw and
 * consume that budget for an outcome that was never in doubt.
 */
export function isProviderAvailable(name?: string | null): boolean {
  return canAttempt(name ?? activeSmsProvider());
}

/**
 * Every provider call funnels through here. Fails fast — without attempting
 * the network call at all — while the circuit is open, and records the
 * outcome of any call it does let through.
 *
 * A per-item provider REJECTION (invalid number, low bulk credits) never
 * reaches here as a throw: sendSingle/sendBulk resolve those in the returned
 * SmsResponse/BulkSmsResult, exactly as textsms.service.ts already does. So
 * the breaker trips only on a genuine transport failure (timeout, DNS,
 * connection refused, an unparseable response) — which is the actual signal
 * "is this provider reachable at all", not "did this one recipient's number
 * get rejected".
 */
async function guarded<T>(providerName: string, fn: () => Promise<T>): Promise<T> {
  if (!canAttempt(providerName)) {
    throw new ServiceUnavailableError(`SMS provider "${providerName}" is temporarily unavailable`);
  }
  try {
    const result = await fn();
    recordSuccess(providerName);
    return result;
  } catch (err) {
    recordFailure(providerName);
    throw err;
  }
}

/**
 * `provider` lets a caller honour a HISTORICAL choice — retryFailures() reads
 * it off the original sms_usage_logs row so a message retries on the
 * provider that actually accepted it the first time, not whatever is active
 * now. Every fresh-send call site omits it and gets the active provider.
 */
export async function sendSingleSms(input: SingleSmsInput, provider?: string | null): Promise<SmsResponse> {
  const adapter = resolveAdapter(provider);
  return guarded(adapter.name, () => adapter.sendSingle(input));
}

export async function sendBulkSmsChunked(items: BulkSmsItem[], provider?: string | null): Promise<BulkSmsResult> {
  const adapter = resolveAdapter(provider);
  return guarded(adapter.name, () => adapter.sendBulk(items));
}

export async function getDeliveryReport(messageId: string, provider?: string | null): Promise<DlrResult> {
  const adapter = resolveAdapter(provider);
  return guarded(adapter.name, () => adapter.getDlr(messageId));
}

export async function getProviderBalance(provider?: string | null): Promise<BalanceResult> {
  const adapter = resolveAdapter(provider);
  return guarded(adapter.name, () => adapter.getBalance());
}

export type {
  SingleSmsInput,
  SmsResponse,
  BulkSmsItem,
  BulkSmsResult,
  DlrResult,
  BalanceResult,
} from './adapters/types';
