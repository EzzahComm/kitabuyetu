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
    memberCode?:  string;   // e.g. KY000000300001
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

export type AdminLoginResult =
  | AdminLoginEnrollmentChallenge
  | AdminLoginMfaChallenge
  | AdminLoginResponse;

export function isAdminEnrollment(r: AdminLoginResult): r is AdminLoginEnrollmentChallenge {
  return (r as AdminLoginEnrollmentChallenge).needsMfaEnrollment === true;
}
export function isAdminMfaChallenge(r: AdminLoginResult): r is AdminLoginMfaChallenge {
  return (r as AdminLoginMfaChallenge).needsMfaCode === true;
}

export interface RefreshResponse {
  accessToken: string;
}

// ------------------------------------------------------------------
// Member responses
// ------------------------------------------------------------------
export interface MemberPublic {
  id:              string;
  firstName:       string;
  lastName:        string;
  phone:           string;
  email:           string | null;
  nationalId:      string | null;
  dateOfBirth:     string | null;
  gender:          string | null;
  address:         string | null;
  profilePhotoUrl: string | null;
  platformRole:    PlatformRole;
  groupRole:       MemberRole;
  isActive:        boolean;
  joinedAt:        string;
  lastLoginAt:     string | null;
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
