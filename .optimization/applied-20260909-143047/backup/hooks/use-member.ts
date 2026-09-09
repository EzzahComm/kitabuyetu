import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { meApi } from '@/lib/api/endpoints';
import type { MemberPassbookQueryInput } from '@/lib/validators/member-passbook.schema';
import type { UpdateMemberGoalInput, LogGoalProgressInput } from '@/lib/validators/member-goal.schema';

export const meKeys = {
  all:          ['me'] as const,
  wallet:       () => [...meKeys.all, 'wallet'] as const,
  passbook:     (params?: Partial<MemberPassbookQueryInput>) => [...meKeys.all, 'passbook', params] as const,
  notifications: (params?: { page?: number; limit?: number }) => [...meKeys.all, 'notifications', params] as const,
  goals:        () => [...meKeys.all, 'goals'] as const,
};

export function useMyWallet() {
  return useQuery({
    queryKey: meKeys.wallet(),
    queryFn:  () => meApi.wallet(),
  });
}

export function useMyPassbook(params?: Partial<MemberPassbookQueryInput>) {
  return useQuery({
    queryKey: meKeys.passbook(params),
    queryFn:  () => meApi.passbook(params),
  });
}

export function useMyNotifications(params?: { page?: number; limit?: number }) {
  return useQuery({
    queryKey: meKeys.notifications(params),
    queryFn:  () => meApi.notifications.list(params),
  });
}

/** Thin wrapper over useMyNotifications for the layout's bell badge — polls so the badge updates without a full page revisit. */
export function useUnreadNotificationCount(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey:        meKeys.notifications({ limit: 1 }),
    queryFn:         () => meApi.notifications.list({ limit: 1 }),
    select:          (data) => data.unreadCount,
    enabled:         opts?.enabled ?? true,
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => meApi.notifications.markRead(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: meKeys.all }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => meApi.notifications.markAllRead(),
    onSuccess:  () => qc.invalidateQueries({ queryKey: meKeys.all }),
  });
}

export function useMyGoals() {
  return useQuery({
    queryKey: meKeys.goals(),
    queryFn:  () => meApi.goals.list(),
  });
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof meApi.goals.create>[0]) => meApi.goals.create(body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: meKeys.goals() }),
  });
}

export function useUpdateGoal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMemberGoalInput) => meApi.goals.update(id, body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: meKeys.goals() }),
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => meApi.goals.delete(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: meKeys.goals() }),
  });
}

export function useLogGoalProgress(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LogGoalProgressInput) => meApi.goals.logProgress(id, body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: meKeys.goals() }),
  });
}
