import { api } from './client';
import { buildQuery } from '@/lib/utils';
import type {
  LoginResponse, LoginResult, RefreshResponse, AdminLoginResponse,
  MemberPublic, SubscriptionPublic, NgoGroupSummary,
} from '@/types/api.types';
import type { PaginatedResult } from '@/types/db.types';

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

  logout:  (refreshToken?: string) =>
    api.post<void>('/auth/logout', { refreshToken }),

  // Backoffice login — separate endpoint for platform staff
  // (super_admin / support / ngo_coordinator). Email-only identifier;
  // returns a backoffice-audience JWT that only works on /api/admin/*.
  adminLogin: (body: { email: string; password: string }) =>
    api.post<AdminLoginResponse>('/auth/admin/login', body),
};

// ------------------------------------------------------------------
// Members
// ------------------------------------------------------------------
export const membersApi = {
  list:   (params?: Record<string, unknown>) =>
    api.get<PaginatedResult<MemberPublic>>(`/members${buildQuery(params ?? {})}`),
  getById: (id: string) =>
    api.get<MemberPublic>(`/members/${id}`),
  create:  (body: unknown) =>
    api.post<MemberPublic>('/members', body),
  update:  (id: string, body: unknown) =>
    api.patch<MemberPublic>(`/members/${id}`, body),
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
    api.get<PaginatedResult<unknown>>(`/contributions${buildQuery(params ?? {})}`),
  getById: (id: string) =>
    api.get<unknown>(`/contributions/${id}`),
  create:  (body: unknown) =>
    api.post<unknown>('/contributions', body),
  update:  (id: string, body: unknown) =>
    api.patch<unknown>(`/contributions/${id}`, body),
  delete:  (id: string) =>
    api.delete<void>(`/contributions/${id}`),
};

// ------------------------------------------------------------------
// Loans
// ------------------------------------------------------------------
export const loansApi = {
  list:   (params?: Record<string, unknown>) =>
    api.get<PaginatedResult<unknown>>(`/loans${buildQuery(params ?? {})}`),
  getById: (id: string) =>
    api.get<unknown>(`/loans/${id}`),
  apply:   (body: unknown) =>
    api.post<unknown>('/loans', body),
  action:  (id: string, body: unknown) =>
    api.patch<unknown>(`/loans/${id}`, body),
  recordRepayment: (id: string, body: unknown) =>
    api.post<unknown>(`/loans/${id}/repayments`, body),
};

// ------------------------------------------------------------------
// Accounting
// ------------------------------------------------------------------
export const accountingApi = {
  listAccounts: () =>
    api.get<unknown[]>('/accounting/accounts'),
  createAccount: (body: unknown) =>
    api.post<unknown>('/accounting/accounts', body),
  journals: (params?: Record<string, unknown>) =>
    api.get<PaginatedResult<unknown>>(`/accounting/journals${buildQuery(params ?? {})}`),
  createJournal: (body: unknown) =>
    api.post<unknown>('/accounting/journals', body),
  trialBalance: () =>
    api.get<unknown[]>('/accounting/reports?type=trial_balance'),
  profitAndLoss: (from: string, to: string) =>
    api.get<unknown>(`/accounting/reports?type=profit_and_loss&from=${from}&to=${to}`),
  balanceSheet:  (asOf?: string) =>
    api.get<unknown>(`/accounting/reports?type=balance_sheet${asOf ? `&asOf=${asOf}` : ''}`),
};

// ------------------------------------------------------------------
// SMS
// ------------------------------------------------------------------
export const smsApi = {
  send:       (body: unknown) => api.post<unknown>('/sms/send', body),
  usage:      (params?: Record<string, unknown>) =>
    api.get<unknown>(`/sms/usage${buildQuery(params ?? {})}`),
  // Bulk / Campaign
  bulk:       (body: unknown) => api.post<unknown>('/sms/bulk', body),
  campaigns:  (params?: Record<string, unknown>) =>
    api.get<unknown>(`/sms/campaign${buildQuery(params ?? {})}`),
  createCampaign: (body: unknown) => api.post<unknown>('/sms/campaign', body),
  cancelCampaign: (id: string)    => api.delete<void>(`/sms/campaign?id=${id}`),
  // Templates
  templates:       (params?: Record<string, unknown>) =>
    api.get<unknown>(`/sms/templates${buildQuery(params ?? {})}`),
  createTemplate:  (body: unknown) => api.post<unknown>('/sms/templates', body),
  updateTemplate:  (id: string, body: unknown) => api.patch<unknown>(`/sms/templates?id=${id}`, body),
  deleteTemplate:  (id: string)    => api.delete<void>(`/sms/templates?id=${id}`),
  // Schedules
  schedules:       (params?: Record<string, unknown>) =>
    api.get<unknown>(`/sms/schedules${buildQuery(params ?? {})}`),
  createSchedule:  (body: unknown) => api.post<unknown>('/sms/schedules', body),
  updateSchedule:  (id: string, body: unknown) => api.patch<unknown>(`/sms/schedules?id=${id}`, body),
  deleteSchedule:  (id: string)    => api.delete<void>(`/sms/schedules?id=${id}`),
  // Provider balance
  providerBalance: () => api.get<unknown>('/sms/balance'),
  checkBalance:    () => api.post<unknown>('/sms/balance', {}),
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
// NGO
// ------------------------------------------------------------------
export const ngoApi = {
  groups:  () => api.get<NgoGroupSummary[]>('/ngo/groups'),
  detail:  (groupId: string) => api.get<unknown>(`/ngo/reports?groupId=${groupId}`),
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
