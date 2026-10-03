'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/shared/page-header';
import {
  usePendingCampaigns,
  useApproveCampaign,
  useRejectCampaign,
  useAwaitingReleases,
  useApproveRelease,
  useRejectRelease,
} from '@/hooks/use-admin-campaigns';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';
import { describePayoutDestination } from '@/lib/campaigns/payout-destination';

export default function AdminCampaignsPage() {
  const { toast } = useToast();
  const { data: campaigns, isLoading } = usePendingCampaigns();
  const approve = useApproveCampaign();
  const reject = useRejectCampaign();

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const { data: releases, isLoading: releasesLoading } = useAwaitingReleases();
  const approveRelease = useApproveRelease();
  const rejectRelease = useRejectRelease();
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  const onApproveRelease = async (id: string) => {
    try {
      await approveRelease.mutateAsync(id);
      toast({ title: 'Release approved', description: 'The payout has been sent for processing.' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onDeclineRelease = async () => {
    if (!decliningId) return;
    try {
      await rejectRelease.mutateAsync({ id: decliningId, reason: declineReason });
      toast({ title: 'Release declined', description: 'The reserved funds were returned to the group.' });
      setDecliningId(null);
      setDeclineReason('');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

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
          <CardContent className="py-16 text-center text-sm text-muted-foreground">Nothing pending review.</CardContent>
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
                    Target {formatKES(c.target_amount)} - submitted {formatDate(c.created_at)}
                  </p>
                  {/* The reviewer vets where the money will go, not just the story. */}
                  <p className="mt-1 text-xs">
                    <span className="text-muted-foreground">Withdrawals paid to: </span>
                    <span className="font-medium">{describePayoutDestination(c)}</span>
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

      <div className="space-y-3 pt-4">
        <PageHeader
          title="Releases awaiting sign-off"
          description="Withdrawals two group officials have approved. Donations sit in the platform paybill until you release them to the payee."
        />
        {releasesLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !releases || releases.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No releases waiting for sign-off.
            </CardContent>
          </Card>
        ) : (
          releases.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{r.campaign_title}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.group_name} - requested {formatDate(r.requested_at)} - campaign has raised{' '}
                    {formatKES(r.amount_raised)}
                  </p>
                  <p className="mt-2 text-sm">
                    Release <span className="font-semibold">{formatKES(r.gross_amount)}</span> - payee receives{' '}
                    <span className="font-semibold">{formatKES(r.net_amount)}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      (platform fee {formatKES(r.platform_fee_amount)} + M-Pesa {formatKES(r.mpesa_charge_amount)})
                    </span>
                  </p>
                  <p className="mt-1 text-xs">
                    <span className="text-muted-foreground">Paid to: </span>
                    <span className="font-medium">{describePayoutDestination(r)}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setDecliningId(r.id)}>
                    Decline
                  </Button>
                  <Button size="sm" onClick={() => onApproveRelease(r.id)} disabled={approveRelease.isPending}>
                    Approve release
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={!!decliningId} onOpenChange={(v) => !v && setDecliningId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline release</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="decline-reason">Reason</Label>
            <Textarea
              id="decline-reason"
              rows={4}
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Why is this release being declined? The group will see this."
            />
          </div>
          <DialogFooter>
            <Button
              onClick={onDeclineRelease}
              disabled={declineReason.trim().length < 3 || rejectRelease.isPending}
              variant="destructive"
            >
              {rejectRelease.isPending ? 'Declining…' : 'Decline release'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectingId} onOpenChange={(v) => !v && setRejectingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this campaign being rejected?"
            />
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
