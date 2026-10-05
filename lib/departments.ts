/**
 * Kitabu Yetu departments and their mailboxes: the single source of truth for
 * "which address handles what". Everything that needs a department address
 * (alert routing, customer-facing contact lines, reply-to, public pages) goes
 * through here rather than hard-coding an address.
 *
 * Client-safe: the defaults below are plain constants. `departmentEmail()`
 * additionally honours `KITABU_EMAIL_<DEPARTMENT>` on the server, so an
 * address can change without a code change.
 *
 * Mailboxes (cPanel, kitabuyetu.co.ke): info, admin, billing, support, hr,
 * enterprise. There is deliberately no careers@ or sales@ mailbox: recruiting
 * goes to hr@, enterprise sales enquiries to enterprise@.
 */

export type Department = 'general' | 'admin' | 'billing' | 'support' | 'hr' | 'enterprise';

export interface DepartmentInfo {
  id: Department;
  label: string;
  /** Default mailbox; override with KITABU_EMAIL_<ID>. */
  email: string;
  /** What lands here. */
  handles: string;
  /**
   * Platform staff role that works this mailbox today. There are no
   * dedicated billing/hr/enterprise platform roles yet — until there are,
   * those mailboxes are worked by super_admins (see docs/DEPARTMENT_EMAILS.md).
   */
  platformRole: 'super_admin' | 'support' | null;
}

export const DEPARTMENTS: Record<Department, DepartmentInfo> = {
  general: {
    id: 'general',
    label: 'General / official contact',
    email: 'info@kitabuyetu.co.ke',
    handles:
      'Public contact address, legal/privacy queries, the official platform-activity alert address (receives every alert).',
    platformRole: 'super_admin',
  },
  admin: {
    id: 'admin',
    label: 'Platform administration',
    email: 'admin@kitabuyetu.co.ke',
    handles:
      'Security events, role/permission changes, configuration, system downtime and failures, campaign and withdrawal approvals.',
    platformRole: 'super_admin',
  },
  billing: {
    id: 'billing',
    label: 'Billing & finance',
    email: 'billing@kitabuyetu.co.ke',
    handles: 'Subscriptions, invoices, payments, refunds, reversals, unrouted PayBill payments, withdrawal releases.',
    platformRole: 'super_admin',
  },
  support: {
    id: 'support',
    label: 'Customer support',
    email: 'support@kitabuyetu.co.ke',
    handles: 'Account lockouts, password issues, SMS delivery problems, unrouted payments, help requests.',
    platformRole: 'support',
  },
  hr: {
    id: 'hr',
    label: 'Human resources & recruiting',
    email: 'hr@kitabuyetu.co.ke',
    handles: 'Job applications from /careers, staff and employee matters.',
    platformRole: 'super_admin',
  },
  enterprise: {
    id: 'enterprise',
    label: 'Enterprise & partnerships',
    email: 'enterprise@kitabuyetu.co.ke',
    handles: 'Enterprise/organization enquiries, new organizations, partner and NGO onboarding.',
    platformRole: 'super_admin',
  },
};

/** Env-overridable mailbox for a department (server only; falls back to the default). */
export function departmentEmail(dept: Department): string {
  const override =
    typeof process !== 'undefined' ? process.env[`KITABU_EMAIL_${dept.toUpperCase()}`]?.trim() : undefined;
  return override && override.includes('@') ? override.toLowerCase() : DEPARTMENTS[dept].email;
}

/**
 * Which departments (beyond `general`, which sees everything) should also be
 * copied on an admin activity alert of this type. Exact types first, then
 * prefixes; an unlisted type goes to `general` only.
 */
const EXACT: Record<string, Department[]> = {
  MPESA_UNROUTED_PAYMENT: ['billing', 'support'],
  MPESA_B2C_FAILED: ['billing', 'admin'],
  HIGH_VALUE_TRANSACTION: ['billing'],
  TRANSACTION_REVERSED: ['billing'],
  REFUND_ISSUED: ['billing'],
  TRANSFER_CREATED: ['billing'],
  ACTIVITY_DIGEST: ['billing'],
  CAMPAIGN_SUBMITTED: ['admin'],
  CAMPAIGN_SUSPENDED: ['admin'],
  JOB_APPLICATION_SUBMITTED: ['hr'],
  ACCOUNT_LOCKED: ['support'],
  FAILED_LOGIN_REPEATED: ['support'],
  PASSWORD_RESET_REQUESTED: ['support'],
  ACCOUNT_DEACTIVATED: ['support'],
  ACCOUNT_DELETED: ['support', 'admin'],
  ACCOUNT_RESTORED: ['support'],
  SUSPICIOUS_LOGIN: ['admin', 'support'],
  SMS_LOW_CREDIT: ['support', 'billing'],
  SMS_CAMPAIGN_FAILED: ['support'],
  SMS_CAMPAIGN_PARTIAL: ['support'],
  SMS_PROVIDER_FAILURE: ['admin', 'support'],
  EMAIL_PROVIDER_FAILURE: ['admin'],
  NOTIFICATION_DELIVERY_FAILED: ['admin'],
  ERROR_SPIKE: ['admin'],
  UNUSUAL_TRANSACTION_ACTIVITY: ['admin', 'billing'],
  PAYMENT_INFRASTRUCTURE_FAILURE: ['admin', 'billing'],
  PAYMENT_CALLBACK_FAILURE: ['admin', 'billing'],
  PAYMENT_CONFIG_CHANGED: ['admin', 'billing'],
};

const PREFIX: [prefix: string, depts: Department[]][] = [
  ['WITHDRAWAL_', ['billing', 'admin']],
  ['SUBSCRIPTION_', ['billing']],
  ['TRIAL_', ['billing']],
  ['PAYMENT_', ['billing']],
  ['INVOICE_', ['billing']],
  ['BILLING_', ['billing']],
  ['ORGANIZATION_', ['enterprise']],
  ['SYSTEM_', ['admin']],
  ['DATABASE_', ['admin']],
  ['CACHE_', ['admin']],
  ['JOB_', ['admin']],
  ['SECURITY_', ['admin']],
  ['PRIVILEGE_', ['admin']],
  ['ADMIN_', ['admin']],
  ['API_KEY_', ['admin']],
  ['CONFIG_', ['admin']],
  ['WEBHOOK_', ['admin']],
  ['SUSPICIOUS_', ['admin']],
  ['ROLE_', ['admin']],
  ['PERMISSION_', ['admin']],
];

export function departmentsForEvent(eventType: string): Department[] {
  const exact = EXACT[eventType];
  if (exact) return exact;
  for (const [prefix, depts] of PREFIX) if (eventType.startsWith(prefix)) return depts;
  return [];
}
