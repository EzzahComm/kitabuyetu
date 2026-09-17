'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/shared/page-header';
import { usePendingCampaigns, useApproveCampaign, useRejectCampaign } from '@/hooks/use-admin-campaigns';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';

export default function AdminCampaignsPage() {
  const { toast } = useToast();
  const { data: campaigns, isLoading } = usePendingCampaigns();
  const approve = useApproveCampaign();
  const reject = useRejectCampaign();

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const onApprove = async (id: string) => {
    try {
      await approve.mutateAsync(id);
      toast({ title: 'Campaign approved', description: 'It is now live and accepting donations.' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onReject = async () => {
    if (!rejectingId) return;
    try {
      await reject.mutateAsync({ id: rejectingId, reason });
      toast({ title: 'Campaign rejected' });
      setRejectingId(null);
      setReason('');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Changi$ha review queue"
        description="Campaigns waiting for approval before they go live and can accept public donations."
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !campaigns || campaigns.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Nothing pending review.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{c.title}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{c.story}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Target {formatKES(c.target_amount)} · submitted {formatDate(c.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setRejectingId(c.id)}>
                    Reject
                  </Button>
                  <Button size="sm" onClick={() => onApprove(c.id)} disabled={approve.isPending}>
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
            <DialogTitle>Reject campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this campaign being rejected?" />
          </div>
          <DialogFooter>
            <Button onClick={onReject} disabled={!reason.trim() || reject.isPending} variant="destructive">
              {reject.isPending ? 'Rejecting…' : 'Reject campaign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
