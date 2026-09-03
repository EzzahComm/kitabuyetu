import { env } from '@/lib/env';
/**
 * SMS template engine.
 *
 * Templates use {{variable_name}} placeholders.
 * renderTemplate() substitutes them; unknown vars are left as-is.
 */

export type TemplateVars = Record<string, string | number | null | undefined>;

/**
 * Alternative spellings that resolve to an EXISTING canonical variable.
 *
 * The template-personalization spec asked for `short_member_id`,
 * `payment_account` and `paybill_number`. Every one of those values already
 * existed under another name (see
 * docs/audits/SMS-TEMPLATE-VARIABLES-AUDIT-2026-09-03.md), and that spec's own
 * §12 says not to create parallel identifiers for data that already exists —
 * so these are ALIASES, not new fields. Nothing new is stored, computed or
 * passed; only the name a template author may write.
 *
 * `membership_no` is the canonical short member id: `PP DDDDD C`, e.g.
 * BG102534, carrying a Damm check digit so a mistyped account fails validation
 * rather than paying a stranger in another group (lib/utils/membership-no.ts).
 * It is also, deliberately, the M-Pesa payment account — which is why
 * `payment_account` and `account_number` both point at it rather than at a
 * duplicated field kept in step with it.
 *
 * Resolution is one level deep and never chains: an alias names a canonical,
 * and a canonical is never itself an alias.
 */
export const VARIABLE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  short_member_id: 'membership_no',
  payment_account: 'membership_no',
  account_number:  'membership_no',
  paybill_number:  'paybill',
  amount_due:      'amount',
});

/**
 * Substitute `{{variable}}` placeholders.
 *
 * A name present in `vars` always wins, so an explicit `account_number` passed
 * by an existing caller behaves exactly as before and no historical template
 * changes meaning. The alias table is consulted ONLY when the written name is
 * absent, which is what makes this purely additive.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    let val = vars[key];
    if (val === undefined || val === null) {
      const canonical = VARIABLE_ALIASES[key];
      if (canonical) val = vars[canonical];
    }
    return val !== undefined && val !== null ? String(val) : match;
  });
}

/**
 * The platform PayBill every "here's how to pay" message quotes.
 *
 * Was copy-pasted identically into three files — contributions.service.ts,
 * jobs/handlers.ts and mpesa-stk.service.ts — so a change had to be made three
 * times or they silently diverged.
 *
 * Deliberately NOT per-group: one platform shortcode pools every group's money
 * today. Per-group shortcodes are separate, unbuilt work with real custody
 * consequences, and this function is the one place that would change if they
 * ever ship.
 *
 * Reads the validated env rather than raw process.env, so an unset
 * MPESA_SHORTCODE fails at cold start instead of quietly rendering an empty
 * PayBill into a payment instruction.
 */
export function platformPaybill(): string {
  return env.MPESA_WORKING_SHORTCODE ?? env.MPESA_SHORTCODE;
}

/** Strip all unresolved {{variable}} placeholders from a rendered message. */
export function stripUnresolved(text: string): string {
  return text.replace(/\{\{\w+\}\}/g, '').replace(/\s{2,}/g, ' ').trim();
}

/** Extract variable names from a template body. */
export function extractVars(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(2, -2)))];
}

// ─── Built-in template keys ───────────────────────────────────────────────────

export const TEMPLATE_KEYS = {
  CONTRIBUTION_RECEIVED:   'contribution_received',
  CONTRIBUTION_REMINDER:   'contribution_reminder',
  LOAN_APPROVED:           'loan_approved',
  LOAN_DISBURSED:          'loan_disbursed',
  LOAN_REPAYMENT_DUE:      'loan_repayment_due',
  LOAN_OVERDUE:            'loan_overdue',
  MEETING_REMINDER:        'meeting_reminder',
  BIRTHDAY:                'birthday',
  PAYMENT_CONFIRMED:       'payment_confirmed',
  WELCOME:                 'welcome',
  OTP:                     'otp',
  GROUP_ANNOUNCEMENT:      'group_announcement',
  GROUP_VERIFICATION_OTP:  'group_verification_otp',
} as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[keyof typeof TEMPLATE_KEYS];

// ─── Inline fallbacks (used when DB template is unavailable) ──────────────────

export const DEFAULT_TEMPLATES: Record<TemplateKey, string> = {
  contribution_received:
    'Dear {{first_name}}, your contribution of KES {{amount}} has been received. Receipt: {{receipt}}. Thank you.',
  loan_approved:
    'Dear {{first_name}}, your loan of KES {{loan_amount}} has been approved. Disbursement is in progress.',
  loan_disbursed:
    'Dear {{first_name}}, KES {{amount}} has been disbursed to your M-Pesa. Receipt: {{receipt}}.',
  loan_repayment_due:
    'Dear {{first_name}}, your loan repayment of KES {{amount}} is due on {{due_date}}. Outstanding: KES {{balance}}. Pay via M-Pesa Paybill {{paybill}}, Account {{account_number}}.',
  loan_overdue:
    'Dear {{first_name}}, your loan repayment of KES {{amount}} is OVERDUE. Penalty: KES {{penalty_amount}}. Pay immediately via M-Pesa Paybill {{paybill}}, Account {{account_number}}.',
  meeting_reminder:
    'Dear {{first_name}}, {{group_name}} meeting is on {{meeting_date}} at {{meeting_location}}. Kindly attend.',
  birthday:
    'Happy Birthday {{first_name}}! Your {{group_name}} family wishes you a wonderful year ahead. Stay blessed!',
  payment_confirmed:
    'Dear {{first_name}}, payment of KES {{amount}} confirmed. Receipt: {{receipt}}.',
  // Kept to one 160-character SMS segment even with a long group name —
  // "Ndengelwa Community Water Project" is 33 characters and real, so the
  // fixed text has to leave room for it. A second segment would double the
  // credit cost of every member a group ever adds. The worked example lands
  // at 114 characters:
  //   "Dear Benedict, you have joined Ndengelwa Community Water Project on
  //    Kitabu Yetu. Your member number is NC000078. Karibu."
  // {{membership_no}} is the SHORT per-group number, never the long
  // member_code — see the payload comment in members.service.ts.
  // Was an inline string literal in contributions.service.ts, invisible to the
  // template system and impossible for a group to customise. `account_number`
  // resolves to membership_no via VARIABLE_ALIASES, so no caller has to pass
  // it separately.
  contribution_reminder:
    'Dear {{first_name}}, this is a friendly reminder to make your {{group_name}} contribution for {{month}}. '
    + 'Pay via M-Pesa Paybill {{paybill}}, Account {{account_number}}. Thank you.',
  welcome:
    'Dear {{first_name}}, you have joined {{group_name}} on Kitabu Yetu. Your member number is {{membership_no}}. Karibu.',
  otp:
    'Your Kitabu Yetu verification code is {{otp}}. Valid for 10 minutes. Do not share this code.',
  group_announcement:
    '{{group_name}}: {{message}}',
  group_verification_otp:
    'Verify your Kitabu Yetu group registration with code {{otp}}. Valid for 10 minutes. Do not share.',
};

/** Render a named built-in template with the given variables. */
export function renderBuiltin(key: TemplateKey, vars: TemplateVars): string {
  return renderTemplate(DEFAULT_TEMPLATES[key], vars);
}
