import type {
  PlanType, SubscriptionProduct, SubscriptionStatus, ContributionStatus, LoanStatus,
  PaymentMethod, PaymentStatus, MemberRole, PlatformRole,
  AccountType, JournalStatus, SmsStatus, Gender, GroupType, OrganizationAccessLevel,
} from './enums';

export interface Group {
  id:                  string;
  name:                string;
  type:                GroupType;
  registration_number: string | null;
  phone:               string;
  email:               string | null;
  address:             string | null;
  county:              string | null;
  logo_url:            string | null;
  is_active:           boolean;
  /**
   * Which product this group registered for (migration 140). Records intent
   * only — what a group may actually use is decided by its active
   * subscriptions. Needed because since migration 139 a new group holds no
   * subscription row at all until it pays, so nothing else can answer "what
   * did this group sign up for" for a never-paid group.
   */
  signup_product:      SubscriptionProduct;
  created_at:          Date;
  updated_at:          Date;
}

export interface Member {
  id:                string;
  phone:             string;
  email:             string | null;
  password_hash:     string;
  first_name:        string;
  last_name:         string;
  national_id:       string | null;
  date_of_birth:     Date | null;
  gender:            Gender | null;
  address:           string | null;
  profile_photo_url: string | null;
  platform_role:     PlatformRole;
  is_active:         boolean;
  email_verified:    boolean;
  phone_verified:    boolean;
  last_login_at:     Date | null;
  created_at:        Date;
  updated_at:        Date;
}

export interface GroupMember {
  id:         string;
  group_id:   string;
  member_id:  string;
  role:       MemberRole;
  joined_at:  Date;
  is_active:  boolean;
  invited_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Contribution {
  id:                   string;
  group_id:             string;
  member_id:            string;
  /** Owning membership (group_members.id) — composite-FK bound (§6a). */
  group_membership_id:  string;
  amount:               string;
  contribution_date:    Date;
  due_date:             Date | null;
  status:               ContributionStatus;
  payment_method:       PaymentMethod | null;
  mpesa_receipt_number: string | null;
  notes:                string | null;
  recorded_by:          string | null;
  journal_entry_id:     string | null;
  created_at:           Date;
  updated_at:           Date;
}

export interface Loan {
  id:                   string;
  group_id:             string;
  member_id:            string;
  principal_amount:     string;
  interest_rate:        string;
  loan_term_months:     number;
  disbursement_date:    Date | null;
  status:               LoanStatus;
  purpose:              string | null;
  guarantor_id:         string | null;
  approved_by:          string | null;
  approved_at:          Date | null;
  rejected_by:          string | null;
  rejected_at:          Date | null;
  rejection_reason:     string | null;
  disbursed_by:         string | null;
  disbursed_at:         Date | null;
  payment_method:       PaymentMethod | null;
  mpesa_receipt_number: string | null;
  total_repayable:      string | null;
  outstanding_balance:  string | null;
  next_payment_date:    Date | null;
  notes:                string | null;
  journal_entry_id:     string | null;
  defaulted_by:             string | null;
  defaulted_at:             Date | null;
  default_reason:           string | null;
  written_off_by:           string | null;
  written_off_at:           Date | null;
  write_off_reason:         string | null;
  write_off_journal_entry_id: string | null;
  created_at:           Date;
  updated_at:           Date;
}

export interface LoanRepayment {
  id:                   string;
  group_id:             string;
  loan_id:              string;
  member_id:            string;
  installment_number:   number;
  due_date:             Date;
  opening_balance:      string;
  principal_component:  string;
  interest_component:   string;
  penalty_amount:       string;
  total_due:            string;
  closing_balance:      string;
  amount_paid:          string;
  payment_date:         Date | null;
  status:               ContributionStatus;
  payment_method:       PaymentMethod | null;
  mpesa_receipt_number: string | null;
  journal_entry_id:     string | null;
  created_at:           Date;
  updated_at:           Date;
}

export interface Account {
  id:           string;
  group_id:     string;
  account_code: string;
  name:         string;
  type:         AccountType;
  parent_id:    string | null;
  description:  string | null;
  is_system:    boolean;
  is_active:    boolean;
  balance:      string;
  created_at:   Date;
  updated_at:   Date;
}

export interface JournalEntry {
  id:          string;
  group_id:    string;
  entry_date:  Date;
  reference:   string | null;
  description: string;
  status:      JournalStatus;
  created_by:  string;
  posted_by:   string | null;
  posted_at:   Date | null;
  voided_by:   string | null;
  voided_at:   Date | null;
  void_reason: string | null;
  created_at:  Date;
  updated_at:  Date;
}

export interface JournalLine {
  id:               string;
  group_id:         string;
  journal_entry_id: string;
  account_id:       string;
  debit:            string;
  credit:           string;
  description:      string | null;
  created_at:       Date;
  updated_at:       Date;
}

export interface BillingAccount {
  id:                    string;
  group_id:              string;
  sms_credits:           string;
  low_balance_threshold: string;
  auto_topup_enabled:    boolean;
  auto_topup_amount:     string | null;
  created_at:            Date;
  updated_at:            Date;
}

export interface Subscription {
  id:                 string;
  group_id:           string;
  /** Migration 127. A group holds at most one ACTIVE row per product. */
  product:            SubscriptionProduct;
  plan_type:          PlanType;
  status:             SubscriptionStatus;
  started_at:         Date;
  expires_at:         Date | null;
  next_billing_date:  Date | null;
  monthly_fee:        string;
  sms_rate:           string;
  /**
   * Messages included in this subscription's monthly bundle (migration 124).
   * Was missing from this interface entirely until migration 127's pass.
   * reserve_sms_credits SUMs this across a group's active subscriptions.
   */
  sms_allowance_included: number;
  max_members:        number | null;
  grace_period_days:  number;
  cancelled_at:       Date | null;
  cancel_reason:      string | null;
  /**
   * The payment that activated this row (migration 138). NULL for
   * pre-payment-gating rows and for legacy/manually-activated plans.
   * UNIQUE — activateSubscriptionForPayment's exactly-once guarantee lives
   * partly on this constraint, not just the check-then-act above it.
   */
  payment_id:         string | null;
  created_at:         Date;
  updated_at:         Date;
}

export interface Invoice {
  id:                 string;
  group_id:           string;
  billing_account_id: string;
  invoice_number:     string;
  invoice_date:       Date;
  due_date:           Date;
  status:             PaymentStatus;
  subtotal:           string;
  tax_amount:         string;
  total_amount:       string;
  paid_amount:        string;
  notes:              string | null;
  created_at:         Date;
  updated_at:         Date;
}

export interface InvoiceItem {
  id:          string;
  group_id:    string;
  invoice_id:  string;
  description: string;
  quantity:    string;
  unit_price:  string;
  total:       string;
  created_at:  Date;
  updated_at:  Date;
}

export interface Payment {
  id:                        string;
  group_id:                  string;
  invoice_id:                string | null;
  amount:                    string;
  payment_method:            PaymentMethod;
  status:                    PaymentStatus;
  mpesa_receipt_number:      string | null;
  mpesa_checkout_request_id: string | null;
  mpesa_merchant_request_id: string | null;
  mpesa_phone:               string | null;
  mpesa_raw_callback:        Record<string, unknown> | null;
  payment_date:              Date | null;
  recorded_by:               string | null;
  notes:                     string | null;
  created_at:                Date;
  updated_at:                Date;
}

/** Lifecycle of the credits attached to one message (migration 123). */
export type SmsBillingState = 'none' | 'reserved' | 'consumed' | 'released';

export interface SmsUsageLog {
  id:               string;
  /** Null only on payer_type='platform' rows (auth/OTP sends belong to no group). */
  group_id:         string | null;
  recipient_phone:  string;
  message_text:     string;
  status:           SmsStatus;
  provider:         string;
  provider_msg_id:  string | null;
  network_id:       string | null;
  campaign_id:      string | null;
  credits_deducted: string;
  sent_at:          Date | null;
  delivered_at:     Date | null;
  failed_reason:    string | null;
  reference_type:   string | null;
  reference_id:     string | null;
  /** Who was billed. 'organization' rows always carry payer_organization_id (migration 051). 'platform' rows can never carry a charge — enforced by CHECK. */
  payer_type:            'group' | 'organization' | 'platform';
  payer_organization_id: string | null;
  // ─── Attribution + reservation (migration 123) ───
  member_id:         string | null;
  notification_type: string | null;
  correlation_id:    string | null;
  channel:           string;
  credits_reserved:  string;
  billing_state:     SmsBillingState;
  reserved_at:       Date | null;
  settled_at:        Date | null;
  created_at:       Date;
  updated_at:       Date;
}

export interface Organization {
  id:                    string;
  name:                  string;
  registration_number:   string | null;
  phone:                 string | null;
  email:                 string | null;
  address:               string | null;
  county:                string | null;
  coordinator_member_id: string | null;
  is_active:             boolean;
  created_at:            Date;
  updated_at:            Date;
}

export interface OrganizationGroupAccess {
  id:           string;
  organization_id:       string;
  group_id:     string;
  access_level: OrganizationAccessLevel;
  granted_by:   string;
  granted_at:   Date;
  revoked_at:   Date | null;
  revoked_by:   string | null;
  is_active:    boolean;
  created_at:   Date;
  updated_at:   Date;
}

export interface AuditLog {
  id:            string;
  group_id:      string | null;
  actor_id:      string | null;
  action:        string;
  resource_type: string;
  resource_id:   string | null;
  old_values:    Record<string, unknown> | null;
  new_values:    Record<string, unknown> | null;
  ip_address:    string | null;
  user_agent:    string | null;
  created_at:    Date;
}

export interface Notification {
  id:             string;
  group_id:       string | null;
  member_id:      string | null;
  type:           string;
  title:          string;
  body:           string;
  is_read:        boolean;
  read_at:        Date | null;
  reference_type: string | null;
  reference_id:   string | null;
  created_at:     Date;
  updated_at:     Date;
}

// Query result helpers
export interface PaginatedResult<T> {
  items:      T[];
  total:      number;
  page:       number;
  pageSize:   number;
  totalPages: number;
}

export interface PaginationParams {
  page:   number;
  limit:  number;
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}
