/**
 * SMS template engine.
 *
 * Templates use {{variable_name}} placeholders.
 * renderTemplate() substitutes them; unknown vars are left as-is.
 */

export type TemplateVars = Record<string, string | number | null | undefined>;

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const val = vars[key];
    return val !== undefined && val !== null ? String(val) : match;
  });
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
    'Dear {{first_name}}, payment of KES {{amount}} confirmed. Receipt: {{receipt}}. KitabuYetu.',
  // Kept to one 160-character SMS segment even with a long group name —
  // "Ndengelwa Community Water Project" is 33 characters and real, so the
  // fixed text has to leave room for it. A second segment would double the
  // credit cost of every member a group ever adds. The worked example lands
  // at 114 characters:
  //   "Karibu Benedict! You have joined Ndengelwa Community Water Project
  //    on Kitabu Yetu. Your member number is NC000078."
  // {{membership_no}} is the SHORT per-group number, never the long
  // member_code — see the payload comment in members.service.ts.
  welcome:
    'Karibu {{first_name}}! You have joined {{group_name}} on Kitabu Yetu. Your member number is {{membership_no}}.',
  otp:
    'Your KitabuYetu verification code is {{otp}}. Valid for 10 minutes. Do not share this code.',
  group_announcement:
    '{{group_name}}: {{message}}',
  group_verification_otp:
    'KitabuYetu: Verify your group registration with code {{otp}}. Valid for 10 minutes. Do not share.',
};

/** Render a named built-in template with the given variables. */
export function renderBuiltin(key: TemplateKey, vars: TemplateVars): string {
  return renderTemplate(DEFAULT_TEMPLATES[key], vars);
}
