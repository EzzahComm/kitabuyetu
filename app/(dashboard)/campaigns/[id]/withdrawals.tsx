'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { ExpandableText } from '@/components/shared/expandable-text';
import { StatusPill } from '@/components/shared/status-pill';
import { ConfirmDialog, MoneyActionDialog } from '@/components/shared/confirm-dialog';
import {
  useCampaignWithdrawals,
  useRequestCampaignWithdrawal,
  useCampaignWithdrawalAction,
} from '@/hooks/use-campaigns';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';
import type { CampaignWithdrawalRow } from '@/lib/services/campaign-withdrawals.service';
import { describePayoutDestination } from '@/lib/campaigns/payout-destination';

/**
 * Withdrawal request + maker-checker approval, same shape as the treasury
 * page's SettlementsTab/VendorPaymentsTab — a second officer must approve
 * before anything reaches Daraja.
 */
export function CampaignWithdrawals({ campaignId, amountRaised }: { campaignId: string; amountRaised: string }) {
  const { toast } = useToast();
  const [requestOpen, setRequestOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [approveTarget, setApproveTarget] = useState<CampaignWithdrawalRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const listQ = useCampaignWithdrawals(campaignId);
  const requestMut = useRequestCampaignWithdrawal(campaignId);
  const actionMut = useCampaignWithdrawalAction(campaignId);

  const onRequest = async () => {
    try {
      await requestMut.mutateAsync(Number(amount));
      toast({ title: 'Withdrawal requested', description: 'Funds reserved — awaiting a second officer’s approval.' });
      setRequestOpen(false);
      setAmount('');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed to request withdrawal', description: getErrorMessage(e) });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Withdrawals</CardTitle>
        <Button size="sm" onClick={() => setRequestOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Request withdrawal
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <PaginatedTable
          data={singlePage(listQ.data)}
          isLoading={listQ.isLoading}
          isError={listQ.isError}
          error={listQ.error}
          onPageChange={() => {}}
          emptyMessage="No withdrawals yet."
          emptyDescription="Pay raised funds out to the campaign's payout destination."
          columns={[
            {
              key: 'gross_amount',
              header: 'Gross',
              className: 'font-medium',
              render: (r: CampaignWithdrawalRow) => formatKES(r.gross_amount),
            },
            {
              key: 'net_amount',
              header: 'Net (paid out)',
              className: 'font-medium',
              render: (r: CampaignWithdrawalRow) => formatKES(r.net_amount),
            },
            {
              key: 'destination',
              header: 'Paid to',
              className: 'text-xs',
              render: (r: CampaignWithdrawalRow) => describePayoutDestination(r),
            },
            {
              key: 'fees',
              header: 'Fees',
              className: 'text-muted-foreground text-xs',
              render: (r: CampaignWithdrawalRow) =>
                `Platform ${formatKES(r.platform_fee_amount)} + M-Pesa ${formatKES(r.mpesa_charge_amount)}`,
            },
            {
              key: 'status',
              header: 'Status',
              render: (r: CampaignWithdrawalRow) => (
                <div>
                  <StatusPill status={r.status} size="sm" />
                  {r.failure_reason && (
                    <ExpandableText lines={2} className="text-[10px] text-destructive mt-0.5 max-w-[180px]">
                      {r.failure_reason}
                    </ExpandableText>
                  )}
                </div>
              ),
            },
            {
              key: 'requested_at',
              header: 'Requested',
              className: 'text-muted-foreground',
              render: (r: CampaignWithdrawalRow) => formatDate(r.requested_at),
            },
            {
              key: 'completed_at',
              header: 'Completed',
              className: 'text-muted-foreground',
              render: (r: CampaignWithdrawalRow) => (r.completed_at ? formatDate(r.completed_at) : '—'),
            },
            {
              key: 'actions',
              header: '',
              render: (r: CampaignWithdrawalRow) =>
                r.status === 'pending_approval' ? (
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="outline" onClick={() => setApproveTarget(r)}>
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      onClick={() => setRejectTarget(r.id)}
                    >
                      Reject
                    </Button>
                  </div>
                ) : null,
            },
          ]}
        />
      </CardContent>

      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Request withdrawal</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Amount (KES)</Label>
              <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Raised so far: {formatKES(amountRaised)}. The platform fee and M-Pesa cost are deducted from this amount
                before it reaches the payout destination.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onRequest} loading={requestMut.isPending} disabled={!amount || Number(amount) <= 0}>
              Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MoneyActionDialog
        open={!!approveTarget}
        onOpenChange={(o) => !o && setApproveTarget(null)}
        title="Approve withdrawal"
        amount={approveTarget ? Number(approveTarget.net_amount) : 0}
        details={
          approveTarget
            ? [
                { label: 'Paid to', value: describePayoutDestination(approveTarget) },
                { label: 'Gross amount', value: formatKES(approveTarget.gross_amount) },
                { label: 'Requested', value: formatDate(approveTarget.requested_at) },
              ]
            : []
        }
        warning="Approving sends this payout to M-Pesa immediately. It cannot be recalled."
        confirmLabel="Approve & send"
        onConfirm={async () => {
          if (approveTarget) await actionMut.mutateAsync({ withdrawalId: approveTarget.id, action: 'approve' });
        }}
      />

      <ConfirmDialog
        open={!!rejectTarget}
        onOpenChange={(o) => {
          if (!o) {
            setRejectTarget(null);
            setRejectReason('');
          }
        }}
        title="Reject withdrawal"
        variant="danger"
        description={
          <div className="space-y-2">
            <p>Why is this being rejected? The reserved funds are released.</p>
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason (min 5 chars)"
            />
          </div>
        }
        confirmLabel="Reject"
        onConfirm={async () => {
          if (rejectTarget && rejectReason.length >= 5)
            await actionMut.mutateAsync({ withdrawalId: rejectTarget, action: 'reject', reason: rejectReason });
        }}
      />
    </Card>
  );
}
