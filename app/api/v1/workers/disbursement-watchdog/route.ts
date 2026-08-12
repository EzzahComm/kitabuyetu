/**
 * POST /api/v1/workers/disbursement-watchdog — Upstash Workflow.
 *
 * Triggered by lib/queue/qstash.ts's triggerDisbursementWatchdog() right
 * after a disbursement/settlement/vendor-payment row's Daraja call succeeds
 * (disbursements.service.ts's dispatchDisbursement, and the settlement/
 * vendor-payment equivalents). Closes B2C_DISBURSEMENT_AUDIT.md C5 — see
 * lib/services/disbursement-watchdog.service.ts's header for the full
 * rationale and lib/queue/qstash.ts's watchdogKey() for why the same key
 * is safe to derive independently at both the trigger site and the
 * callback site.
 *
 * This route is a thin adapter, not a second resolution pipeline: the real
 * callback handlers (handleB2CResult etc.) are what actually complete a
 * payout, exactly as they did before this route existed. All this run does
 * is wait for one of those handlers to call notifyDisbursementCallback(),
 * and if the wait window elapses without that happening, flip the row to an
 * explicit 'timed_out' status via resolveWatchdogTimeout — never resolve or
 * retry the underlying payment itself.
 *
 * Auth: serve() verifies every request is genuinely from QStash using
 * QSTASH_CURRENT_SIGNING_KEY/QSTASH_NEXT_SIGNING_KEY (read from env by
 * default — no Receiver wiring needed here, unlike sms-dispatch-chunk/
 * route.ts, which predates this package). That check is independent of this
 * app's own proxy-level auth gate — proxy.ts's isWebhook set must allow-list
 * this exact path or every QStash-driven invocation 401s before serve() is
 * ever reached (see that file's own comment for the sms-dispatch-chunk
 * precedent this mirrors).
 */
import { serve } from '@upstash/workflow/nextjs';
import type { WorkflowContext } from '@upstash/workflow';
import { watchdogKey, type DisbursementWatchdogPayload } from '@/lib/queue/qstash';
import { resolveWatchdogTimeout } from '@/lib/services/disbursement-watchdog.service';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs'; // withAdminDb's pg pool isn't edge-compatible.
export const dynamic = 'force-dynamic';

// How long a payout may sit dispatched/processing before the watchdog gives
// up waiting for Safaricom's result callback and surfaces it as 'timed_out'.
// 2x findStuckDisbursements' own "should have arrived by now" floor
// (disbursements.service.ts, 10 minutes) — conservative, and still a large
// improvement on that monitor's own up-to-~59-minute latency between hourly
// cron ticks (lib/jobs/index.ts).
const WAIT_TIMEOUT = '20m';

export const { POST } = serve<DisbursementWatchdogPayload>(
  async (context: WorkflowContext<DisbursementWatchdogPayload>) => {
    const { kind, rowId } = context.requestPayload;
    const key = watchdogKey(kind, rowId);

    const { timeout } = await context.waitForEvent('wait-for-callback', key, {
      timeout: WAIT_TIMEOUT,
    });

    if (!timeout) {
      // notifyDisbursementCallback fired — the real handler already
      // resolved this row. Nothing left for the watchdog to do.
      return;
    }

    await context.run('resolve-timeout', () => resolveWatchdogTimeout(kind, rowId));
  },
  {
    failureFunction: async ({ context, failStatus, failResponse }) => {
      // Falls back to today's status quo (hourly findStuck*() paging) if
      // the workflow itself dies for an unrelated reason (e.g. QStash
      // outage, a code bug) — this is a visibility log, not the payout's
      // only safety net.
      logger.error('[disbursement-watchdog] workflow run failed permanently', {
        workflowRunId: context.workflowRunId, failStatus, failResponse,
      });
    },
  },
);
