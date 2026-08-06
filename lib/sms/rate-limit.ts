/**
 * Abuse control for the SMS send surface.
 *
 * Every outbound SMS costs real money, and until now nothing bounded how fast a
 * caller could spend it: the only brake was the prepaid credit balance itself,
 * so a compromised officer token could drain a group's entire balance in
 * seconds (SMS_MESSAGING_AUDIT_2026-08.md H2). That gap was masked while the
 * billed send path was broken by C1 — fixing C1 re-arms these endpoints, so the
 * limiter has to land in the same change, not after it.
 *
 * Scoped per group rather than per user: the credit balance being protected is
 * the group's, so two officers of one group share its budget. `checkRateLimit`
 * is fail-open by design (a Redis outage must not block sending), so this is
 * abuse control, not an accounting guarantee — the ledger remains the authority
 * on what was actually spent.
 *
 * Request-count limiting only. Volume-aware limiting (recipients per window,
 * and the per-member/per-phone/per-organization tiers) belongs with the
 * reservation ledger in Phase 2/3 of docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md.
 */
import { checkRateLimit } from '@/lib/redis';
import { errorResponse } from '@/lib/utils/response';

/**
 * Per-group ceilings, keyed by send surface. `bulk` and `campaign` are far
 * tighter than `send` because one call fans out to up to 5,000 recipients
 * (BulkSmsSchema.phones), whereas `send` is the single/few-recipient path used
 * for transactional receipts and manual officer messages.
 */
export const SMS_RATE_LIMITS = {
  send:     { limit: 30, windowSeconds: 60 },
  bulk:     { limit: 5,  windowSeconds: 60 },
  campaign: { limit: 5,  windowSeconds: 60 },
} as const;

export type SmsSendSurface = keyof typeof SMS_RATE_LIMITS;

/**
 * Returns a 429 response when the group is over its ceiling for this surface,
 * or `null` to proceed. Callers must return the response when it is non-null.
 */
export async function enforceSmsRateLimit(
  surface: SmsSendSurface,
  groupId: string,
): Promise<Response | null> {
  const { limit, windowSeconds } = SMS_RATE_LIMITS[surface];
  const allowed = await checkRateLimit(`sms:${surface}:${groupId}`, limit, windowSeconds);
  if (allowed) return null;

  return errorResponse(
    `Too many SMS requests. This group may send at most ${limit} ${surface} requests per ${windowSeconds}s.`,
    'RATE_LIMITED',
    429,
  );
}
