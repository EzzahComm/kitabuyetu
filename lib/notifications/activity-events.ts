/**
 * Central event registry. Every platform activity that can reach the
 * administrators is declared here once, with its default severity and routing.
 * New products add entries here and call emitActivity(); nothing else changes.
 *
 * Routing defaults (overridable per event in admin_notification_preferences):
 *   sms       — send a concise SMS to the admin phone
 *   email     — send a detailed email to the admin address
 *   aggregate — do not alert one-by-one; roll into the periodic digest
 */
import type { NotificationSeverity } from './notification-types';

export enum ActivityEventType {
  // Authentication & accounts
  USER_REGISTERED = 'USER_REGISTERED',
  ACCOUNT_ACTIVATED = 'ACCOUNT_ACTIVATED',
  ACCOUNT_DEACTIVATED = 'ACCOUNT_DEACTIVATED',
  PASSWORD_RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  EMAIL_VERIFIED = 'EMAIL_VERIFIED',
  PHONE_VERIFIED = 'PHONE_VERIFIED',
  ROLE_CHANGED = 'ROLE_CHANGED',
  PERMISSION_CHANGED = 'PERMISSION_CHANGED',
  SUSPICIOUS_LOGIN = 'SUSPICIOUS_LOGIN',
  FAILED_LOGIN_REPEATED = 'FAILED_LOGIN_REPEATED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_DELETED = 'ACCOUNT_DELETED',
  ACCOUNT_RESTORED = 'ACCOUNT_RESTORED',

  // Subscriptions & billing
  SUBSCRIPTION_CREATED = 'SUBSCRIPTION_CREATED',
  SUBSCRIPTION_UPDATED = 'SUBSCRIPTION_UPDATED',
  SUBSCRIPTION_UPGRADED = 'SUBSCRIPTION_UPGRADED',
  SUBSCRIPTION_DOWNGRADED = 'SUBSCRIPTION_DOWNGRADED',
  SUBSCRIPTION_RENEWED = 'SUBSCRIPTION_RENEWED',
  SUBSCRIPTION_CANCELLED = 'SUBSCRIPTION_CANCELLED',
  SUBSCRIPTION_EXPIRED = 'SUBSCRIPTION_EXPIRED',
  SUBSCRIPTION_SUSPENDED = 'SUBSCRIPTION_SUSPENDED',
  SUBSCRIPTION_REACTIVATED = 'SUBSCRIPTION_REACTIVATED',
  TRIAL_STARTED = 'TRIAL_STARTED',
  TRIAL_ENDED = 'TRIAL_ENDED',
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  INVOICE_GENERATED = 'INVOICE_GENERATED',
  INVOICE_PAID = 'INVOICE_PAID',
  BILLING_REFUND = 'BILLING_REFUND',
  BILLING_CREDIT = 'BILLING_CREDIT',

  // SMS / messaging (group activity is reported to admins to detect misuse)
  SMS_CAMPAIGN_CREATED = 'SMS_CAMPAIGN_CREATED',
  SMS_CAMPAIGN_APPROVED = 'SMS_CAMPAIGN_APPROVED',
  SMS_CAMPAIGN_SENT = 'SMS_CAMPAIGN_SENT',
  SMS_CAMPAIGN_PARTIAL = 'SMS_CAMPAIGN_PARTIAL',
  SMS_CAMPAIGN_FAILED = 'SMS_CAMPAIGN_FAILED',
  SMS_MESSAGE_SENT = 'SMS_MESSAGE_SENT',
  SMS_SCHEDULED = 'SMS_SCHEDULED',
  SMS_SCHEDULE_EXECUTED = 'SMS_SCHEDULE_EXECUTED',
  SMS_SCHEDULE_CANCELLED = 'SMS_SCHEDULE_CANCELLED',
  SMS_LOW_CREDIT = 'SMS_LOW_CREDIT',
  SMS_PROVIDER_FAILURE = 'SMS_PROVIDER_FAILURE',
  EMAIL_CAMPAIGN_SENT = 'EMAIL_CAMPAIGN_SENT',

  // Chama Reminder (Kumbusha)
  REMINDER_CAMPAIGN_CREATED = 'REMINDER_CAMPAIGN_CREATED',
  REMINDER_CAMPAIGN_SCHEDULED = 'REMINDER_CAMPAIGN_SCHEDULED',
  REMINDER_CAMPAIGN_SENT = 'REMINDER_CAMPAIGN_SENT',
  REMINDER_CAMPAIGN_COMPLETED = 'REMINDER_CAMPAIGN_COMPLETED',
  REMINDER_CAMPAIGN_FAILED = 'REMINDER_CAMPAIGN_FAILED',

  // Financial transactions
  TRANSACTION_CREATED = 'TRANSACTION_CREATED',
  TRANSACTION_COMPLETED = 'TRANSACTION_COMPLETED',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  TRANSACTION_REVERSED = 'TRANSACTION_REVERSED',
  HIGH_VALUE_TRANSACTION = 'HIGH_VALUE_TRANSACTION',
  MPESA_C2B_RECEIVED = 'MPESA_C2B_RECEIVED',
  MPESA_STK_COMPLETED = 'MPESA_STK_COMPLETED',
  MPESA_STK_FAILED = 'MPESA_STK_FAILED',
  MPESA_B2C_SENT = 'MPESA_B2C_SENT',
  MPESA_B2C_FAILED = 'MPESA_B2C_FAILED',
  MPESA_UNROUTED_PAYMENT = 'MPESA_UNROUTED_PAYMENT',
  CONTRIBUTION_RECEIVED = 'CONTRIBUTION_RECEIVED',
  LOAN_REPAYMENT_RECEIVED = 'LOAN_REPAYMENT_RECEIVED',
  FINE_ISSUED = 'FINE_ISSUED',
  FINE_PAID = 'FINE_PAID',
  WELFARE_CONTRIBUTION = 'WELFARE_CONTRIBUTION',
  WELFARE_PAYOUT = 'WELFARE_PAYOUT',
  SHARE_PURCHASED = 'SHARE_PURCHASED',
  SHARE_WITHDRAWN = 'SHARE_WITHDRAWN',
  DIVIDEND_CALCULATED = 'DIVIDEND_CALCULATED',
  DIVIDEND_DISTRIBUTED = 'DIVIDEND_DISTRIBUTED',
  TRANSFER_CREATED = 'TRANSFER_CREATED',
  REFUND_ISSUED = 'REFUND_ISSUED',

  // Withdrawals & approvals
  WITHDRAWAL_REQUESTED = 'WITHDRAWAL_REQUESTED',
  WITHDRAWAL_PENDING_REVIEW = 'WITHDRAWAL_PENDING_REVIEW',
  WITHDRAWAL_APPROVED = 'WITHDRAWAL_APPROVED',
  WITHDRAWAL_REJECTED = 'WITHDRAWAL_REJECTED',
  WITHDRAWAL_CANCELLED = 'WITHDRAWAL_CANCELLED',
  WITHDRAWAL_PROCESSING = 'WITHDRAWAL_PROCESSING',
  WITHDRAWAL_COMPLETED = 'WITHDRAWAL_COMPLETED',
  WITHDRAWAL_FAILED = 'WITHDRAWAL_FAILED',
  WITHDRAWAL_REVERSED = 'WITHDRAWAL_REVERSED',
  APPROVAL_REQUESTED = 'APPROVAL_REQUESTED',
  APPROVAL_REVIEWED = 'APPROVAL_REVIEWED',
  APPROVAL_GRANTED = 'APPROVAL_GRANTED',
  APPROVAL_DENIED = 'APPROVAL_DENIED',

  // Organizations, groups, members
  ORGANIZATION_CREATED = 'ORGANIZATION_CREATED',
  ORGANIZATION_APPROVED = 'ORGANIZATION_APPROVED',
  ORGANIZATION_SUSPENDED = 'ORGANIZATION_SUSPENDED',
  ORGANIZATION_ADMIN_CHANGED = 'ORGANIZATION_ADMIN_CHANGED',
  ORG_GROUP_LINK_REQUESTED = 'ORG_GROUP_LINK_REQUESTED',
  ORG_GROUP_LINK_APPROVED = 'ORG_GROUP_LINK_APPROVED',
  ORG_GROUP_LINK_REJECTED = 'ORG_GROUP_LINK_REJECTED',
  // Programs (migration 206) — no platform-admin approval step by design, so
  // these are routine visibility, not actionable alerts (see DEFS below).
  PROGRAM_APPLICATION_SUBMITTED = 'PROGRAM_APPLICATION_SUBMITTED',
  PROGRAM_APPLICATION_ACCEPTED = 'PROGRAM_APPLICATION_ACCEPTED',
  PROGRAM_APPLICATION_DECLINED = 'PROGRAM_APPLICATION_DECLINED',
  PROGRAM_INVITATION_SENT = 'PROGRAM_INVITATION_SENT',
  PROGRAM_INVITATION_ACCEPTED = 'PROGRAM_INVITATION_ACCEPTED',
  PROGRAM_INVITATION_DECLINED = 'PROGRAM_INVITATION_DECLINED',
  GROUP_CREATED = 'GROUP_CREATED',
  GROUP_APPROVED = 'GROUP_APPROVED',
  GROUP_SUSPENDED = 'GROUP_SUSPENDED',
  GROUP_DELETED = 'GROUP_DELETED',
  GROUP_ADMIN_ASSIGNED = 'GROUP_ADMIN_ASSIGNED',
  GROUP_OWNERSHIP_CHANGED = 'GROUP_OWNERSHIP_CHANGED',
  CONSTITUTION_CREATED = 'CONSTITUTION_CREATED',
  CONSTITUTION_CHANGED = 'CONSTITUTION_CHANGED',
  FIELD_OFFICER_ASSIGNED = 'FIELD_OFFICER_ASSIGNED',
  MEMBER_ADDED = 'MEMBER_ADDED',
  MEMBER_REMOVED = 'MEMBER_REMOVED',
  MEMBER_SUSPENDED = 'MEMBER_SUSPENDED',
  MEMBER_REINSTATED = 'MEMBER_REINSTATED',

  // Loans & savings cycle
  LOAN_CREATED = 'LOAN_CREATED',
  LOAN_APPROVED = 'LOAN_APPROVED',
  LOAN_REJECTED = 'LOAN_REJECTED',
  LOAN_DISBURSED = 'LOAN_DISBURSED',
  LOAN_EARLY_REPAYMENT = 'LOAN_EARLY_REPAYMENT',
  LOAN_STATUS_CHANGED = 'LOAN_STATUS_CHANGED',
  LOAN_DEFAULTED = 'LOAN_DEFAULTED',
  CYCLE_OPENED = 'CYCLE_OPENED',
  CYCLE_CLOSED = 'CYCLE_CLOSED',

  // Changi$ha (fundraising)
  CAMPAIGN_CREATED = 'CAMPAIGN_CREATED',
  CAMPAIGN_SUBMITTED = 'CAMPAIGN_SUBMITTED',
  CAMPAIGN_APPROVED = 'CAMPAIGN_APPROVED',
  CAMPAIGN_REJECTED = 'CAMPAIGN_REJECTED',
  CAMPAIGN_DONATION_RECEIVED = 'CAMPAIGN_DONATION_RECEIVED',
  CAMPAIGN_TARGET_REACHED = 'CAMPAIGN_TARGET_REACHED',
  CAMPAIGN_CLOSED = 'CAMPAIGN_CLOSED',
  CAMPAIGN_SUSPENDED = 'CAMPAIGN_SUSPENDED',

  // Security & configuration
  SECURITY_ALERT = 'SECURITY_ALERT',
  PRIVILEGE_ESCALATION = 'PRIVILEGE_ESCALATION',
  ADMIN_ACCOUNT_CREATED = 'ADMIN_ACCOUNT_CREATED',
  ADMIN_ACCOUNT_SUSPENDED = 'ADMIN_ACCOUNT_SUSPENDED',
  API_KEY_CREATED = 'API_KEY_CREATED',
  API_KEY_REVOKED = 'API_KEY_REVOKED',
  CONFIG_CHANGED = 'CONFIG_CHANGED',
  PAYMENT_CONFIG_CHANGED = 'PAYMENT_CONFIG_CHANGED',
  WEBHOOK_CONFIG_CHANGED = 'WEBHOOK_CONFIG_CHANGED',
  SUSPICIOUS_API_ACTIVITY = 'SUSPICIOUS_API_ACTIVITY',
  UNUSUAL_TRANSACTION_ACTIVITY = 'UNUSUAL_TRANSACTION_ACTIVITY',

  // System health / availability
  SYSTEM_DOWNTIME = 'SYSTEM_DOWNTIME',
  SYSTEM_RECOVERED = 'SYSTEM_RECOVERED',
  DATABASE_FAILURE = 'DATABASE_FAILURE',
  CACHE_FAILURE = 'CACHE_FAILURE',
  JOB_QUEUE_STALLED = 'JOB_QUEUE_STALLED',
  JOB_FAILURES = 'JOB_FAILURES',
  PAYMENT_CALLBACK_FAILURE = 'PAYMENT_CALLBACK_FAILURE',
  PAYMENT_INFRASTRUCTURE_FAILURE = 'PAYMENT_INFRASTRUCTURE_FAILURE',
  EMAIL_PROVIDER_FAILURE = 'EMAIL_PROVIDER_FAILURE',
  ERROR_SPIKE = 'ERROR_SPIKE',
  NOTIFICATION_DELIVERY_FAILED = 'NOTIFICATION_DELIVERY_FAILED',

  // HR / recruiting
  JOB_APPLICATION_SUBMITTED = 'JOB_APPLICATION_SUBMITTED',

  // Meta
  ACTIVITY_DIGEST = 'ACTIVITY_DIGEST',
}

export interface EventDefinition {
  title: string;
  severity: NotificationSeverity;
  sms: boolean;
  email: boolean;
  aggregate: boolean;
}

type Def = [
  title: string,
  severity: NotificationSeverity,
  opts?: Partial<Pick<EventDefinition, 'sms' | 'email' | 'aggregate'>>,
];

/** Default channels by severity when an entry does not say otherwise. */
function defaults(severity: NotificationSeverity): Pick<EventDefinition, 'sms' | 'email'> {
  return { sms: severity !== 'INFO', email: true };
}

const T = ActivityEventType;
const SMS_EMAIL = { sms: true, email: true } as const;
const AGG = { sms: false, email: true, aggregate: true } as const;

const DEFS: Record<ActivityEventType, Def> = {
  [T.USER_REGISTERED]: ['New User Registration', 'INFO', SMS_EMAIL],
  [T.ACCOUNT_ACTIVATED]: ['Account Activated', 'INFO', { sms: false }],
  [T.ACCOUNT_DEACTIVATED]: ['Account Deactivated', 'WARNING'],
  [T.PASSWORD_RESET_REQUESTED]: ['Password Reset Requested', 'INFO', AGG],
  [T.PASSWORD_CHANGED]: ['Password Changed', 'INFO', AGG],
  [T.EMAIL_VERIFIED]: ['Email Verified', 'INFO', AGG],
  [T.PHONE_VERIFIED]: ['Phone Verified', 'INFO', AGG],
  [T.ROLE_CHANGED]: ['Role Changed', 'HIGH'],
  [T.PERMISSION_CHANGED]: ['Permission Changed', 'HIGH'],
  [T.SUSPICIOUS_LOGIN]: ['Suspicious Login', 'HIGH'],
  [T.FAILED_LOGIN_REPEATED]: ['Repeated Failed Logins', 'WARNING'],
  [T.ACCOUNT_LOCKED]: ['Account Locked', 'WARNING'],
  [T.ACCOUNT_DELETED]: ['Account Deleted', 'HIGH'],
  [T.ACCOUNT_RESTORED]: ['Account Restored', 'WARNING'],

  [T.SUBSCRIPTION_CREATED]: ['New Subscription', 'INFO', SMS_EMAIL],
  [T.SUBSCRIPTION_UPDATED]: ['Subscription Updated', 'INFO'],
  [T.SUBSCRIPTION_UPGRADED]: ['Subscription Upgraded', 'INFO', SMS_EMAIL],
  [T.SUBSCRIPTION_DOWNGRADED]: ['Subscription Downgraded', 'WARNING'],
  [T.SUBSCRIPTION_RENEWED]: ['Subscription Renewed', 'INFO'],
  [T.SUBSCRIPTION_CANCELLED]: ['Subscription Cancelled', 'WARNING'],
  [T.SUBSCRIPTION_EXPIRED]: ['Subscription Expired', 'INFO', AGG],
  [T.SUBSCRIPTION_SUSPENDED]: ['Subscription Suspended', 'WARNING'],
  [T.SUBSCRIPTION_REACTIVATED]: ['Subscription Reactivated', 'INFO'],
  [T.TRIAL_STARTED]: ['Trial Started', 'INFO', AGG],
  [T.TRIAL_ENDED]: ['Trial Ended', 'INFO', AGG],
  [T.PAYMENT_RECEIVED]: ['Payment Received', 'INFO', SMS_EMAIL],
  [T.PAYMENT_FAILED]: ['Payment Failed', 'WARNING'],
  [T.INVOICE_GENERATED]: ['Invoice Generated', 'INFO', AGG],
  [T.INVOICE_PAID]: ['Invoice Paid', 'INFO'],
  [T.BILLING_REFUND]: ['Refund Issued', 'HIGH'],
  [T.BILLING_CREDIT]: ['Credit Applied', 'WARNING'],

  [T.SMS_CAMPAIGN_CREATED]: ['SMS Campaign Created', 'INFO', AGG],
  [T.SMS_CAMPAIGN_APPROVED]: ['SMS Campaign Approved', 'INFO'],
  [T.SMS_CAMPAIGN_SENT]: ['Bulk SMS Sent', 'INFO', SMS_EMAIL],
  [T.SMS_CAMPAIGN_PARTIAL]: ['SMS Campaign Partially Completed', 'WARNING'],
  [T.SMS_CAMPAIGN_FAILED]: ['SMS Campaign Failed', 'WARNING'],
  [T.SMS_MESSAGE_SENT]: ['SMS Sent by Group', 'INFO', SMS_EMAIL],
  [T.SMS_SCHEDULED]: ['SMS Scheduled', 'INFO', AGG],
  [T.SMS_SCHEDULE_EXECUTED]: ['Scheduled SMS Executed', 'INFO', AGG],
  [T.SMS_SCHEDULE_CANCELLED]: ['Scheduled SMS Cancelled', 'INFO', AGG],
  [T.SMS_LOW_CREDIT]: ['SMS Credit Warning', 'WARNING'],
  [T.SMS_PROVIDER_FAILURE]: ['SMS Provider Failure', 'WARNING'],
  [T.EMAIL_CAMPAIGN_SENT]: ['Email Campaign Sent', 'INFO', { sms: false, email: true }],

  [T.REMINDER_CAMPAIGN_CREATED]: ['Reminder Campaign Created', 'INFO', AGG],
  [T.REMINDER_CAMPAIGN_SCHEDULED]: ['Reminder Campaign Scheduled', 'INFO', AGG],
  [T.REMINDER_CAMPAIGN_SENT]: ['Reminder Campaign Sent', 'INFO', SMS_EMAIL],
  [T.REMINDER_CAMPAIGN_COMPLETED]: ['Reminder Campaign Completed', 'INFO', AGG],
  [T.REMINDER_CAMPAIGN_FAILED]: ['Reminder Campaign Failed', 'WARNING'],

  [T.TRANSACTION_CREATED]: ['Transaction Created', 'INFO', AGG],
  [T.TRANSACTION_COMPLETED]: ['Transaction Completed', 'INFO', AGG],
  [T.TRANSACTION_FAILED]: ['Transaction Failed', 'WARNING', AGG],
  [T.TRANSACTION_REVERSED]: ['Transaction Reversed', 'HIGH'],
  [T.HIGH_VALUE_TRANSACTION]: ['High-Value Transaction', 'HIGH'],
  [T.MPESA_C2B_RECEIVED]: ['PayBill Payment Received', 'INFO', AGG],
  [T.MPESA_STK_COMPLETED]: ['STK Payment Completed', 'INFO', AGG],
  [T.MPESA_STK_FAILED]: ['STK Payment Failed', 'INFO', AGG],
  [T.MPESA_B2C_SENT]: ['B2C Payout Sent', 'INFO'],
  [T.MPESA_B2C_FAILED]: ['B2C Payout Failed', 'HIGH'],
  [T.MPESA_UNROUTED_PAYMENT]: ['Unrouted PayBill Payment', 'WARNING'],
  [T.CONTRIBUTION_RECEIVED]: ['Contribution Received', 'INFO', AGG],
  [T.LOAN_REPAYMENT_RECEIVED]: ['Loan Repayment Received', 'INFO', AGG],
  [T.FINE_ISSUED]: ['Fine Issued', 'INFO', AGG],
  [T.FINE_PAID]: ['Fine Paid', 'INFO', AGG],
  [T.WELFARE_CONTRIBUTION]: ['Welfare Contribution', 'INFO', AGG],
  [T.WELFARE_PAYOUT]: ['Welfare Payout', 'WARNING'],
  [T.SHARE_PURCHASED]: ['Share Purchased', 'INFO', AGG],
  [T.SHARE_WITHDRAWN]: ['Share Withdrawn', 'WARNING'],
  [T.DIVIDEND_CALCULATED]: ['Dividend Calculated', 'INFO'],
  [T.DIVIDEND_DISTRIBUTED]: ['Dividend Distributed', 'WARNING'],
  [T.TRANSFER_CREATED]: ['Transfer Created', 'WARNING'],
  [T.REFUND_ISSUED]: ['Refund Issued', 'HIGH'],

  [T.WITHDRAWAL_REQUESTED]: ['New Withdrawal Request', 'HIGH'],
  [T.WITHDRAWAL_PENDING_REVIEW]: ['Withdrawal Awaiting Kitabu Yetu Approval', 'HIGH'],
  [T.WITHDRAWAL_APPROVED]: ['Withdrawal Approved', 'HIGH'],
  [T.WITHDRAWAL_REJECTED]: ['Withdrawal Rejected', 'HIGH'],
  [T.WITHDRAWAL_CANCELLED]: ['Withdrawal Cancelled', 'WARNING'],
  [T.WITHDRAWAL_PROCESSING]: ['Withdrawal Processing', 'INFO', { sms: false, email: true }],
  [T.WITHDRAWAL_COMPLETED]: ['Withdrawal Completed', 'HIGH'],
  [T.WITHDRAWAL_FAILED]: ['Withdrawal Failed', 'HIGH'],
  [T.WITHDRAWAL_REVERSED]: ['Withdrawal Reversed', 'CRITICAL'],
  [T.APPROVAL_REQUESTED]: ['Approval Requested', 'HIGH'],
  [T.APPROVAL_REVIEWED]: ['Approval Reviewed', 'INFO', { sms: false, email: true }],
  [T.APPROVAL_GRANTED]: ['Approval Granted', 'INFO', { sms: false, email: true }],
  [T.APPROVAL_DENIED]: ['Approval Denied', 'WARNING'],

  [T.ORGANIZATION_CREATED]: ['Organization Created', 'INFO', SMS_EMAIL],
  [T.ORGANIZATION_APPROVED]: ['Organization Approved', 'INFO'],
  [T.ORGANIZATION_SUSPENDED]: ['Organization Suspended', 'HIGH'],
  [T.ORGANIZATION_ADMIN_CHANGED]: ['Organization Administrator Changed', 'HIGH'],
  [T.ORG_GROUP_LINK_REQUESTED]: ['Group-Organization Link Awaiting Approval', 'HIGH'],
  [T.ORG_GROUP_LINK_APPROVED]: ['Group-Organization Link Approved', 'INFO'],
  [T.ORG_GROUP_LINK_REJECTED]: ['Group-Organization Link Rejected', 'WARNING'],
  // Routine, high-volume, no admin action needed — same AGG/immediate-email
  // split as LOAN_CREATED/LOAN_REJECTED vs LOAN_APPROVED above: the outcome
  // that actually activates a membership gets an immediate email, the
  // routine create/decline steps fold into the digest.
  [T.PROGRAM_APPLICATION_SUBMITTED]: ['Program Application Submitted', 'INFO', AGG],
  [T.PROGRAM_APPLICATION_ACCEPTED]: ['Program Application Accepted', 'INFO', { sms: false, email: true }],
  [T.PROGRAM_APPLICATION_DECLINED]: ['Program Application Declined', 'INFO', AGG],
  [T.PROGRAM_INVITATION_SENT]: ['Program Invitation Sent', 'INFO', AGG],
  [T.PROGRAM_INVITATION_ACCEPTED]: ['Program Invitation Accepted', 'INFO', { sms: false, email: true }],
  [T.PROGRAM_INVITATION_DECLINED]: ['Program Invitation Declined', 'INFO', AGG],
  [T.GROUP_CREATED]: ['Group Created', 'INFO', SMS_EMAIL],
  [T.GROUP_APPROVED]: ['Group Approved', 'INFO'],
  [T.GROUP_SUSPENDED]: ['Group Suspended', 'HIGH'],
  [T.GROUP_DELETED]: ['Group Deleted', 'HIGH'],
  [T.GROUP_ADMIN_ASSIGNED]: ['Group Administrator Assigned', 'WARNING'],
  [T.GROUP_OWNERSHIP_CHANGED]: ['Group Ownership Changed', 'HIGH'],
  [T.CONSTITUTION_CREATED]: ['Constitution Created', 'INFO', AGG],
  [T.CONSTITUTION_CHANGED]: ['Constitution Changed', 'WARNING', { sms: false }],
  [T.FIELD_OFFICER_ASSIGNED]: ['Field Officer Assigned', 'INFO', AGG],
  [T.MEMBER_ADDED]: ['Member Added', 'INFO', AGG],
  [T.MEMBER_REMOVED]: ['Member Removed', 'WARNING', { sms: false }],
  [T.MEMBER_SUSPENDED]: ['Member Suspended', 'WARNING', { sms: false }],
  [T.MEMBER_REINSTATED]: ['Member Reinstated', 'INFO', AGG],

  [T.LOAN_CREATED]: ['Loan Application', 'INFO', AGG],
  [T.LOAN_APPROVED]: ['Loan Approved', 'INFO', { sms: false, email: true }],
  [T.LOAN_REJECTED]: ['Loan Rejected', 'INFO', AGG],
  [T.LOAN_DISBURSED]: ['Loan Disbursed', 'WARNING'],
  [T.LOAN_EARLY_REPAYMENT]: ['Early Loan Repayment', 'INFO', AGG],
  [T.LOAN_STATUS_CHANGED]: ['Loan Status Changed', 'INFO', AGG],
  [T.LOAN_DEFAULTED]: ['Loan Defaulted', 'WARNING'],
  [T.CYCLE_OPENED]: ['Cycle Opened', 'INFO', { sms: false, email: true }],
  [T.CYCLE_CLOSED]: ['Cycle Closed', 'WARNING'],

  [T.CAMPAIGN_CREATED]: ['Campaign Created', 'INFO', AGG],
  [T.CAMPAIGN_SUBMITTED]: ['Campaign Submitted for Review', 'HIGH'],
  [T.CAMPAIGN_APPROVED]: ['Campaign Approved', 'INFO', { sms: false, email: true }],
  [T.CAMPAIGN_REJECTED]: ['Campaign Rejected', 'INFO', { sms: false, email: true }],
  [T.CAMPAIGN_DONATION_RECEIVED]: ['Campaign Donation Received', 'INFO', AGG],
  [T.CAMPAIGN_TARGET_REACHED]: ['Campaign Target Reached', 'INFO', SMS_EMAIL],
  [T.CAMPAIGN_CLOSED]: ['Campaign Closed', 'INFO', { sms: false, email: true }],
  [T.CAMPAIGN_SUSPENDED]: ['Campaign Suspended', 'HIGH'],

  [T.SECURITY_ALERT]: ['Security Alert', 'CRITICAL'],
  [T.PRIVILEGE_ESCALATION]: ['Privilege Escalation', 'CRITICAL'],
  [T.ADMIN_ACCOUNT_CREATED]: ['Admin Account Created', 'HIGH'],
  [T.ADMIN_ACCOUNT_SUSPENDED]: ['Admin Account Suspended', 'HIGH'],
  [T.API_KEY_CREATED]: ['API Key Created', 'HIGH'],
  [T.API_KEY_REVOKED]: ['API Key Revoked', 'HIGH'],
  [T.CONFIG_CHANGED]: ['Service Configuration Changed', 'HIGH'],
  [T.PAYMENT_CONFIG_CHANGED]: ['Payment Configuration Changed', 'CRITICAL'],
  [T.WEBHOOK_CONFIG_CHANGED]: ['Webhook Configuration Changed', 'HIGH'],
  [T.SUSPICIOUS_API_ACTIVITY]: ['Suspicious API Activity', 'HIGH'],
  [T.UNUSUAL_TRANSACTION_ACTIVITY]: ['Unusual Transaction Activity', 'CRITICAL'],

  [T.SYSTEM_DOWNTIME]: ['System Downtime', 'CRITICAL'],
  [T.SYSTEM_RECOVERED]: ['System Recovered', 'INFO', SMS_EMAIL],
  [T.DATABASE_FAILURE]: ['Database Failure', 'CRITICAL'],
  [T.CACHE_FAILURE]: ['Cache/Redis Failure', 'WARNING'],
  [T.JOB_QUEUE_STALLED]: ['Background Jobs Stalled', 'HIGH'],
  [T.JOB_FAILURES]: ['Background Job Failures', 'WARNING'],
  [T.PAYMENT_CALLBACK_FAILURE]: ['Payment Callback Failure', 'HIGH'],
  [T.PAYMENT_INFRASTRUCTURE_FAILURE]: ['Payment Infrastructure Failure', 'CRITICAL'],
  [T.EMAIL_PROVIDER_FAILURE]: ['Email Provider Failure', 'WARNING'],
  [T.ERROR_SPIKE]: ['Server Error Spike', 'HIGH'],
  [T.NOTIFICATION_DELIVERY_FAILED]: ['Admin Notification Delivery Failed', 'WARNING', { sms: false, email: true }],

  [T.JOB_APPLICATION_SUBMITTED]: ['New Job Application', 'INFO', { sms: false, email: true }],

  [T.ACTIVITY_DIGEST]: ['Platform Activity Summary', 'INFO', { sms: false, email: true }],
};

export function getEventDefinition(type: string): EventDefinition {
  const def = DEFS[type as ActivityEventType];
  if (!def) {
    // Unknown types still audit and alert (WARNING) — never silently dropped.
    return {
      title: type.replace(/_/g, ' ').toLowerCase(),
      severity: 'WARNING',
      sms: true,
      email: true,
      aggregate: false,
    };
  }
  const [title, severity, opts] = def;
  return { title, severity, aggregate: false, ...defaults(severity), ...opts };
}

export const ALL_EVENT_TYPES = Object.values(ActivityEventType) as string[];
