import type { MemberRole, PlatformRole } from './enums';

// ------------------------------------------------------------------
// Standard API envelope
// ------------------------------------------------------------------
export interface ApiSuccess<T = unknown> {
  success: true;
  data:    T;
}

export interface ApiError {
  success: false;
  error:   string;
  code:    string;
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

// ------------------------------------------------------------------
// Auth context injected by edge middleware into request headers
// ------------------------------------------------------------------
export interface AuthContext {
  userId:   string;
  groupId:  string;
  role:     MemberRole | PlatformRole;
  organizationId?:   string;
  // Active Membership Context + drift epochs (payment architecture §2.1/§2.5).
  // Absent on legacy tokens issued before Phase 3.2; sensitive-op checks
  // skip when absent (drift bounded by the access-token TTL).
  membershipId?:   string;
  membershipNo?:   string;
  authVersion?:    number;
  sessionVersion?: number;
}

// ------------------------------------------------------------------
// Auth responses
// ------------------------------------------------------------------
export interface LoginResponse {
  accessToken:  string;
  refreshToken: string;
  member: {
    id:           string;
    firstName:    string;
    lastName:     string;
    phone:        string;
    email:        string | null;
    platformRole: PlatformRole;
    groupRole:    MemberRole;
    groupId:      string;
    groupName:    string;
    // ── Phase A additions: human-readable IDs + shared identity ──
    groupCode?:   string;   // e.g. KY0000003
    memberCode?:  string;   // e.g. KY000000300001 (internal/regulatory — never a payment id)
    membershipNo?: string;  // e.g. BG102534 — the ONLY public payment identifier (Phase 1)
    personId?:    string;   // cross-group identity (person table)
    officerRole?: string;   // formal governance role from group_officers (chair/sec/treas/etc.)
    // ── Phase D Part 2: group lifecycle ──
    groupStatus?: string;   // 'pending_verification' | 'active' | …
  };
}

// Returned by /auth/login when the member belongs to more than one group.
// The client shows the user a chooser and re-submits with `groupCode`.
export interface NeedsGroupSelection {
  needsGroupSelection: true;
  groups: Array<{
    groupId:    string;
    groupCode:  string;
    groupName:  string;
    groupRole:  MemberRole;
    officerRole?: string;
  }>;
}

export type LoginResult = LoginResponse | NeedsGroupSelection;

export function isGroupSelectionNeeded(r: LoginResult): r is NeedsGroupSelection {
  return (r as NeedsGroupSelection).needsGroupSelection === true;
}

// Backoffice login (super_admin / support / organization_coordinator). No group
// context — these accounts operate cross-tenant or Organization-scoped.
export interface AdminLoginResponse {
  accessToken:  string;
  refreshToken: string;
  audience:     'backoffice';
  member: {
    id:           string;
    firstName:    string;
    lastName:     string;
    email:        string;
    platformRole: Exclude<PlatformRole, 'member'>;
    organizationId?:       string;
  };
}

// Step-1 response when the member has never enrolled an authenticator.
// The frontend shows the QR + recovery codes, then re-submits the
// 6-digit code along with the `challenge` token to /admin/login/verify
// which performs the enrollment write + issues the real access token.
export interface AdminLoginEnrollmentChallenge {
  needsMfaEnrollment: true;
  challenge:          string;   // short-lived JWT (5 min)
  secret:             string;   // base32 — shown so user can paste manually
  qrCodeDataUrl:      string;   // PNG data URL for inline rendering
  recoveryCodes:      string[]; // 10 codes; shown ONCE, never returned again
  accountLabel:       string;   // e.g. "alice@kitabuyetu.co.ke"
}

// Step-1 response when the member is already enrolled. The frontend
// prompts for the current 6-digit code (or a recovery code) and re-submits
// to /admin/login/verify with the same challenge token.
export interface AdminLoginMfaChallenge {
  needsMfaCode: true;
  challenge:    string;   // short-lived JWT (5 min)
}

// Returned by /admin/login/verify when the member is active staff at more
// than one organization (multi-staff organizations, migration 101). The
// client shows an org chooser and re-submits the same challenge + code
// along with `organizationId` — mirrors NeedsGroupSelection's shape/flow
// on the consumer /login side.
export interface NeedsOrgSelection {
  needsOrgSelection: true;
  organizations: Array<{
    organizationId:   string;
    organizationName: string;
    orgRole:          'lead' | 'staff';
  }>;
}

// Step 1 (/admin/login) can never return NeedsOrgSelection — only step 2
// (/admin/login/verify, after the member is identified) can, so this stays
// a narrower, separate union rather than folding NeedsOrgSelection in here.
export type AdminLoginResult =
  | AdminLoginEnrollmentChallenge
  | AdminLoginMfaChallenge
  | AdminLoginResponse;

export type AdminLoginVerifyResult = NeedsOrgSelection | AdminLoginResponse;

export function isAdminEnrollment(r: AdminLoginResult): r is AdminLoginEnrollmentChallenge {
  return (r as AdminLoginEnrollmentChallenge).needsMfaEnrollment === true;
}
export function isAdminMfaChallenge(r: AdminLoginResult): r is AdminLoginMfaChallenge {
  return (r as AdminLoginMfaChallenge).needsMfaCode === true;
}
export function isOrgSelectionNeeded(r: AdminLoginVerifyResult): r is NeedsOrgSelection {
  return (r as NeedsOrgSelection).needsOrgSelection === true;
}

/** One row in the sidebar group switcher (payment architecture §8). */
export interface MembershipSwitcherItem {
  membershipId:   string;
  groupId:        string;
  groupCode:      string;
  groupName:      string;
  role:           MemberRole;
  membershipNo:   string | null;
  displayAlias:   string | null;
  savingsBalance: string;
  isCurrent:      boolean;
}

export interface RefreshResponse {
  accessToken: string;
  /** Rotated refresh token (§15.3) — the presented token is consumed; store
   *  this one. Absent only from pre-rotation server responses. */
  refreshToken?: string;
}

// ------------------------------------------------------------------
// Member responses
// ------------------------------------------------------------------
// The ACTUAL wire shape of /members list/detail rows: snake_case members-table
// columns (SELECT m.*, PII masked per caller role, password_hash stripped
// server-side) plus the group_members join fields. Replaces the old
// `MemberPublic` interface, which described a camelCase mapping no route ever
// performed — reads against it were silently undefined.
export interface GroupMemberRow {
  id:                string;
  phone:             string;
  email:             string | null;
  first_name:        string;
  middle_name?:      string | null;
  last_name:         string;
  national_id:       string | null;
  date_of_birth:     string | null;
  gender:            string | null;
  address:           string | null;
  profile_photo_url: string | null;
  occupation?:       string | null;
  alternative_phone?: string | null;
  county_id?:        string | null;
  platform_role:     PlatformRole;
  is_active:         boolean;
  email_verified:    boolean;
  phone_verified:    boolean;
  last_login_at:     string | null;
  created_at:        string;
  group_role:        MemberRole;
  group_status:      string;
  joined_at:         string;
  /** Present on list rows only (joined from group_members). */
  membership_no?:    string | null;
}

// ------------------------------------------------------------------
// Contribution responses
// ------------------------------------------------------------------
export interface ContributionPublic {
  id:                  string;
  memberId:            string;
  memberName:          string;
  amount:              string;
  contributionDate:    string;
  dueDate:             string | null;
  status:              string;
  paymentMethod:       string | null;
  mpesaReceiptNumber:  string | null;
  notes:               string | null;
  createdAt:           string;
}

// ------------------------------------------------------------------
// Loan responses
// ------------------------------------------------------------------
export interface LoanPublic {
  id:                  string;
  memberId:            string;
  memberName:          string;
  principalAmount:     string;
  interestRate:        string;
  loanTermMonths:      number;
  disbursementDate:    string | null;
  status:              string;
  purpose:             string | null;
  totalRepayable:      string | null;
  outstandingBalance:  string | null;
  nextPaymentDate:     string | null;
  createdAt:           string;
}

export interface RepaymentScheduleItem {
  installmentNumber:  number;
  dueDate:            string;
  openingBalance:     string;
  principalComponent: string;
  interestComponent:  string;
  penaltyAmount:      string;
  totalDue:           string;
  closingBalance:     string;
  amountPaid:         string;
  status:             string;
  paymentDate:        string | null;
}

// ------------------------------------------------------------------
// Accounting responses
// ------------------------------------------------------------------
export interface TrialBalanceLine {
  accountCode:  string;
  accountName:  string;
  accountType:  string;
  totalDebits:  string;
  totalCredits: string;
  netBalance:   string;
}

export interface ProfitAndLoss {
  period: { from: string; to: string };
  income: { accountCode: string; accountName: string; amount: string }[];
  expenses: { accountCode: string; accountName: string; amount: string }[];
  totalIncome:   string;
  totalExpenses: string;
  netProfit:     string;
}

export interface BalanceSheet {
  asOf: string;
  assets:      { accountCode: string; accountName: string; balance: string }[];
  liabilities: { accountCode: string; accountName: string; balance: string }[];
  equity:      { accountCode: string; accountName: string; balance: string }[];
  totalAssets:      string;
  totalLiabilities: string;
  totalEquity:      string;
}

export interface CashFlowLine {
  accountCode: string;
  accountName: string;
  /** Positive = cash in, negative = cash out. */
  amount:      string;
}

export interface CashFlowStatement {
  period: { from: string; to: string };
  operating: CashFlowLine[];
  investing: CashFlowLine[];
  financing: CashFlowLine[];
  netOperating: string;
  netInvesting: string;
  netFinancing: string;
  netChange:    string;
  openingCash:  string;
  closingCash:  string;
  /** openingCash + netChange should equal closingCash — false signals unclassified movement. */
  reconciles:   boolean;
}

export interface EquityChangesLine {
  accountCode: string;
  accountName: string;
  opening:     string;
  increases:   string;
  decreases:   string;
  closing:     string;
}

export interface EquityChanges {
  period: { from: string; to: string };
  lines: EquityChangesLine[];
  totalOpening: string;
  totalClosing: string;
  /** Period surplus not yet closed into an equity account. */
  periodNetProfit: string;
}

export interface JournalEntry {
  id:         string;
  entryDate:  string;
  reference:  string | null;
  memo:       string | null;
  status:     string;
  lineCount:  number;
}

// ------------------------------------------------------------------
// Billing responses
// ------------------------------------------------------------------
export interface SubscriptionPublic {
  id:               string;
  planType:         string;
  status:           string;
  startedAt:        string;
  expiresAt:        string | null;
  nextBillingDate:  string | null;
  monthlyFee:       string;
  smsRate:          string;
  maxMembers:       number | null;
}

// ------------------------------------------------------------------
// Organization responses
// ------------------------------------------------------------------
// SMS responses
// ------------------------------------------------------------------
export interface SmsTemplate {
  id:           string;
  template_key: string;
  name:         string;
  body:         string;
  category:     string;
  is_system:    boolean;
  is_active:    boolean;
  variables:    string[];
}

export interface SmsCampaign {
  id:              string;
  name:            string;
  status:          'draft' | 'scheduled' | 'sending' | 'completed' | 'failed' | 'cancelled';
  message:         string;
  recipient_count: number;
  sent_count:      number;
  failed_count:    number;
  scheduled_at:    string | null;
  completed_at:    string | null;
  created_at:      string;
}

export interface SmsSchedule {
  id:              string;
  name:            string;
  schedule_type:   string;
  is_active:       boolean;
  cron_expression: string | null;
  next_run_at:     string | null;
  last_run_at:     string | null;
  template_name:   string | null;
}

export interface SmsProviderBalance {
  balance:     string | null;
  currency:    string;
  lastChecked: string | null;
}

// ------------------------------------------------------------------
export interface OrganizationProfile {
  id:   string;
  name: string;
  type: 'bank' | 'sacco' | 'foundation' | 'ngo' | 'government' | 'cooperative' | 'faith_based' | 'other';
}

export interface OrganizationGroupSummary {
  groupId:          string;
  groupName:        string;
  groupType:        string;
  county:           string | null;
  activeMemberCount: number;
  totalContributions: string;
  activeLoanPortfolio: string;
  defaultedLoanCount: number;
  subscriptionPlan:   string | null;
  subscriptionStatus: string | null;
  groupCreatedAt:     string;
}
