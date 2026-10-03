'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { adminApi } from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage, formatDate } from '@/lib/utils';
import type { OrgGroupLinkRow } from '@/lib/services/organization-group-links.service';

const STATUS_LABEL: Record<OrgGroupLinkRow['status'], string> = {
  pending: 'Awaiting platform review',
  approved: 'Linked',
  rejected: 'Declined',
};
const STATUS_VARIANT: Record<OrgGroupLinkRow['status'], 'default' | 'secondary' | 'destructive'> = {
  pending: 'secondary',
  approved: 'default',
  rejected: 'destructive',
};

export default function EnterpriseGroupsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [groupCode, setGroupCode] = useState('');

  const { data: links, isLoading } = useQuery({
    queryKey: ['enterprise', 'group-links'],
    queryFn: () => adminApi.get<OrgGroupLinkRow[]>('/organization/group-links'),
  });

  const request = useMutation({
    mutationFn: () => adminApi.post<OrgGroupLinkRow>('/organization/group-links', { groupCode }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enterprise', 'group-links'] });
      toast({ title: 'Request sent', description: 'A platform admin will review it shortly.' });
      setGroupCode('');
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Could not send request', description: getErrorMessage(e) }),
  });

  const linked = (links ?? []).filter((l) => l.status === 'approved');
  const pending = (links ?? []).filter((l) => l.status === 'pending');
  const other = (links ?? []).filter((l) => l.status === 'rejected');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Groups"
        description="Groups linked to your organization. A platform admin reviews every request."
      />

      <Card>
        <CardHeader>
          <CardTitle>Request a group</CardTitle>
          <CardDescription>Enter the group&apos;s code (e.g. KY0000001).</CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="groupCode">Group code</Label>
            <Input
              id="groupCode"
              value={groupCode}
              onChange={(e) => setGroupCode(e.target.value)}
              placeholder="KY0000001"
            />
          </div>
          <Button onClick={() => request.mutate()} disabled={groupCode.trim().length < 9 || request.isPending}>
            {request.isPending ? 'Sending…' : 'Request link'}
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <GroupLinkList title="Linked groups" items={linked} empty="No groups linked yet." />
          <GroupLinkList title="Awaiting review" items={pending} empty="No pending requests." />
          {other.length > 0 && <GroupLinkList title="Declined" items={other} empty="" />}
        </>
      )}
    </div>
  );
}

function GroupLinkList({ title, items, empty }: { title: string; items: OrgGroupLinkRow[]; empty: string }) {
  if (items.length === 0 && !empty) return null;
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">{empty}</CardContent>
        </Card>
      ) : (
        items.map((l) => (
          <Card key={l.id}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{l.groupName}</p>
                <p className="text-xs text-muted-foreground">
                  requested {formatDate(l.requestedAt)}
                  {l.status === 'rejected' && l.rejectionReason ? ` - ${l.rejectionReason}` : ''}
                </p>
              </div>
              <Badge variant={STATUS_VARIANT[l.status]}>{STATUS_LABEL[l.status]}</Badge>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
