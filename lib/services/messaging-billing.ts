/**
 * SMS credit reservation — the single place credits are earmarked, charged or
 * returned.
 *
 * Phase 2a of docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md. Before this,
 * two independent send paths each had their own billing behaviour: one debited
 * up-front and never refunded, the other hardcoded `credits_deducted = 0` and
 * billed nothing at all. Everything now funnels through `reserveCredits` /
 * `settleReservation`.
 *
 * ── Why reservation rather than debit-then-refund ──
 * `reminder_dispatch_log` deliberately treats a `failed` reminder as
 * non-terminal and retries it on the next cron tick. Under debit-on-attempt
 * that charges the group again every cycle. With a reservation, a failed send
 * *releases*, so only a successful send ever consumes — retries become safe by
 * construction rather than by remembering to refund.
 *
 * ── Why this never throws ──
 * The two callers need opposite contracts: `smsService.send` must throw
 * (`/sms/send` maps InsufficientSmsCreditsError to a 402, and the trigger
 * engine catches to drive its retry), while `notifyMember` must never throw
 * (three call sites, including reminder.service, sit between a claim and a
 * settle in separate transactions — an escaping error strands the claim).
 * So this module returns a discriminated union and each caller adapts it.
 * All SQLSTATE mapping lives here, in one place.
 */
import type { PoolClient } from 'pg';
import { pool, withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueueJob } from '@/lib/jobs';
import { isFeatureEnabled } from './feature-flags.service';

/** Postgres error codes raised by reserve_sms_credits (migration 123). */
const PG_INSUFFICIENT   = '22003';
const PG_BAD_INPUT      = '22023';
const PG_NOT_AUTHORIZED = '42501';

export type SmsPayerType = 'group' | 'organization' | 'platform';

export interface ReservationTarget {
  payerType:       SmsPayerType;
  groupId:         string | null;
  organizationId?: string | null;
}

export type ReserveFailure =
  | 'insufficient_credits'
  | 'no_billing_account'
  | 'not_authorized'
  | 'subscription_inactive'
  | 'dispatch_halted'
  | 'daily_limit_reached';

/**
 * Operator kill switch (SMS-AUDIT-v3 V3-05).
 *
 * There was previously no way to stop SMS during an incident short of a
 * redeploy or revoking the provider credentials. This is a `feature_flags`
 * row rather than an env var precisely so it can be flipped without a
 * deploy — an incident switch that needs a deploy is not an incident switch.
 *
 * Semantics come free from isFeatureEnabled's fail-open-on-unknown-key rule:
 * with no row present the flag reads enabled, so shipping this changes
 * nothing. Halting is an explicit act — insert the row with enabled=false.
 */
export const SMS_DISPATCH_FLAG = 'sms_dispatch';

export type ReserveResult =
  | {
      ok: true; rate: number; total: number; remaining: number;
      // Phase 2b (docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md) — the
      // bundled-allowance/paid split. fromAllowance/fromPaid are money
      // values; fromAllowanceCount/fromPaidCount are message counts. Always
      // fromAllowance=0/fromAllowanceCount=0 for an organization payer —
      // organizations get no allowance, see migration 124.
      fromAllowance: number; fromPaid: number;
      fromAllowanceCount: number; fromPaidCount: number;
    }
  | { ok: false; reason: ReserveFailure; detail: string };

/** A `platform`-funded send is free by schema invariant — nothing to reserve. */
export const PLATFORM_RATE_ZERO = {
  ok: true as const, rate: 0, total: 0, remaining: 0,
  fromAllowance: 0, fromPaid: 0, fromAllowanceCount: 0, fromPaidCount: 0,
};

/**
 * Earmark credits for `count` messages without debiting them.
 *
 * Runs on the caller's client so the reservation commits (or rolls back) with
 * whatever else that caller is doing — the same reasoning migration 051 gives
 * for `debit_organization_sms_credits` running in the caller's transaction.
 */
export async function reserveCredits(
  client: Pick<PoolClient, 'query'>,
  target: ReservationTarget,
  count:  number,
): Promise<ReserveResult> {
  // Platform-funded sends (OTP, password reset, verification) bail out here,
  // BEFORE the kill switch below — deliberately. Those are the messages that
  // let people back into their accounts, and halting them would lock every
  // user out during precisely the incident the switch exists to contain. It
  // is the same reasoning migration 123 encodes as a CHECK so a billing
  // regression can never brick password reset. To stop absolutely everything,
  // including auth, rotate the provider credential — that is faster and more
  // complete than a flag.
  if (target.payerType === 'platform') return PLATFORM_RATE_ZERO;
  if (count <= 0) return PLATFORM_RATE_ZERO;

  // Checked here rather than at the routes because this is the one chokepoint
  // every billed send passes through — single, bulk, campaign, scheduled,
  // trigger-driven and retry alike. Gating the three HTTP routes instead
  // would leave the automation paths (which spend the same credits) running,
  // the same structural mistake the SMS rate limiter already makes.
  //
  // Wrapped and FAIL-OPEN on purpose. Two reasons:
  //   1. This module's contract is that it never throws — notifyMember sits
  //      between a reminder claim and its settle in separate transactions, so
  //      an escaping error strands the claim. Letting a flag lookup propagate
  //      would break that promise for every caller.
  //   2. A kill switch must stop sends DELIBERATELY, never by accident. If its
  //      own lookup fails, the safe reading is "no operator has halted
  //      anything", not "halt the platform".
  let dispatchAllowed = true;
  try {
    dispatchAllowed = await isFeatureEnabled(
      client as PoolClient,
      SMS_DISPATCH_FLAG,
      { groupId: target.groupId },
    );
  } catch (err) {
    logger.warn('[messaging-billing] kill-switch lookup failed — allowing dispatch', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  if (!dispatchAllowed) {
    return {
      ok: false,
      reason: 'dispatch_halted',
      detail: 'SMS dispatch is currently halted by an operator',
    };
  }

  // Per-group daily cap. sms_group_settings.daily_send_limit has existed since
  // migration 013 and was returned to clients by /sms/settings, but no send
  // path had ever read it — an operator could see the field and reasonably
  // believe a cap was in force when none was.
  //
  // NULL (and no settings row at all) means unlimited, which is every group
  // today, so enforcing this changes no existing group's behaviour.
  //
  // The day boundary is Africa/Nairobi, not UTC. A "daily" limit that reset at
  // 03:00 local would be surprising to the operator who set it, and Kenya has
  // no DST so the offset is constant.
  if (target.groupId) {
    const capped = await isOverDailyLimit(client, target.groupId, count);
    if (capped) {
      return {
        ok: false,
        reason: 'daily_limit_reached',
        detail: `This group's daily SMS limit (${capped.limit}) would be exceeded: ${capped.used} already sent today, ${count} more requested`,
      };
    }
  }

  try {
    const { rows } = await client.query<{
      result: {
        rate: string; total: string; remaining: string;
        fromAllowance: string; fromPaid: string;
        fromAllowanceCount: number; fromPaidCount: number;
      };
    }>(
      `SELECT reserve_sms_credits($1,$2,$3,$4) AS result`,
      [target.payerType, target.groupId, target.organizationId ?? null, count],
    );
    const r = rows[0].result;
    return {
      ok:                 true,
      rate:               Number(r.rate),
      total:              Number(r.total),
      remaining:          Number(r.remaining),
      fromAllowance:      Number(r.fromAllowance),
      fromPaid:           Number(r.fromPaid),
      fromAllowanceCount: Number(r.fromAllowanceCount),
      fromPaidCount:      Number(r.fromPaidCount),
    };
  } catch (err) {
    return classifyReserveError(err, target);
  }
}

/**
 * Returns the cap and today's usage when this send would breach the group's
 * daily limit, or null when it may proceed.
 *
 * Released rows are excluded: a send that failed and had its reservation
 * returned did not consume the group's allowance, so it must not count
 * against the cap.
 *
 * Fails OPEN on error, for the same two reasons the kill-switch lookup does —
 * this module must not throw, and a cost control going dark should not take
 * all messaging down with it.
 */
async function isOverDailyLimit(
  client:  Pick<PoolClient, 'query'>,
  groupId: string,
  count:   number,
): Promise<{ limit: number; used: number } | null> {
  try {
    const { rows } = await client.query<{ limit: number | null; used: string }>(
      `SELECT s.daily_send_limit AS limit,
              (SELECT count(*) FROM sms_usage_logs u
                WHERE u.group_id = s.group_id
                  AND u.billing_state <> 'released'
                  AND u.created_at >= date_trunc('day', NOW() AT TIME ZONE 'Africa/Nairobi')
                                        AT TIME ZONE 'Africa/Nairobi') AS used
         FROM sms_group_settings s
        WHERE s.group_id = $1`,
      [groupId],
    );
    const limit = rows[0]?.limit ?? null;
    if (limit === null) return null; // no row, or NULL = unlimited

    const used = Number(rows[0].used);
    return used + count > limit ? { limit, used } : null;
  } catch (err) {
    logger.warn('[messaging-billing] daily-limit lookup failed — allowing dispatch', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function classifyReserveError(err: unknown, target: ReservationTarget): ReserveResult {
  const code   = (err as { code?: string })?.code;
  const detail = err instanceof Error ? err.message : String(err);

  if (code === PG_INSUFFICIENT) {
    return { ok: false, reason: 'insufficient_credits', detail };
  }
  if (code === PG_NOT_AUTHORIZED) {
    // The group path raises this for a missing/inactive subscription; the org
    // path raises it when the group has no active access under the org.
    return {
      ok:     false,
      reason: target.payerType === 'organization' ? 'not_authorized' : 'subscription_inactive',
      detail,
    };
  }
  if (code === PG_BAD_INPUT) {
    return { ok: false, reason: 'no_billing_account', detail };
  }

  // Anything else is a genuine fault (connection loss, a bug). Surface it as a
  // failure rather than a throw — but log it, because unlike the cases above
  // it is not an expected outcome.
  logger.error('[messaging-billing] unexpected reserve error', { err: detail, target });
  return { ok: false, reason: 'no_billing_account', detail };
}

/**
 * Convert earmarks into a real charge, or return them.
 *
 * Idempotent by construction: the RPC only claims rows still in
 * `billing_state='reserved'`, so settling a batch twice is a no-op rather than
 * a double charge. Never throws — this runs after the provider has already
 * accepted the message, and an escaping error here would strand the
 * reservation with the SMS already sent.
 */
export async function settleReservation(
  logIds:  string[],
  outcome: 'consume' | 'release',
): Promise<{ settled: boolean; credits: number }> {
  if (!logIds.length) return { settled: true, credits: 0 };

  try {
    const { rows } = await withAdminDb((db) =>
      db.query<{ result: { payers: number; credits: string } }>(
        `SELECT settle_sms_credit_reservation($1::uuid[], $2) AS result`,
        [logIds, outcome],
      ),
    );
    return { settled: true, credits: Number(rows[0].result.credits ?? 0) };
  } catch (err) {
    // Deliberately swallowed. The stale-reservation sweeper
    // (sms_release_stale_reservations) is the backstop: it re-settles anything
    // left in 'reserved', consuming rows the provider accepted and releasing
    // the rest. Losing this write is recoverable; throwing is not.
    logger.error('[messaging-billing] settle failed — sweeper will recover', {
      err: err instanceof Error ? err.message : String(err),
      outcome,
      count: logIds.length,
    });
    return { settled: false, credits: 0 };
  }
}

/**
 * Raise a low-balance alert for a payer, at most once per 24h.
 *
 * Enqueued rather than sent inline so a slow SMTP call never sits in the SMS
 * path. `low_balance_notified_at` (not the dedup key alone) drives the 24h
 * window, because the top-up path clears it — so the alert re-arms on recovery
 * instead of going quiet for a fixed period.
 *
 * The alert itself must NEVER be delivered by SMS: a group is alerted exactly
 * when it cannot afford to send one. The handler uses in-app + email only.
 */
export async function raiseLowBalanceAlert(target: ReservationTarget): Promise<void> {
  if (target.payerType === 'platform') return;

  const isOrg = target.payerType === 'organization';
  const id    = isOrg ? target.organizationId : target.groupId;
  if (!id) return;

  try {
    const table  = isOrg ? 'organization_billing_accounts' : 'billing_accounts';
    const keyCol = isOrg ? 'organization_id' : 'group_id';

    // Claim-by-UPDATE: only the caller that actually moves the timestamp gets
    // to enqueue, so concurrent senders can't produce a burst of alerts.
    const claimed = await withAdminDb((db) =>
      db.query(
        `UPDATE ${table}
         SET low_balance_notified_at = NOW()
         WHERE ${keyCol} = $1
           AND (low_balance_notified_at IS NULL
                OR low_balance_notified_at < NOW() - INTERVAL '24 hours')`,
        [id],
      ).then((r) => r.rowCount ?? 0),
    );
    if (!claimed) return;

    await enqueueJob(
      'sms_low_balance_alert',
      { payerType: target.payerType, groupId: target.groupId, organizationId: target.organizationId ?? null },
      { priority: 8, dedup_key: `low_balance:${target.payerType}:${id}`, max_attempts: 3 },
    );
  } catch (err) {
    // An alert is best-effort; failing to warn must never fail the send path.
    logger.error('[messaging-billing] low-balance alert failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Clear the low-balance flag so the alert re-arms. Called by the top-up path.
 *
 * For a long time nothing called this: billing.service.ts's addSmsCredits()
 * — the group top-up path — never invoked it, so a group that ran dry, got
 * warned, and topped up the same day would run dry a second time in total
 * silence, because raiseLowBalanceAlert() claims by moving
 * low_balance_notified_at and then declines to fire for 24h. Wired up
 * 2026-08-20 (SMS_SYSTEM_AUDIT_2026-08-20.md M1); the organization sibling
 * below was correct from the start.
 */
export async function clearLowBalanceFlag(groupId: string): Promise<void> {
  await pool.query(
    `UPDATE billing_accounts SET low_balance_notified_at = NULL WHERE group_id = $1`,
    [groupId],
  ).catch(() => { /* best-effort */ });
}

/** Organization-side mirror of clearLowBalanceFlag, for addOrganizationSmsCredits. */
export async function clearOrganizationLowBalanceFlag(organizationId: string): Promise<void> {
  await pool.query(
    `UPDATE organization_billing_accounts SET low_balance_notified_at = NULL WHERE organization_id = $1`,
    [organizationId],
  ).catch(() => { /* best-effort */ });
}

/**
 * Zero the bundled SMS allowance for every group whose own billing anniversary
 * has come round. Driven by the sms_allowance_reset job, DAILY at 01:00 UTC.
 *
 * Was a single sweep on the 1st of the month (migration 124), which did not
 * match what a group actually buys: a subscription's cycle runs from the day
 * it was purchased, so a group joining on the 28th got a fresh allowance three
 * days later while one joining on the 2nd waited 29 days. Migration 151 moved
 * the period onto the subscription anniversary.
 *
 * Idempotent by construction. The anniversary is derived from started_at on
 * every run and compared against sms_allowance_period_start, so running this
 * hourly, daily, or twice in a minute resets each group exactly once per
 * cycle. That matters because it now runs every day rather than once a month.
 *
 * Deriving the anniversary each time (rather than adding a month to the last
 * one) is also what stops it drifting: Postgres clamps 31 Jan + 1 month to
 * 28 Feb, but the next anniversary is computed from started_at again and
 * lands on 31 Mar.
 *
 * Deliberately does NOT touch sms_allowance_reserved: an in-flight
 * reservation self-drains through the normal settle flow (consume or
 * release), and zeroing it here would mask a genuinely stuck reservation
 * instead of surfacing it to sms_release_stale_reservations, which exists
 * precisely to catch that.
 */
export async function resetDueSmsAllowances(): Promise<{ groupsReset: number }> {
  const { rowCount } = await withAdminDb((db) =>
    db.query(
      `UPDATE billing_accounts ba
       SET    sms_allowance_used        = 0,
              sms_allowance_period_start = anniv.period_start,
              updated_at                 = NOW()
       FROM (
         SELECT s.group_id,
                (s.started_at::date
                  + ((date_part('year',  age(CURRENT_DATE, s.started_at::date)) * 12
                    + date_part('month', age(CURRENT_DATE, s.started_at::date)))::int)
                    * INTERVAL '1 month')::date AS period_start
         FROM   subscriptions s
         WHERE  s.status = 'active'
       ) AS anniv
       WHERE ba.group_id = anniv.group_id
         AND (ba.sms_allowance_period_start IS NULL
              OR ba.sms_allowance_period_start < anniv.period_start)`,
    ),
  );
  return { groupsReset: rowCount ?? 0 };
}
