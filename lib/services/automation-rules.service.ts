/**
 * Automation rules service — CRUD for SMS + email trigger rules (Phase 9.4.3).
 *
 * sms_trigger_rules (migration 052) and email_trigger_rules (migration 195)
 * are separate tables with an identical shape. This service is the one place
 * that treats them as a single "automation rule" concept for authoring, so
 * the dispatch engines (lib/sms/trigger-engine.ts, email-trigger.service.ts)
 * stay untouched and channel-specific — this only ever writes rows they later
 * read.
 *
 * Rules are never hard-deleted: both execution tables reference rule_id
 * ON DELETE CASCADE, so deleting a rule would silently erase its audit trail.
 * Deactivation (is_active = false) is the only teardown path — a stopped rule
 * keeps its history and can be reactivated later.
 *
 * Query strings are written out per-channel rather than interpolating a table
 * name from a lookup — `channel` is user input (an API body/query field), and
 * this codebase never string-builds identifiers from request data.
 */

import { PoolClient } from 'pg';
import { withDb, type TenantContext } from '@/lib/db';
import { parseRecipientSpec } from '@/lib/sms/events';
import { parseRecipientEmailSpec } from './email-trigger.service';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';

export type AutomationChannel = 'sms' | 'email';
export type FrequencyCapCategory = 'transactional' | 'marketing' | 'promotional';

export interface AutomationRule {
  id: string;
  channel: AutomationChannel;
  group_id: string | null;
  organization_id: string | null;
  name: string;
  description: string | null;
  event_type: string;
  conditions: unknown;
  template_key: string;
  recipient_spec: unknown;
  delay_seconds: number;
  max_retries: number;
  is_active: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AutomationRuleExecution {
  id: string;
  event_type: string;
  event_id: string;
  status: string;
  reason: string | null;
  recipients: number;
  attempts: number;
  executed_at: Date | null;
  created_at: Date;
}

export interface FrequencyCap {
  id: string;
  rule_id: string;
  event_type: string;
  category: FrequencyCapCategory;
  max_per_day: number;
  is_active: boolean;
}

export interface AutomationRuleInput {
  name: string;
  description?: string;
  event_type: string;
  conditions?: unknown;
  template_key: string;
  recipient_spec: unknown;
  delay_seconds?: number;
  max_retries?: number;
}

export type AutomationRuleUpdate = Partial<
  Pick<
    AutomationRuleInput,
    'description' | 'conditions' | 'template_key' | 'recipient_spec' | 'delay_seconds' | 'max_retries'
  >
> & { is_active?: boolean };

function assertChannel(channel: string): asserts channel is AutomationChannel {
  if (channel !== 'sms' && channel !== 'email') throw new ValidationError("channel must be 'sms' or 'email'");
}

function validateRecipientSpec(channel: AutomationChannel, raw: unknown): void {
  const parsed = channel === 'sms' ? parseRecipientSpec(raw) : parseRecipientEmailSpec(raw);
  if (!parsed) throw new ValidationError('recipient_spec is invalid for this channel');
}

/**
 * Conditions grammar for authoring is deliberately a subset of what
 * evaluateCondition() can execute (lib/sms/conditions.ts also accepts
 * all/any/not nesting): `{}` always matches, or a single {field, op, value}
 * leaf. That covers the overwhelming majority of real rules (e.g. "amount
 * gte 1000") without a nested condition-tree builder in the UI.
 */
const CONDITION_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'contains', 'exists']);

function validateConditions(raw: unknown): void {
  if (raw === undefined || raw === null) return;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('conditions must be an object');
  const c = raw as Record<string, unknown>;
  if (Object.keys(c).length === 0) return;
  if (typeof c.field === 'string' && typeof c.op === 'string' && CONDITION_OPS.has(c.op)) return;
  throw new ValidationError('conditions must be {} or a single {field, op, value} leaf');
}

function validateCommon(channel: AutomationChannel, data: AutomationRuleInput): void {
  if (!data.name?.trim()) throw new ValidationError('Rule name is required');
  if (!data.event_type?.trim()) throw new ValidationError('event_type is required');
  if (!data.template_key?.trim()) throw new ValidationError('template_key is required');
  validateRecipientSpec(channel, data.recipient_spec);
  validateConditions(data.conditions);
  if (data.delay_seconds !== undefined && (data.delay_seconds < 0 || data.delay_seconds > 2_592_000)) {
    throw new ValidationError('delay_seconds must be between 0 and 2,592,000 (30 days)');
  }
  if (data.max_retries !== undefined && (data.max_retries < 0 || data.max_retries > 10)) {
    throw new ValidationError('max_retries must be between 0 and 10');
  }
}

/**
 * A tenant user authors a rule scoped to whichever context they're acting in
 * — their group, or (groupless) their organization. Platform-wide rules
 * (both null, e.g. migration 052's payment_received_receipt seed) are
 * ops/seed-only and not authorable from this service.
 */
function requireScope(ctx: TenantContext): { groupId: string | null; organizationId: string | null } {
  if (ctx.groupId) return { groupId: ctx.groupId, organizationId: null };
  if (ctx.organizationId) return { groupId: null, organizationId: ctx.organizationId };
  throw new ValidationError('A rule must be authored from a group or organization context');
}

/**
 * Confirm template_key names a real, active template the caller's scope can
 * see — the direct fix for the class of bug this phase surfaced in the email
 * engine (see email-trigger.service.ts): a rule that silently no-ops because
 * its template_key was never created, or was mistyped, is indistinguishable
 * from a rule that's just quiet.
 */
async function assertTemplateExists(
  db: PoolClient,
  channel: AutomationChannel,
  groupId: string | null,
  templateKey: string,
): Promise<void> {
  const table = channel === 'sms' ? 'sms_templates' : 'email_templates';
  const { rows } = await db.query(
    `SELECT 1 FROM ${table} WHERE (group_id = $1 OR group_id IS NULL) AND template_key = $2 AND is_active LIMIT 1`,
    [groupId, templateKey],
  );
  if (!rows.length) {
    throw new ValidationError(`No active ${channel} template found for key '${templateKey}'`);
  }
}

// ============================================================================
// LIST / GET
// ============================================================================

export async function listAutomationRules(ctx: TenantContext, channel?: AutomationChannel): Promise<AutomationRule[]> {
  return withDb(ctx, async (db) => {
    const out: AutomationRule[] = [];

    if (!channel || channel === 'sms') {
      const { rows } = await db.query(
        `SELECT id, group_id, organization_id, name, description, event_type, conditions,
                template_key, recipient_spec, delay_seconds, max_retries, is_active,
                created_by, created_at, updated_at
         FROM sms_trigger_rules ORDER BY created_at DESC`,
      );
      out.push(...rows.map((r) => ({ ...r, channel: 'sms' as const })));
    }

    if (!channel || channel === 'email') {
      const { rows } = await db.query(
        `SELECT id, group_id, organization_id, name, description, event_type, conditions,
                template_key, recipient_spec, delay_seconds, max_retries, is_active,
                created_by, created_at, updated_at
         FROM email_trigger_rules ORDER BY created_at DESC`,
      );
      out.push(...rows.map((r) => ({ ...r, channel: 'email' as const })));
    }

    return out.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  });
}

export async function getAutomationRule(
  ctx: TenantContext,
  channel: string,
  id: string,
): Promise<AutomationRule | null> {
  assertChannel(channel);
  return withDb(ctx, async (db) => {
    const table = channel === 'sms' ? 'sms_trigger_rules' : 'email_trigger_rules';
    const { rows } = await db.query(
      `SELECT id, group_id, organization_id, name, description, event_type, conditions,
              template_key, recipient_spec, delay_seconds, max_retries, is_active,
              created_by, created_at, updated_at
       FROM ${table} WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? { ...row, channel } : null;
  });
}

// ============================================================================
// CREATE
// ============================================================================

export async function createAutomationRule(
  ctx: TenantContext,
  channel: string,
  data: AutomationRuleInput,
): Promise<AutomationRule> {
  assertChannel(channel);
  validateCommon(channel, data);
  const scope = requireScope(ctx);

  return withDb(ctx, async (db) => {
    await assertTemplateExists(db, channel, scope.groupId, data.template_key);

    const table = channel === 'sms' ? 'sms_trigger_rules' : 'email_trigger_rules';
    const { rows } = await db.query(
      `INSERT INTO ${table}
         (group_id, organization_id, name, description, event_type, conditions,
          template_key, recipient_spec, delay_seconds, max_retries, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11)
       RETURNING id, group_id, organization_id, name, description, event_type, conditions,
                 template_key, recipient_spec, delay_seconds, max_retries, is_active,
                 created_by, created_at, updated_at`,
      [
        scope.groupId,
        scope.organizationId,
        data.name.trim(),
        data.description?.trim() || null,
        data.event_type,
        JSON.stringify(data.conditions ?? {}),
        data.template_key,
        JSON.stringify(data.recipient_spec),
        data.delay_seconds ?? 0,
        data.max_retries ?? 3,
        ctx.userId,
      ],
    );
    return { ...rows[0], channel };
  });
}

// ============================================================================
// UPDATE (including activate/deactivate)
// ============================================================================

export async function updateAutomationRule(
  ctx: TenantContext,
  channel: string,
  id: string,
  data: AutomationRuleUpdate,
): Promise<AutomationRule> {
  assertChannel(channel);
  const scope = requireScope(ctx);

  if (data.conditions !== undefined) validateConditions(data.conditions);
  if (data.recipient_spec !== undefined) validateRecipientSpec(channel, data.recipient_spec);
  if (data.delay_seconds !== undefined && (data.delay_seconds < 0 || data.delay_seconds > 2_592_000)) {
    throw new ValidationError('delay_seconds must be between 0 and 2,592,000 (30 days)');
  }
  if (data.max_retries !== undefined && (data.max_retries < 0 || data.max_retries > 10)) {
    throw new ValidationError('max_retries must be between 0 and 10');
  }

  return withDb(ctx, async (db) => {
    if (data.template_key !== undefined) {
      await assertTemplateExists(db, channel, scope.groupId, data.template_key);
    }

    const sets: string[] = ['updated_at = NOW()'];
    const vals: unknown[] = [];
    let idx = 1;

    if (data.description !== undefined) {
      sets.push(`description = $${++idx}`);
      vals.push(data.description?.trim() || null);
    }
    if (data.conditions !== undefined) {
      sets.push(`conditions = $${++idx}::jsonb`);
      vals.push(JSON.stringify(data.conditions));
    }
    if (data.template_key !== undefined) {
      sets.push(`template_key = $${++idx}`);
      vals.push(data.template_key);
    }
    if (data.recipient_spec !== undefined) {
      sets.push(`recipient_spec = $${++idx}::jsonb`);
      vals.push(JSON.stringify(data.recipient_spec));
    }
    if (data.delay_seconds !== undefined) {
      sets.push(`delay_seconds = $${++idx}`);
      vals.push(data.delay_seconds);
    }
    if (data.max_retries !== undefined) {
      sets.push(`max_retries = $${++idx}`);
      vals.push(data.max_retries);
    }
    if (data.is_active !== undefined) {
      sets.push(`is_active = $${++idx}`);
      vals.push(data.is_active);
    }

    // Ownership: only the caller's own group/org rule is editable, never an
    // inherited platform or (for a group user) organization-level default —
    // matches sms_templates' `AND is_system = false` guard on writes.
    const ownerClause = scope.groupId ? `group_id = $${++idx}` : `organization_id = $${++idx}`;
    vals.push(scope.groupId ?? scope.organizationId);

    const table = channel === 'sms' ? 'sms_trigger_rules' : 'email_trigger_rules';
    const { rows } = await db.query(
      `UPDATE ${table} SET ${sets.join(', ')}
       WHERE id = $1 AND ${ownerClause}
       RETURNING id, group_id, organization_id, name, description, event_type, conditions,
                 template_key, recipient_spec, delay_seconds, max_retries, is_active,
                 created_by, created_at, updated_at`,
      [id, ...vals],
    );

    if (!rows.length) throw new NotFoundError('Automation rule', id);
    return { ...rows[0], channel };
  });
}

// ============================================================================
// EXECUTIONS (recent activity — "why did this rule fire")
// ============================================================================

export async function listRuleExecutions(
  ctx: TenantContext,
  channel: string,
  ruleId: string,
  limit = 20,
): Promise<AutomationRuleExecution[]> {
  assertChannel(channel);
  const cappedLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20;

  return withDb(ctx, async (db) => {
    const table = channel === 'sms' ? 'sms_trigger_executions' : 'email_trigger_executions';
    const { rows } = await db.query(
      `SELECT id, event_type, event_id, status, reason, recipients, attempts, executed_at, created_at
       FROM ${table} WHERE rule_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [ruleId, cappedLimit],
    );
    return rows;
  });
}

// ============================================================================
// FREQUENCY CAPS (email channel only — migration 195)
// ============================================================================

export async function listFrequencyCaps(ctx: TenantContext, ruleId: string): Promise<FrequencyCap[]> {
  return withDb(ctx, async (db) => {
    const { rows } = await db.query(
      `SELECT id, rule_id, event_type, category, max_per_day, is_active
       FROM frequency_caps WHERE rule_id = $1 ORDER BY category`,
      [ruleId],
    );
    return rows;
  });
}

export async function upsertFrequencyCap(
  ctx: TenantContext,
  ruleId: string,
  data: { category: FrequencyCapCategory; max_per_day: number },
): Promise<FrequencyCap> {
  if (data.max_per_day <= 0 || data.max_per_day > 9999) {
    throw new ValidationError('max_per_day must be between 1 and 9999');
  }
  const scope = requireScope(ctx);
  if (!scope.groupId)
    throw new ValidationError('Frequency caps are group-scoped; switch to a group context to set one');

  return withDb(ctx, async (db) => {
    const { rows: ruleRows } = await db.query(
      `SELECT event_type FROM email_trigger_rules WHERE id = $1 AND group_id = $2`,
      [ruleId, scope.groupId],
    );
    if (!ruleRows.length) throw new NotFoundError('Automation rule', ruleId);

    const { rows } = await db.query(
      `INSERT INTO frequency_caps (rule_id, group_id, event_type, category, max_per_day, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (rule_id, category) DO UPDATE
         SET max_per_day = $5, is_active = true, updated_at = NOW()
       RETURNING id, rule_id, event_type, category, max_per_day, is_active`,
      [ruleId, scope.groupId, ruleRows[0].event_type, data.category, data.max_per_day, ctx.userId],
    );
    return rows[0];
  });
}
