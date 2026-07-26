'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowLeft, CheckCircle2, Loader2, Send, XCircle, Wallet, Coins,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from '@/lib/api/client';

// ── Types ──────────────────────────────────────────────────────────────

type Status = 'draft' | 'pending_approval' | 'approved' | 'paid' | 'cancelled';

interface Declaration {
  id: string; group_id: string;
  period_label: string; period_start: string; period_end: string;
  pool_amount: string; policy_type: string; policy_config: Record<string, unknown>;
  share_class_ids: string[]; withholding_tax_rate: string;
  status: Status; notes: string | null;
  total_eligible_members: number; total_shares_snapshot: string;
  total_allocated: string; total_tax: string; total_paid: string;
  declared_by: string; declared_at: string;
  approved_by: string | null; approved_at: string | null;
  snapshot_at: string | null; paid_at: string | null;
  cancelled_at: string | null; cancellation_reason: string | null;
}

interface AllocationPreview {
  memberId: string; firstName: string; lastName: string; phone: string;
  sharesHeld: number; weightFactor: number;
  grossAmount: string; taxAmount: string; netAmount: string;
}
interface Allocation {
  id: string; member_id: string;
  shares_held: number; weight_factor: string;
  gross_amount: string; tax_amount: string; net_amount: string;
  status: 'pending' | 'paid' | 'reinvested' | 'cancelled';
  payment_method: string | null; payment_reference: string | null;
  paid_at: string | null;
  member_first_name: string; member_last_name: string; member_phone: string;
}
interface Preview {
  rows: AllocationPreview[];
  totalEligibleMembers: number; totalSharesSnapshot: number;
  totalGross: string; totalTax: string; totalNet: string;
  roundingRemainder: string;
}

const fmtMoney = (v: string | number | null | undefined) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 2 }).format(Number(v ?? 0));
const fmtPct   = (rate: string | number) =>
  (Number(rate) * 100).toFixed(rate.toString().length > 5 ? 2 : 0) + '%';

const STATUS_BADGE: Record<Status, 'default' | 'success' | 'secondary' | 'warning' | 'destructive' | 'outline'> = {
  draft:            'secondary',
  pending_approval: 'warning',
  approved:         'default',
  paid:             'success',
  cancelled:        'outline',
};

const ALLOC_BADGE: Record<string, 'default' | 'success' | 'secondary' | 'warning' | 'destructive' | 'outline'> = {
  pending:    'warning',
  paid:       'success',
  reinvested: 'default',
  cancelled:  'outline',
};

// ── Page ───────────────────────────────────────────────────────────────

export default function DividendDetailPage() {
  const params = useParams<{ id: string }>();
  const id     = params.id;
  const qc     = useQueryClient();
  const { toast } = useToast();

  const declQ = useQuery<Declaration>({
    queryKey: ['dividend', id],
    queryFn:  () => api.get<Declaration>(`/dividends/${id}`),
  });
  const decl = declQ.data;

  // Pre-approval → show virtual preview. Post-approval → show persisted allocations.
  const showPreview = decl && (decl.status === 'draft' || decl.status === 'pending_approval');
  const previewQ = useQuery<Preview>({
    queryKey: ['dividend', id, 'preview'],
    queryFn:  () => api.get<Preview>(`/dividends/${id}/preview`),
    enabled:  Boolean(showPreview),
  });
  const allocsQ = useQuery<{ items: Allocation[] }>({
    queryKey: ['dividend', id, 'allocations'],
    queryFn:  () => api.get<{ items: Allocation[] }>(`/dividends/${id}/allocations`),
    enabled:  Boolean(decl) && !showPreview,
  });

  const [cancelOpen, setCancelOpen]   = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [payOpen,    setPayOpen]      = useState<Allocation | null>(null);
  const [bulkOpen,   setBulkOpen]     = useState(false);
  const [selected,   setSelected]     = useState<Set<string>>(new Set());
  const [busy,       setBusy]         = useState(false);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['dividend', id] }),
      qc.invalidateQueries({ queryKey: ['dividend', id, 'preview'] }),
      qc.invalidateQueries({ queryKey: ['dividend', id, 'allocations'] }),
      qc.invalidateQueries({ queryKey: ['dividends', 'list'] }),
    ]);
  };

  const onSubmit  = async () => { setBusy(true); try {
    await api.post(`/dividends/${id}/submit`, {});
    toast({ title: 'Submitted for approval' });
    await refresh();
  } catch (e) { toast({ variant: 'destructive', title: 'Failed', description: e instanceof ApiError ? e.message : '' }); }
  finally { setBusy(false); } };

  const onApprove = async () => { setBusy(true); try {
    await api.post(`/dividends/${id}/approve`, {});
    toast({ title: 'Approved', description: 'Allocations have been computed and persisted.' });
    await refresh();
  } catch (e) { toast({ variant: 'destructive', title: 'Failed', description: e instanceof ApiError ? e.message : '' }); }
  finally { setBusy(false); } };

  if (declQ.isLoading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!decl) {
    return <div className="p-6"><p className="text-muted-foreground">Declaration not found.</p></div>;
  }

  const allocItems = allocsQ.data?.items ?? [];
  const previewRows = previewQ.data?.rows ?? [];
  const pendingSelectableIds = allocItems.filter((a) => a.status === 'pending').map((a) => a.id);
  const allSelected = pendingSelectableIds.length > 0 && pendingSelectableIds.every((id) => selected.has(id));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <Link href="/dividends" className="text-muted-foreground hover:text-foreground mt-1">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{decl.period_label}</h1>
            <p className="text-sm text-muted-foreground">
              {new Date(decl.period_start).toLocaleDateString()} → {new Date(decl.period_end).toLocaleDateString()}
            </p>
          </div>
          <Badge variant={STATUS_BADGE[decl.status]} className="capitalize mt-2">{decl.status.replace('_', ' ')}</Badge>
        </div>

        {/* Status-driven actions */}
        <div className="flex flex-wrap items-center gap-2">
          {decl.status === 'draft' && (
            <>
              <Button onClick={onSubmit} disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Submit for approval
              </Button>
              <Button variant="outline" onClick={() => setCancelOpen(true)}>Cancel</Button>
            </>
          )}
          {decl.status === 'pending_approval' && (
            <>
              <Button onClick={() => setApproveOpen(true)} disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Approve &amp; snapshot
              </Button>
              <Button variant="outline" onClick={() => setCancelOpen(true)}>Cancel</Button>
            </>
          )}
          {decl.status === 'approved' && (
            <>
              <Button disabled={selected.size === 0} onClick={() => setBulkOpen(true)}>
                <Wallet className="mr-2 h-4 w-4" /> Pay selected ({selected.size})
              </Button>
              <Button variant="outline" onClick={() => setCancelOpen(true)}>Cancel</Button>
            </>
          )}
        </div>
      </div>

      {/* Info card */}
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Pool"      value={fmtMoney(decl.pool_amount)}   />
        <Stat label="Allocated" value={fmtMoney(decl.total_allocated)} sub={decl.total_eligible_members ? `${decl.total_eligible_members} members` : undefined} />
        <Stat label="Paid"      value={fmtMoney(decl.total_paid)}    sub={Number(decl.total_allocated) > 0 ? `${Math.round((Number(decl.total_paid) / Number(decl.total_allocated)) * 100)}% of allocated` : undefined} />
        <Stat label="Tax"       value={fmtMoney(decl.total_tax)}     sub={`${fmtPct(decl.withholding_tax_rate)} rate`} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Declaration details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <Field label="Policy"             value={(decl.policy_type === 'flat_per_member' ? 'Flat per member' : decl.policy_type === 'proportional_to_shares' ? 'Proportional to shares' : decl.policy_type)} />
          <Field label="Eligible classes"   value={decl.share_class_ids.length === 0 ? 'All active classes' : `${decl.share_class_ids.length} class(es)`} />
          <Field label="Declared"           value={new Date(decl.declared_at).toLocaleString()} />
          <Field label="Approved"           value={decl.approved_at ? new Date(decl.approved_at).toLocaleString() : '—'} />
          <Field label="Snapshot taken"     value={decl.snapshot_at ? new Date(decl.snapshot_at).toLocaleString() : '—'} />
          <Field label="Paid out"           value={decl.paid_at ? new Date(decl.paid_at).toLocaleString() : '—'} />
          {decl.notes && <Field label="Notes" value={decl.notes} />}
          {decl.cancellation_reason && <Field label="Cancellation reason" value={decl.cancellation_reason} />}
        </CardContent>
      </Card>

      {/* Allocations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between gap-3">
            <span>{showPreview ? 'Allocation preview (not yet committed)' : 'Allocations'}</span>
            {showPreview && previewQ.data && (
              <span className="text-xs font-normal text-muted-foreground">
                Pool {fmtMoney(decl.pool_amount)} → {previewQ.data.totalEligibleMembers} member(s) · rounding remainder {fmtMoney(previewQ.data.roundingRemainder)}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {previewQ.isLoading || allocsQ.isLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : showPreview ? (
            previewRows.length === 0 ? (
              <EmptyAllocs message="No eligible shareholders — at least one member with shares is required before approval." />
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Member</th>
                    <th className="px-4 py-3 text-right">Shares</th>
                    <th className="px-4 py-3 text-right">Gross</th>
                    <th className="px-4 py-3 text-right">Tax</th>
                    <th className="px-4 py-3 text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r) => (
                    <tr key={r.memberId} className="border-b last:border-b-0">
                      <td className="px-4 py-2">
                        <p className="font-medium">{r.firstName} {r.lastName}</p>
                        <p className="font-mono text-xs text-muted-foreground">{r.phone}</p>
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{r.sharesHeld}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmtMoney(r.grossAmount)}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmtMoney(r.taxAmount)}</td>
                      <td className="px-4 py-2 text-right font-mono font-medium">{fmtMoney(r.netAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : allocItems.length === 0 ? (
            <EmptyAllocs message="No allocations recorded." />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  {decl.status === 'approved' && (
                    <th className="w-8 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => {
                          if (e.target.checked) setSelected(new Set(pendingSelectableIds));
                          else                  setSelected(new Set());
                        }}
                        aria-label="Select all pending allocations"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3 text-right">Shares</th>
                  <th className="px-4 py-3 text-right">Gross</th>
                  <th className="px-4 py-3 text-right">Tax</th>
                  <th className="px-4 py-3 text-right">Net</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {allocItems.map((a) => (
                  <tr key={a.id} className={`border-b last:border-b-0 hover:bg-muted/30 ${a.status === 'cancelled' ? 'opacity-60' : ''}`}>
                    {decl.status === 'approved' && (
                      <td className="px-4 py-2">
                        {a.status === 'pending' && (
                          <input
                            type="checkbox"
                            checked={selected.has(a.id)}
                            onChange={(e) => setSelected((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(a.id);
                              else                  next.delete(a.id);
                              return next;
                            })}
                            aria-label={`Select ${a.member_first_name} ${a.member_last_name}`}
                          />
                        )}
                      </td>
                    )}
                    <td className="px-4 py-2">
                      <p className="font-medium">{a.member_first_name} {a.member_last_name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{a.member_phone}</p>
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{a.shares_held}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtMoney(a.gross_amount)}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtMoney(a.tax_amount)}</td>
                    <td className="px-4 py-2 text-right font-mono font-medium">{fmtMoney(a.net_amount)}</td>
                    <td className="px-4 py-2"><Badge variant={ALLOC_BADGE[a.status] ?? 'outline'} className="capitalize">{a.status}</Badge></td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {a.payment_method ? (
                        <>
                          <p className="capitalize">{a.payment_method.replace('_', ' ')}</p>
                          {a.payment_reference && <p className="font-mono">{a.payment_reference}</p>}
                          {a.paid_at && <p>{new Date(a.paid_at).toLocaleDateString()}</p>}
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {decl.status === 'approved' && a.status === 'pending' && (
                        <Button size="sm" variant="outline" onClick={() => setPayOpen(a)}>
                          <Wallet className="mr-1.5 h-3 w-3" /> Pay
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title="Approve & snapshot this declaration?"
        description={`Locks in the ${fmtMoney(decl.pool_amount)} pool across ${previewQ.data?.totalEligibleMembers ?? decl.total_eligible_members ?? 'the eligible'} shareholder(s) at today's share balances. Allocations are computed and persisted — after this, changes require cancelling the whole declaration.`}
        confirmLabel="Approve & snapshot"
        onConfirm={onApprove}
      />

      <CancelDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        onConfirm={async (reason) => {
          try {
            await api.post(`/dividends/${id}/cancel`, { reason });
            toast({ title: 'Cancelled' });
            setCancelOpen(false);
            await refresh();
          } catch (e) {
            toast({ variant: 'destructive', title: 'Cancel failed', description: e instanceof ApiError ? e.message : '' });
          }
        }}
      />

      <PayDialog
        allocation={payOpen}
        onOpenChange={(open) => { if (!open) setPayOpen(null); }}
        onConfirm={async (paymentMethod, paymentReference) => {
          if (!payOpen) return;
          try {
            await api.post(`/dividends/${id}/allocations/${payOpen.id}/pay`, {
              paymentMethod, ...(paymentReference ? { paymentReference } : {}),
            });
            toast({ title: 'Payment recorded' });
            setPayOpen(null);
            await refresh();
          } catch (e) {
            toast({ variant: 'destructive', title: 'Payment failed', description: e instanceof ApiError ? e.message : '' });
          }
        }}
      />

      <BulkPayDialog
        open={bulkOpen}
        count={selected.size}
        onOpenChange={setBulkOpen}
        onConfirm={async (paymentMethod, paymentReference) => {
          try {
            const result = await api.post<{ paid: number; skipped: { id: string; reason: string }[] }>(
              `/dividends/${id}/allocations/bulk-pay`,
              { allocationIds: Array.from(selected), paymentMethod, ...(paymentReference ? { paymentReference } : {}) },
            );
            toast({
              title: `Paid ${result.paid} allocation(s)`,
              description: result.skipped.length > 0 ? `${result.skipped.length} skipped` : undefined,
            });
            setBulkOpen(false);
            setSelected(new Set());
            await refresh();
          } catch (e) {
            toast({ variant: 'destructive', title: 'Bulk pay failed', description: e instanceof ApiError ? e.message : '' });
          }
        }}
      />
    </div>
  );
}

// ── Small subcomponents ────────────────────────────────────────────────

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-0.5">{value}</p>
    </div>
  );
}

function EmptyAllocs({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
      <Coins className="h-8 w-8" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ── Modals ─────────────────────────────────────────────────────────────

function CancelDialog({ open, onOpenChange, onConfirm }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy]     = useState(false);
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setReason(''); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader><DialogTitle className="flex items-center gap-2"><XCircle className="h-5 w-5" /> Cancel declaration</DialogTitle></DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="cancelReason">Reason</Label>
          <Input id="cancelReason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Keep declaration</Button>
          <Button
            variant="destructive"
            disabled={reason.trim().length < 3 || busy}
            onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); } finally { setBusy(false); } }}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const paySchema = z.object({
  paymentMethod:    z.enum(['mpesa', 'cash', 'bank_transfer', 'cheque', 'other']),
  paymentReference: z.string().optional(),
});
type PayForm = z.infer<typeof paySchema>;

function PayDialog({ allocation, onOpenChange, onConfirm }: {
  allocation: Allocation | null;
  onOpenChange: (v: boolean) => void;
  onConfirm: (method: string, reference: string | undefined) => Promise<void>;
}) {
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<PayForm>({
    resolver: zodResolver(paySchema),
    defaultValues: { paymentMethod: 'mpesa' },
  });
  if (!allocation) return null;
  return (
    <Dialog open={true} onOpenChange={(v) => { if (!v) { reset(); onOpenChange(false); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
        <p className="text-sm">
          <strong>{allocation.member_first_name} {allocation.member_last_name}</strong> · {fmtMoney(allocation.net_amount)}
        </p>
        <form onSubmit={handleSubmit(async (v) => { await onConfirm(v.paymentMethod, v.paymentReference?.trim() || undefined); reset(); })} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="method">Payment method</Label>
            <select id="method" {...register('paymentMethod')} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="mpesa">M-Pesa</option>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ref">Reference (optional)</Label>
            <Input id="ref" placeholder="M-Pesa receipt or bank ref" {...register('paymentReference')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BulkPayDialog({ open, count, onOpenChange, onConfirm }: {
  open: boolean; count: number; onOpenChange: (v: boolean) => void;
  onConfirm: (method: string, reference: string | undefined) => Promise<void>;
}) {
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<PayForm>({
    resolver: zodResolver(paySchema),
    defaultValues: { paymentMethod: 'mpesa' },
  });
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Bulk pay {count} allocation(s)</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Same payment method/reference is recorded against each selected allocation. Already-paid or cancelled rows are skipped.</p>
        <form onSubmit={handleSubmit(async (v) => { await onConfirm(v.paymentMethod, v.paymentReference?.trim() || undefined); reset(); })} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="bulkMethod">Payment method</Label>
            <select id="bulkMethod" {...register('paymentMethod')} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="mpesa">M-Pesa</option>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="bulkRef">Reference (optional)</Label>
            <Input id="bulkRef" placeholder="Common ref applied to every paid row" {...register('paymentReference')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm bulk pay
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
