import * as React from 'react';
import { Megaphone, BellOff } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/utils';
import { announcements } from '../../_data';

export default function NotificationsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-foreground">Notifications</h1>
        <p className="text-xs text-muted-foreground">Group announcements and account alerts</p>
      </div>

      {announcements.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={BellOff}
              title="You're all caught up"
              description="Announcements from your group leaders and payment alerts will appear here."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex gap-3 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <Megaphone size={18} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{a.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{a.body}</p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground/70">{a.author} · {formatDateTime(a.date)}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
