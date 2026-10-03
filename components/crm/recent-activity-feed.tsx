'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useRecentActivity } from '@/hooks/use-crm';
import { formatDateTime } from '@/lib/utils';

export function RecentActivityFeed() {
  const { data: activities, isLoading } = useRecentActivity(30);

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h3 className="font-semibold">Recent activity</h3>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !activities || activities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing logged yet — calls, notes, and stage changes will show up here.
          </p>
        ) : (
          <div className="max-h-[32rem] space-y-3 overflow-y-auto">
            {activities.map((a) => (
              <div key={a.id} className="border-l-2 border-brand-200 pl-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{a.activity_type}</Badge>
                  <span className="text-xs text-muted-foreground">{formatDateTime(a.occurred_at)}</span>
                </div>
                {(a.contact_name || a.opportunity_title) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.contact_id ? (
                      <Link href={`/crm/${a.contact_id}`} className="hover:text-foreground hover:underline">
                        {a.contact_name}
                      </Link>
                    ) : (
                      a.contact_name
                    )}
                    {a.opportunity_title && ` · ${a.opportunity_title}`}
                  </p>
                )}
                {a.body && <p className="mt-1 text-sm">{a.body}</p>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
