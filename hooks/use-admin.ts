'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getStoredAccessToken } from '@/lib/api/client';
import type {
  getPlatformStats, getRevenueTrend, listGroups, getGroupById, updateGroupStatus,
  listPlatformUsers, updatePlatformUserRole, getBillingOverview,
  listSupportTickets, createSupportTicket, updateTicketStatus,
  listAuditLogs, listFeatureFlags, toggleFeatureFlag, getPlatformAnalytics,
} from '@/lib/services/admin.service';
import type {
  listOrganizations, getOrganizationDetail, createOrganization,
  setOrganizationActive, assignGroupToOrganization, revokeGroupFromOrganization,
} from '@/lib/services/admin-organizations.service';
import type {
  listOrgStaff, addOrgStaff,
} from '@/lib/services/organization-members.service';
import type { AssignableRole, AssignRoleResult } from '@/lib/services/member-roles.service';

// Response/request shapes derived directly from the service functions that
// back each route (`Awaited<ReturnType<typeof fn>>` / `Parameters<typeof fn>`)
// rather than hand-duplicated interfaces — stays in sync automatically if the
// service's return shape changes.
type PlatformStats            = Awaited<ReturnType<typeof getPlatformStats>>;
type RevenueTrend             = Awaited<ReturnType<typeof getRevenueTrend>>;
type AdminGroupList           = Awaited<ReturnType<typeof listGroups>>;
type AdminGroupDetail         = Awaited<ReturnType<typeof getGroupById>>;
type UpdateGroupResult        = Awaited<ReturnType<typeof updateGroupStatus>>;
type AdminOrgList             = Awaited<ReturnType<typeof listOrganizations>>;
type AdminOrgDetail           = Awaited<ReturnType<typeof getOrganizationDetail>>;
type CreateOrgInput           = Parameters<typeof createOrganization>[0];
type AdminOrgCreated          = Awaited<ReturnType<typeof createOrganization>>;
type SetOrgActiveResult       = Awaited<ReturnType<typeof setOrganizationActive>>;
type AssignGroupToOrgResult   = Awaited<ReturnType<typeof assignGroupToOrganization>>;
type RevokeGroupFromOrgResult = Awaited<ReturnType<typeof revokeGroupFromOrganization>>;
type OrgStaffList      = Awaited<ReturnType<typeof listOrgStaff>>;
// `invitedBy` is injected server-side from the caller's own auth context
// (see app/api/admin/organizations/[id]/staff/route.ts) — the client never
// supplies it.
type AddOrgStaffInput  = Omit<Parameters<typeof addOrgStaff>[1], 'invitedBy'>;
type AddOrgStaffResult = Awaited<ReturnType<typeof addOrgStaff>>;
type AdminUserList            = Awaited<ReturnType<typeof listPlatformUsers>>;
type UpdateUserRoleResult     = Awaited<ReturnType<typeof updatePlatformUserRole>>;
type BillingOverview          = Awaited<ReturnType<typeof getBillingOverview>>;
type SupportTicketList        = Awaited<ReturnType<typeof listSupportTickets>>;
type CreateTicketInput        = Parameters<typeof createSupportTicket>[0];
type CreatedTicket            = Awaited<ReturnType<typeof createSupportTicket>>;
type UpdatedTicket            = Awaited<ReturnType<typeof updateTicketStatus>>;
type AuditLogList             = Awaited<ReturnType<typeof listAuditLogs>>;
type FeatureFlagList          = Awaited<ReturnType<typeof listFeatureFlags>>;
type ToggleFeatureFlagResult  = Awaited<ReturnType<typeof toggleFeatureFlag>>;
type PlatformAnalytics        = Awaited<ReturnType<typeof getPlatformAnalytics>>;

export async function adminFetch<T>(
  path: string,
  opts?: { method?: string; json?: unknown },
): Promise<T> {
  // The proxy rejects every /api/admin/* request without a Bearer token, so
  // the backoffice session token MUST ride along. Without this header every
  // admin widget 401s and the portal renders zeros instead of live data.
  const headers: Record<string, string> = {};
  const token = getStoredAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (opts?.json) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    method: opts?.method ?? 'GET',
    headers,
    body: opts?.json ? JSON.stringify(opts.json) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? 'Request failed');
  // Admin routes return the standard { success, data } envelope. Unwrap it so
  // callers get the payload directly (pages read `data.items`, not
  // `data.data.items`). Fall back to the raw body for any un-enveloped route.
  return (json && typeof json === 'object' && 'success' in json && 'data' in json)
    ? (json.data as T)
    : (json as T);
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform dashboard
// ─────────────────────────────────────────────────────────────────────────────
export function useAdminDashboard() {
  return useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn:  () => adminFetch<PlatformStats>('/api/admin/dashboard'),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export function useAdminRevenueTrend() {
  return useQuery({
    queryKey: ['admin', 'revenue-trend'],
    queryFn:  () => adminFetch<RevenueTrend>('/api/admin/dashboard?widget=revenue_trend'),
    staleTime: 300_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Groups (the platform tenants / chamas)
// ─────────────────────────────────────────────────────────────────────────────
export function useAdminGroups(params: {
  page?: number; limit?: number; search?: string; status?: string; plan?: string;
} = {}) {
  const p = new URLSearchParams();
  if (params.page)   p.set('page',   String(params.page));
  if (params.limit)  p.set('limit',  String(params.limit));
  if (params.search) p.set('search', params.search);
  if (params.status) p.set('status', params.status);
  if (params.plan)   p.set('plan',   params.plan);

  return useQuery({
    queryKey: ['admin', 'groups', params],
    queryFn:  () => adminFetch<AdminGroupList>(`/api/admin/groups?${p}`),
    staleTime: 30_000,
  });
}

export function useAdminGroup(id: string) {
  return useQuery({
    queryKey: ['admin', 'groups', id],
    queryFn:  () => adminFetch<AdminGroupDetail>(`/api/admin/groups/${id}`),
    enabled:  !!id,
  });
}

export function useUpdateGroupStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: string; reason?: string }) =>
      adminFetch<UpdateGroupResult>(`/api/admin/groups/${id}`, { method: 'PATCH', json: { action, reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'groups'] });
      qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Organizations (federating bodies — banks, SACCOs, foundations)
// ─────────────────────────────────────────────────────────────────────────────
export function useAdminOrganizations(params: {
  page?: number; limit?: number; search?: string; type?: string; status?: string;
} = {}) {
  const p = new URLSearchParams();
  if (params.page)   p.set('page',   String(params.page));
  if (params.limit)  p.set('limit',  String(params.limit));
  if (params.search) p.set('search', params.search);
  if (params.type)   p.set('type',   params.type);
  if (params.status) p.set('status', params.status);

  return useQuery({
    queryKey: ['admin', 'organizations', params],
    queryFn:  () => adminFetch<AdminOrgList>(`/api/admin/organizations?${p}`),
    staleTime: 30_000,
  });
}

export function useAdminOrganization(id: string) {
  return useQuery({
    queryKey: ['admin', 'organizations', id],
    queryFn:  () => adminFetch<AdminOrgDetail>(`/api/admin/organizations/${id}`),
    enabled:  !!id,
  });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateOrgInput) =>
      adminFetch<AdminOrgCreated>('/api/admin/organizations', { method: 'POST', json: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });
}

export function useUpdateOrganizationStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'deactivate' }) =>
      adminFetch<SetOrgActiveResult>(`/api/admin/organizations/${id}`, { method: 'PATCH', json: { action } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });
}

export function useAssignGroupToOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, groupId, accessLevel }: { orgId: string; groupId: string; accessLevel?: string }) =>
      adminFetch<AssignGroupToOrgResult>(`/api/admin/organizations/${orgId}/groups`, {
        method: 'POST', json: { groupId, accessLevel },
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations', v.orgId] });
      qc.invalidateQueries({ queryKey: ['admin', 'organizations'] });
    },
  });
}

export function useRevokeGroupFromOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, groupId }: { orgId: string; groupId: string }) =>
      adminFetch<RevokeGroupFromOrgResult>(`/api/admin/organizations/${orgId}/groups?groupId=${groupId}`, {
        method: 'DELETE',
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations', v.orgId] });
      qc.invalidateQueries({ queryKey: ['admin', 'organizations'] });
    },
  });
}

// Multi-staff organizations (migration 101).
export function useOrgStaff(orgId: string) {
  return useQuery({
    queryKey: ['admin', 'organizations', orgId, 'staff'],
    queryFn:  () => adminFetch<OrgStaffList>(`/api/admin/organizations/${orgId}/staff`),
    enabled:  !!orgId,
  });
}

export function useAddOrgStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, ...body }: { orgId: string } & AddOrgStaffInput) =>
      adminFetch<AddOrgStaffResult>(`/api/admin/organizations/${orgId}/staff`, {
        method: 'POST', json: body,
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations', v.orgId, 'staff'] });
    },
  });
}

export function useChangeOrgStaffRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, memberId, orgRole }: { orgId: string; memberId: string; orgRole: 'lead' | 'staff' }) =>
      adminFetch<{ success: true }>(`/api/admin/organizations/${orgId}/staff/${memberId}`, {
        method: 'PATCH', json: { orgRole },
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations', v.orgId, 'staff'] });
    },
  });
}

export function useRemoveOrgStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, memberId }: { orgId: string; memberId: string }) =>
      adminFetch<{ success: true }>(`/api/admin/organizations/${orgId}/staff/${memberId}`, {
        method: 'DELETE',
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations', v.orgId, 'staff'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────────────
export function useAdminUsers(params: {
  page?: number; limit?: number; search?: string; role?: string;
} = {}) {
  const p = new URLSearchParams();
  if (params.page)   p.set('page',   String(params.page));
  if (params.limit)  p.set('limit',  String(params.limit));
  if (params.search) p.set('search', params.search);
  if (params.role)   p.set('role',   params.role);

  return useQuery({
    queryKey: ['admin', 'users', params],
    queryFn:  () => adminFetch<AdminUserList>(`/api/admin/users?${p}`),
    staleTime: 30_000,
  });
}

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, platformRole }: { id: string; platformRole: string }) =>
      adminFetch<UpdateUserRoleResult>(`/api/admin/users/${id}`, { method: 'PATCH', json: { platformRole } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

// ── Group-level role assignment (Super Admin) ──────────────────────────────
export function useAssignableRoles(groupId?: string | null) {
  return useQuery({
    queryKey: ['admin', 'assignable-roles', groupId],
    queryFn:  () => adminFetch<{ items: AssignableRole[] }>(`/api/admin/roles?groupId=${groupId}`),
    enabled:  !!groupId,
    staleTime: 5 * 60_000,
  });
}

export function useAssignGroupRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, groupId, roleId }: { memberId: string; groupId: string; roleId: string }) =>
      adminFetch<AssignRoleResult>(`/api/admin/members/${memberId}/role`, {
        method: 'POST',
        json: { groupId, roleId },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      qc.invalidateQueries({ queryKey: ['admin', 'audit-logs'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Billing
// ─────────────────────────────────────────────────────────────────────────────
export function useAdminBilling() {
  return useQuery({
    queryKey: ['admin', 'billing'],
    queryFn:  () => adminFetch<BillingOverview>('/api/admin/billing'),
    staleTime: 60_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Support tickets
// ─────────────────────────────────────────────────────────────────────────────
export function useAdminTickets(params: {
  page?: number; limit?: number; status?: string; priority?: string; search?: string;
} = {}) {
  const p = new URLSearchParams();
  if (params.page)     p.set('page',     String(params.page));
  if (params.limit)    p.set('limit',    String(params.limit));
  if (params.status)   p.set('status',   params.status);
  if (params.priority) p.set('priority', params.priority);
  if (params.search)   p.set('search',   params.search);

  return useQuery({
    queryKey: ['admin', 'tickets', params],
    queryFn:  () => adminFetch<SupportTicketList>(`/api/admin/support?${p}`),
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTicketInput) =>
      adminFetch<CreatedTicket>('/api/admin/support', { method: 'POST', json: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tickets'] }),
  });
}

export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; status: string; resolution?: string }) =>
      adminFetch<UpdatedTicket>(`/api/admin/support/${id}`, { method: 'PATCH', json: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'tickets'] });
      qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit logs
// ─────────────────────────────────────────────────────────────────────────────
export function useAuditLogs(params: {
  page?: number; limit?: number; groupId?: string;
  action?: string; table?: string; search?: string;
  from?: string; to?: string;
} = {}) {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) p.set(k, String(v)); });

  return useQuery({
    queryKey: ['admin', 'audit-logs', params],
    queryFn:  () => adminFetch<AuditLogList>(`/api/admin/audit-logs?${p}`),
    staleTime: 30_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────────────
export function useAdminAnalytics() {
  return useQuery({
    queryKey: ['admin', 'analytics'],
    queryFn:  () => adminFetch<PlatformAnalytics>('/api/admin/analytics'),
    staleTime: 300_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature flags
// ─────────────────────────────────────────────────────────────────────────────
export function useFeatureFlags() {
  return useQuery({
    queryKey: ['admin', 'feature-flags'],
    queryFn:  () => adminFetch<FeatureFlagList>('/api/admin/feature-flags'),
    staleTime: 60_000,
  });
}

export function useToggleFeatureFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      adminFetch<ToggleFeatureFlagResult>('/api/admin/feature-flags', { method: 'PATCH', json: { key, enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'feature-flags'] }),
  });
}
