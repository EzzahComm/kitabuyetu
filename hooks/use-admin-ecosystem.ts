'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminFetch } from '@/hooks/use-admin';
import type { Partner, Opportunity, Application, EligibilityRules } from '@/lib/services/ecosystem.service';

const PARTNERS_KEY = ['admin', 'ecosystem', 'partners'] as const;
const OPPORTUNITIES_KEY = ['admin', 'ecosystem', 'opportunities'] as const;
const APPLICATIONS_KEY = ['admin', 'ecosystem', 'applications'] as const;

// ── Partners ─────────────────────────────────────────────────────────────

export function usePartners() {
  return useQuery({
    queryKey: PARTNERS_KEY,
    queryFn:  () => adminFetch<Partner[]>('/api/admin/ecosystem/partners'),
  });
}

export function useCreatePartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      type: Partner['type'];
      description?: string;
      logo_url?: string;
      website_url?: string;
      contact_email?: string;
      contact_phone?: string;
    }) => adminFetch<Partner>('/api/admin/ecosystem/partners', { method: 'POST', json: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: PARTNERS_KEY }),
  });
}

export function usePartner(id: string) {
  return useQuery({
    queryKey: [...PARTNERS_KEY, id],
    queryFn:  () => adminFetch<Partner>(`/api/admin/ecosystem/partners/${id}`),
    enabled:  !!id,
  });
}

export function useUpdatePartner(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Pick<Partner,
      'name' | 'type' | 'description' | 'logo_url' | 'website_url' | 'contact_email' | 'contact_phone' | 'is_active'
    >>) => adminFetch<Partner>(`/api/admin/ecosystem/partners/${id}`, { method: 'PATCH', json: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PARTNERS_KEY });
      qc.invalidateQueries({ queryKey: [...PARTNERS_KEY, id] });
    },
  });
}

// ── Opportunities ────────────────────────────────────────────────────────

export function useOpportunities() {
  return useQuery({
    queryKey: OPPORTUNITIES_KEY,
    queryFn:  () => adminFetch<Opportunity[]>('/api/admin/ecosystem/opportunities'),
  });
}

export function useCreateOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      partner_id: string;
      title: string;
      description: string;
      opportunity_type: Opportunity['opportunity_type'];
      category?: string;
      amount_min?: number;
      amount_max?: number;
      currency?: string;
      terms_summary?: string;
      eligibility_rules: EligibilityRules;
      application_url?: string;
      featured?: boolean;
    }) => adminFetch<Opportunity>('/api/admin/ecosystem/opportunities', { method: 'POST', json: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: OPPORTUNITIES_KEY }),
  });
}

export function useOpportunity(id: string) {
  return useQuery({
    queryKey: [...OPPORTUNITIES_KEY, id],
    queryFn:  () => adminFetch<Opportunity>(`/api/admin/ecosystem/opportunities/${id}`),
    enabled:  !!id,
  });
}

export function useUpdateOpportunity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Pick<Opportunity,
      'title' | 'description' | 'category' | 'amount_min' | 'amount_max' | 'terms_summary'
      | 'eligibility_rules' | 'application_url' | 'featured'
    >>) => adminFetch<Opportunity>(`/api/admin/ecosystem/opportunities/${id}`, { method: 'PATCH', json: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OPPORTUNITIES_KEY });
      qc.invalidateQueries({ queryKey: [...OPPORTUNITIES_KEY, id] });
    },
  });
}

export function usePublishOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      adminFetch<Opportunity>(`/api/admin/ecosystem/opportunities/${id}/publish`, { method: 'PUT' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: OPPORTUNITIES_KEY }),
  });
}

export function useCloseOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      adminFetch<Opportunity>(`/api/admin/ecosystem/opportunities/${id}/close`, { method: 'PUT' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: OPPORTUNITIES_KEY }),
  });
}

// ── Applications ─────────────────────────────────────────────────────────

export function useApplications() {
  return useQuery({
    queryKey: APPLICATIONS_KEY,
    queryFn:  () => adminFetch<Application[]>('/api/admin/ecosystem/applications'),
  });
}

export function useUpdateApplicationStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, response_message }: {
      id: string;
      status: Application['application_status'];
      response_message?: string;
    }) =>
      adminFetch<Application>(`/api/admin/ecosystem/applications/${id}/status`, {
        method: 'PUT',
        json: { status, response_message },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: APPLICATIONS_KEY }),
  });
}
