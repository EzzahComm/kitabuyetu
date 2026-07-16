import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { finesApi } from '@/lib/api/endpoints';

export const fineKeys = {
  policy: ['fines', 'policy'] as const,
};

/** Effective group fine schedule (advisory offence -> amount tariff). */
export function useFinePolicy() {
  return useQuery({
    queryKey: fineKeys.policy,
    queryFn:  () => finesApi.policy(),
  });
}

export function useSetFinePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { schedule: Record<string, number> }) => finesApi.setPolicy(body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: fineKeys.policy }),
  });
}
