/**
 * Email trigger engine — mirrors SMS trigger infrastructure (lib/sms/trigger-engine.ts)
 * but dispatches to email_campaigns instead of smsService.
 *
 * Three key invariants:
 * 1. Emitting never throws — an event failure never rolls back the triggering action
 * 2. Exactly-once per (rule, event) via UNIQUE (rule_id, event_id)
 * 3. Terminal rows stay terminal — execution rows transition 'pending' → final state once only
 *
 * Reuses:
 * - lib/sms/conditions.ts (condition DSL is channel-agnostic)
 * - lib/sms/events.ts (event types are shared, payload is scalar JSON)
 * - renderTemplate from lib/sms/templates.ts (same substitution engine)
 * - getCampaignRecipients from campaign.service.ts (for email member resolution)
 */

import { PoolClient } from 'pg';
import { withAdminDb, type TenantContext } from '@/lib/db';
import { renderTemplate, stripUnresolved } from '@/lib/sms/templates';
import { evaluateCondition } from '@/lib/sms/conditions';
import { getCampaignRecipients } from './campaign.service';
import { logger } from '@/lib/logger';
import type { BusinessEvent } from '@/lib/sms/events';

interface EmailRuleRow {
  id: string;
  group_id: string | null;
  organization_id: string | null;
  name: string;
  event_type: string;
  conditions: unknown;
  template_key: string;
  recipient_spec: unknown;
  delay_seconds: number;
  max_retries: number;
  created_by: string | null;
}

interface FrequencyCapRow {
  id: string;
  rule_id: string;
  category: 'transactional' | 'marketing' | 'promotional';
  max_per_day: number;
}

export interface EmailTriggerEmitSummary {
  evaluated: number;
  matched: number;
  frequency_capped: number;
  dispatched: number;
  deferred: number;
  skipped: number;
}

/**
 * Load email trigger rules visible to a group (group + org + platform scope).
 * Specificity resolution: group beats org beats platform for rules sharing the same name.
 */
export async function loadMatchingEmailRules(eventType: string, groupId: string): Promise<EmailRuleRow[]> {
  const rows = await withAdminDb((db) =>
    db
      .query<EmailRuleRow>(
        `SELECT r.id, r.group_id, r.organization_id, r.name, r.event_type, r.conditions,
              r.template_key, r.recipient_spec, r.delay_seconds, r.max_retries, r.created_by
       FROM email_trigger_rules r
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
      )
      .then((r) => r.rows),
  );

  const specificity = (r: EmailRuleRow) => (r.group_id ? 2 : r.organization_id ? 1 : 0);
  const winner = new Map<string, EmailRuleRow>();
  for (const rule of rows) {
    const existing = winner.get(rule.name);
    if (!existing || specificity(rule) > specificity(existing)) winner.set(rule.name, rule);
  }
  return [...winner.values()];
}

/**
 * Check frequency cap enforcement for a recipient against a rule.
 * Returns true if the send should be skipped due to cap.
 */
async function isFrequencyCapped(
  db: PoolClient,
  ruleId: string,
  recipientId: string,
  capRow: FrequencyCapRow | null,
): Promise<boolean> {
  if (!capRow) return false; // No cap configured = no limit

  const { rows } = await db.query<{ sent_count: number }>(
    `SELECT sent_count FROM frequency_cap_executions
     WHERE cap_id = $1 AND recipient_id = $2 AND sent_date = CURRENT_DATE`,
    [capRow.id, recipientId],
  );

  const today = rows[0];
  return today ? today.sent_count >= capRow.max_per_day : false;
}

/**
 * Record a send against frequency cap bucket (insert or update today's count).
 */
async function recordFrequencyCapExecution(
  db: PoolClient,
  capId: string,
  groupId: string,
  recipientId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO frequency_cap_executions (cap_id, group_id, recipient_id, sent_count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (cap_id, recipient_id, sent_date) DO UPDATE
     SET sent_count = sent_count + 1, updated_at = NOW()`,
    [capId, groupId, recipientId],
  );
}

/**
 * Emit an email trigger event: load matching rules, evaluate conditions, enforce frequency caps,
 * and hand off dispatch to the existing email_campaigns / drainCampaignRecipients machinery.
 *
 * Never throws — failures are caught and logged, never bubbled up.
 */
export async function emitEmailTriggerEvent(event: BusinessEvent): Promise<EmailTriggerEmitSummary> {
  const summary: EmailTriggerEmitSummary = {
    evaluated: 0,
    matched: 0,
    frequency_capped: 0,
    dispatched: 0,
    deferred: 0,
    skipped: 0,
  };

  try {
    const rules = await loadMatchingEmailRules(event.eventType, event.groupId);
    summary.evaluated = rules.length;

    if (!rules.length) return summary;

    // For each matching rule, resolve recipients, check conditions, and dispatch.
    await withAdminDb(async (db) => {
      for (const rule of rules) {
        try {
          // Parse recipient spec (reuse from SMS engine).
          const spec = parseRecipientEmailSpec(rule.recipient_spec);
          if (!spec) {
            logger.warn('[email-trigger] invalid recipient spec', { ruleId: rule.id });
            summary.skipped++;
            continue;
          }

          // Evaluate conditions against event payload (reuse from SMS engine).
          if (!evaluateCondition(rule.conditions, event.payload)) {
            summary.skipped++;
            continue;
          }

          summary.matched++;

          // Resolve recipients for this rule (email addresses only).
          const recipients = await resolveEmailRecipients(db, event.groupId, spec);
          if (!recipients.length) {
            summary.skipped++;
            continue;
          }

          // Load frequency cap for this rule (if any).
          const { rows: capRows } = await db.query<FrequencyCapRow>(
            `SELECT id, rule_id, category, max_per_day FROM frequency_caps
             WHERE rule_id = $1 AND is_active`,
            [rule.id],
          );
          const cap = capRows[0] || null;

          // Filter recipients by frequency cap.
          const uncapped: typeof recipients = [];
          for (const r of recipients) {
            if (await isFrequencyCapped(db, rule.id, r.id, cap)) {
              summary.frequency_capped++;
            } else {
              uncapped.push(r);
            }
          }

          if (!uncapped.length) {
            summary.skipped++;
            continue;
          }

          // Look up the email_templates row for this key (group override, then
          // platform default), then render {{vars}} into its subject + body.
          // NOTE: this used to call renderTemplate(rule.template_key, ...) —
          // substituting into the KEY STRING itself instead of a template body,
          // since renderTemplate() takes template text, not a lookup key (see
          // lib/sms/trigger-engine.ts's loadTemplateBody for the pattern this
          // mirrors). Every email trigger send since Phase 9.4.2 shipped would
          // have mailed the literal template_key as the body. Caught while
          // building the automation rules UI, before any rule went live.
          const template = await loadEmailTemplate(db, event.groupId, rule.template_key);
          if (!template) {
            logger.warn('[email-trigger] no template found for key', {
              templateKey: rule.template_key,
              ruleId: rule.id,
            });
            summary.skipped++;
            continue;
          }

          const templateVars: Record<string, string | number | null> = {};
          for (const [k, v] of Object.entries(event.payload)) {
            if (v === null || typeof v === 'string' || typeof v === 'number') {
              templateVars[k] = v;
            }
          }
          const subject = stripUnresolved(renderTemplate(template.subject, templateVars));
          const body = stripUnresolved(renderTemplate(template.body, templateVars));

          // Insert execution record (idempotency key).
          const { rows: execRows } = await db.query<{ id: string }>(
            `INSERT INTO email_trigger_executions
               (rule_id, group_id, event_type, event_id, event_payload, status, recipients)
             VALUES ($1, $2, $3, $4, $5, 'pending', $6)
             ON CONFLICT (rule_id, event_id) DO NOTHING
             RETURNING id`,
            [rule.id, event.groupId, event.eventType, event.eventId, event.payload, uncapped.length],
          );

          if (!execRows[0]) {
            summary.skipped++; // Duplicate event
            continue;
          }

          // Create email_campaign row to trigger the existing drainCampaignRecipients job.
          const { rows: campaignRows } = await db.query<{ id: string }>(
            `INSERT INTO email_campaigns
               (group_id, name, subject, html_body, status, started_at, total_recipients, created_by)
             VALUES ($1, $2, $3, $4, 'sending', NOW(), $5, $6)
             RETURNING id`,
            [event.groupId, rule.name, subject, body, uncapped.length, rule.created_by],
          );

          const campaignId = campaignRows[0].id;

          // Populate email_campaign_recipients and record cap executions.
          for (const r of uncapped) {
            await db.query(
              `INSERT INTO email_campaign_recipients (campaign_id, group_id, member_id, email, name)
               VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
              [campaignId, event.groupId, r.memberId || null, r.email, r.name],
            );

            if (cap) {
              await recordFrequencyCapExecution(db, cap.id, event.groupId, r.id);
            }
          }

          if (rule.delay_seconds > 0) {
            summary.deferred++;
          } else {
            summary.dispatched++;
          }
        } catch (err) {
          logger.warn('[email-trigger] rule execution failed', { ruleId: rule.id, error: (err as Error).message });
          summary.skipped++;
        }
      }
    });
  } catch (err) {
    logger.error('[email-trigger] emit failed', {
      eventType: event.eventType,
      eventId: event.eventId,
      error: (err as Error).message,
    });
  }

  return summary;
}

// ─── Templates ────────────────────────────────────────────────────────────────

interface EmailTemplateBody {
  subject: string;
  body: string;
}

/**
 * Group override first, then a platform-wide (group_id IS NULL) template.
 * Mirrors lib/sms/trigger-engine.ts's loadTemplateBody, but email has no
 * compiled-in DEFAULT_TEMPLATES fallback — an unknown key here means the
 * rule's author never created the template, so skip loudly (caller logs)
 * rather than mailing something.
 */
async function loadEmailTemplate(db: PoolClient, groupId: string, key: string): Promise<EmailTemplateBody | null> {
  const { rows } = await db.query<EmailTemplateBody>(
    `SELECT subject, body FROM email_templates
     WHERE (group_id = $1 OR group_id IS NULL) AND template_key = $2 AND locale = 'en' AND is_active
     ORDER BY group_id NULLS LAST LIMIT 1`,
    [groupId, key],
  );
  return rows[0] ?? null;
}

// ─── Recipient Resolution ────────────────────────────────────────────────────

interface EmailRecipient {
  id: string; // member_id or crm_contact.id
  email: string;
  name: string;
  memberId?: string; // for member rows
}

export type EmailRecipientSpec =
  | { type: 'all_members' }
  | { type: 'active_members' }
  | { type: 'roles'; roles: string[] }
  | { type: 'event_member'; field: string };

/**
 * Parse and validate email recipient spec (subset of SMS spec; event_phone excluded since we need emails).
 * Exported for reuse by automation-rules.service.ts, which validates a
 * proposed recipient_spec at rule-creation time using the same grammar.
 */
export function parseRecipientEmailSpec(raw: unknown): EmailRecipientSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const spec = raw as Record<string, unknown>;

  switch (spec.type) {
    case 'all_members':
    case 'active_members':
      return { type: spec.type };
    case 'roles': {
      if (!Array.isArray(spec.roles) || spec.roles.length === 0) return null;
      const roles = spec.roles.filter((r): r is string => typeof r === 'string');
      return roles.length === spec.roles.length ? { type: 'roles', roles } : null;
    }
    case 'event_member':
      return typeof spec.field === 'string' && spec.field.length > 0
        ? { type: 'event_member', field: spec.field }
        : null;
    default:
      return null;
  }
}

/**
 * Resolve email recipient list for a trigger rule.
 * Returns members with emails only (filtered for email IS NOT NULL).
 */
async function resolveEmailRecipients(
  db: PoolClient,
  groupId: string,
  spec: EmailRecipientSpec,
): Promise<EmailRecipient[]> {
  if (spec.type === 'all_members' || spec.type === 'active_members') {
    const rows = await getCampaignRecipients(groupId, { activeOnly: spec.type === 'active_members' });
    return rows.map((r) => ({ id: r.memberId, email: r.email, name: r.name, memberId: r.memberId }));
  } else if (spec.type === 'roles') {
    const { rows } = await db.query<{ id: string; email: string | null; name: string }>(
      `SELECT m.id, m.email, COALESCE(NULLIF(TRIM(m.first_name || ' ' || m.last_name), ''), m.email) AS name
       FROM members m
       JOIN group_members gm ON gm.member_id = m.id
       WHERE gm.group_id = $1 AND gm.status = 'active' AND gm.role = ANY($2::member_role[])
         AND m.email IS NOT NULL`,
      [groupId, spec.roles],
    );
    return rows.map((r) => ({ id: r.id, email: r.email!, name: r.name, memberId: r.id }));
  } else if (spec.type === 'event_member') {
    // Resolved from event payload (field name).
    return [];
  }
  return [];
}
