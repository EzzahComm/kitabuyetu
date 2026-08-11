/**
 * SMS trigger engine — the WHEN/THEN runtime.
 *
 * Business code calls `emitBusinessEvent()` and moves on. The engine finds the
 * active rules for that event type, evaluates each rule's conditions against
 * the payload, and either sends inline or defers to the job queue.
 *
 * Three invariants hold this together:
 *
 *  1. **Emitting never throws.** An SMS failure must never roll back the
 *     payment (or loan, or contribution) that triggered it. Every path is
 *     caught; failures land in sms_trigger_executions.reason, not the caller.
 *
 *  2. **Exactly-once per (rule, event).** The UNIQUE (rule_id, event_id) insert
 *     is the claim. A replayed M-Pesa callback re-emits the same event_id, the
 *     insert no-ops, and no duplicate SMS goes out. This is why the execution
 *     row is written *before* the send, not after.
 *
 *  3. **Terminal is terminal.** Rows leave 'pending' exactly once (DB trigger
 *     enforces it). Retries keep the row 'pending' and bump `attempts` until
 *     max_retries, then settle on 'failed'.
 */

import { withAdminDb } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs';
import { logger } from '@/lib/logger';
import { AppError } from '@/lib/utils/errors';
import { smsService, resolveSmsRecipients, GROUP_PAYER, type SmsPayer } from '@/lib/services/sms.service';
import { renderTemplate, stripUnresolved, DEFAULT_TEMPLATES } from './templates';
import { evaluateCondition } from './conditions';
import { parseRecipientSpec, type BusinessEvent, type EventPayload, type RecipientSpec } from './events';

interface RuleRow {
  id:              string;
  group_id:        string | null;
  organization_id: string | null;
  name:            string;
  event_type:      string;
  conditions:     unknown;
  template_key:   string;
  recipient_spec: unknown;
  delay_seconds:  number;
  max_retries:    number;
  created_by:     string | null;
}

export interface EmitSummary {
  evaluated: number;
  matched:   number;
  dispatched: number;
  deferred:  number;
  skipped:   number;
}

// ─── Rule resolution ─────────────────────────────────────────────────────────

/**
 * Rules visible to a group: its own, those of any Organization that oversees it, and
 * platform defaults. Where several rules share a `name`, the most specific
 * scope wins — that is how a group overrides an Organization default without the Organization
 * rule having to be disabled for everyone.
 */
export async function loadMatchingRules(eventType: string, groupId: string): Promise<RuleRow[]> {
  const rows = await withAdminDb((db) =>
    db.query<RuleRow>(
      `SELECT r.id, r.group_id, r.organization_id, r.name, r.event_type, r.conditions,
              r.template_key, r.recipient_spec, r.delay_seconds, r.max_retries, r.created_by
       FROM sms_trigger_rules r
       WHERE r.is_active AND r.event_type = $1
         AND (
              r.group_id = $2
           OR (r.group_id IS NULL AND r.organization_id IS NULL)
           OR (r.group_id IS NULL AND r.organization_id IN (
                 SELECT nga.organization_id FROM organization_group_access nga
                 WHERE nga.group_id = $2 AND nga.is_active
              ))
         )`,
      [eventType, groupId],
    ).then((r) => r.rows),
  );

  const specificity = (r: RuleRow) => (r.group_id ? 2 : r.organization_id ? 1 : 0);
  const winner = new Map<string, RuleRow>();
  for (const rule of rows) {
    const existing = winner.get(rule.name);
    if (!existing || specificity(rule) > specificity(existing)) winner.set(rule.name, rule);
  }
  return [...winner.values()];
}

// ─── Emit ────────────────────────────────────────────────────────────────────

export async function emitBusinessEvent(event: BusinessEvent): Promise<EmitSummary> {
  const summary: EmitSummary = { evaluated: 0, matched: 0, dispatched: 0, deferred: 0, skipped: 0 };

  try {
    const rules = await loadMatchingRules(event.eventType, event.groupId);
    summary.evaluated = rules.length;

    for (const rule of rules) {
      if (!evaluateCondition(rule.conditions, event.payload)) {
        summary.skipped++;
        // Non-matches are logged, not persisted: an execution row per rule per
        // event would grow the audit table with the events that did nothing.
        logger.debug('[sms-trigger] conditions not met', { rule: rule.name, event: event.eventType });
        continue;
      }
      summary.matched++;

      const executionId = await claimExecution(rule, event);
      if (!executionId) {
        // Already claimed — a duplicate emit of the same business event.
        logger.info('[sms-trigger] duplicate event suppressed', {
          rule: rule.name, eventId: event.eventId,
        });
        continue;
      }

      if (rule.delay_seconds > 0) {
        await enqueueJob(
          'sms_trigger_fire',
          { executionId },
          {
            priority:  6,
            run_at:    new Date(Date.now() + rule.delay_seconds * 1000),
            dedup_key: `sms_trigger_fire:${executionId}`,
            max_attempts: rule.max_retries + 1,
          },
        );
        summary.deferred++;
      } else {
        await dispatchExecution(executionId);
        summary.dispatched++;
      }
    }
  } catch (err) {
    // Deliberately swallowed. See invariant (1) — the caller is mid-payment.
    logger.error('[sms-trigger] emit failed', { event: event.eventType, eventId: event.eventId, err });
  }

  return summary;
}

/**
 * Insert the execution row, which *is* the idempotency claim. Returns null when
 * the row already exists (duplicate event), meaning: do not send.
 */
async function claimExecution(rule: RuleRow, event: BusinessEvent): Promise<string | null> {
  const scheduledFor = rule.delay_seconds > 0
    ? new Date(Date.now() + rule.delay_seconds * 1000)
    : null;

  const { rows } = await withAdminDb((db) =>
    db.query<{ id: string }>(
      `INSERT INTO sms_trigger_executions
         (rule_id, group_id, event_type, event_id, event_payload, scheduled_for)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (rule_id, event_id) DO NOTHING
       RETURNING id`,
      [rule.id, event.groupId, event.eventType, event.eventId,
       JSON.stringify(event.payload), scheduledFor],
    ),
  );
  return rows[0]?.id ?? null;
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

interface ExecutionRow extends RuleRow {
  execution_id:  string;
  exec_group_id: string;
  event_id:      string;
  event_payload: EventPayload;
  attempts:      number;
}

/**
 * Render and send one claimed execution. Safe to call twice: the row is only
 * moved out of 'pending' once, and the DB trigger rejects a second transition.
 *
 * Called inline for delay_seconds = 0, and from the sms_trigger_fire job
 * handler for deferred rules.
 */
export async function dispatchExecution(executionId: string): Promise<void> {
  const exec = await withAdminDb((db) =>
    db.query<ExecutionRow>(
      `SELECT e.id AS execution_id, e.group_id AS exec_group_id, e.event_id,
              e.event_payload, e.attempts,
              r.id, r.group_id, r.organization_id, r.name, r.event_type, r.conditions,
              r.template_key, r.recipient_spec, r.delay_seconds, r.max_retries, r.created_by
       FROM sms_trigger_executions e
       JOIN sms_trigger_rules r ON r.id = e.rule_id
       WHERE e.id = $1 AND e.status = 'pending'`,
      [executionId],
    ).then((r) => r.rows[0]),
  );

  // Absent or already terminal — nothing to do. Not an error: a retried job
  // whose first attempt succeeded lands here.
  if (!exec) return;

  const spec = parseRecipientSpec(exec.recipient_spec);
  if (!spec) return settle(executionId, 'failed', `malformed recipient_spec on rule ${exec.name}`);

  const body = await loadTemplateBody(exec.exec_group_id, exec.template_key);
  if (!body) return settle(executionId, 'failed', `no template for key '${exec.template_key}'`);

  let phones: string[];
  try {
    phones = await resolveRecipients(exec.exec_group_id, spec, exec.event_payload);
  } catch (err) {
    return retryOrFail(exec, `recipient resolution failed: ${errText(err)}`);
  }

  if (!phones.length) return settle(executionId, 'suppressed', 'no eligible recipients');

  const message = stripUnresolved(renderTemplate(body, toTemplateVars(exec.event_payload)));

  // An organization-scoped rule is the organization's automation, so the
  // organization funds it. Group and platform-default rules bill the group —
  // a platform default is not anyone's campaign to pay for.
  const payer: SmsPayer = exec.organization_id
    ? { type: 'organization', organizationId: exec.organization_id }
    : GROUP_PAYER;

  try {
    const logs = await smsService.send(
      // Empty string, not 'system': app_current_user_id() is
      // NULLIF(current_setting(...), '')::uuid, so '' becomes a NULL uuid while
      // any non-uuid literal raises 22P02 on the first RLS policy that reads it.
      // A platform-default rule has no created_by, so it would have failed every
      // dispatch — masked until now by C1 throwing earlier in the same call
      // (SMS_MESSAGING_AUDIT_2026-08.md M1).
      { userId: exec.created_by ?? '', groupId: exec.exec_group_id, role: 'chairperson' },
      phones,
      message,
      exec.event_type,
      // reference_id is a UUID column; the event id is the business row it came from.
      exec.event_id,
      payer,
    );

    // send() returns [] when every recipient is on the opt-out list — nothing
    // was billed and nothing dispatched, which is a suppression, not a send.
    if (!logs.length) return settle(executionId, 'suppressed', 'all recipients opted out');

    await withAdminDb((db) =>
      db.query(
        `UPDATE sms_trigger_executions
         SET status='sent', executed_at=NOW(), attempts=attempts+1,
             sms_log_ids=$2::uuid[], recipients=$3
         WHERE id=$1 AND status='pending'`,
        [executionId, logs.map((l) => l.id), logs.length],
      ),
    );
    logger.info('[sms-trigger] sent', { rule: exec.name, recipients: logs.length });
  } catch (err) {
    // Billing-configuration failures (insufficient credits, inactive
    // subscription, no billing account — smsService.send's 402s, all thrown
    // as AppError with statusCode 402) are deterministic: retrying with
    // backoff can't fix "there is no money," it just re-attempts the same
    // failure `max_retries` times before giving up anyway. Fail immediately
    // instead — [PROVEN-PROD]: the payment.received rule for one group
    // burned 4 attempts per event, 5 events in one evening, 100% "Insufficient
    // SMS credits," zero of them ever going to reach a different outcome.
    // Anything else here (provider outage, transient network error) still
    // gets the normal retry/backoff below.
    if (err instanceof AppError && err.statusCode === 402) {
      logger.warn('[sms-trigger] billing failure — not retrying', { rule: exec.name, reason: err.message });
      return settle(exec.execution_id, 'failed', err.message);
    }
    await retryOrFail(exec, errText(err));
  }
}

/** Keep the row 'pending' and re-enqueue while attempts remain; else settle 'failed'. */
async function retryOrFail(exec: ExecutionRow, reason: string): Promise<void> {
  const attempts = exec.attempts + 1;

  if (attempts > exec.max_retries) {
    logger.error('[sms-trigger] giving up', { rule: exec.name, attempts, reason });
    return settle(exec.execution_id, 'failed', reason);
  }

  await withAdminDb((db) =>
    db.query(
      `UPDATE sms_trigger_executions SET attempts=$2, reason=$3
       WHERE id=$1 AND status='pending'`,
      [exec.execution_id, attempts, reason],
    ),
  );

  // Exponential backoff: 1, 2, 4 … minutes, matching sms_failures' cadence.
  const backoffMs = Math.min(2 ** (attempts - 1), 8) * 60_000;
  await enqueueJob(
    'sms_trigger_fire',
    { executionId: exec.execution_id },
    {
      priority:  6,
      run_at:    new Date(Date.now() + backoffMs),
      dedup_key: `sms_trigger_fire:${exec.execution_id}:${attempts}`,
      max_attempts: 1,
    },
  );
  logger.warn('[sms-trigger] retry scheduled', { rule: exec.name, attempts, reason });
}

async function settle(
  executionId: string,
  status: 'sent' | 'failed' | 'suppressed',
  reason: string,
): Promise<void> {
  await withAdminDb((db) =>
    db.query(
      `UPDATE sms_trigger_executions
       SET status=$2, reason=$3, executed_at=NOW(), attempts=attempts+1
       WHERE id=$1 AND status='pending'`,
      [executionId, status, reason],
    ),
  );
  if (status === 'failed') logger.error('[sms-trigger] execution failed', { executionId, reason });
}

// ─── Recipients & templates ──────────────────────────────────────────────────

export async function resolveRecipients(
  groupId: string,
  spec: RecipientSpec,
  payload: EventPayload,
): Promise<string[]> {
  switch (spec.type) {
    case 'event_phone': {
      const phone = payload[spec.field];
      return typeof phone === 'string' && phone.trim() ? [phone] : [];
    }

    case 'event_member': {
      const memberId = payload[spec.field];
      if (typeof memberId !== 'string' || !memberId) return [];
      return resolveSmsRecipients(groupId, 'selected', { memberIds: [memberId] });
    }

    case 'roles':
      return resolveSmsRecipients(groupId, 'roles', { roles: spec.roles });

    case 'all_members':
    case 'active_members':
      return resolveSmsRecipients(groupId, spec.type, null);
  }
}

/** Group override first, then a system template, then the compiled-in default. */
async function loadTemplateBody(groupId: string, key: string): Promise<string | null> {
  const body = await withAdminDb((db) =>
    db.query<{ body: string }>(
      `SELECT body FROM sms_templates
       WHERE (group_id=$1 OR group_id IS NULL) AND template_key=$2 AND is_active
       ORDER BY group_id NULLS LAST LIMIT 1`,
      [groupId, key],
    ).then((r) => r.rows[0]?.body ?? null),
  );

  // A rule may name a custom key with no DB row yet; fall back only if the key
  // is one we ship. Unknown keys fail loudly rather than sending an empty SMS.
  return body ?? (DEFAULT_TEMPLATES as Record<string, string | undefined>)[key] ?? null;
}

function toTemplateVars(payload: EventPayload): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== null && v !== undefined) vars[k] = String(v);
  }
  return vars;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
