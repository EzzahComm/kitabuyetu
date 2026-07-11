'use client';

import { useQuery } from '@tanstack/react-query';
import { organizationApi } from '@/lib/api/endpoints';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatKES } from '@/lib/utils';
import { useState } from 'react';

export default function OrganizationPage() {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  const { data: groups, isLoading } = useQuery({ queryKey: ['organization','groups'], queryFn: organizationApi.groups });
  const { data: detail, isLoading: loadingDetail } = useQuery({
    queryKey: ['organization','detail', selectedGroup],
    queryFn:  () => organizationApi.detail(selectedGroup!),
    enabled:  !!selectedGroup,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Organization Portal</h1>
        <p className="text-sm text-muted-foreground">Monitor affiliated groups</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Groups</h2>
          {isLoading ? (
            Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-16 w-full"/>)
          ) : (
            (groups ?? []).flatMap((organization: any) =>
              (organization.groups ?? []).map((g: any) => (
                <Card
                  key={g.groupId}
                  className={`cursor-pointer transition-colors ${selectedGroup === g.groupId ? 'ring-2 ring-brand-500' : 'hover:bg-muted/50'}`}
                  onClick={() => setSelectedGroup(g.groupId)}
                >
                  <CardContent className="p-4">
                    <p className="font-medium">{g.groupName}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs capitalize">{g.groupType}</Badge>
                      <span className="text-xs text-muted-foreground">{g.memberCount ?? '?'} members</span>
                    </div>
                  </CardContent>
                </Card>
              ))
            )
          )}
        </div>

        <div className="lg:col-span-2">
          {!selectedGroup ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground text-sm border rounded-lg">
              Select a group to view details
            </div>
          ) : loadingDetail ? (
            <Skeleton className="h-64 w-full"/>
          ) : (
            <Card>
              <CardHeader><CardTitle className="text-base">Group Report</CardTitle></CardHeader>
              <CardContent>
                <pre className="text-xs whitespace-pre-wrap overflow-auto max-h-96">{JSON.stringify(detail, null, 2)}</pre>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
