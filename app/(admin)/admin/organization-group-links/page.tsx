'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/shared/page-header';
import {
  usePendingOrgGroupLinks,
  useApproveOrgGroupLink,
  useRejectOrgGroupLink,
} from '@/hooks/use-admin-organization-group-links';
import { useToast } from '@/hooks/use-toast';
import { formatDate, getErrorMessage } from '@/lib/utils';

export default function AdminOrganizationGroupLinksPage() {
  const { toast } = useToast();
  const { data: requests, isLoading } = usePendingOrgGroupLinks();
  const approve = useApproveOrgGroupLink();
  const reject = useRejectOrgGroupLink();

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const onApprove = async (id: string) => {
    try {
      await approve.mutateAsync(id);
      toast({ title: 'Link approved', description: 'The group is now linked to the organization.' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onReject = async () => {
    if (!rejectingId) return;
    try {
      await reject.mutateAsync({ id: rejectingId, reason });
      toast({ title: 'Link rejected' });
      setRejectingId(null);
      setReason('');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Group-organization links"
        description="Either a group or an organization can request a link; nothing goes live until you approve it."
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !requests || requests.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">Nothing pending review.</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {r.groupName} <span className="font-normal text-muted-foreground">→</span> {r.organizationName}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">requested {formatDate(r.requestedAt)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setRejectingId(r.id)}>
                    Reject
                  </Button>
                  <Button size="sm" onClick={() => onApprove(r.id)} disabled={approve.isPending}>
                    Approve
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!rejectingId} onOpenChange={(v) => !v && setRejectingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject link request</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this link being rejected? Both sides will see this."
            />
          </div>
          <DialogFooter>
            <Button onClick={onReject} disabled={!reason.trim() || reject.isPending} variant="destructive">
              {reject.isPending ? 'Rejecting…' : 'Reject link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
