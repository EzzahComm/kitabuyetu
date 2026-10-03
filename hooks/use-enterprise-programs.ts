'use client';

/**
 * Org-coordinator side of the Programs feature (migration 206) — an
 * organization publishes a program, groups apply or are invited. Distinct
 * from the Funding Portal's `organizationApi` program hooks (funding_programs,
 * a budget/disbursement concept) — see feedback_funding_programs_is_money_only.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/client';
import { enterpriseKeys } from '@/lib/api/enterprise-keys';
import type { ProgramRow, ProgramMembershipRow } from '@/lib/services/programs.service';
import type { ProgramApplicationRow } from '@/lib/services/program-applications.service';
import type { ProgramInvitationRow } from '@/lib/services/program-invitations.service';
import type { CreateGroupProgramInput, UpdateGroupProgramInput } from '@/lib/validators/organization.schema';

const BASE = '/organization/group-programs';

export function useGroupPrograms() {
  return useQuery({
    queryKey: enterpriseKeys.groupPrograms(),
    queryFn: () => adminApi.get<{ items: ProgramRow[] }>(BASE),
  });
}

export function useGroupProgram(id: string) {
  return useQuery({
    queryKey: enterpriseKeys.groupProgram(id),
    queryFn: () => adminApi.get<ProgramRow>(`${BASE}/${id}`),
    enabled: !!id,
  });
}

export function useCreateGroupProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateGroupProgramInput) => adminApi.post<ProgramRow>(BASE, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: enterpriseKeys.groupPrograms() }),
  });
}

export function useUpdateGroupProgram(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateGroupProgramInput) => adminApi.patch<ProgramRow>(`${BASE}/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: enterpriseKeys.groupProgram(id) });
      qc.invalidateQueries({ queryKey: enterpriseKeys.groupPrograms() });
    },
  });
}

export function useTransitionGroupProgramStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: ProgramRow['status']) => adminApi.patch<ProgramRow>(`${BASE}/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: enterpriseKeys.groupProgram(id) });
      qc.invalidateQueries({ queryKey: enterpriseKeys.groupPrograms() });
    },
  });
}

export function useGroupProgramApplications(programId: string) {
  return useQuery({
    queryKey: enterpriseKeys.groupProgramApplications(programId),
    queryFn: () => adminApi.get<{ items: ProgramApplicationRow[] }>(`${BASE}/${programId}/applications`),
    enabled: !!programId,
  });
}

function useApplicationAction(programId: string, action: 'accept' | 'decline' | 'request-info' | 'under-review') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ appId, reviewNotes }: { appId: string; reviewNotes?: string }) =>
      adminApi.post<{ application: ProgramApplicationRow; membership?: ProgramMembershipRow }>(
        `${BASE}/${programId}/applications/${appId}/${action}`,
        reviewNotes !== undefined ? { reviewNotes } : {},
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: enterpriseKeys.groupProgramApplications(programId) }),
  });
}

export const useAcceptProgramApplication = (programId: string) => useApplicationAction(programId, 'accept');
export const useDeclineProgramApplication = (programId: string) => useApplicationAction(programId, 'decline');
export const useRequestProgramApplicationInfo = (programId: string) => useApplicationAction(programId, 'request-info');
export const useMarkProgramApplicationUnderReview = (programId: string) =>
  useApplicationAction(programId, 'under-review');

export function useGroupProgramInvitations(programId: string) {
  return useQuery({
    queryKey: enterpriseKeys.groupProgramInvitations(programId),
    queryFn: () => adminApi.get<{ items: ProgramInvitationRow[] }>(`${BASE}/${programId}/invitations`),
    enabled: !!programId,
  });
}

export function useInviteGroupToProgram(programId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { groupCode: string; message?: string }) =>
      adminApi.post<ProgramInvitationRow>(`${BASE}/${programId}/invitations`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: enterpriseKeys.groupProgramInvitations(programId) }),
  });
}

export function useCancelProgramInvitation(programId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invId: string) =>
      adminApi.post<ProgramInvitationRow>(`${BASE}/${programId}/invitations/${invId}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: enterpriseKeys.groupProgramInvitations(programId) }),
  });
}
