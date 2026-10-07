'use client';

/**
 * Kitabu Yetu sign-off for group → member disbursements (migration 218). A
 * disbursement reaches this queue only after the group's treasurer has
 * approved it; signing off releases it (M-Pesa) or executes it and posts the
 * group and member ledgers (cash / bank transfer). Declining returns the
 * reserved funds to the group.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/shared/page-header';
import { MoneyActionDialog } from '@/components/shared/confirm-dialog';
import {
  useAwaitingMemberPayouts,
  useApproveMemberPayout,
  useRejectMemberPayout,
  type PlatformPayoutRow,
} from '@/hooks/use-admin-member-payouts';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';

const METHOD_LABEL: Record<PlatformPayoutRow['payment_method'], string> = {
  mpesa: 'M-Pesa',
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
};

export default function AdminDisbursementsPage() {
  const { toast } = useToast();
  const { data: rows, isLoading } = useAwaitingMemberPayouts();
  const approve = useApproveMemberPayout();
  const reject = useRejectMemberPayout();
  const [approving, setApproving] = useState<PlatformPayoutRow | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const onApprove = async (row: PlatformPayoutRow) => {
    try {
      await approve.mutateAsync(row.id);
      toast({
        title: `${row.reference} signed off`,
        description:
          row.payment_method === 'mpesa'
            ? 'Sent to M-Pesa. Ledgers post when Safaricom confirms.'
            : 'Executed. Group and member ledgers have been posted.',
      });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Sign-off failed', description: getErrorMessage(e) });
    }
  };

  const onDecline = async () => {
    if (!decliningId) return;
    try {
      await reject.mutateAsync({ id: decliningId, reason: reason.trim() });
      toast({ title: 'Disbursement declined', description: 'The reserved funds were returned to the group.' });
      setDecliningId(null);
      setReason('');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Member disbursements"
        description="Treasurer-approved disbursements awaiting Kitabu Yetu sign-off. Signing off moves the money and posts both ledgers."
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !rows || rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No disbursements waiting for sign-off.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1 space-y-1 text-sm">
                  <p className="text-lg font-semibold">
                    {formatKES(Number(r.amount))} <span className="text-sm font-normal">· {r.reference}</span>
                  </p>
                  <p>
                    <span className="font-medium">{r.recipient_name}</span>
                    {r.recipient_membership_no ? ` · #${r.recipient_membership_no}` : ''} · {r.group_name}
                  </p>
                  <p className="text-muted-foreground">{r.purpose_description}</p>
                  <p className="text-xs text-muted-foreground">
                    {METHOD_LABEL[r.payment_method]}
                    {r.payment_method === 'mpesa' ? ` to ${r.phone}` : ''}
                    {r.payment_reference ? ` · ${r.payment_reference}` : ''} · initiated by {r.initiated_by_name} (
                    {r.initiated_by_role}) {formatDate(r.created_at)} · approved by treasurer {r.approved_by_name}
                    {r.approved_at ? ` ${formatDate(r.approved_at)}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setDecliningId(r.id)}>
                    Decline
                  </Button>
                  <Button onClick={() => setApproving(r)}>Sign off</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {approving && (
        <MoneyActionDialog
          open={!!approving}
          onOpenChange={(o) => !o && setApproving(null)}
          title={`Sign off ${approving.reference}?`}
          amount={Number(approving.amount)}
          details={[
            { label: 'Group', value: approving.group_name },
            { label: 'Member', value: approving.recipient_name },
            { label: 'Method', value: METHOD_LABEL[approving.payment_method] },
            { label: 'Purpose', value: approving.purpose_description },
            { label: 'Treasurer', value: approving.approved_by_name ?? '—' },
          ]}
          warning={
            approving.payment_method === 'mpesa'
              ? "Signing off sends the money to the member's registered phone immediately."
              : 'Signing off records the payment as made and posts the group and member ledgers.'
          }
          confirmLabel="Sign off"
          onConfirm={() => onApprove(approving)}
        />
      )}

      <Dialog open={!!decliningId} onOpenChange={(o) => !o && setDecliningId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Decline disbursement</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="decline-reason">Reason (sent to the initiator)</Label>
            <Textarea id="decline-reason" value={reason} rows={3} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={onDecline}
              disabled={reason.trim().length < 5}
              loading={reject.isPending}
            >
              Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
