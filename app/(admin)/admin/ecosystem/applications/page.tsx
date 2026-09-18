'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { useApplications, useUpdateApplicationStatus } from '@/hooks/use-admin-ecosystem';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage, formatDate } from '@/lib/utils';
import type { Application } from '@/lib/services/ecosystem.service';

const STATUS_VARIANT: Record<Application['application_status'], 'default' | 'secondary' | 'outline' | 'destructive'> = {
  submitted: 'outline',
  shortlisted: 'secondary',
  accepted: 'default',
  rejected: 'destructive',
  withdrawn: 'outline',
};

export default function AdminEcosystemApplicationsPage() {
  const { toast } = useToast();
  const { data: applications, isLoading } = useApplications();
  const updateStatus = useUpdateApplicationStatus();

  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [respondingAction, setRespondingAction] = useState<'accepted' | 'rejected' | null>(null);
  const [responseMessage, setResponseMessage] = useState('');

  const openRespond = (id: string, action: 'accepted' | 'rejected') => {
    setRespondingId(id);
    setRespondingAction(action);
    setResponseMessage('');
  };

  const onShortlist = async (id: string) => {
    try {
      await updateStatus.mutateAsync({ id, status: 'shortlisted' });
      toast({ title: 'Application shortlisted' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onRespond = async () => {
    if (!respondingId || !respondingAction) return;
    try {
      await updateStatus.mutateAsync({ id: respondingId, status: respondingAction, response_message: responseMessage || undefined });
      toast({ title: respondingAction === 'accepted' ? 'Application accepted' : 'Application rejected' });
      setRespondingId(null);
      setRespondingAction(null);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketplace applications"
        description="Groups applying to opportunities from ecosystem partners."
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !applications || applications.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No applications yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {applications.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{a.group_name}</p>
                    <Badge variant={STATUS_VARIANT[a.application_status]}>{a.application_status}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Contact: {a.contact_member_name} · {a.contact_member_phone}
                    {a.contact_member_email ? ` · ${a.contact_member_email}` : ''}
                  </p>
                  {a.message && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">"{a.message}"</p>}
                  <p className="mt-2 text-xs text-muted-foreground">Submitted {formatDate(a.created_at)}</p>
                </div>
                {a.application_status === 'submitted' && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => onShortlist(a.id)} disabled={updateStatus.isPending}>
                      Shortlist
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openRespond(a.id, 'rejected')}>
                      Reject
                    </Button>
                    <Button size="sm" onClick={() => openRespond(a.id, 'accepted')}>
                      Accept
                    </Button>
                  </div>
                )}
                {a.application_status === 'shortlisted' && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => openRespond(a.id, 'rejected')}>
                      Reject
                    </Button>
                    <Button size="sm" onClick={() => openRespond(a.id, 'accepted')}>
                      Accept
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!respondingId} onOpenChange={(v) => !v && setRespondingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{respondingAction === 'accepted' ? 'Accept application' : 'Reject application'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="response">Message to the group (optional)</Label>
            <Textarea
              id="response"
              rows={4}
              value={responseMessage}
              onChange={(e) => setResponseMessage(e.target.value)}
              placeholder="Next steps, or the reason for declining…"
            />
          </div>
          <DialogFooter>
            <Button
              onClick={onRespond}
              disabled={updateStatus.isPending}
              variant={respondingAction === 'rejected' ? 'destructive' : 'default'}
            >
              {updateStatus.isPending ? 'Saving…' : respondingAction === 'accepted' ? 'Accept' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
