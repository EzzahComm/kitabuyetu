import { api } from './client';
import { buildQuery } from '@/lib/utils';
import type {
  LoginResponse, LoginResult, RefreshResponse, AdminLoginResponse, AdminLoginResult,
  GroupMemberRow, SubscriptionPublic, OrganizationGroupSummary, OrganizationProfile, MembershipSwitcherItem,
  TrialBalanceLine, ProfitAndLoss, BalanceSheet, CashFlowStatement, EquityChanges, JournalEntry,
  SmsTemplate, SmsCampaign, SmsSchedule, SmsProviderBalance,
} from '@/types/api.types';
import type { PaginatedResult, Account, SmsUsageLog, Contribution, Loan, LoanRepayment } from '@/types/db.types';
import type { SmsUsageSummary } from '@/lib/sms/analytics';
import type { FiscalPeriod } from '@/lib/services/fiscal-periods.service';
import type { EffectiveThreshold } from '@/lib/services/approval-policy.service';
import type { EffectiveTemplate } from '@/lib/services/posting-templates.service';
import type { EffectiveLoanTerms } from '@/lib/services/loan-policy.service';
import type { EffectiveFineSchedule } from '@/lib/services/fine-policy.service';
import type { EffectiveSavingsLimits } from '@/lib/services/savings-policy.service';

// ------------------------------------------------------------------
// Auth
// ------------------------------------------------------------------
export const authApi = {
  // Identifier may be a phone (07XX… / +254…) or an email address. When the
  // member is in multiple groups, the response is NeedsGroupSelection and the
  // client re-submits with `groupCode`.
  login: (body: { identifier: string; password: string; groupCode?: string }) =>
    api.post<LoginResult>('/auth/login', body),

  register: (body: unknown) =>
    api.post<LoginResponse & {
      registrationFee: number;
      groupCode?:      string;
      memberCode?:     string;
    }>('/auth/register', body),

  refresh: (refreshToken: string) =>
    api.post<RefreshResponse>('/auth/refresh', { refreshToken }),

  // Group switcher (payment architecture §8)
  memberships: () =>
    api.get<{ items: MembershipSwitcherItem[] }>('/auth/memberships'),

  switchGroup: (groupId: string) =>
    api.post<LoginResponse>('/auth/switch-group', { groupId }),

  logout:  (refreshToken?: string) =>
    api.post<void>('/auth/logout', { refreshToken }),

  // Registrant verification (§4A) — pending_verification groups only.
  verifyStart: (channel: 'email' | 'sms') =>
    api.post<{ channel: 'email' | 'sms'; expiresAt: string }>('/auth/verify/start', { channel }),

  verifyComplete: (code: string) =>
    api.post<LoginResponse>('/auth/verify/complete', { code }),

  // Public — no access token required (the token param IS the proof).
  verifyEmailToken: (token: string) =>
    api.post<{ status: string; groupId: string }>('/auth/verify/email', { token }),

  // Step 1 of backoffice login. Returns one of:
  //   - AdminLoginEnrollmentChallenge (first-time staff: QR + recovery codes)
  //   - AdminLoginMfaChallenge        (enrolled staff: just prompt for code)
  //   - AdminLoginResponse            (legacy path; not reachable with MFA on)
  // The client narrows via isAdminEnrollment / isAdminMfaChallenge.
  adminLogin: (body: { email: string; password: string }) =>
    api.post<AdminLoginResult>('/auth/admin/login', body),

  // Step 2 of backoffice login: submit the 6-digit TOTP code (or a recovery
  // code) + the challenge token from step 1. On first-time enrollment the
  // client also echoes back the 10 plaintext recoveryCodes so they get
  // bcrypt-hashed + stored alongside the secret.
  adminLoginVerify: (body: {
    challenge:      string;
    code:           string;
    label?:         string;
    recoveryCodes?: string[];
  }) =>
    api.post<AdminLoginResponse>('/auth/admin/login/verify', body),
};

// ------------------------------------------------------------------
// Members
// ------------------------------------------------------------------
export const membersApi = {
  list:   (params?: Record<string, unknown>) =>
    api.get<PaginatedResult<GroupMemberRow>>(`/members${buildQuery(params ?? {})}`),
  getById: (id: string) =>
    api.get<GroupMemberRow>(`/members/${id}`),
  create:  (body: unknown) =>
    api.post<GroupMemberRow>('/members', body),
  update:  (id: string, body: unknown) =>
    api.patch<GroupMemberRow>(`/members/${id}`, body),
  updateRole: (id: string, role: string) =>
    api.put<unknown>(`/members/${id}`, { role }),
  deactivate: (id: string) =>
    api.delete<void>(`/members/${id}`),
  // Phase E2 — explicit state-machine transition with optional reason.
  // Use this instead of `deactivate()` so the audit columns are stamped.
  transitionStatus: (id: string, status: string, reason?: string) =>
    api.post<unknown>(`/members/${id}/status`, { status, reason }),
};

// Phase E2 — next-of-kin emergency contacts, scoped to a member.
export const nextOfKinApi = {
  list:   (memberId: string) =>
    api.get<unknown[]>(`/members/${memberId}/next-of-kin`),
  create: (memberId: string, body: unknown) =>
    api.post<unknown>(`/members/${memberId}/next-of-kin`, body),
  update: (memberId: string, kinId: string, body: unknown) =>
    api.patch<unknown>(`/members/${memberId}/next-of-kin/${kinId}`, body),
  remove: (memberId: string, kinId: string) =>
    api.delete<void>(`/members/${memberId}/next-of-kin/${kinId}`),
};

// ------------------------------------------------------------------
// Contributions
// ------------------------------------------------------------------
export const contributionsApi = {
  list:   (params?: Record<string, unknown>) =>
    api.get<PaginatedResult<Contribution & { member_name: string }>>(`/contributions${buildQuery(params ?? {})}`),
  getById: (id: string) =>
    api.get<Contribution & { member_name: string }>(`/contributions/${id}`),
  create:  (body: unknown) =>
    api.post<Contribution>('/contributions', body),
  update:  (id: string, body: unknown) =>
    api.patch<Contribution>(`/contributions/${id}`, body),
  delete:  (id: string) =>
    api.delete<void>(`/contributions/${id}`),
  policy: () =>
    api.get<EffectiveSavingsLimits>('/contributions/policy'),
  setPolicy: (body: unknown) =>
    api.put<EffectiveSavingsLimits>('/contributions/policy', body),
};

// ------------------------------------------------------------------
// Loans
// ------------------------------------------------------------------
export const loansApi = {
  list:   (params?: Record<string, unknown>) =>
    api.get<PaginatedResult<Loan & { member_name: string }>>(`/loans${buildQuery(params ?? {})}`),
  getById: (id: string) =>
    api.get<Loan & { member_name: string; member_phone: string; schedule: LoanRepayment[] }>(`/loans/${id}`),
  apply:   (body: unknown) =>
    api.post<Loan>('/loans', body),
  action:  (id: string, body: unknown) =>
    api.patch<Loan>(`/loans/${id}`, body),
  recordRepayment: (id: string, body: unknown) =>
    api.post<LoanRepayment>(`/loans/${id}/repayments`, body),
  policy: () =>
    api.get<EffectiveLoanTerms>('/loans/policy'),
  setPolicy: (body: unknown) =>
    api.put<EffectiveLoanTerms>('/loans/policy', body),
};

// ------------------------------------------------------------------
// Fines
// ------------------------------------------------------------------
export const finesApi = {
  policy: () =>
    api.get<EffectiveFineSchedule>('/fines/policy'),
  setPolicy: (body: { schedule: Record<string, number> }) =>
    api.put<EffectiveFineSchedule>('/fines/policy', body),
};

// ------------------------------------------------------------------
// Accounting
// ------------------------------------------------------------------
export const accountingApi = {
  listAccounts: () =>
    api.get<Account[]>('/accounting/accounts'),
  createAccount: (body: unknown) =>
    api.post<Account>('/accounting/accounts', body),
  journals: (params?: Record<string, unknown>) =>
    api.get<PaginatedResult<JournalEntry>>(`/accounting/journals${buildQuery(params ?? {})}`),
  createJournal: (body: unknown) =>
    api.post<unknown>('/accounting/journals', body),
  trialBalance: () =>
    api.get<TrialBalanceLine[]>('/accounting/reports?type=trial_balance'),
  profitAndLoss: (from: string, to: string) =>
    api.get<ProfitAndLoss>(`/accounting/reports?type=profit_and_loss&from=${from}&to=${to}`),
  balanceSheet:  (asOf?: string) =>
    api.get<BalanceSheet>(`/accounting/reports?type=balance_sheet${asOf ? `&asOf=${asOf}` : ''}`),
  fiscalPeriods: () =>
    api.get<FiscalPeriod[]>('/accounting/fiscal-periods'),
  closePeriod: (body: { periodStart: string; periodEnd: string }) =>
    api.post<unknown>('/accounting/fiscal-periods', body),
  reopenPeriod: (id: string, body: { reason: string }) =>
    api.post<unknown>(`/accounting/fiscal-periods/${id}`, body),
  policies: () =>
    api.get<EffectiveThreshold[]>('/accounting/policies'),
  setPolicy: (body: { key: string; threshold: number }) =>
    api.put<EffectiveThreshold[]>('/accounting/policies', body),
  cashFlow: (from: string, to: string) =>
    api.get<CashFlowStatement>(`/accounting/reports?type=cash_flow&from=${from}&to=${to}`),
  equityChanges: (from: string, to: string) =>
    api.get<EquityChanges>(`/accounting/reports?type=equity_changes&from=${from}&to=${to}`),
  postingTemplates: () =>
    api.get<EffectiveTemplate[]>('/accounting/posting-templates'),
  setPostingTemplate: (body: unknown) =>
    api.put<EffectiveTemplate[]>('/accounting/posting-templates', body),
};

// ------------------------------------------------------------------
// SMS
// ------------------------------------------------------------------
export interface SmsUsageResult extends PaginatedResult<SmsUsageLog> {
  balance: { credits: string; rate: string };
  summary: SmsUsageSummary;
}

export const smsApi = {
  send:       (body: unknown) => api.post<unknown>('/sms/send', body),
  usage:      (params?: Record<string, unknown>) =>
    api.get<SmsUsageResult>(`/sms/usage${buildQuery(params ?? {})}`),
  // Bulk / Campaign
  bulk:       (body: unknown) => api.post<{ queued: number }>('/sms/bulk', body),
  campaigns:  (params?: Record<string, unknown>) =>
    api.get<PaginatedResult<SmsCampaign>>(`/sms/campaign${buildQuery(params ?? {})}`),
  createCampaign: (body: unknown) => api.post<SmsCampaign>('/sms/campaign', body),
  cancelCampaign: (id: string)    => api.delete<void>(`/sms/campaign?id=${id}`),
  // Templates
  templates:       (params?: Record<string, unknown>) =>
    api.get<SmsTemplate[]>(`/sms/templates${buildQuery(params ?? {})}`),
  createTemplate:  (body: unknown) => api.post<SmsTemplate>('/sms/templates', body),
  updateTemplate:  (id: string, body: unknown) => api.patch<SmsTemplate>(`/sms/templates?id=${id}`, body),
  deleteTemplate:  (id: string)    => api.delete<void>(`/sms/templates?id=${id}`),
  // Schedules
  schedules:       (params?: Record<string, unknown>) =>
    api.get<SmsSchedule[]>(`/sms/schedules${buildQuery(params ?? {})}`),
  createSchedule:  (body: unknown) => api.post<SmsSchedule>('/sms/schedules', body),
  updateSchedule:  (id: string, body: unknown) => api.patch<SmsSchedule>(`/sms/schedules?id=${id}`, body),
  deleteSchedule:  (id: string)    => api.delete<void>(`/sms/schedules?id=${id}`),
  // Provider balance
  providerBalance: () => api.get<SmsProviderBalance>('/sms/balance'),
  checkBalance:    () => api.post<SmsProviderBalance>('/sms/balance', {}),
  // DLR
  dlr: (messageId: string) => api.get<unknown>(`/sms/dlr?messageId=${messageId}`),
};

// ------------------------------------------------------------------
// Billing
// ------------------------------------------------------------------
export const billingApi = {
  plans:         () => api.get<{ plans: unknown[]; current: SubscriptionPublic | null }>('/billing/plans'),
  upgradePlan:   (planType: string) => api.post<unknown>('/billing/plans', { planType }),
  invoices:      () => api.get<unknown[]>('/billing/invoices'),
  recordPayment: (body: unknown) => api.post<unknown>('/billing/payments', body),
  smsTopup:      (amount: number) => api.post<unknown>('/billing/payments', { type: 'sms_topup', amount }),
};

// ------------------------------------------------------------------
// M-Pesa
// ------------------------------------------------------------------
export const mpesaApi = {
  stkPush:   (body: unknown) => api.post<{ checkoutRequestId: string; message: string }>('/mpesa/stk-push', body),
  pollStatus: (checkoutRequestId: string) =>
    api.get<{ status: string; mpesaReceiptNumber: string | null }>(`/mpesa/status?checkoutRequestId=${checkoutRequestId}`),
  b2c: (body: unknown) => api.post<unknown>('/mpesa/b2c', body),
};

// ------------------------------------------------------------------
// Reports
// ------------------------------------------------------------------
export const reportsApi = {
  contributions: (from: string, to: string) =>
    api.get<unknown>(`/reports?type=contribution&from=${from}&to=${to}`),
  loans:         () => api.get<unknown>('/reports?type=loans'),
  financial:     (from: string, to: string) =>
    api.get<unknown>(`/reports?type=financial&from=${from}&to=${to}`),
};

// ------------------------------------------------------------------
// Organization
// ------------------------------------------------------------------
export const organizationApi = {
  profile: () => api.get<OrganizationProfile>('/organization/profile'),
  groups:  () => api.get<OrganizationGroupSummary[]>('/organization/groups'),
  detail:  (groupId: string) => api.get<unknown>(`/organization/reports?groupId=${groupId}`),
  policies: () => api.get<EffectiveThreshold[]>('/organization/policies'),
  setPolicy: (body: { key: string; threshold: number }) =>
    api.put<EffectiveThreshold[]>('/organization/policies', body),
};

// ------------------------------------------------------------------
// Import
// ------------------------------------------------------------------
export const importApi = {
  upload: (type: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.upload<{ imported: number; errors: unknown[] }>(`/import?type=${type}`, fd);
  },
};
