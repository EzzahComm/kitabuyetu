import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { smsApi } from '@/lib/api/endpoints';
import type { SmsGroupSettingsUpdateInput } from '@/lib/validators/sms.schema';

export const smsSettingsKeys = {
  settings:  ['sms', 'settings'] as const,
  birthdays: ['sms', 'birthdays'] as const,
};

export function useSmsSettings() {
  return useQuery({ queryKey: smsSettingsKeys.settings, queryFn: smsApi.settings });
}

export function useUpdateSmsSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SmsGroupSettingsUpdateInput) => smsApi.updateSettings(body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: smsSettingsKeys.settings }),
  });
}

/** Upcoming birthdays plus what the daily job actually dispatched. Read-only. */
export function useBirthdays() {
  return useQuery({ queryKey: smsSettingsKeys.birthdays, queryFn: smsApi.birthdays });
}
