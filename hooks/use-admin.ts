'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

async function adminFetch<T>(
  path: string,
  opts?: { method?: string; json?: unknown },
): Promise<T> {
  const res = await fetch(path, {
    method: opts?.method ?? 'GET',
    headers: opts?.json ? { 'Content-Type': 'application/json' } : {},
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
    queryFn:  () => adminFetch<any>('/api/admin/dashboard'),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export function useAdminRevenueTrend() {
  return useQuery({
    queryKey: ['admin', 'revenue-trend'],
    queryFn:  () => adminFetch<any>('/api/admin/dashboard?widget=revenue_trend'),
    staleTime: 300_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Organizations
// ─────────────────────────────────────────────────────────────────────────────
export function useAdminOrganizations(params: {
  page?: number; limit?: number; search?: string; status?: string; plan?: string;
} = {}) {
  const p = new URLSearchParams();
  if (params.page)   p.set('page',   String(params.page));
  if (params.limit)  p.set('limit',  String(params.limit));
  if (params.search) p.set('search', params.search);
  if (params.status) p.set('status', params.status);
  if (params.plan)   p.set('plan',   params.plan);

  return useQuery({
    queryKey: ['admin', 'organizations', params],
    queryFn:  () => adminFetch<any>(`/api/admin/organizations?${p}`),
    staleTime: 30_000,
  });
}

export function useAdminOrganization(id: string) {
  return useQuery({
    queryKey: ['admin', 'organizations', id],
    queryFn:  () => adminFetch<any>(`/api/admin/organizations/${id}`),
    enabled:  !!id,
  });
}

export function useUpdateOrganizationStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: string; reason?: string }) =>
      adminFetch<any>(`/api/admin/organizations/${id}`, { method: 'PATCH', json: { action, reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
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
    queryFn:  () => adminFetch<any>(`/api/admin/users?${p}`),
    staleTime: 30_000,
  });
}

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, platformRole }: { id: string; platformRole: string }) =>
      adminFetch<any>(`/api/admin/users/${id}`, { method: 'PATCH', json: { platformRole } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

// ── Group-level role assignment (Super Admin) ──────────────────────────────
export function useAssignableRoles(groupId?: string | null) {
  return useQuery({
    queryKey: ['admin', 'assignable-roles', groupId],
    queryFn:  () => adminFetch<{ items: any[] }>(`/api/admin/roles?groupId=${groupId}`),
    enabled:  !!groupId,
    staleTime: 5 * 60_000,
  });
}

export function useAssignGroupRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, groupId, roleId }: { memberId: string; groupId: string; roleId: string }) =>
      adminFetch<any>(`/api/admin/members/${memberId}/role`, {
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
    queryFn:  () => adminFetch<any>('/api/admin/billing'),
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
    queryFn:  () => adminFetch<any>(`/api/admin/support?${p}`),
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      adminFetch<any>('/api/admin/support', { method: 'POST', json: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tickets'] }),
  });
}

export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; status: string; resolution?: string }) =>
      adminFetch<any>(`/api/admin/support/${id}`, { method: 'PATCH', json: data }),
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
    queryFn:  () => adminFetch<any>(`/api/admin/audit-logs?${p}`),
    staleTime: 30_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────────────
export function useAdminAnalytics() {
  return useQuery({
    queryKey: ['admin', 'analytics'],
    queryFn:  () => adminFetch<any>('/api/admin/analytics'),
    staleTime: 300_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature flags
// ─────────────────────────────────────────────────────────────────────────────
export function useFeatureFlags() {
  return useQuery({
    queryKey: ['admin', 'feature-flags'],
    queryFn:  () => adminFetch<any>('/api/admin/feature-flags'),
    staleTime: 60_000,
  });
}

export function useToggleFeatureFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      adminFetch<any>('/api/admin/feature-flags', { method: 'PATCH', json: { key, enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'feature-flags'] }),
  });
}
