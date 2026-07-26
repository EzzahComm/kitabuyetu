import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { buildQuery } from '@/lib/utils';
import type { meetingsService } from '@/lib/services/meetings.service';
import type { PaginatedResult } from '@/types/db.types';

const BASE = '/meetings';

export interface MeetingRow {
  id:                 string;
  title:              string;
  meeting_type:       string;
  status:             string;
  scheduled_at:       string;
  ended_at:           string | null;
  venue:              string | null;
  is_virtual:         boolean;
  meeting_link:       string | null;
  quorum_required:    number | null;
  quorum_achieved:    number | null;
  created_by_name:    string;
  chaired_by_name:    string | null;
  attendees_present:  number;
  resolution_count:   number;
}

export type MeetingStats = Awaited<ReturnType<typeof meetingsService.getStats>>;

export const meetingKeys = {
  all:    ['meetings'] as const,
  list:   (p?: Record<string, unknown>) => [...meetingKeys.all, 'list', p] as const,
  detail: (id: string) => [...meetingKeys.all, id] as const,
  stats:  ['meetings', 'stats'] as const,
};

export function useMeetings(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: meetingKeys.list(params),
    queryFn:  () => api.get<PaginatedResult<MeetingRow>>(`${BASE}${buildQuery(params ?? {})}`),
  });
}

export function useMeetingStats() {
  return useQuery({
    queryKey: meetingKeys.stats,
    queryFn:  () => api.get<MeetingStats>(`${BASE}?stats=1`),
  });
}

export function useMeeting(id: string) {
  return useQuery({
    queryKey: meetingKeys.detail(id),
    queryFn:  () => api.get<MeetingRow>(`${BASE}/${id}`),
    enabled:  !!id,
  });
}

export function useCreateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.post<MeetingRow>(BASE, body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: meetingKeys.all });
      qc.invalidateQueries({ queryKey: meetingKeys.stats });
    },
  });
}

export function useUpdateMeeting(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.patch<MeetingRow>(`${BASE}/${id}`, body),
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
    mutationFn: (body: unknown) => api.post<MeetingRow>(`${BASE}/${meetingId}/attendance`, body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) }),
  });
}

export function useAddResolution(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.post<unknown>(`${BASE}/${meetingId}/resolutions`, body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) }),
  });
}
