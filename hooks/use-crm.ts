import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Contact, Opportunity, Activity, ContactType, OpportunityStage, ActivityType } from '@/lib/services/crm.service';

const BASE = '/crm/contacts';

const crmKeys = {
  all:    ['crm', 'contacts'] as const,
  list:   (filters?: Record<string, unknown>) => ['crm', 'contacts', 'list', filters] as const,
  detail: (id: string) => ['crm', 'contacts', 'detail', id] as const,
};

export function useContacts(filters?: { contact_type?: ContactType; marketing_opt_in?: boolean }) {
  const params = new URLSearchParams();
  if (filters?.contact_type) params.set('contact_type', filters.contact_type);
  if (filters?.marketing_opt_in !== undefined) params.set('marketing_opt_in', String(filters.marketing_opt_in));
  const qs = params.toString();

  return useQuery({
    queryKey: crmKeys.list(filters),
    queryFn:  () => api.get<Contact[]>(`${BASE}${qs ? `?${qs}` : ''}`),
  });
}

export function useContact(id: string) {
  return useQuery({
    queryKey: crmKeys.detail(id),
    queryFn:  () => api.get<{ contact: Contact; opportunities: Opportunity[]; activities: Activity[] }>(`${BASE}/${id}`),
    enabled:  !!id,
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      contact_type: ContactType; name: string; email?: string; phone?: string;
      notes?: string; marketing_opt_in?: boolean;
    }) => api.post<Contact>(BASE, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.all }),
  });
}

export function useUpdateContact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: Partial<Pick<Contact, 'name' | 'email' | 'phone' | 'notes' | 'contact_type'>>) =>
      api.patch<Contact>(`${BASE}/${id}`, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crmKeys.detail(id) });
      qc.invalidateQueries({ queryKey: crmKeys.all });
    },
  });
}

export function useSetOptIn(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (optIn: boolean) =>
      optIn ? api.post<Contact>(`${BASE}/${id}/opt-in`, {}) : api.delete<Contact>(`${BASE}/${id}/opt-in`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crmKeys.detail(id) });
      qc.invalidateQueries({ queryKey: crmKeys.all });
    },
  });
}

export function useCreateOpportunity(contactId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; stage?: OpportunityStage; amount?: number; notes?: string }) =>
      api.post<Opportunity>(`${BASE}/${contactId}/opportunities`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.detail(contactId) }),
  });
}

export function useLogActivity(contactId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { activity_type: ActivityType; body?: string }) =>
      api.post<Activity>(`${BASE}/${contactId}/activities`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.detail(contactId) }),
  });
}
