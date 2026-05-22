import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { buildQuery } from '@/lib/utils';

const BASE = '/meetings';

export const meetingKeys = {
  all:    ['meetings'] as const,
  list:   (p?: Record<string, unknown>) => [...meetingKeys.all, 'list', p] as const,
  detail: (id: string) => [...meetingKeys.all, id] as const,
  stats:  ['meetings', 'stats'] as const,
};

export function useMeetings(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: meetingKeys.list(params),
    queryFn:  () => api.get<any>(`${BASE}${buildQuery(params ?? {})}`),
  });
}

export function useMeetingStats() {
  return useQuery({
    queryKey: meetingKeys.stats,
    queryFn:  () => api.get<any>(`${BASE}?stats=1`),
  });
}

export function useMeeting(id: string) {
  return useQuery({
    queryKey: meetingKeys.detail(id),
    queryFn:  () => api.get<any>(`${BASE}/${id}`),
    enabled:  !!id,
  });
}

export function useCreateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.post<any>(BASE, body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: meetingKeys.all });
      qc.invalidateQueries({ queryKey: meetingKeys.stats });
    },
  });
}

export function useUpdateMeeting(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.patch<any>(`${BASE}/${id}`, body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: meetingKeys.list() });
      qc.invalidateQueries({ queryKey: meetingKeys.detail(id) });
      qc.invalidateQueries({ queryKey: meetingKeys.stats });
    },
  });
}

export function useRecordAttendance(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.post<any>(`${BASE}/${meetingId}/attendance`, body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) }),
  });
}

export function useAddResolution(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.post<any>(`${BASE}/${meetingId}/resolutions`, body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) }),
  });
}
