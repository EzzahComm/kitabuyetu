/**
 * Business event catalog for the SMS trigger engine.
 *
 * A business event is emitted by the code that owns the state change (payment
 * completion, loan approval, …). It carries no notion of SMS — deciding whether
 * a message goes out, to whom, and from which template is the trigger engine's
 * job, driven by sms_trigger_rules rows.
 *
 * `eventId` is the originating business row id. It is the idempotency key: the
 * same (rule, eventId) pair can never send twice, so re-emitting an event (an
 * M-Pesa callback replay, a job retry) is safe by construction.
 */

export const SMS_EVENTS = {
  // Payments & reconciliation
  PAYMENT_RECEIVED:        'payment.received',
  MPESA_RECONCILED:        'mpesa.reconciled',
  MPESA_RECONCILE_FAILED:  'mpesa.reconciliation_failed',

  // Contributions
  CONTRIBUTION_RECORDED:   'contribution.recorded',
  CONTRIBUTION_DUE:        'contribution.due',
  CONTRIBUTION_OVERDUE:    'contribution.overdue',

  // Loans
  LOAN_APPROVED:           'loan.approved',
  LOAN_DECLINED:           'loan.declined',
  LOAN_DISBURSED:          'loan.disbursed',
  LOAN_REPAYMENT_DUE:      'loan.repayment_due',
  LOAN_OVERDUE:            'loan.overdue',

  // Membership & governance
  MEMBER_REGISTERED:       'member.registered',
  MEETING_SCHEDULED:       'meeting.scheduled',
  APPROVAL_REQUESTED:      'approval.requested',
} as const;

export type SmsEventType = (typeof SMS_EVENTS)[keyof typeof SMS_EVENTS];

const EVENT_VALUES: readonly string[] = Object.values(SMS_EVENTS);

export function isSmsEventType(value: string): value is SmsEventType {
  return EVENT_VALUES.includes(value);
}

/**
 * Payload values are flat scalars so they can be (a) matched by the condition
 * DSL, (b) substituted into {{template}} placeholders, and (c) stored as JSONB
 * on the execution row for audit without a schema migration per event type.
 */
export type EventPayload = Record<string, string | number | boolean | null | undefined>;

export interface BusinessEvent {
  eventType: SmsEventType;
  /** Originating business row id — the idempotency key. Must be a UUID. */
  eventId:   string;
  groupId:   string;
  payload:   EventPayload;
  /** Member who caused the event, if any. Null for system/callback-driven events. */
  actorId?:  string | null;
}

/**
 * Group roles a rule may target. Must stay in step with the `member_role` enum
 * (renamed in migration 050) — resolveSmsRecipients casts to it, so an unknown
 * value would surface as a raw Postgres enum error mid-dispatch rather than a
 * config error. 'chairperson' is the group's top officer role.
 */
export const TARGETABLE_ROLES = ['chairperson', 'treasurer', 'secretary', 'member'] as const;
export type TargetableRole = (typeof TARGETABLE_ROLES)[number];

/**
 * Where a rule sends its message. Resolved at dispatch time against *current*
 * membership, never against a snapshot taken when the rule was written.
 */
export type RecipientSpec =
  /** A phone number carried on the event itself (e.g. the M-Pesa payer). */
  | { type: 'event_phone';    field: string }
  /** A member id on the event; we look up their phone. */
  | { type: 'event_member';   field: string }
  /** Every officer in the group holding one of these group roles. */
  | { type: 'roles';          roles: string[] }
  | { type: 'all_members' }
  | { type: 'active_members' };

/** Narrow untrusted JSONB from the rules table into a RecipientSpec. */
export function parseRecipientSpec(raw: unknown): RecipientSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const spec = raw as Record<string, unknown>;

  switch (spec.type) {
    case 'event_phone':
    case 'event_member':
      return typeof spec.field === 'string' && spec.field.length > 0
        ? ({ type: spec.type, field: spec.field } as RecipientSpec)
        : null;
    case 'roles': {
      if (!Array.isArray(spec.roles) || spec.roles.length === 0) return null;
      const roles = spec.roles.filter(
        (r): r is TargetableRole => typeof r === 'string' && (TARGETABLE_ROLES as readonly string[]).includes(r),
      );
      // All-or-nothing: silently dropping an unknown role would quietly narrow
      // the audience of an approval notification.
      return roles.length === spec.roles.length ? { type: 'roles', roles } : null;
    }
    case 'all_members':
    case 'active_members':
      return { type: spec.type };
    default:
      return null;
  }
}
