/**
 * QStash (Upstash) client — two independent, both-optional uses of the same
 * QStash account. Each falls back to its pre-existing behavior when unset;
 * neither depends on the other.
 *
 * 1. Chunked bulk-SMS fan-out. Closes SMS_MESSAGING_AUDIT_2026-08.md H3
 *    (SMS-007/SMS-015): the re-billing-on-retry half of that finding was
 *    left open pending "a dispatch-level idempotency key" (see
 *    lib/jobs/db.ts's resetStuckJobs comment) — this is that key, applied
 *    per chunk. Also closes docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md
 *    Phase 3 item 10 ("per-recipient checkpointing in handleSmsBulkSend").
 *    Pulled forward ahead of that doc's own Phase 4/5 because the Chama
 *    Reminder product depends on broadcast-scale sends being safe before its
 *    portal ships. handleSmsBulkSend (lib/jobs/handlers.ts) used to dispatch
 *    an entire campaign as ONE function invocation looping over every
 *    recipient in-process — a timeout mid-loop reset the whole job to
 *    'pending' and re-ran it from scratch, re-billing and re-sending
 *    recipients who'd already gone out. Large campaigns now split into
 *    chunks, each delivered as its own QStash-triggered HTTP call to
 *    /api/v1/workers/sms-dispatch-chunk, with QStash's own per-message
 *    retry/DLQ instead of one shared function-timeout budget.
 *
 * 2. Disbursement watchdog (Upstash Workflow, a separate package built on
 *    QStash). Closes B2C_DISBURSEMENT_AUDIT.md C5 for all three money-out
 *    spines — disbursements, settlements, vendor payments — where a dropped
 *    Daraja result callback leaves a payout stuck in 'dispatched'/
 *    'processing' forever with its true state unknown
 *    (docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md §9). Purely additive:
 *    the real callback handlers (handleB2CResult etc.) remain the primary
 *    resolution path and are unchanged; the watchdog only turns "stuck
 *    forever, silently" into a bounded, explicit 'timed_out' status when the
 *    callback never arrives. See lib/services/disbursement-watchdog.service.ts.
 *
 * Deliberately optional, same "falls back when unset" pattern as every
 * other provider block in lib/env.ts: isQstashConfigured() is false when
 * any of the four QSTASH_* vars is unset, and every caller of this module
 * degrades to its pre-existing behavior exactly as if this file didn't
 * exist. Nothing else in the platform depends on QStash — the Postgres
 * job_queue/pg_cron scheduler that runs everything else is untouched (see
 * the messaging architecture doc's "Explicitly not duplicating" note on why
 * this stays narrowly scoped).
 */
import { Client } from '@upstash/qstash';
import { Client as WorkflowClient } from '@upstash/workflow';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import type { TemplateVars } from '@/lib/sms/templates';

export function isQstashConfigured(): boolean {
  return Boolean(env.QSTASH_URL && env.QSTASH_TOKEN && env.QSTASH_CURRENT_SIGNING_KEY && env.QSTASH_NEXT_SIGNING_KEY);
}

const globalWithQstash = globalThis as typeof globalThis & { _kyQstash?: Client };

function buildClient(): Client {
  if (!env.QSTASH_TOKEN) throw new Error('QSTASH_TOKEN environment variable is not set');
  // baseUrl defaults to https://qstash.upstash.io when unset — only pass it
  // through when configured (e.g. a region-pinned endpoint).
  return new Client(env.QSTASH_URL ? { token: env.QSTASH_TOKEN, baseUrl: env.QSTASH_URL } : { token: env.QSTASH_TOKEN });
}

function client(): Client {
  if (!globalWithQstash._kyQstash) {
    globalWithQstash._kyQstash = buildClient();
  }
  return globalWithQstash._kyQstash;
}

// Falls back to the production domain, matching lib/brand.ts and every
// other NEXT_PUBLIC_APP_URL call site's convention.
function appBaseUrl(): string {
  return (env.NEXT_PUBLIC_APP_URL ?? 'https://kitabuyetu.co.ke').replace(/\/$/, '');
}

export interface SmsDispatchChunkPayload {
  jobId:          string;
  chunkIndex:     number;
  chunkCount:     number;
  groupId:        string;
  campaignId?:    string;
  phones:         string[];
  message:        string;
  senderId?:      string;
  timeToSend?:    string;
  referenceType?: string;
  referenceId?:   string;
  sentBy:         string;
  totalRecipientCount: number;
  fundedBy?:            'organization';
  payerOrganizationId?: string;
  /** Precomputed per-phone template variables, serialised (Map isn't JSON-safe). */
  varsByPhone?: Record<string, TemplateVars>;
}

/**
 * Publish one recipient chunk for async dispatch. Each chunk carries its own
 * stable dispatch key (`${jobId}:chunk:${chunkIndex}`, derived by the
 * receiving route — see sms-dispatch-chunk/route.ts) so a QStash-driven
 * retry of this exact chunk re-hits sendBulkCampaign's own dedup rather than
 * double-billing. Returns the QStash message id for logging; callers should
 * not treat publish failures as fatal to the whole batch — see
 * handleSmsBulkSend's own fallback comment.
 */
export async function publishSmsChunk(payload: SmsDispatchChunkPayload): Promise<string> {
  const { messageId } = await client().publishJSON({
    url:  `${appBaseUrl()}/api/v1/workers/sms-dispatch-chunk`,
    body: payload,
    // Let QStash retry a chunk that 5xxs or times out — independent of, and
    // in addition to, the sms_usage_logs-level retry sms_failures already
    // does for individual provider rejections.
    retries: 3,
  });
  logger.info(`[qstash] published SMS chunk ${payload.chunkIndex + 1}/${payload.chunkCount} for job ${payload.jobId}`, { messageId });
  return messageId;
}

// ─── Disbursement watchdog (Upstash Workflow) ──────────────────────────────

const globalWithWorkflow = globalThis as typeof globalThis & { _kyWorkflowClient?: WorkflowClient };

function workflowClient(): WorkflowClient {
  if (!globalWithWorkflow._kyWorkflowClient) {
    if (!env.QSTASH_TOKEN) throw new Error('QSTASH_TOKEN environment variable is not set');
    globalWithWorkflow._kyWorkflowClient = env.QSTASH_URL
      ? new WorkflowClient({ token: env.QSTASH_TOKEN, baseUrl: env.QSTASH_URL })
      : new WorkflowClient({ token: env.QSTASH_TOKEN });
  }
  return globalWithWorkflow._kyWorkflowClient;
}

export type DisbursementWatchdogKind = 'disbursement' | 'settlement' | 'vendor_payment';

export interface DisbursementWatchdogPayload {
  kind:  DisbursementWatchdogKind;
  rowId: string;
}

/**
 * One shared key, used as BOTH the Upstash Workflow `workflowRunId` (at
 * trigger time) and the `waitForEvent`/`notify` `eventId` (at trigger AND
 * callback time). Never hand-format this string anywhere else — the trigger
 * site and the callback site derive it independently (different HTTP
 * requests, no shared state), so if they ever compute it differently they
 * can never rendezvous. Safe as a stable, collision-free identifier: none of
 * the three source tables (disbursement_requests/settlement_requests/
 * vendor_payments) ever reuses a row's id across a retry — a rejected or
 * failed request always creates a NEW row.
 */
export function watchdogKey(kind: DisbursementWatchdogKind, rowId: string): string {
  return `${kind}:${rowId}`;
}

/**
 * Best-effort: start a watchdog workflow run for a payout row that just
 * dispatched successfully. Never throws — a failure to start the watchdog
 * must never block or fail the real Daraja dispatch it's meant to watch.
 * Supplying our own `workflowRunId` (rather than round-tripping the one
 * `trigger()` would otherwise generate) is what lets notifyDisbursementCallback
 * reach this run later without any new column or DB round-trip to pass an
 * id between two independent HTTP requests — see watchdogKey's own comment.
 *
 * If QStash/Workflow is unconfigured or down, this is a no-op: the row falls
 * back to exactly today's status quo (silent-stuck until the hourly
 * findStuck*() sweep pages it — see disbursement-watchdog.service.ts).
 */
export async function triggerDisbursementWatchdog(input: DisbursementWatchdogPayload): Promise<void> {
  if (!isQstashConfigured()) return;
  const key = watchdogKey(input.kind, input.rowId);
  try {
    await workflowClient().trigger({
      url:            `${appBaseUrl()}/api/v1/workers/disbursement-watchdog`,
      body:           input,
      workflowRunId:  key,
    });
  } catch (err) {
    logger.error(`[qstash] failed to trigger disbursement watchdog for ${key}`, { err: String(err) });
  }
}

/**
 * Best-effort: tell a waiting watchdog run that the real callback handler
 * has already resolved this row, so the workflow ends immediately instead of
 * idling out its full timeout. Never throws. A failed/lost notify is safe,
 * not silently wrong: if the watchdog still times out afterward, its own
 * resolution step is idempotent on `status IN ('dispatched','processing')`
 * (resolveWatchdogTimeout) — a row the real handler already completed or
 * failed no longer matches that WHERE clause, so the stale timeout is a no-op.
 */
export async function notifyDisbursementCallback(
  kind:      DisbursementWatchdogKind,
  rowId:     string,
  eventData: unknown,
): Promise<void> {
  if (!isQstashConfigured()) return;
  const key = watchdogKey(kind, rowId);
  try {
    await workflowClient().notify({ eventId: key, workflowRunId: key, eventData });
  } catch (err) {
    logger.error(`[qstash] failed to notify disbursement watchdog for ${key}`, { err: String(err) });
  }
}
