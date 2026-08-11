import { api } from './client';
import { buildQuery } from '@/lib/utils';
import type {
  LoginResponse, LoginResult, RefreshResponse, AdminLoginResult, AdminLoginVerifyResult,
  GroupMemberRow, SubscriptionPublic, OrganizationGroupSummary, OrganizationProfile, MembershipSwitcherItem,
  TrialBalanceLine, ProfitAndLoss, BalanceSheet, CashFlowStatement, EquityChanges, JournalEntry,
  SmsTemplate, SmsCampaign, SmsSchedule, SmsProviderBalance,
} from '@/types/api.types';
import type { PaginatedResult, Account, SmsUsageLog, Contribution, Loan, LoanRepayment } from '@/types/db.types';
import type { SmsUsageSummary } from '@/lib/sms/analytics';
import type { FiscalPeriod } from '@/lib/services/fiscal-periods.service';
import type { EffectiveThreshold } from '@/lib/services/approval-policy.service';
import type { CreateJournalPayload , CreateAccountPayload, SetPostingTemplatePayload, SetApprovalPolicyInput, ClosePeriodInput, ReopenPeriodInput } from '@/lib/validators/accounting.schema';
import type { StkPushInput , B2CInput } from '@/lib/validators/mpesa.schema';
import type { RegisterPayload, ChangePasswordPayload } from '@/lib/validators/auth.schema';
import type { CreateMemberPayload, UpdateMemberPayload, CreateNextOfKinPayload, UpdateNextOfKinPayload, UpdateMemberRoleInput, MemberStatusTransitionInput } from '@/lib/validators/member.schema';
import type { CreateContributionPayload, UpdateContributionPayload, SetSavingsLimitsPayload } from '@/lib/validators/contribution.schema';
import type { ApplyLoanPayload, LoanActionInput, RecordRepaymentPayload, SetLoanTermsPayload } from '@/lib/validators/loan.schema';
import type { SendSmsPayload, BulkSmsPayload, CampaignCreatePayload, TemplateCreatePayload, TemplateUpdatePayload, ScheduleCreatePayload } from '@/lib/validators/sms.schema';
import type { RecordManualPaymentPayload, UpgradePlanInput } from '@/lib/validators/billing.schema';
import type { DepositPayload, CreateProgramPayload, DisbursePayload, DisbursementActionInput, BrandingPayload } from '@/lib/validators/organization.schema';
import type { EffectiveTemplate } from '@/lib/services/posting-templates.service';
import type { EffectiveLoanTerms } from '@/lib/services/loan-policy.service';
import type { EffectiveFineSchedule } from '@/lib/services/fine-policy.service';
import type { EffectiveSavingsLimits } from '@/lib/services/savings-policy.service';
import type { MemberWalletSummary } from '@/lib/services/member-wallet.service';
import type { PassbookEntry } from '@/lib/services/member-passbook.service';
import type { MemberPassbookQueryInput } from '@/lib/validators/member-passbook.schema';
import type { MemberNotification } from '@/lib/services/member-notifications.service';
import type { MemberGoal } from '@/lib/services/member-goals.service';
import type {
  OrgWallet, FundingProgram, OrgDisbursement, ProgramBudgetLine, DonorSpendLine,
} from '@/lib/services/organization-finance.service';
import type {
  OrganizationMemberRow, OrganizationAuditLogRow, OrganizationBranding,
} from '@/lib/services/organization.service';
import type { CreateMemberGoalInput, UpdateMemberGoalInput, LogGoalProgressInput } from '@/lib/validators/member-goal.schema';

// ------------------------------------------------------------------
// Auth
// ------------------------------------------------------------------
export const authApi = {
  // Identifier may be a phone (07XX… / +254…) or an email address. When the
  // member is in multiple groups, the response is NeedsGroupSelection and the
  // client re-submits with `groupCode`.
  login: (body: { identifier: string; password: string; groupCode?: string }) =>
    api.post<LoginResult>('/auth/login', body),

  changePassword: (body: ChangePasswordPayload) =>
    api.post<{ changed: boolean }>('/auth/change-password', body),
  register: (body: RegisterPayload) =>
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

  // Self-service forgot-password — public, phone-only (mirrors the pattern
  // above). start() always resolves the same way regardless of whether the
  // phone belongs to an account.
  forgotPasswordStart: (phone: string) =>
    api.post<{ status: string }>('/auth/forgot-password/start', { phone }),

  forgotPasswordReset: (body: { phone: string; otp: string; password: string }) =>
    api.post<{ status: string }>('/auth/forgot-password/reset', body),

  // Step 1 of backoffice login. Returns one of:
  //   - AdminLoginEnrollmentChallenge (first-time staff: QR + recovery codes)
  //   - AdminLoginMfaChallenge        (enrolled staff: just prompt for code)
  //   - AdminLoginResponse            (legacy path; not reachable with MFA on)
  // The client narrows via isAdminEnrollment / isAdminMfaChallenge.
  // `surface` picks which allowed-role list the server checks
  // (SURFACE_ALLOWED_ROLES in the route) — 'platform' from /admin-login,
  // 'organization' from /enterprise/login. super_admin passes either.
  adminLogin: (body: { email: string; password: string; surface: 'platform' | 'organization' }) =>
    api.post<AdminLoginResult>('/auth/admin/login', body),

  // Step 2 of backoffice login: submit the 6-digit TOTP code (or a recovery
  // code) + the challenge token from step 1. On first-time enrollment the
  // client also echoes back the 10 plaintext recoveryCodes so they get
  // bcrypt-hashed + stored alongside the secret. Can also return
  // NeedsOrgSelection (multi-staff organizations, migration 101) — the
  // client shows an org chooser and re-submits with `organizationId`.
  adminLoginVerify: (body: {
    challenge:      string;
    code:           string;
    label?:         string;
    recoveryCodes?: string[];
    organizationId?: string;
  }) =>
    api.post<AdminLoginVerifyResult>('/auth/admin/login/verify', body),

  // Staff/backoffice forgot-password — public, email-link based (mirrors
  // forgotPasswordStart/Reset above, but for super_admin/support/
  // organization_coordinator accounts, which sign in with email not phone).
  adminForgotPasswordStart: (email: string) =>
    api.post<{ status: string }>('/auth/admin/forgot-password/start', { email }),

  adminForgotPasswordReset: (body: { token: string; password: string }) =>
    api.post<{ status: string }>('/auth/admin/forgot-password/reset', body),
};

// ------------------------------------------------------------------
// Organization staff invitations (Phase 2, migration 102) — fully public,
// unauthenticated flow reached only via an emailed link. Mirrors
// authApi.verifyEmailToken's shape: token-in-body, no access token.
// ------------------------------------------------------------------
export interface OrgInvitationLookup {
  id:               string;
  organizationId:   string;
  organizationName: string;
  email:            string;
  firstName:        string;
  lastName:         string;
  orgRole:          'lead' | 'staff';
  status:           string;
}

export const orgInvitationApi = {
  lookup: (token: string) =>
    api.post<OrgInvitationLookup>('/organization-invitations/lookup', { token }),

  confirmEmail: (token: string) =>
    api.post<{ phone: string }>('/organization-invitations/confirm-email', { token }),

  verifyOtp: (token: string, otp: string) =>
    api.post<{ status: string }>('/organization-invitations/verify-otp', { token, otp }),

  complete: (token: string, password: string) =>
    api.post<{ status: string }>('/organization-invitations/complete', { token, password }),

  decline: (token: string) =>
    api.post<{ status: string }>('/organization-invitations/decline', { token }),
};

// ------------------------------------------------------------------
// Me — the (member) self-service portal. Every route here is scoped to the
// signed-in member's own data (auth.userId), no id params, mirroring
// authApi's shape but under /me/*.
// ------------------------------------------------------------------
export const meApi = {
  wallet: () =>
    api.get<MemberWalletSummary>('/me/wallet'),

  passbook: (params?: Partial<MemberPassbookQueryInput>) =>
    api.get<PaginatedResult<PassbookEntry>>(`/me/passbook${buildQuery(params ?? {})}`),

  notifications: {
    list: (params?: { page?: number; limit?: number }) =>
      api.get<PaginatedResult<MemberNotification> & { unreadCount: number }>(`/me/notifications${buildQuery(params ?? {})}`),
    markRead: (id: string) =>
      api.patch<{ id: string }>(`/me/notifications/${id}`, {}),
    markAllRead: () =>
      api.post<{ status: string }>('/me/notifications/mark-all-read', {}),
  },

  goals: {
    list: () =>
      api.get<MemberGoal[]>('/me/goals'),
    create: (body: CreateMemberGoalInput) =>
      api.post<MemberGoal>('/me/goals', body),
    update: (id: string, body: UpdateMemberGoalInput) =>
      api.patch<MemberGoal>(`/me/goals/${id}`, body),
    delete: (id: string) =>
      api.delete<void>(`/me/goals/${id}`),
    logProgress: (id: string, body: LogGoalProgressInput) =>
      api.post<MemberGoal>(`/me/goals/${id}/progress`, body),
  },
};

// ------------------------------------------------------------------
// Members
// ------------------------------------------------------------------
export const membersApi = {
  list:   (params?: Record<string, unknown>) =>
    api.get<PaginatedResult<GroupMemberRow>>(`/members${buildQuery(params ?? {})}`),
  getById: (id: string) =>
    api.get<GroupMemberRow>(`/members/${id}`),
  create:  (body: CreateMemberPayload) =>
    api.post<GroupMemberRow>('/members', body),
  update:  (id: string, body: UpdateMemberPayload) =>
    api.patch<GroupMemberRow>(`/members/${id}`, body),
  updateRole: (id: string, role: UpdateMemberRoleInput['role']) =>
    api.put<unknown>(`/members/${id}`, { role }),
  deactivate: (id: string) =>
    api.delete<void>(`/members/${id}`),
  // Phase E2 — explicit state-machine transition with optional reason.
  // Use this instead of `deactivate()` so the audit columns are stamped.
  transitionStatus: (id: string, status: MemberStatusTransitionInput['status'], reason?: string) =>
    api.post<unknown>(`/members/${id}/status`, { status, reason }),
};

// Phase E2 — next-of-kin emergency contacts, scoped to a member.
export const nextOfKinApi = {
  list:   (memberId: string) =>
    api.get<unknown[]>(`/members/${memberId}/next-of-kin`),
  create: (memberId: string, body: CreateNextOfKinPayload) =>
    api.post<unknown>(`/members/${memberId}/next-of-kin`, body),
  update: (memberId: string, kinId: string, body: UpdateNextOfKinPayload) =>
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
  create:  (body: CreateContributionPayload) =>
    api.post<Contribution>('/contributions', body),
  update:  (id: string, body: UpdateContributionPayload) =>
    api.patch<Contribution>(`/contributions/${id}`, body),
  delete:  (id: string) =>
    api.delete<void>(`/contributions/${id}`),
  policy: () =>
    api.get<EffectiveSavingsLimits>('/contributions/policy'),
  setPolicy: (body: SetSavingsLimitsPayload) =>
    api.put<EffectiveSavingsLimits>('/contributions/policy', body),
  remindNonContributors: () =>
    api.post<{ attempted: number; sent: number; skipped: number; failed: number }>('/contributions/remind-non-contributors', {}),
};

// ------------------------------------------------------------------
// Loans
// ------------------------------------------------------------------
export const loansApi = {
  list:   (params?: Record<string, unknown>) =>
    api.get<PaginatedResult<Loan & { member_name: string }>>(`/loans${buildQuery(params ?? {})}`),
  getById: (id: string) =>
    api.get<Loan & { member_name: string; member_phone: string; schedule: LoanRepayment[] }>(`/loans/${id}`),
  apply:   (body: ApplyLoanPayload) =>
    api.post<Loan>('/loans', body),
  action:  (id: string, body: LoanActionInput) =>
    api.patch<Loan>(`/loans/${id}`, body),
  recordRepayment: (id: string, body: RecordRepaymentPayload) =>
    api.post<LoanRepayment>(`/loans/${id}/repayments`, body),
  policy: () =>
    api.get<EffectiveLoanTerms>('/loans/policy'),
  setPolicy: (body: SetLoanTermsPayload) =>
    api.put<EffectiveLoanTerms>('/loans/policy', body),
  // SIMPLIFICATION_AND_RBAC_AUDIT.md §4 — dashboard's "Upcoming Loan Repayments" card.
  upcomingRepayments: (limit = 5) =>
    api.get<(LoanRepayment & { member_name: string })[]>(`/loans/upcoming-repayments?limit=${limit}`),
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
  createAccount: (body: CreateAccountPayload) =>
    api.post<Account>('/accounting/accounts', body),
  journals: (params?: Record<string, unknown>) =>
    api.get<PaginatedResult<JournalEntry>>(`/accounting/journals${buildQuery(params ?? {})}`),
  createJournal: (body: CreateJournalPayload) =>
    api.post<unknown>('/accounting/journals', body),
  trialBalance: () =>
    api.get<TrialBalanceLine[]>('/accounting/reports?type=trial_balance'),
  profitAndLoss: (from: string, to: string) =>
    api.get<ProfitAndLoss>(`/accounting/reports?type=profit_and_loss&from=${from}&to=${to}`),
  balanceSheet:  (asOf?: string) =>
    api.get<BalanceSheet>(`/accounting/reports?type=balance_sheet${asOf ? `&asOf=${asOf}` : ''}`),
  fiscalPeriods: () =>
    api.get<FiscalPeriod[]>('/accounting/fiscal-periods'),
  closePeriod: (body: ClosePeriodInput) =>
    api.post<unknown>('/accounting/fiscal-periods', body),
  reopenPeriod: (id: string, body: ReopenPeriodInput) =>
    api.post<unknown>(`/accounting/fiscal-periods/${id}`, body),
  policies: () =>
    api.get<EffectiveThreshold[]>('/accounting/policies'),
  setPolicy: (body: SetApprovalPolicyInput) =>
    api.put<EffectiveThreshold[]>('/accounting/policies', body),
  cashFlow: (from: string, to: string) =>
    api.get<CashFlowStatement>(`/accounting/reports?type=cash_flow&from=${from}&to=${to}`),
  equityChanges: (from: string, to: string) =>
    api.get<EquityChanges>(`/accounting/reports?type=equity_changes&from=${from}&to=${to}`),
  postingTemplates: () =>
    api.get<EffectiveTemplate[]>('/accounting/posting-templates'),
  setPostingTemplate: (body: SetPostingTemplatePayload) =>
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
  send:       (body: SendSmsPayload) => api.post<unknown>('/sms/send', body),
  usage:      (params?: Record<string, unknown>) =>
    api.get<SmsUsageResult>(`/sms/usage${buildQuery(params ?? {})}`),
  // Bulk / Campaign
  bulk:       (body: BulkSmsPayload) => api.post<{ queued: number }>('/sms/bulk', body),
  campaigns:  (params?: Record<string, unknown>) =>
    api.get<PaginatedResult<SmsCampaign>>(`/sms/campaign${buildQuery(params ?? {})}`),
  createCampaign: (body: CampaignCreatePayload) => api.post<SmsCampaign>('/sms/campaign', body),
  cancelCampaign: (id: string)    => api.delete<void>(`/sms/campaign?id=${id}`),
  // Templates
  templates:       (params?: Record<string, unknown>) =>
    api.get<SmsTemplate[]>(`/sms/templates${buildQuery(params ?? {})}`),
  createTemplate:  (body: TemplateCreatePayload) => api.post<SmsTemplate>('/sms/templates', body),
  updateTemplate:  (id: string, body: TemplateUpdatePayload) => api.patch<SmsTemplate>(`/sms/templates?id=${id}`, body),
  deleteTemplate:  (id: string)    => api.delete<void>(`/sms/templates?id=${id}`),
  // Schedules
  schedules:       (params?: Record<string, unknown>) =>
    api.get<SmsSchedule[]>(`/sms/schedules${buildQuery(params ?? {})}`),
  createSchedule:  (body: ScheduleCreatePayload) => api.post<SmsSchedule>('/sms/schedules', body),
  updateSchedule:  (id: string, body: Partial<ScheduleCreatePayload>) => api.patch<SmsSchedule>(`/sms/schedules?id=${id}`, body),
  deleteSchedule:  (id: string)    => api.delete<void>(`/sms/schedules?id=${id}`),
  // Provider balance
  providerBalance: () => api.get<SmsProviderBalance>('/sms/balance'),
  checkBalance:    () => api.post<SmsProviderBalance>('/sms/balance', {}),
  // Tenant's own credit balance (distinct from the provider-wide balance above)
  creditBalance:   () => api.get<{ credits: string; rate: string }>('/sms/credits'),
  // DLR
  dlr: (messageId: string) => api.get<unknown>(`/sms/dlr?messageId=${messageId}`),
  // Self-service opt-out (SMS_MESSAGING_AUDIT_2026-08.md M5) — scoped to the
  // caller's own phone + active group.
  preferences:       () => api.get<{ optedOut: boolean }>('/sms/preferences'),
  setPreferences:    (optedOut: boolean) => api.put<{ optedOut: boolean }>('/sms/preferences', { optedOut }),
};

// ------------------------------------------------------------------
// Billing
// ------------------------------------------------------------------
export const billingApi = {
  plans:         () => api.get<{ plans: unknown[]; current: SubscriptionPublic | null }>('/billing/plans'),
  upgradePlan:   (planType: UpgradePlanInput['planType']) => api.post<unknown>('/billing/plans', { planType }),
  invoices:      () => api.get<unknown[]>('/billing/invoices'),
  recordPayment: (body: RecordManualPaymentPayload) => api.post<unknown>('/billing/payments', body),
  smsTopup:      (amount: number) => api.post<unknown>('/billing/payments', { type: 'sms_topup', amount }),
};

// ------------------------------------------------------------------
// M-Pesa
// ------------------------------------------------------------------
export const mpesaApi = {
  stkPush:   (body: StkPushInput) => api.post<{ checkoutRequestId: string; message: string }>('/mpesa/stk-push', body),
  pollStatus: (checkoutRequestId: string) =>
    api.get<{ status: string; mpesaReceiptNumber: string | null }>(`/mpesa/status?checkoutRequestId=${checkoutRequestId}`),
  b2c: (body: B2CInput) => api.post<unknown>('/mpesa/b2c', body),
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
  groups:  (params?: { page?: number; limit?: number }) =>
    api.get<PaginatedResult<OrganizationGroupSummary>>(`/organization/groups${buildQuery(params ?? {})}`),
  detail:  (groupId: string) => api.get<unknown>(`/organization/reports?groupId=${groupId}`),
  policies: () => api.get<EffectiveThreshold[]>('/organization/policies'),
  setPolicy: (body: SetApprovalPolicyInput) =>
    api.put<EffectiveThreshold[]>('/organization/policies', body),

  // ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md Phase 4 — disbursements page.
  // Backend (organization-finance.service.ts) already existed; this is the
  // first frontend client wiring for it.
  wallet: () => api.get<{ wallet: OrgWallet }>('/organization/wallet'),
  deposit: (body: DepositPayload) => api.post<unknown>('/organization/wallet', body),
  programs: () => api.get<{ items: FundingProgram[] }>('/organization/programs'),
  createProgram: (body: CreateProgramPayload) => api.post<FundingProgram>('/organization/programs', body),
  // Note: this route returns {items,total,page,limit} (organization-finance
  // .service.ts's own listDisbursements shape), not the {pageSize,totalPages}
  // shape PaginatedResult<T> elsewhere in this file assumes.
  disbursements: (params?: { page?: number; limit?: number }) =>
    api.get<{ items: OrgDisbursement[]; total: number; page: number; limit: number }>(
      `/organization/disbursements${buildQuery(params ?? {})}`,
    ),
  disburse: (body: DisbursePayload) =>
    api.post<OrgDisbursement & { needsApproval: boolean }>('/organization/disbursements', body),
  disbursementAction: (id: string, body: DisbursementActionInput) =>
    api.post<OrgDisbursement>(`/organization/disbursements/${id}`, body),

  // ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md Phase 4 — reports page. Both
  // reports already existed server-side (organization-finance.service.ts);
  // this is the first frontend wiring for either.
  budgetReport: () => api.get<{ items: ProgramBudgetLine[] }>('/organization/programs?report=budget'),
  donorSpendReport: () => api.get<{ items: DonorSpendLine[] }>('/organization/programs?report=donor'),

  // ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md Phase 4 — members page. New
  // backend (organization.service.ts's listMembers) — customer members
  // across the org's branches, distinct from organization staff.
  members: (params?: { page?: number; limit?: number; search?: string }) =>
    api.get<PaginatedResult<OrganizationMemberRow>>(`/organization/members${buildQuery(params ?? {})}`),

  // ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md Phase 4 — audit trail page. New
  // backend (organization.service.ts's listAuditLogs), joining the
  // platform-wide audit_logs table through organization_group_access.
  auditLogs: (params?: { page?: number; limit?: number; search?: string }) =>
    api.get<PaginatedResult<OrganizationAuditLogRow>>(`/organization/audit-logs${buildQuery(params ?? {})}`),

  // ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md Phase 4 — branding page.
  // New backend (migration 109 + organization.service.ts's getBranding/
  // setBranding). Scope: logo + primary color only (decision recorded in
  // the audit doc's Phase 4 section) — no custom domain.
  branding: () => api.get<OrganizationBranding>('/organization/branding'),
  setBranding: (body: BrandingPayload) =>
    api.put<OrganizationBranding>('/organization/branding', body),
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
