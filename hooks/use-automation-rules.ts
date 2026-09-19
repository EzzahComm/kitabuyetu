'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type {
  AutomationRule, AutomationChannel, AutomationRuleInput, AutomationRuleUpdate,
  AutomationRuleExecution, FrequencyCap, FrequencyCapCategory,
} from '@/lib/services/automation-rules.service';

const BASE = '/marketing/automation-rules';

const keys = {
  rules:       (channel?: AutomationChannel) => ['automation-rules', channel ?? 'all'] as const,
  executions:  (channel: AutomationChannel, id: string) => ['automation-rules', channel, id, 'executions'] as const,
  frequencyCap: (id: string) => ['automation-rules', 'email', id, 'frequency-cap'] as const,
  smsTemplates: ['sms-templates'] as const,
};

export function useAutomationRules(channel?: AutomationChannel) {
  return useQuery({
    queryKey: keys.rules(channel),
    queryFn:  () => api.get<AutomationRule[]>(channel ? `${BASE}?channel=${channel}` : BASE),
  });
}

export function useCreateAutomationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: AutomationRuleInput & { channel: AutomationChannel }) => api.post<AutomationRule>(BASE, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automation-rules'] }),
  });
}

export function useUpdateAutomationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channel, id, data }: { channel: AutomationChannel; id: string; data: AutomationRuleUpdate }) =>
      api.patch<AutomationRule>(`${BASE}/${channel}/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automation-rules'] }),
  });
}

export function useRuleExecutions(channel: AutomationChannel, id: string, enabled = false) {
  return useQuery({
    queryKey: keys.executions(channel, id),
    queryFn:  () => api.get<AutomationRuleExecution[]>(`${BASE}/${channel}/${id}/executions`),
    enabled:  enabled && !!id,
  });
}

export function useFrequencyCaps(id: string, enabled = false) {
  return useQuery({
    queryKey: keys.frequencyCap(id),
    queryFn:  () => api.get<FrequencyCap[]>(`${BASE}/email/${id}/frequency-cap`),
    enabled:  enabled && !!id,
  });
}

export function useUpsertFrequencyCap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, category, max_per_day }: { id: string; category: FrequencyCapCategory; max_per_day: number }) =>
      api.put<FrequencyCap>(`${BASE}/email/${id}/frequency-cap`, { category, max_per_day }),
    onSuccess: (_data, { id }) => qc.invalidateQueries({ queryKey: keys.frequencyCap(id) }),
  });
}

// ─── Templates (for the rule form's template picker) ───────────────────────

export interface SmsTemplate {
  id: string;
  group_id: string | null;
  template_key: string;
  name: string;
  category: string;
  is_active: boolean;
}

export function useSmsTemplates() {
  return useQuery({
    queryKey: keys.smsTemplates,
    queryFn:  () => api.get<SmsTemplate[]>('/sms/templates'),
  });
}
