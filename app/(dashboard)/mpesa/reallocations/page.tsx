'use client';

/**
 * Reallocation queue (payment architecture §3.4, §15.5; ADR-20).
 *
 * Treasurers correct a payment posted to the wrong member here. Corrections
 * above the group's approval threshold wait for a SECOND officer — the
 * initiator cannot approve their own correction (server-enforced).
 */
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRightLeft, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { MoneyActionDialog } from '@/components/shared/confirm-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from '@/lib/api/client';
import { formatKES, formatDate } from '@/lib/utils';
import type { PaginatedResult } from '@/types/db.types';

interface ReallocRow {
  id: string; status: 'pending_approval' | 'executed' | 'rejected';
  amount: string; mpesa_receipt_number: string | null; reason: string;
  from_member_name: string | null; to_member_name: string | null;
  initiated_by_name: string | null; approved_by_name: string | null;
  rejection_reason: string | null; created_at: string; executed_at: string | null;
}
interface ContributionRow {
  id: string; member_id: string; member_name: string; amount: string;
  status: string; payment_method: string | null;
  mpesa_receipt_number: string | null; contribution_date: string;
}
interface MemberRow { id: string; first_name: string; last_name: string; phone: string }

const STATUS_BADGE: Record<ReallocRow['status'], { label: string; variant: 'warning' | 'success' | 'destructive' }> = {
  pending_approval: { label: 'Awaiting approval', variant: 'warning' },
  executed:         { label: 'Executed',          variant: 'success' },
  rejected:         { label: 'Rejected',          variant: 'destructive' },
};

export default function ReallocationsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [creating, setCreating]         = useState(false);
  const [contributionId, setContribId]  = useState('');
  const [toMemberId, setToMemberId]     = useState('');
  const [reason, setReason]             = useState('');
  const [rejecting, setRejecting]       = useState<ReallocRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approving, setApproving]       = useState<ReallocRow | null>(null);
  const [busy, setBusy]                 = useState(false);

  const { data, isLoading } = useQuery<PaginatedResult<ReallocRow>>({
    queryKey: ['mpesa', 'reallocations'],
    queryFn:  () => api.get<PaginatedResult<ReallocRow>>('/mpesa/reallocations?limit=50'),
  });
  const { data: contribData } = useQuery<PaginatedResult<ContributionRow>>({
    queryKey: ['mpesa', 'reallocations', 'contributions'],
    queryFn:  () => api.get<PaginatedResult<ContributionRow>>('/contributions?limit=100'),
    enabled:  creating,
  });
  const { data: membersData } = useQuery<PaginatedResult<MemberRow>>({
    queryKey: ['mpesa', 'reallocations', 'members'],
    queryFn:  () => api.get<PaginatedResult<MemberRow>>('/members?status=active&limit=200'),
    enabled:  creating,
  });

  const items = data?.items ?? [];
  // Only completed M-Pesa contributions with a linked receipt can be corrected
  // here (cash entries are edited directly on the contribution).
  const correctable = (contribData?.items ?? []).filter(
    (c) => c.status === 'completed' && c.payment_method === 'mpesa' && c.mpesa_receipt_number,
  );
  const members = membersData?.items ?? [];
  const chosen  = correctable.find((c) => c.id === contributionId);

  const refresh = () => qc.invalidateQueries({ queryKey: ['mpesa', 'reallocations'] });

  const initiate = async () => {
    if (!contributionId || !toMemberId || reason.trim().length < 5) {
      toast({ variant: 'destructive', title: 'Pick a contribution, a target member, and give a reason (5+ chars)' });
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ needsApproval: boolean }>('/mpesa/reallocations', {
        contributionId, toMemberId, reason: reason.trim(),
      });
      toast({
        title: res.needsApproval
          ? 'Correction submitted — awaiting a second officer'
          : 'Correction executed',
      });
      setCreating(false);
      setContribId(''); setToMemberId(''); setReason('');
      await refresh();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Correction failed', description: err instanceof ApiError ? err.message : '' });
    } finally {
      setBusy(false);
    }
  };

  const approve = async (row: ReallocRow) => {
    setBusy(true);
    try {
      await api.post(`/mpesa/reallocations/${row.id}`, { action: 'approve' });
      toast({ title: 'Correction approved and executed' });
      setApproving(null);
      await refresh();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Approval failed', description: err instanceof ApiError ? err.message : '' });
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!rejecting || rejectReason.trim().length < 5) {
      toast({ variant: 'destructive', title: 'Give a rejection reason (5+ chars)' });
      return;
    }
    setBusy(true);
    try {
      await api.post(`/mpesa/reallocations/${rejecting.id}`, { action: 'reject', reason: rejectReason.trim() });
      toast({ title: 'Correction rejected' });
      setRejecting(null); setRejectReason('');
      await refresh();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Rejection failed', description: err instanceof ApiError ? err.message : '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Link href="/mpesa" className="mt-1"><Button variant="ghost" size="icon" aria-label="Back to M-Pesa"><ArrowLeft size={16} /></Button></Link>
        <PageHeader
          className="flex-1"
          title="Payment corrections"
          description="Move a payment posted to the wrong member. Originals are never edited — corrections post contra entries with a full audit trail."
          actions={
            <Button size="sm" onClick={() => setCreating(true)}>
              <ArrowRightLeft size={15} className="mr-2" /> New correction
            </Button>
          }
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <ShieldCheck className="mx-auto mb-3 opacity-40" size={32} />
            No corrections yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((row) => {
            const badge = STATUS_BADGE[row.status];
            return (
              <Card key={row.id}>
                <CardContent className="py-4 flex items-center justify-between flex-wrap gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{formatKES(Number(row.amount))}</span>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {row.from_member_name ?? 'Unknown'} → {row.to_member_name ?? 'Unknown'}
                      {row.mpesa_receipt_number ? ` · Receipt ${row.mpesa_receipt_number}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.reason} · by {row.initiated_by_name ?? 'unknown'} · {formatDate(row.created_at)}
                      {row.status === 'executed' && row.approved_by_name ? ` · approved by ${row.approved_by_name}` : ''}
                      {row.status === 'rejected' && row.rejection_reason ? ` · rejected: ${row.rejection_reason}` : ''}
                    </p>
                  </div>
                  {row.status === 'pending_approval' && (
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setRejecting(row); setRejectReason(''); }} disabled={busy}>
                        Reject
                      </Button>
                      <Button size="sm" onClick={() => setApproving(row)} disabled={busy}>
                        Approve
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* New correction */}
      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Correct a misposted payment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Contribution to correct</Label>
              <select
                value={contributionId}
                onChange={(e) => setContribId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select contribution…</option>
                {correctable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.member_name} — KES {Number(c.amount).toLocaleString()} · {c.mpesa_receipt_number}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Move to member</Label>
              <select
                value={toMemberId}
                onChange={(e) => setToMemberId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select member…</option>
                {members
                  .filter((m) => m.id !== chosen?.member_id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>{m.first_name} {m.last_name} — {m.phone}</option>
                  ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Reason</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Payer used a relative's account number"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Corrections above your group&apos;s approval threshold need a second officer to approve.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={initiate} loading={busy}>Submit correction</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve — executes the money move immediately, so confirm with full details */}
      {approving && (
        <MoneyActionDialog
          open={!!approving}
          onOpenChange={(o) => !o && setApproving(null)}
          title="Approve this correction?"
          amount={parseFloat(approving.amount)}
          details={[
            { label: 'From', value: approving.from_member_name ?? '—' },
            { label: 'To', value: approving.to_member_name ?? '—' },
            ...(approving.mpesa_receipt_number ? [{ label: 'Receipt', value: approving.mpesa_receipt_number }] : []),
            { label: 'Initiated by', value: approving.initiated_by_name ?? '—' },
            { label: 'Reason', value: approving.reason },
          ]}
          warning="Approving executes the reallocation immediately — the contribution moves between members and both sets of books update."
          confirmLabel="Approve & execute"
          onConfirm={() => approve(approving)}
        />
      )}

      {/* Reject */}
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Reject correction</DialogTitle></DialogHeader>
          <div className="space-y-1">
            <Label>Rejection reason</Label>
            <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Why is this correction wrong?" />
          </div>
          <DialogFooter>
            <Button variant="destructive" onClick={reject} loading={busy}>Reject correction</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
