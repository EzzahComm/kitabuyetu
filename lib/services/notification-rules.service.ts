import { withAdminDb } from '@/lib/db';
import { sendTemplatedEmail } from './email.service';

export interface NotificationRule {
  id: string;
  groupId: string | null;
  name: string;
  eventType: string;
  conditions: Record<string, unknown> | null;
  actions: NotificationAction[];
  isActive: boolean;
}

export interface NotificationAction {
  type: 'email';
  templateKey: string;
  recipients: 'member' | 'chairperson' | 'treasurer' | 'all_officers' | 'admin_email';
  vars?: Record<string, string>;
}

export async function getRules(groupId: string): Promise<NotificationRule[]> {
  const { rows } = await withAdminDb((db) =>
    db.query(
      `SELECT id, group_id, name, event_type, conditions, actions, is_active
       FROM notification_rules
       WHERE (group_id=$1 OR group_id IS NULL) AND is_active=true
       ORDER BY group_id NULLS LAST`,
      [groupId],
    ),
  );
  return rows.map((r) => ({
    id: r.id,
    groupId: r.group_id,
    name: r.name,
    eventType: r.event_type,
    conditions: r.conditions,
    actions: r.actions ?? [],
    isActive: r.is_active,
  }));
}

export async function createRule(input: {
  groupId: string;
  createdBy: string;
  name: string;
  eventType: string;
  conditions?: Record<string, unknown>;
  actions: NotificationAction[];
}): Promise<string> {
  const { rows } = await withAdminDb((db) =>
    db.query(
      `INSERT INTO notification_rules (group_id, created_by, name, event_type, conditions, actions)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        input.groupId,
        input.createdBy,
        input.name,
        input.eventType,
        input.conditions ? JSON.stringify(input.conditions) : null,
        JSON.stringify(input.actions),
      ],
    ),
  );
  return rows[0].id as string;
}

export async function toggleRule(ruleId: string, isActive: boolean): Promise<void> {
  await withAdminDb((db) =>
    db.query(`UPDATE notification_rules SET is_active=$1 WHERE id=$2`, [isActive, ruleId]),
  );
}

// Fire all matching rules for an event
export async function fireEvent(opts: {
  groupId: string;
  eventType: string;
  contextData: Record<string, string | number | boolean | null | undefined>;
  memberEmail?: string;
  memberId?: string;
}): Promise<void> {
  const rules = await getRules(opts.groupId);
  const matching = rules.filter((r) => r.eventType === opts.eventType);

  for (const rule of matching) {
    if (!conditionsMatch(rule.conditions, opts.contextData)) continue;

    for (const action of rule.actions) {
      if (action.type !== 'email') continue;

      const recipients = await resolveRecipients(action.recipients, opts.groupId, opts.memberEmail);
      const vars = { ...opts.contextData, ...(action.vars ?? {}) };

      for (const email of recipients) {
        await sendTemplatedEmail({
          templateKey: action.templateKey,
          to: email,
          vars: vars as Record<string, string>,
          groupId: opts.groupId,
          userId: opts.memberId,
          referenceType: 'rule',
        }).catch(() => {});
      }
    }
  }
}

function conditionsMatch(
  conditions: Record<string, unknown> | null,
  data: Record<string, unknown>,
): boolean {
  if (!conditions) return true;
  for (const [key, spec] of Object.entries(conditions)) {
    const val = data[key];
    if (typeof spec === 'object' && spec !== null) {
      const s = spec as Record<string, unknown>;
      if ('gte' in s && Number(val) < Number(s.gte)) return false;
      if ('lte' in s && Number(val) > Number(s.lte)) return false;
      if ('eq'  in s && val !== s.eq)                return false;
    } else if (val !== spec) {
      return false;
    }
  }
  return true;
}

async function resolveRecipients(
  recipients: NotificationAction['recipients'],
  groupId: string,
  memberEmail?: string,
): Promise<string[]> {
  if (recipients === 'member' && memberEmail) return [memberEmail];
  if (recipients === 'admin_email') {
    const adminEmail = process.env.EMAIL_ADMIN ?? 'admin@kitabuyetu.com';
    return [adminEmail];
  }

  const roleFilter =
    recipients === 'chairperson' ? `role = 'chairperson'`
    : recipients === 'treasurer'  ? `role IN ('treasurer','chairperson')`
    : `role IN ('chairperson','treasurer','secretary')`;

  const { rows } = await withAdminDb((db) =>
    db.query(
      `SELECT m.email FROM members m
       JOIN group_members gm ON gm.member_id = m.id AND gm.group_id = $1
       WHERE m.email IS NOT NULL AND ${roleFilter}`,
      [groupId],
    ),
  );
  return rows.map((r: { email: string }) => r.email);
}
