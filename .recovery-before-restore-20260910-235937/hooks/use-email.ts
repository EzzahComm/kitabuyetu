'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface EmailLog {
  id: string;
  to: string;
  from: string;
  subject: string;
  template_key: string;
  category: string;
  provider: string;
  status: string;
  sent_at: string | null;
  opened_at: string | null;
  bounced_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface EmailTemplate {
  id: string;
  group_id: string | null;
  template_key: string;
  locale: string;
  name: string;
  subject: string;
  is_active: boolean;
  created_at: string;
}

export interface EmailCampaign {
  id: string;
  name: string;
  subject: string;
  status: string;
  total_recipients: number | null;
  sent_count: number;
  failed_count: number;
  opened_count: number;
  scheduled_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface EmailAnalytics {
  total: number;
  sent: number;
  failed: number;
  opened: number;
  bounced: number;
  byCategory: { category: string; count: number }[];
  byDay: { date: string; sent: number; failed: number }[];
}

export interface EmailSchedule {
  id: string;
  name: string;
  template_key: string;
  recipient_email: string;
  schedule_type: string;
  next_run_at: string;
  last_run_at: string | null;
  is_active: boolean;
}

export interface EmailPreference {
  category: string;
  enabled: boolean;
  frequency: string;
  group_id: string | null;
}

// ─── Email Logs ───────────────────────────────────────────────────────────────

export function useEmailLogs(params?: { status?: string; category?: string; days?: number; page?: number }) {
  const qs = new URLSearchParams();
  if (params?.status)   qs.set('status',   params.status);
  if (params?.category) qs.set('category', params.category);
  if (params?.days)     qs.set('days',     String(params.days));
  if (params?.page)     qs.set('page',     String(params.page));

  return useQuery({
    queryKey: ['email-logs', params],
    queryFn: () => api.get<{ data: EmailLog[]; meta: { total: number; page: number; limit: number } }>(`/email/logs?${qs}`),
  });
}

// ─── Email Analytics ─────────────────────────────────────────────────────────

export function useEmailAnalytics(days = 30) {
  return useQuery({
    queryKey: ['email-analytics', days],
    queryFn: () => api.get<EmailAnalytics>(`/email/analytics?days=${days}`),
    staleTime: 60_000,
  });
}

// ─── Email Templates ─────────────────────────────────────────────────────────

export function useEmailTemplates() {
  return useQuery({
    queryKey: ['email-templates'],
    queryFn: () => api.get<EmailTemplate[]>('/email/templates'),
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { templateKey: string; name: string; subject: string; body: string; locale?: string }) =>
      api.post<{ id: string }>('/email/templates', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-templates'] }),
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; subject?: string; body?: string; isActive?: boolean }) =>
      api.put<{ id: string }>(`/email/templates/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-templates'] }),
  });
}

// ─── Email Campaigns ─────────────────────────────────────────────────────────

export function useEmailCampaigns() {
  return useQuery({
    queryKey: ['email-campaigns'],
    queryFn: () => api.get<EmailCampaign[]>('/email/campaigns'),
  });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; subject: string; templateKey?: string; htmlBody?: string; recipientFilter?: unknown; scheduledAt?: string; launch?: boolean }) =>
      api.post<{ id: string }>('/email/campaigns', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-campaigns'] }),
  });
}

export function useCampaignAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'launch' | 'cancel' }) =>
      api.post<void>(`/email/campaigns/${id}`, { action }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-campaigns'] }),
  });
}

// ─── Email Schedules ─────────────────────────────────────────────────────────

export function useEmailSchedules() {
  return useQuery({
    queryKey: ['email-schedules'],
    queryFn: () => api.get<EmailSchedule[]>('/email/schedules'),
  });
}

// ─── Email Preferences ───────────────────────────────────────────────────────

export function useEmailPreferences() {
  return useQuery({
    queryKey: ['email-preferences'],
    queryFn: () => api.get<EmailPreference[]>('/email/preferences'),
  });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EmailPreference[]) => api.put<void>('/email/preferences', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-preferences'] }),
  });
}

// ─── Email Branding ───────────────────────────────────────────────────────────

export interface EmailBranding {
  sender_name: string;
  sender_email: string;
  reply_to_email: string;
  logo_url: string;
  primary_color: string;
  footer_text: string;
  website_url: string;
}

export function useEmailBranding() {
  return useQuery({
    queryKey: ['email-branding'],
    queryFn: () => api.get<EmailBranding | null>('/email/branding'),
  });
}

export function useUpdateBranding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<EmailBranding>) => api.put<void>('/email/branding', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-branding'] }),
  });
}
