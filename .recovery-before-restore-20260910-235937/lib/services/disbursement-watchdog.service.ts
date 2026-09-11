/**
 * Disbursement watchdog — timeout resolution (Upstash Workflow).
 *
 * Closes B2C_DISBURSEMENT_AUDIT.md C5 for all three money-out spines
 * (docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md §9): a dropped Daraja
 * result callback leaves a payout stuck 'dispatched'/'processing' forever,
 * with its true state unknown. This module is the ONE thing the watchdog
 * workflow route (app/api/v1/workers/disbursement-watchdog/route.ts) does
 * when its context.waitForEvent step times out — kept as a plain, directly
 * testable function rather than logic buried inside the serve()-wrapped
 * route, same "route is a thin adapter" discipline as
 * app/api/v1/workers/sms-dispatch-chunk/route.ts over smsService.sendBulkCampaign.
 *
 * The real callback handlers — handleB2CResult (mpesa-b2c.service.ts),
 * handleSettlementB2BResult / handleVendorPaymentResult
 * (settlement-callbacks.service.ts) — remain the PRIMARY resolution path and
 * are unchanged. This module only runs when they never got the chance to.
 *
 * Deliberately does NOT touch accounts.reserved_amount. A timed-out row's
 * money fate is genuinely unknown — Safaricom may have paid it out for real
 * despite the callback being dropped. Releasing the reservation on timeout
 * would let the group's available balance grow back before anyone has
 * confirmed the money didn't leave, opening a double-spend window. This
 * preserves exactly today's implicit behavior (nothing mutates a stuck row's
 * reservation) — it only makes the status explicit and findable instead of
 * silently stuck.
 */
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { DisbursementWatchdogKind } from '@/lib/queue/qstash';

// Table/in-flight-status pair per kind. Keyed by the closed
// DisbursementWatchdogKind union (never user input) — safe to interpolate
// the table name directly, there is no fourth value this can ever be.
const SPINE_BY_KIND: Record<DisbursementWatchdogKind, { table: string; inProgressStatus: string }> = {
  disbursement:   { table: 'disbursement_requests', inProgressStatus: 'dispatched' },
  settlement:     { table: 'settlement_requests',   inProgressStatus: 'processing' },
  vendor_payment: { table: 'vendor_payments',       inProgressStatus: 'processing' },
};

export interface WatchdogTimeoutResult {
  /** false means the real callback handler already resolved this row before
   *  the workflow's timeout fired — a safe no-op, not an error. */
  resolved: boolean;
}

/**
 * Flip a payout row to 'timed_out' — ONLY if it's still in its in-flight
 * state. Idempotent and race-safe: if handleB2CResult (or its settlement/
 * vendor-payment equivalents) already moved the row to 'completed'/'failed'
 * — whether because the real callback beat the timeout, or because
 * notifyDisbursementCallback's own best-effort notify raced ahead of this
 * workflow reaching waitForEvent and got lost — this UPDATE's WHERE clause
 * simply matches zero rows and `resolved` comes back false.
 */
export async function resolveWatchdogTimeout(
  kind:  DisbursementWatchdogKind,
  rowId: string,
): Promise<WatchdogTimeoutResult> {
  const { table, inProgressStatus } = SPINE_BY_KIND[kind];

  return withAdminDb(async (db) => {
    const { rows } = await db.query<{ id: string; group_id: string; amount: string }>(
      `UPDATE ${table}
       SET    status = 'timed_out',
              failure_reason = 'Watchdog timeout: no Daraja result callback received within the wait window'
       WHERE  id = $1 AND status = $2
       RETURNING id, group_id, amount`,
      [rowId, inProgressStatus],
    );
    const row = rows[0];

    if (row) {
      // Same shape/fields as findStuckDisbursements' existing paging signal
      // (disbursements.service.ts) — deliberately not a new alert channel;
      // see the messaging architecture doc §9 for why.
      logger.error(`[disbursement-watchdog] ${kind} timed out waiting for a Daraja result callback`, {
        kind, id: row.id, groupId: row.group_id, amount: row.amount,
      });
    }

    return { resolved: Boolean(row) };
  });
}
