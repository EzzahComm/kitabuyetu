'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminFetch } from '@/hooks/use-admin';

export interface PlatformPayoutRow {
  id: string;
  reference: string;
  group_id: string;
  group_name: string;
  amount: string;
  payment_method: 'mpesa' | 'cash' | 'bank_transfer';
  payment_reference: string | null;
  payout_purpose: string;
  purpose_description: string;
  phone: string;
  recipient_name: string;
  recipient_membership_no: string | null;
  initiated_by_name: string | null;
  initiated_by_role: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  created_at: string;
}

const KEY = ['admin', 'member-payouts'] as const;

/** Treasurer-approved member disbursements awaiting Kitabu Yetu sign-off (migration 218). */
export function useAwaitingMemberPayouts() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => adminFetch<PlatformPayoutRow[]>('/api/admin/member-payouts'),
  });
}

export function useApproveMemberPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminFetch<unknown>(`/api/admin/member-payouts/${id}/approve`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRejectMemberPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminFetch<unknown>(`/api/admin/member-payouts/${id}/reject`, { method: 'POST', json: { reason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
