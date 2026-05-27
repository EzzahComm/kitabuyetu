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
  ngoId?:   string;
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

// Backoffice login (super_admin / support / ngo_coordinator). No group
// context — these accounts operate cross-tenant or NGO-scoped.
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
    ngoId?:       string;
  };
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
// NGO responses
// ------------------------------------------------------------------
export interface NgoGroupSummary {
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
