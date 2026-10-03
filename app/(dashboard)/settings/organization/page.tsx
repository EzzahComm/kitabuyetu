'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/context';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';
import type { OrgGroupLinkRow } from '@/lib/services/organization-group-links.service';

const STATUS_LABEL: Record<OrgGroupLinkRow['status'], string> = {
  pending: 'Awaiting platform review',
  approved: 'Linked',
  rejected: 'Request declined',
};
const STATUS_VARIANT: Record<OrgGroupLinkRow['status'], 'default' | 'secondary' | 'destructive'> = {
  pending: 'secondary',
  approved: 'default',
  rejected: 'destructive',
};

export default function GroupOrganizationLinkPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [organizationName, setOrganizationName] = useState('');

  const { data: link, isLoading } = useQuery({
    queryKey: ['group', 'organization-link'],
    queryFn: () => api.get<OrgGroupLinkRow | null>('/groups/organization-link'),
  });

  const request = useMutation({
    mutationFn: () => api.post<OrgGroupLinkRow>('/groups/organization-link', { organizationName }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group', 'organization-link'] });
      toast({ title: 'Request sent', description: 'A platform admin will review it shortly.' });
      setOrganizationName('');
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Could not send request', description: getErrorMessage(e) }),
  });

  const isChairperson = user && 'groupRole' in user && user.groupRole === 'chairperson';
  const canRequest = isChairperson && (!link || link.status === 'rejected');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization"
        description="Link your group to an institution overseeing multiple groups (a SACCO federation, NGO, or similar). A platform admin reviews every request."
      />

      <Card>
        <CardHeader>
          <CardTitle>Current status</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !link ? (
            <p className="text-sm text-muted-foreground">Not linked to any organization.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{link.organizationName}</span>
                <Badge variant={STATUS_VARIANT[link.status]}>{STATUS_LABEL[link.status]}</Badge>
              </div>
              {link.status === 'rejected' && link.rejectionReason && (
                <p className="text-sm text-muted-foreground">Reason: {link.rejectionReason}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {canRequest && (
        <Card>
          <CardHeader>
            <CardTitle>Request a link</CardTitle>
            <CardDescription>Chairperson only. Enter the organization&apos;s exact name.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="organizationName">Organization name</Label>
              <Input
                id="organizationName"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                placeholder="e.g. Nairobi SACCO Federation"
              />
            </div>
            <Button onClick={() => request.mutate()} disabled={organizationName.trim().length < 3 || request.isPending}>
              {request.isPending ? 'Sending…' : 'Request link'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
