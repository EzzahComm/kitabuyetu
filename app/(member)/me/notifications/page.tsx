'use client';

import * as React from 'react';
import { Bell, BellOff, CheckCheck, MessageSquareOff } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListSkeleton } from '@/components/shared/skeletons';
import { cn, formatDateTime, getErrorMessage } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { smsApi } from '@/lib/api/endpoints';
import {
  useMyNotifications, useMarkNotificationRead, useMarkAllNotificationsRead,
} from '@/hooks/use-member';

/**
 * Self-service SMS opt-out (SMS_MESSAGING_AUDIT_2026-08.md M5) — the platform
 * had a working optOut() function honoured by every send path, but nothing
 * ever called it, so members had no way to actually stop receiving SMS.
 * Scoped to this member's phone + their active group.
 */
function SmsPreferenceCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['sms-preferences'],
    queryFn:  () => smsApi.preferences(),
  });

  const setPref = useMutation({
    mutationFn: (optedOut: boolean) => smsApi.setPreferences(optedOut),
    onSuccess: (res) => {
      qc.setQueryData(['sms-preferences'], res);
      toast({
        title: res.optedOut ? 'SMS notifications turned off' : 'SMS notifications turned on',
        description: res.optedOut
          ? "You'll still see alerts here in-app and by other channels."
          : undefined,
      });
    },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Could not update', description: e.message }),
  });

  if (isLoading) return null;
  const optedOut = data?.optedOut ?? false;

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <MessageSquareOff size={16} />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">SMS notifications</p>
            <p className="text-xs text-muted-foreground">
              {optedOut ? "You've opted out of SMS for this group" : 'Loan, contribution, and reminder texts'}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant={optedOut ? 'default' : 'outline'}
          disabled={setPref.isPending}
          onClick={() => setPref.mutate(!optedOut)}
        >
          {optedOut ? 'Turn on' : 'Turn off'}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function NotificationsPage() {
  const { data, isLoading, isError, error } = useMyNotifications({ limit: 50 });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Notifications</h1>
          <p className="text-xs text-muted-foreground">Loan, contribution, and account alerts</p>
        </div>
        {!!data?.unreadCount && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            disabled={markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            <CheckCheck size={14} className="mr-1" /> Mark all read
          </Button>
        )}
      </div>

      <SmsPreferenceCard />

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : isError ? (
        <EmptyState icon={BellOff} title="Could not load notifications" description={getErrorMessage(error)} />
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={BellOff}
              title="You're all caught up"
              description="Loan reminders, contribution alerts, and account updates will appear here."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((n) => (
            <Card
              key={n.id}
              className={cn('cursor-pointer transition-colors', !n.isRead && 'border-brand-200 bg-brand-50/40')}
              onClick={() => !n.isRead && markRead.mutate(n.id)}
            >
              <CardContent className="flex gap-3 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <Bell size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{n.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground/70">{formatDateTime(n.createdAt)}</p>
                </div>
                {!n.isRead && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-hidden />}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
