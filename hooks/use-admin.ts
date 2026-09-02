'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getStoredAccessToken } from '@/lib/api/client';
import type {
  getPlatformStats, getRevenueTrend, listGroups, getGroupById, updateGroupStatus,
  listPlatformUsers, updatePlatformUserRole, getBillingOverview,
  listSupportTickets, createSupportTicket, updateTicketStatus,
  listAuditLogs, listFeatureFlags, toggleFeatureFlag, getPlatformAnalytics,
  listGroupMembers, getAdminMemberDetail,
  listUnroutedPayments, resolveUnroutedPayment,
} from '@/lib/services/admin.service';
import type {
  listOrganizations, getOrganizationDetail, createOrganization,
  setOrganizationActive, assignGroupToOrganization, revokeGroupFromOrganization,
  compareOrganizations,
} from '@/lib/services/admin-organizations.service';
import type {
  listOrgStaff, addOrgStaff, createOrgInvitation, listOrgInvitations, resendOrgInvitation,
} from '@/lib/services/organization-members.service';
import type { AssignableRole, AssignRoleResult } from '@/lib/services/member-roles.service';
import type { SubscriptionProduct, OrganizationPlanType, PlanType, BillingCycle } from '@/types/enums';
import type { AdminLoginResponse } from '@/types/api.types';
import type {
  listGovernanceAlerts, acknowledgeAlert, resolveAlert, getGroupGovernanceSnapshot,
} from '@/lib/services/governance.service';
import type { searchPlatform } from '@/lib/services/admin-search.service';
import type {
  getPricingConfig, setActiveTiers, setProviderCost,
} from '@/lib/services/sms-pricing-admin.service';
import type {
  getMarginSummary, getTopCustomers, getTierViability, getOrganizationUsage,
} from '@/lib/services/sms-margin.service';
import type { TopUpSmsCreditsInput } from '@/lib/validators/organization.schema';
import type {
  getOrganizationPlan, assignOrganizationPlan, CustomPlanTerms,
} from '@/lib/services/organization-plan.service';
import type { getCountyAggregation, getWardAggregation } from '@/lib/services/admin-geography.service';

// Response/request shapes derived directly from the service functions that
// back each route (`Awaited<ReturnType<typeof fn>>` / `Parameters<typeof fn>`)
// rather than hand-duplicated interfaces — stays in sync automatically if the
// service's return shape changes.
type PlatformStats            = Awaited<ReturnType<typeof getPlatformStats>>;
type RevenueTrend             = Awaited<ReturnType<typeof getRevenueTrend>>;
type AdminGroupList           = Awaited<ReturnType<typeof listGroups>>;
type AdminGroupDetail         = Awaited<ReturnType<typeof getGroupById>>;
type UpdateGroupResult        = Awaited<ReturnType<typeof updateGroupStatus>>;
type AdminGroupMemberList     = Awaited<ReturnType<typeof listGroupMembers>>;
type AdminMemberDetail        = Awaited<ReturnType<typeof getAdminMemberDetail>>;
type AdminOrgList             = Awaited<ReturnType<typeof listOrganizations>>;
type AdminOrgDetail           = Awaited<ReturnType<typeof getOrganizationDetail>>;
// The route's request body is WIDER than createOrganization()'s own service
// signature — it also requires a plan (organization-plan.service.ts's own
// assignOrganizationPlan is a deliberately separate call the route makes
// second). Deriving only from createOrganization here would silently drop
// the plan fields from the type and let the client build a body the route
// rejects — exactly the drift CLIENT_SERVER_CONTRACT_AUDIT_2026-08.md exists
// to catch, so this is composed from both real signatures instead of one.
type CreateOrgInput = Parameters<typeof createOrganization>[0] & {
  planType:  OrganizationPlanType;
  custom?:   CustomPlanTerms;
  planNotes?: string;
};
type AdminOrgCreated          = Awaited<ReturnType<typeof createOrganization>>;
type AdminOrgPlan             = Awaited<ReturnType<typeof getOrganizationPlan>>;
type AssignOrgPlanResult      = Awaited<ReturnType<typeof assignOrganizationPlan>>;
type SetOrgActiveResult       = Awaited<ReturnType<typeof setOrganizationActive>>;
type AssignGroupToOrgResult   = Awaited<ReturnType<typeof assignGroupToOrganization>>;
type RevokeGroupFromOrgResult = Awaited<ReturnType<typeof revokeGroupFromOrganization>>;
type OrgComparisonList        = Awaited<ReturnType<typeof compareOrganizations>>;
type OrgStaffList      = Awaited<ReturnType<typeof listOrgStaff>>;
// `invitedBy` is injected server-side from the caller's own auth context
// (see app/api/admin/organizations/[id]/staff/route.ts) — the client never
// supplies it.
type AddOrgStaffInput  = Omit<Parameters<typeof addOrgStaff>[1], 'invitedBy'>;
type AddOrgStaffResult = Awaited<ReturnType<typeof addOrgStaff>>;
// `invitedBy` is injected server-side, same as AddOrgStaffInput above.
type InviteOrgStaffInput  = Omit<Parameters<typeof createOrgInvitation>[1], 'invitedBy'>;
type InviteOrgStaffResult = Awaited<ReturnType<typeof createOrgInvitation>>;
type OrgInvitationList    = Awaited<ReturnType<typeof listOrgInvitations>>;
type ResendInvitationResult = Awaited<ReturnType<typeof resendOrgInvitation>>;

// No service layer backs these two (mirrors GET /api/v1/auth/memberships'
// own inline-query shape on the tenant side) — plain interfaces instead of
// the Awaited<ReturnType<...>> derivation used everywhere else in this file.
export interface MyOrganizationSummary {
  organizationId:   string;
  organizationName: string;
  organizationType: string;
  orgRole:          'lead' | 'staff';
}
// Same response shape admin-login itself returns — switching orgs mints a
// full replacement session, so loginAdmin() can consume it directly.
export type SwitchOrgResult = AdminLoginResponse;
type AdminUserList            = Awaited<ReturnType<typeof listPlatformUsers>>;
type UpdateUserRoleResult     = Awaited<ReturnType<typeof updatePlatformUserRole>>;
type BillingOverview          = Awaited<ReturnType<typeof getBillingOverview>>;
type SupportTicketList        = Awaited<ReturnType<typeof listSupportTickets>>;
type UnroutedPaymentList      = Awaited<ReturnType<typeof listUnroutedPayments>>;
type ResolveUnroutedResult    = Awaited<ReturnType<typeof resolveUnroutedPayment>>;
type CreateTicketInput        = Parameters<typeof createSupportTicket>[0];
type CreatedTicket            = Awaited<ReturnType<typeof createSupportTicket>>;
type UpdatedTicket            = Awaited<ReturnType<typeof updateTicketStatus>>;
type AuditLogList             = Awaited<ReturnType<typeof listAuditLogs>>;
type FeatureFlagList          = Awaited<ReturnType<typeof listFeatureFlags>>;
type ToggleFeatureFlagResult  = Awaited<ReturnType<typeof toggleFeatureFlag>>;
type PlatformAnalytics        = Awaited<ReturnType<typeof getPlatformAnalytics>>;
type GovernanceAlertList      = Awaited<ReturnType<typeof listGovernanceAlerts>>;
type AcknowledgedAlert        = Awaited<ReturnType<typeof acknowledgeAlert>>;
type ResolvedAlert            = Awaited<ReturnType<typeof resolveAlert>>;
type GroupGovernanceSnapshot  = Awaited<ReturnType<typeof getGroupGovernanceSnapshot>>;
type PlatformSearchResults    = Awaited<ReturnType<typeof searchPlatform>>;
type SmsPricingConfig         = Awaited<ReturnType<typeof getPricingConfig>>;
type SmsTiersActivated        = Awaited<ReturnType<typeof setActiveTiers>>;
type SmsProviderCostSaved     = Awaited<ReturnType<typeof setProviderCost>>;
type SmsMarginSummary         = Awaited<ReturnType<typeof getMarginSummary>>;
type SmsGroupUsageList        = Awaited<ReturnType<typeof getTopCustomers>>;
type SmsTierViabilityList     = Awaited<ReturnType<typeof getTierViability>>;
type SmsOrganizationUsageList = Awaited<ReturnType<typeof getOrganizationUsage>>;
export interface SmsMarginResponse {
  summary:        SmsMarginSummary;
  topCustomers:   SmsGroupUsageList;
  tiers:          SmsTierViabilityList;
  byOrganization: SmsOrganizationUsageList;
}
type CountyAggregationList    = Awaited<ReturnType<typeof getCountyAggregation>>;
type WardAggregationList      = Awaited<ReturnType<typeof getWardAggregation>>;

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
  /** Which product's plan the list shows and the `plan` filter applies to. */
  product?: SubscriptionProduct;
} = {}) {
  const p = new URLSearchParams();
  if (params.page)    p.set('page',    String(params.page));
  if (params.limit)   p.set('limit',   String(params.limit));
  if (params.search)  p.set('search',  params.search);
  if (params.status)  p.set('status',  params.status);
  if (params.plan)    p.set('plan',    params.plan);
  if (params.product) p.set('product', params.product);

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

// Member drill-down (SUPER_ADMIN_PLATFORM_AUDIT.md §2.6/§2.7 Phase 1).
export function useAdminGroupMembers(groupId: string, page: number) {
  return useQuery({
    queryKey: ['admin', 'groups', groupId, 'members', page],
    queryFn:  () => adminFetch<AdminGroupMemberList>(`/api/admin/groups/${groupId}/members?page=${page}&limit=25`),
    enabled:  !!groupId,
  });
}

export function useAdminMemberDetail(groupId: string, memberId: string) {
  return useQuery({
    queryKey: ['admin', 'groups', groupId, 'members', memberId],
    queryFn:  () => adminFetch<AdminMemberDetail>(`/api/admin/groups/${groupId}/members/${memberId}`),
    enabled:  !!groupId && !!memberId,
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

/**
 * Correct a group's profile — the typo path, distinct from the status
 * transitions above. The route branches on whether the body carries `action`,
 * so these must never be merged into one mutation.
 *
 * A rename can collide with uq_group_name_per_county and comes back as a 409
 * with a readable message; the caller surfaces it rather than retrying.
 */
export interface UpdateGroupProfileInput {
  name?:             string;
  type?:             string;
  subCounty?:        string | null;
  ward?:             string | null;
  villageEstate?:    string | null;
  meetingFrequency?: string | null;
  meetingDay?:       string | null;
  meetingTime?:      string | null;
}

export function useUpdateGroupProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateGroupProfileInput & { id: string }) =>
      adminFetch<UpdateGroupResult>(`/api/admin/groups/${id}`, { method: 'PATCH', json: body }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'group', vars.id] });
      qc.invalidateQueries({ queryKey: ['admin', 'groups'] });
    },
  });
}

/**
 * Correct a member's name or email.
 *
 * PHONE IS NOT EDITABLE and is not in this type. It is the login identity and
 * UNIQUE platform-wide, so changing it changes who can sign in — a different
 * operation from fixing a typo. The route's schema is strict(), so sending it
 * would 400 rather than be silently dropped.
 */
export interface UpdateMemberProfileInput {
  firstName?: string;
  lastName?:  string;
  email?:     string | null;
}

export function useUpdateMemberProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, memberId, ...body }: UpdateMemberProfileInput & { groupId: string; memberId: string }) =>
      adminFetch<unknown>(`/api/admin/groups/${groupId}/members/${memberId}`, { method: 'PATCH', json: body }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'member', vars.memberId] });
      qc.invalidateQueries({ queryKey: ['admin', 'group', vars.groupId] });
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

export function useOrganizationComparison() {
  return useQuery({
    queryKey: ['admin', 'organizations', 'compare'],
    queryFn:  () => adminFetch<OrgComparisonList>('/api/admin/organizations/compare'),
    staleTime: 60_000,
  });
}

export function useCountyGeography() {
  return useQuery({
    queryKey: ['admin', 'geography', 'counties'],
    queryFn:  () => adminFetch<CountyAggregationList>('/api/admin/geography/counties'),
    staleTime: 60_000,
  });
}

export function useWardGeography(countyId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'geography', 'counties', countyId, 'wards'],
    queryFn:  () => adminFetch<WardAggregationList>(`/api/admin/geography/counties/${countyId}/wards`),
    enabled:  enabled && !!countyId,
    staleTime: 60_000,
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

/** Current plan + usage-vs-caps for one organization (super_admin/support). */
export function useOrganizationPlan(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'organization', organizationId, 'plan'],
    queryFn:  () => adminFetch<AdminOrgPlan>(`/api/admin/organizations/${organizationId}/plan`),
    enabled:  !!organizationId,
    staleTime: 30_000,
  });
}

/** super_admin assigns or changes an organization's plan — never self-serve. */
export function useAssignOrganizationPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ organizationId, ...body }: {
      organizationId: string; planType: OrganizationPlanType; custom?: CustomPlanTerms; notes?: string;
    }) =>
      adminFetch<AssignOrgPlanResult>(`/api/admin/organizations/${organizationId}/plan`, { method: 'POST', json: body }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'organization', vars.organizationId, 'plan'] });
      qc.invalidateQueries({ queryKey: ['admin', 'organizations'] });
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

// ─────────────────────────────────────────────────────────────────────────────
// Backoffice org-switching (migration 101, WorkspaceSwitcher) — for staff
// active at more than one organization. Mirrors GET /api/v1/auth/memberships
// + POST /api/v1/auth/switch-group's role on the tenant side.
// ─────────────────────────────────────────────────────────────────────────────
export function useMyOrganizations() {
  return useQuery({
    queryKey: ['admin', 'auth', 'my-organizations'],
    queryFn:  () => adminFetch<{ items: MyOrganizationSummary[] }>('/api/admin/auth/my-organizations'),
  });
}

export function useSwitchOrg() {
  return useMutation({
    mutationFn: (organizationId: string) =>
      adminFetch<SwitchOrgResult>('/api/admin/auth/switch-org', { method: 'POST', json: { organizationId } }),
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

export function useInviteOrgStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, ...body }: { orgId: string } & InviteOrgStaffInput) =>
      adminFetch<InviteOrgStaffResult>(`/api/admin/organizations/${orgId}/staff/invite`, {
        method: 'POST', json: body,
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations', v.orgId, 'staff'] });
      qc.invalidateQueries({ queryKey: ['admin', 'organizations', v.orgId, 'invitations'] });
    },
  });
}

export function useOrgInvitations(orgId: string) {
  return useQuery({
    queryKey: ['admin', 'organizations', orgId, 'invitations'],
    queryFn:  () => adminFetch<OrgInvitationList>(`/api/admin/organizations/${orgId}/staff/invitations`),
    enabled:  !!orgId,
  });
}

export function useResendOrgInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, invitationId }: { orgId: string; invitationId: string }) =>
      adminFetch<ResendInvitationResult>(`/api/admin/organizations/${orgId}/staff/invitations/${invitationId}/resend`, {
        method: 'POST',
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations', v.orgId, 'invitations'] });
    },
  });
}

export function useCancelOrgInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, invitationId }: { orgId: string; invitationId: string }) =>
      adminFetch<{ id: string }>(`/api/admin/organizations/${orgId}/staff/invitations/${invitationId}`, {
        method: 'DELETE',
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations', v.orgId, 'invitations'] });
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
// Unrouted M-Pesa payments — see the note on listUnroutedPayments/
// resolveUnroutedPayment in admin.service.ts for why this exists alongside
// the treasurer-facing use-mpesa hooks: those can't reach a row with no
// candidate_group_id, which is most of this queue.
// ─────────────────────────────────────────────────────────────────────────────
export function useAdminUnroutedPayments(params: { page?: number; limit?: number; search?: string } = {}) {
  const p = new URLSearchParams();
  if (params.page)   p.set('page',   String(params.page));
  if (params.limit)  p.set('limit',  String(params.limit));
  if (params.search) p.set('search', params.search);

  return useQuery({
    queryKey: ['admin', 'mpesa-unrouted', params],
    queryFn:  () => adminFetch<UnroutedPaymentList>(`/api/admin/mpesa/unrouted?${p}`),
    staleTime: 20_000,
  });
}

export function useResolveUnroutedPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: {
      id: string; action: 'allocate' | 'dismiss' | 'activate_subscription';
      groupId?: string; memberId?: string; notes?: string;
      planType?: PlanType; product?: SubscriptionProduct; billingCycle?: BillingCycle;
    }) =>
      adminFetch<ResolveUnroutedResult>(`/api/admin/mpesa/unrouted/${id}`, { method: 'PATCH', json: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'mpesa-unrouted'] }),
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

// ─────────────────────────────────────────────────────────────────────────────
// Governance / health-scoring
// ─────────────────────────────────────────────────────────────────────────────
export function useGovernanceAlerts(params: {
  page?: number; limit?: number; status?: string; severity?: string; groupId?: string;
} = {}) {
  const p = new URLSearchParams();
  if (params.page)     p.set('page',     String(params.page));
  if (params.limit)    p.set('limit',    String(params.limit));
  if (params.status)   p.set('status',   params.status);
  if (params.severity) p.set('severity', params.severity);
  if (params.groupId)  p.set('groupId',  params.groupId);

  return useQuery({
    queryKey: ['admin', 'governance', 'alerts', params],
    queryFn:  () => adminFetch<GovernanceAlertList>(`/api/admin/governance/alerts?${p}`),
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
}

export function useAcknowledgeGovernanceAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      adminFetch<AcknowledgedAlert>(`/api/admin/governance/alerts/${id}`, { method: 'PATCH', json: { status: 'acknowledged' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'governance', 'alerts'] }),
  });
}

export function useResolveGovernanceAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      adminFetch<ResolvedAlert>(`/api/admin/governance/alerts/${id}`, { method: 'PATCH', json: { status: 'resolved' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'governance', 'alerts'] }),
  });
}

export function useGroupGovernanceSnapshot(groupId: string) {
  return useQuery({
    queryKey: ['admin', 'governance', 'snapshot', groupId],
    queryFn:  () => adminFetch<GroupGovernanceSnapshot>(`/api/admin/governance/snapshots?groupId=${groupId}`),
    enabled: !!groupId,
    staleTime: 60_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SMS pricing configuration (spec §12, super_admin only)
//
// These exist because the pricing screen originally called the api client
// (`api.get('/admin/sms-pricing')`), which prefixes every path with `/api/v1`.
// That sent a BACKOFFICE-audience token at a TENANT-audience URL, so proxy.ts
// rejected all three calls with "This route requires a tenant session. Sign in
// at /login." before Next could even report that no such route exists — a
// super_admin who was correctly signed in saw a sign-in error on a screen that
// had never once loaded. adminFetch is the only client that speaks to
// /api/admin/*; going through it is what makes the URL right by construction.
// See docs/audits/PRODUCT_CONCORDANCE_AUDIT_2026-08.md §3.2.
// ─────────────────────────────────────────────────────────────────────────────
export function useSmsPricingConfig() {
  return useQuery({
    queryKey: ['admin', 'sms-pricing'],
    queryFn:  () => adminFetch<SmsPricingConfig>('/api/admin/sms-pricing'),
    staleTime: 60_000,
  });
}

export function useActivateSmsTiers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tierIds: string[]) =>
      adminFetch<SmsTiersActivated>('/api/admin/sms-pricing', {
        method: 'POST',
        json: { kind: 'activate_tiers', tierIds },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'sms-pricing'] }),
  });
}

export function useSetSmsProviderCost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (unitCost: number) =>
      adminFetch<SmsProviderCostSaved>('/api/admin/sms-pricing', {
        method: 'POST',
        json: { kind: 'provider_cost', unitCost },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'sms-pricing'] }),
  });
}

/**
 * SMS revenue, margin, and per-group/per-organization usage (spec §15,
 * INTERNAL — super_admin only). Backs the "Revenue & Usage" tab on the SMS
 * Pricing page. `byOrganization`'s revenue is real once an organization has
 * a top-up recorded (useAdminTopUpOrganizationSmsCredits below) — before
 * that it's a genuine zero, not a placeholder (see sms-margin.service.ts).
 */
export function useSmsMargin(from?: string, to?: string) {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to)   qs.set('to', to);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return useQuery({
    queryKey: ['admin', 'sms-margin', from ?? null, to ?? null],
    queryFn:  () => adminFetch<SmsMarginResponse>(`/api/admin/sms-margin${suffix}`),
    staleTime: 60_000,
  });
}

/**
 * super_admin corrects/grants an organization's SMS balance — previously
 * impossible; there was no admin tool to touch this at all. Same underlying
 * function as an organization_coordinator's own self-serve top-up, just
 * addressed by org id instead of the caller's own auth context.
 */
export function useAdminTopUpOrganizationSmsCredits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ organizationId, ...body }: TopUpSmsCreditsInput & { organizationId: string }) =>
      adminFetch<{ creditsAdded: number; newBalance: number; rateApplied: number }>(
        `/api/admin/organizations/${organizationId}/sms-credits`, { method: 'POST', json: body },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'sms-margin'] }),
  });
}

/** super_admin sets an organization's negotiated per-SMS rate — never writable before this. */
export function useSetOrganizationSmsRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ organizationId, rate }: { organizationId: string; rate: number }) =>
      adminFetch<{ organizationId: string; rate: number }>(
        `/api/admin/organizations/${organizationId}/sms-rate`, { method: 'POST', json: { rate } },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'sms-margin'] }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified cross-entity search (command palette)
// ─────────────────────────────────────────────────────────────────────────────
export function useAdminSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ['admin', 'search', q],
    queryFn:  () => adminFetch<PlatformSearchResults>(`/api/admin/search?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
    staleTime: 15_000,
  });
}
