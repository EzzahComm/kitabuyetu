'use client';

/**
 * Group (tenant) side of the Programs feature (migration 206) — browse
 * published programs, apply, and manage invitations from organizations.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { ProgramRow } from '@/lib/services/programs.service';
import type { ProgramApplicationRow } from '@/lib/services/program-applications.service';
import type { ProgramInvitationRow } from '@/lib/services/program-invitations.service';

const KEYS = {
  published: ['group-programs', 'published'] as const,
  applications: ['group-programs', 'applications'] as const,
  invitations: ['group-programs', 'invitations'] as const,
};

export function usePublishedPrograms() {
  return useQuery({
    queryKey: KEYS.published,
    queryFn: () => api.get<{ items: ProgramRow[] }>('/groups/programs'),
  });
}

export function useMyProgramApplications() {
  return useQuery({
    queryKey: KEYS.applications,
    queryFn: () => api.get<{ items: ProgramApplicationRow[] }>('/groups/programs/applications'),
  });
}

export function useApplyToProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ programId, applicationData }: { programId: string; applicationData?: Record<string, unknown> }) =>
      api.post<ProgramApplicationRow>(`/groups/programs/${programId}/apply`, { applicationData }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.applications }),
  });
}

export function useWithdrawProgramApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (applicationId: string) =>
      api.post<ProgramApplicationRow>(`/groups/programs/applications/${applicationId}/withdraw`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.applications }),
  });
}

export function useMyProgramInvitations() {
  return useQuery({
    queryKey: KEYS.invitations,
    queryFn: () => api.get<{ items: ProgramInvitationRow[] }>('/groups/program-invitations'),
  });
}

export function useAcceptProgramInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ProgramInvitationRow>(`/groups/program-invitations/${id}/accept`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.invitations });
      qc.invalidateQueries({ queryKey: KEYS.applications });
    },
  });
}

export function useDeclineProgramInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ProgramInvitationRow>(`/groups/program-invitations/${id}/decline`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.invitations }),
  });
}
