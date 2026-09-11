import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { buildQuery } from '@/lib/utils';
import type { meetingsService , CreateMeetingPayload, UpdateMeetingPayload, RecordAttendancePayload, AddResolutionPayload, UpdateResolutionPayload } from '@/lib/services/meetings.service';
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

/** A row of `meeting_attendance`, as getById returns it. */
export interface MeetingAttendanceRow {
  id:            string;
  meeting_id:    string;
  member_id:     string;
  member_name:   string;
  member_phone:  string | null;
  status:        string;
  excuse_reason: string | null;
  fine_amount:   string | null;
}

/** A row of `meeting_resolutions`, as getById returns it. */
export interface MeetingResolutionRow {
  id:                      string;
  meeting_id:              string;
  sort_order:              number;
  resolution_text:         string;
  proposed_by_name:        string | null;
  responsible_party_name:  string | null;
  responsible_party:       string | null;
  votes_for:               number;
  votes_against:           number;
  votes_abstain:           number;
  status:                  string;
  implementation_deadline: string | null;
  implemented:             boolean;
  implemented_at:          string | null;
  notes:                   string | null;
}

/** What GET /meetings/:id returns — the meeting plus its children. */
export type MeetingDetail = MeetingRow & {
  agenda:          string[] | null;
  minutes:         string | null;
  notes:           string | null;
  secretary_name:  string | null;
  attendance:      MeetingAttendanceRow[];
  resolutions:     MeetingResolutionRow[];
};

export type MeetingStats = Awaited<ReturnType<typeof meetingsService.getStats>>;

export const meetingKeys = {
  all:    ['meetings'] as const,
  /** Prefix for every list query, whatever its params — use this to invalidate. */
  lists:  () => [...meetingKeys.all, 'list'] as const,
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
    queryFn:  () => api.get<MeetingDetail>(`${BASE}/${id}`),
    enabled:  !!id,
  });
}

export function useCreateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMeetingPayload) => api.post<MeetingRow>(BASE, body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: meetingKeys.all });
      qc.invalidateQueries({ queryKey: meetingKeys.stats });
    },
  });
}

export function useUpdateMeeting(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMeetingPayload) => api.patch<MeetingRow>(`${BASE}/${id}`, body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: meetingKeys.lists() });
      qc.invalidateQueries({ queryKey: meetingKeys.detail(id) });
      qc.invalidateQueries({ queryKey: meetingKeys.stats });
    },
  });
}

// The list and the stats cards both derive from these children —
// attendees_present and resolution_count are per-row aggregates, and the stats
// header counts resolutions and implemented resolutions. Invalidating only the
// detail left both stale.
export function useRecordAttendance(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordAttendancePayload) => api.post<MeetingRow>(`${BASE}/${meetingId}/attendance`, body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
      qc.invalidateQueries({ queryKey: meetingKeys.lists() });
      qc.invalidateQueries({ queryKey: meetingKeys.stats });
    },
  });
}

export function useAddResolution(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddResolutionPayload) => api.post<unknown>(`${BASE}/${meetingId}/resolutions`, body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
      qc.invalidateQueries({ queryKey: meetingKeys.lists() });
      qc.invalidateQueries({ queryKey: meetingKeys.stats });
    },
  });
}

/** Mark a resolution implemented, or amend its follow-through details. */
export function useUpdateResolution(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ resolutionId, ...body }: UpdateResolutionPayload & { resolutionId: string }) =>
      api.patch<unknown>(`${BASE}/${meetingId}/resolutions/${resolutionId}`, body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
      // "N implemented" on the stats card moves with this.
      qc.invalidateQueries({ queryKey: meetingKeys.stats });
    },
  });
}
