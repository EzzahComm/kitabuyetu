'use client';

import * as React from 'react';
import { Bell, BellOff, CheckCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListSkeleton } from '@/components/shared/skeletons';
import { cn, formatDateTime, getErrorMessage } from '@/lib/utils';
import {
  useMyNotifications, useMarkNotificationRead, useMarkAllNotificationsRead,
} from '@/hooks/use-member';

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
