'use client';

/**
 * Organization → branch disbursements (ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md
 * Phase 4). Backend (organization-finance.service.ts's disburse/approve/reject/
 * listDisbursements) already existed and is live — this is the first frontend
 * wiring for it. Maker-checker pattern mirrors app/(dashboard)/mpesa/reallocations:
 * MoneyActionDialog for approve (executes real money movement), a plain reason
 * dialog for reject.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Plus } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { StatusPill } from '@/components/shared/status-pill';
import { MoneyDisplay } from '@/components/shared/money-display';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { MoneyActionDialog } from '@/components/shared/confirm-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useHasOrganizationPermission } from '@/lib/auth/use-permission';
import { organizationApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/utils';
import type { PaginatedResult } from '@/types/db.types';
import { DISBURSEMENT_TYPES, PAYMENT_METHODS } from '@/lib/validators/organization.schema';

const PAYMENT_METHOD_LABELS: Record<typeof PAYMENT_METHODS[number], string> = {
  mpesa:          'M-Pesa',
  cash:           'Cash',
  cheque:         'Cheque',
  bank_transfer:  'Bank transfer',
  standing_order: 'Standing order',
};

/** Only these leave a number worth capturing. Cash has nothing to reference. */
const METHODS_WITH_REFERENCE = ['cheque', 'bank_transfer', 'standing_order'] as const;

interface DisbursementRow {
  id: string; group_id: string; group_name?: string;
  funding_program_id: string | null; program_name?: string | null;
  disbursement_type: string; amount: string; status: string;
  reference: string; notes: string | null; created_at: string;
  /** NULL for anything disbursed before migration 150 — "not recorded". */
  payment_method: string | null; payment_reference: string | null;
}

export default function DisbursementsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const canManageDisbursements = useHasOrganizationPermission();
  const [page, setPage] = useState(1);

  const [creating, setCreating] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [amount, setAmount] = useState('');
  const [disbursementType, setDisbursementType] = useState<typeof DISBURSEMENT_TYPES[number]>('grant');
  const [fundingProgramId, setFundingProgramId] = useState('');
  const [notes, setNotes] = useState('');
  // '' means "not recorded" and is sent as undefined — never defaulted to a
  // channel, because guessing invents an audit trail for real money.
  const [paymentMethod, setPaymentMethod] = useState<'' | typeof PAYMENT_METHODS[number]>('');
  const [paymentReference, setPaymentReference] = useState('');
  const [busy, setBusy] = useState(false);

  const [approving, setApproving] = useState<DisbursementRow | null>(null);
  const [rejecting, setRejecting] = useState<DisbursementRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data: walletData } = useQuery({
    queryKey: ['enterprise', 'wallet'],
    queryFn:  () => organizationApi.wallet(),
  });
  const { data: groupsPage } = useQuery({
    queryKey: ['enterprise', 'groups'],
    queryFn:  () => organizationApi.groups({ limit: 200 }),
  });
  const { data: programsData } = useQuery({
    queryKey: ['enterprise', 'programs'],
    queryFn:  () => organizationApi.programs(),
  });
  const { data, isLoading, isError, error } = useQuery<PaginatedResult<DisbursementRow>>({
    queryKey: ['enterprise', 'disbursements', page],
    queryFn:  async () => {
      const res = await organizationApi.disbursements({ page, limit: 20 });
      return { ...res, pageSize: res.limit ?? 20, totalPages: Math.max(1, Math.ceil(res.total / (res.limit ?? 20))) };
    },
  });

  const groups = groupsPage?.items ?? [];
  const programs = (programsData as unknown as {
    items: { id: string; name: string; status: string; processing_fee_pct: string | null }[];
  } | undefined)?.items ?? [];
  const selectedProgram = programs.find((p) => p.id === fundingProgramId);
  const feePct = selectedProgram?.processing_fee_pct ? parseFloat(selectedProgram.processing_fee_pct) : 0;
  const parsedAmountPreview = parseFloat(amount);
  const netPreview = feePct > 0 && parsedAmountPreview > 0
    ? parsedAmountPreview - Math.round(parsedAmountPreview * feePct) / 100
    : null;
  const availableBalance = walletData ? parseFloat(walletData.wallet.available_balance) : null;

  const refresh = () => qc.invalidateQueries({ queryKey: ['enterprise', 'disbursements'] });
  const refreshWallet = () => qc.invalidateQueries({ queryKey: ['enterprise', 'wallet'] });

  const resetForm = () => {
    setGroupId(''); setAmount(''); setDisbursementType('grant'); setFundingProgramId(''); setNotes('');
    setPaymentMethod(''); setPaymentReference('');
  };

  const submitDisbursement = async () => {
    const parsedAmount = parseFloat(amount);
    if (!groupId || !(parsedAmount > 0)) {
      toast({ variant: 'destructive', title: 'Pick a branch and enter a valid amount' });
      return;
    }
    setBusy(true);
    try {
      const res = await organizationApi.disburse({
        groupId, amount: parsedAmount, disbursementType,
        fundingProgramId: fundingProgramId || undefined,
        notes: notes.trim() || undefined,
        paymentMethod: paymentMethod || undefined,
        paymentReference: paymentReference.trim() || undefined,
      });
      toast({
        title: res.needsApproval
          ? 'Disbursement submitted — awaiting a second officer'
          : 'Disbursement sent',
      });
      setCreating(false);
      resetForm();
      await Promise.all([refresh(), refreshWallet()]);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Disbursement failed', description: err instanceof ApiError ? err.message : '' });
    } finally {
      setBusy(false);
    }
  };

  const approve = async (row: DisbursementRow) => {
    setBusy(true);
    try {
      await organizationApi.disbursementAction(row.id, { action: 'approve' });
      toast({ title: 'Disbursement approved and sent' });
      setApproving(null);
      await Promise.all([refresh(), refreshWallet()]);
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
      await organizationApi.disbursementAction(rejecting.id, { action: 'reject', reason: rejectReason.trim() });
      toast({ title: 'Disbursement rejected — reservation released' });
      setRejecting(null); setRejectReason('');
      await Promise.all([refresh(), refreshWallet()]);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Rejection failed', description: err instanceof ApiError ? err.message : '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Disbursements"
        description="Send funds from your organization wallet to a branch, and approve pending requests."
        breadcrumbs={[{ label: 'Portfolio', href: '/enterprise' }, { label: 'Disbursements' }]}
        actions={
          canManageDisbursements ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={15} className="mr-2" /> New disbursement
            </Button>
          ) : undefined
        }
      />

      {availableBalance !== null && (
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <Banknote size={18} />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">Available wallet balance</p>
                <MoneyDisplay amount={availableBalance} size="md" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <PaginatedTable<DisbursementRow>
        data={data}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onPageChange={setPage}
        emptyMessage="No disbursements yet"
        emptyDescription="Send your first disbursement to a branch using the button above."
        emptyIcon={Banknote}
        columns={[
          {
            key: 'group', header: 'Branch',
            render: (r) => (
              <div>
                <p className="font-medium text-foreground">{r.group_name ?? '—'}</p>
                <p className="text-xs text-muted-foreground">{r.reference}</p>
              </div>
            ),
          },
          {
            key: 'program', header: 'Program',
            render: (r) => <span className="text-muted-foreground">{r.program_name ?? '—'}</span>,
          },
          {
            key: 'type', header: 'Type',
            render: (r) => <span className="capitalize text-muted-foreground">{r.disbursement_type.replace(/_/g, ' ')}</span>,
          },
          {
            key: 'amount', header: 'Amount', className: 'text-right',
            render: (r) => <MoneyDisplay amount={parseFloat(r.amount)} size="sm" />,
          },
          {
            // "Not recorded" is shown plainly rather than blank — a dash reads
            // as "no data available", when the real meaning is that nobody
            // captured how the money moved.
            key: 'paid_by', header: 'Paid by',
            render: (r) => (r.payment_method ? (
              <span className="text-muted-foreground">
                {PAYMENT_METHOD_LABELS[r.payment_method as typeof PAYMENT_METHODS[number]] ?? r.payment_method}
                {r.payment_reference ? ` · ${r.payment_reference}` : ''}
              </span>
            ) : (
              <span className="text-xs italic text-muted-foreground/70">Not recorded</span>
            )),
          },
          {
            key: 'status', header: 'Status',
            render: (r) => (
              <StatusPill
                status={r.status}
                tone={r.status === 'pending_approval' ? 'pending' : r.status === 'rejected' ? 'negative' : 'positive'}
                label={r.status.replace(/_/g, ' ')}
                size="sm"
              />
            ),
          },
          {
            key: 'date', header: 'Date',
            render: (r) => <span className="text-muted-foreground">{formatDate(r.created_at)}</span>,
          },
          {
            key: 'actions', header: '', className: 'text-right',
            render: (r) => (
              r.status === 'pending_approval' && canManageDisbursements ? (
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setRejecting(r); setRejectReason(''); }} disabled={busy}>
                    Reject
                  </Button>
                  <Button size="sm" onClick={() => setApproving(r)} disabled={busy}>
                    Approve
                  </Button>
                </div>
              ) : null
            ),
          },
        ]}
      />

      {/* New disbursement */}
      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Send a disbursement</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Branch</Label>
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select branch…</option>
                {groups.map((g) => (
                  <option key={g.groupId} value={g.groupId}>{g.groupName}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Amount (KES)</Label>
              <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <select
                value={disbursementType}
                onChange={(e) => setDisbursementType(e.target.value as typeof disbursementType)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm capitalize"
              >
                {DISBURSEMENT_TYPES.map((t) => (
                  <option key={t} value={t} className="capitalize">{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            {programs.length > 0 && (
              <div className="space-y-1">
                <Label>Funding program (optional)</Label>
                <select
                  value={fundingProgramId}
                  onChange={(e) => setFundingProgramId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">None</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.processing_fee_pct ? ` (${p.processing_fee_pct}% processing fee)` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {netPreview !== null && (
              <p className="text-sm rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                Branch receives <strong>KES {netPreview.toLocaleString()}</strong> in cash
                (KES {parsedAmountPreview.toLocaleString()} minus the {feePct}% processing fee) —
                the branch still owes the full KES {parsedAmountPreview.toLocaleString()} as principal.
                Enter a larger amount here if you need a specific net figure to reach the branch.
              </p>
            )}
            <div className="space-y-1">
              <Label>How was it paid? (optional)</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={paymentMethod}
                onChange={(e) => {
                  const next = e.target.value as typeof paymentMethod;
                  setPaymentMethod(next);
                  // Clearing the method must clear the reference too, or the
                  // DB check constraint rejects a reference with no method.
                  if (!next || !METHODS_WITH_REFERENCE.includes(next as never)) setPaymentReference('');
                }}
              >
                <option value="">Not recorded</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Cash and cheque leave no receipt of their own — recording it here is the only trace.
              </p>
            </div>
            {/* Cash has no number to capture, so the field only appears for the
                channels that actually produce one. */}
            {METHODS_WITH_REFERENCE.includes(paymentMethod as never) && (
              <div className="space-y-1">
                <Label>
                  {paymentMethod === 'cheque' ? 'Cheque number' : 'Transfer reference'} (optional)
                </Label>
                <Input
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  placeholder={paymentMethod === 'cheque' ? 'e.g. 004512' : 'e.g. bank slip no.'}
                />
              </div>
            )}
            <div className="space-y-1">
              <Label>Notes (optional)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Q3 revolving fund top-up" />
            </div>
            <p className="text-xs text-muted-foreground">
              Disbursements above your organization&apos;s approval threshold need a second officer to approve.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={submitDisbursement} loading={busy} disabled={!canManageDisbursements}>Send disbursement</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve — executes the money move immediately */}
      {approving && (
        <MoneyActionDialog
          open={!!approving}
          onOpenChange={(o) => !o && setApproving(null)}
          title="Approve this disbursement?"
          amount={parseFloat(approving.amount)}
          details={[
            { label: 'Branch', value: approving.group_name ?? '—' },
            { label: 'Program', value: approving.program_name ?? '—' },
            { label: 'Type', value: approving.disbursement_type.replace(/_/g, ' ') },
            { label: 'Reference', value: approving.reference },
          ]}
          warning="Approving sends the funds immediately — the wallet balance and the branch's own ledger both update."
          confirmLabel="Approve & send"
          onConfirm={() => approve(approving)}
        />
      )}

      {/* Reject */}
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Reject disbursement</DialogTitle></DialogHeader>
          <div className="space-y-1">
            <Label>Rejection reason</Label>
            <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Why is this disbursement being rejected?" />
          </div>
          <DialogFooter>
            <Button variant="destructive" onClick={reject} loading={busy} disabled={!canManageDisbursements}>Reject disbursement</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
