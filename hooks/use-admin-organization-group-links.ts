'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminFetch } from '@/hooks/use-admin';
import type { OrgGroupLinkRow } from '@/lib/services/organization-group-links.service';

const KEY = ['admin', 'organization-group-links'] as const;

export function usePendingOrgGroupLinks() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => adminFetch<OrgGroupLinkRow[]>('/api/admin/organization-group-links'),
  });
}

export function useApproveOrgGroupLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      adminFetch<OrgGroupLinkRow>(`/api/admin/organization-group-links/${id}/approve`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRejectOrgGroupLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminFetch<OrgGroupLinkRow>(`/api/admin/organization-group-links/${id}/reject`, {
        method: 'POST',
        json: { reason },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
