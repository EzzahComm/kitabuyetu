import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { membersApi } from '@/lib/api/endpoints';

export const memberKeys = {
  all:    ['members'] as const,
  list:   (params?: Record<string, unknown>) => [...memberKeys.all, 'list', params] as const,
  detail: (id: string) => [...memberKeys.all, id] as const,
};

export function useMembers(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: memberKeys.list(params),
    queryFn:  () => membersApi.list(params),
  });
}

export function useMember(id: string) {
  return useQuery({
    queryKey: memberKeys.detail(id),
    queryFn:  () => membersApi.getById(id),
    enabled:  !!id,
  });
}

export function useCreateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => membersApi.create(body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: memberKeys.all }),
  });
}

export function useUpdateMember(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => membersApi.update(id, body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: memberKeys.list() });
      qc.invalidateQueries({ queryKey: memberKeys.detail(id) });
    },
  });
}

export function useDeactivateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => membersApi.deactivate(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: memberKeys.all }),
  });
}
