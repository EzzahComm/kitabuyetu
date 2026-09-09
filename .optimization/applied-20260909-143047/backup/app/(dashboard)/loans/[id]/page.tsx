'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle, XCircle, DollarSign, Smartphone, AlertTriangle, Ban } from 'lucide-react';
import { api, ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusPill } from '@/components/shared/status-pill';
import { PageHeader } from '@/components/shared/page-header';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog, MoneyActionDialog } from '@/components/shared/confirm-dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useLoan, useLoanAction, useRecordRepayment } from '@/hooks/use-loans';
import { useHasPermission } from '@/lib/auth/use-permission';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

// Mirrors RecordRepaymentSchema field-for-field. It used to be
// {amount, paymentMethod, reference}, none of which the API accepts —
// installmentNumber/amountPaid/paymentDate are all required there, so every
// repayment recorded through this dialog 400'd.
const repaySchema = z.object({
  installmentNumber:  z.coerce.number().int().min(1),
  amountPaid:         z.coerce.number().positive(),
  paymentDate:        z.string().min(1),
  paymentMethod:      z.enum(['mpesa', 'cash', 'bank_transfer', 'cheque', 'standing_order']),
  mpesaReceiptNumber: z.string().optional(),
  penaltyAmount:      z.coerce.number().min(0).optional(),
});

export default function LoanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [repayOpen, setRepayOpen] = useState(false);
  const [mpesaOpen, setMpesaOpen] = useState(false);
  const [b2cPhone,  setB2cPhone]  = useState('');
  const [b2cAmount, setB2cAmount] = useState('');
  const [b2cIdempotencyKey, setB2cIdempotencyKey] = useState('');
  const [b2cConfirmOpen, setB2cConfirmOpen] = useState(false);
  // Only 'approve' can go through a bare confirm — RejectLoanSchema needs a
  // reason and DisburseLoanSchema needs a date + payment method, so those two
  // get real dialogs instead (previously all three posted just {action} and
  // reject/disburse 400'd every time).
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [rejectOpen, setRejectOpen]     = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [disburseOpen, setDisburseOpen] = useState(false);
  const [disburseDate, setDisburseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [disburseMethod, setDisburseMethod] = useState<'cash' | 'bank_transfer' | 'cheque' | 'standing_order'>('cash');
  const [disburseRef, setDisburseRef]   = useState('');
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [defaultReason, setDefaultReason] = useState('');
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [writeOffReason, setWriteOffReason] = useState('');

  const { data: loan, isLoading, isError, error } = useLoan(id);
  const loanAction   = useLoanAction(id);
  const recordRepay  = useRecordRepayment(id);
  const canManageLoans = useHasPermission('loans.approve');

  type RepayForm = z.infer<typeof repaySchema>;
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<RepayForm>({
    resolver: zodResolver(repaySchema),
    defaultValues: {
      paymentMethod: 'mpesa' as const,
      paymentDate:   new Date().toISOString().slice(0, 10),
    },
  });

  const onApprove = async () => {
    try {
      await loanAction.mutateAsync({ action: 'approve' });
      toast({ title: 'Loan approved' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Approval failed', description: getErrorMessage(err) });
    }
  };

  const onReject = async () => {
    try {
      await loanAction.mutateAsync({ action: 'reject', reason: rejectReason.trim() });
      toast({ title: 'Loan rejected' });
      setRejectOpen(false); setRejectReason('');
    } catch (err) {
      toast({ variant: 'destructive', title: 'Rejection failed', description: getErrorMessage(err) });
    }
  };

  const onDisburse = async () => {
    try {
      await loanAction.mutateAsync({
        action:             'disburse',
        disbursementDate:   disburseDate,
        paymentMethod:      disburseMethod,
        mpesaReceiptNumber: disburseRef.trim() || null,
      });
      toast({ title: 'Loan marked disbursed' });
      setDisburseOpen(false); setDisburseRef('');
    } catch (err) {
      toast({ variant: 'destructive', title: 'Disbursement failed', description: getErrorMessage(err) });
    }
  };

  const onRepay = async (values: RepayForm) => {
    try {
      await recordRepay.mutateAsync({
        installmentNumber:  values.installmentNumber,
        amountPaid:         values.amountPaid,
        paymentDate:        values.paymentDate,
        paymentMethod:      values.paymentMethod,
        mpesaReceiptNumber: values.mpesaReceiptNumber?.trim() || null,
        penaltyAmount:      values.penaltyAmount ?? 0,
      });
      toast({ title: 'Repayment recorded' });
      setRepayOpen(false);
      reset();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(err) });
    }
  };

  if (isLoading) {
    return <div className="space-y-4">{Array.from({length:4}).map((_,i)=><Skeleton key={i} className="h-24 w-full"/>)}</div>;
  }

  if (isError) return <p className="text-destructive">{getErrorMessage(error)}</p>;
  if (!loan) return <p className="text-muted-foreground">Loan not found</p>;

  const l = loan;
  const schedule = l.schedule ?? [];
  // The picker offers only what can still be paid; the first entry is the
  // earliest unpaid installment, which is the default the <select> lands on.
  const unpaidSchedule = schedule.filter((r) => r.status !== 'completed' && r.status !== 'cancelled');

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" aria-label="Go back" asChild className="mt-1">
          <Link href="/loans"><ArrowLeft size={18}/></Link>
        </Button>
        <PageHeader
          className="flex-1"
          title="Loan Details"
          description={l.id}
          actions={<StatusPill status={l.status} />}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Card><CardContent className="p-4 space-y-2">
          <p className="text-sm text-muted-foreground">Member</p>
          <p className="font-semibold">{l.member_name ?? l.member_id}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 space-y-2">
          <p className="text-sm text-muted-foreground">Principal</p>
          <p className="font-bold text-xl">{formatKES(l.principal_amount)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 space-y-2">
          <p className="text-sm text-muted-foreground">Interest rate / Term</p>
          <p className="font-semibold">{l.interest_rate}% /mo × {l.loan_term_months} months</p>
          {/* Cadence is only worth a line when it is not the default — a
              weekly loan reads "12 months" above but has 52 instalments. */}
          {l.repayment_frequency && l.repayment_frequency !== 'monthly' && (
            <p className="text-xs text-muted-foreground">
              Repaid {l.repayment_frequency === 'biweekly' ? 'every 2 weeks' : l.repayment_frequency}
            </p>
          )}
        </CardContent></Card>
        <Card><CardContent className="p-4 space-y-2">
          <p className="text-sm text-muted-foreground">Outstanding balance</p>
          <p className="font-bold text-xl text-red-600">{formatKES(l.outstanding_balance ?? l.principal_amount)}</p>
        </CardContent></Card>
      </div>

      <div className="flex gap-2 flex-wrap">
        {l.status === 'pending' && canManageLoans && (
          <>
            <Button variant="default" onClick={() => setConfirmApprove(true)} loading={loanAction.isPending}>
              <CheckCircle size={16} className="mr-2"/> Approve
            </Button>
            <Button variant="destructive" onClick={() => setRejectOpen(true)} loading={loanAction.isPending}>
              <XCircle size={16} className="mr-2"/> Reject
            </Button>
          </>
        )}
        {l.status === 'approved' && canManageLoans && (
          <>
            <Button onClick={() => setDisburseOpen(true)} loading={loanAction.isPending} variant="outline">
              <DollarSign size={16} className="mr-2"/> Mark disbursed
            </Button>
            <Button onClick={() => {
              setB2cPhone(l.member_phone ?? '');
              setB2cAmount(String(Math.round(Number(l.principal_amount ?? 0))));
              // One key per dialog open: repeated clicks of "Send" while this
              // dialog is up are the SAME logical attempt (idempotent replay
              // returns the original result instead of a second real payout);
              // reopening the dialog is a deliberate new attempt.
              setB2cIdempotencyKey(crypto.randomUUID());
              setMpesaOpen(true);
            }}>
              <Smartphone size={16} className="mr-2"/> Disburse via M-Pesa
            </Button>
          </>
        )}
        {l.status === 'active' && canManageLoans && (
          <>
            <Button onClick={() => setRepayOpen(true)}>
              <DollarSign size={16} className="mr-2"/> Record repayment
            </Button>
            <Button variant="outline" onClick={() => setDefaultOpen(true)}>
              <AlertTriangle size={16} className="mr-2"/> Mark defaulted
            </Button>
          </>
        )}
        {l.status === 'defaulted' && canManageLoans && (
          <Button variant="destructive" onClick={() => setWriteOffOpen(true)}>
            <Ban size={16} className="mr-2"/> Write off
          </Button>
        )}
      </div>

      {schedule.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Repayment Schedule</CardTitle></CardHeader>
          <CardContent className="p-0">
            <PaginatedTable
              data={singlePage(schedule.map((s) => ({ ...s, id: String(s.installment_number) })))}
              isLoading={false}
              onPageChange={() => {}}
              emptyMessage="No repayment schedule"
              columns={[
                { key: 'installment_number', header: '#', render: (s) => s.installment_number },
                { key: 'due_date', header: 'Due Date', render: (s) => formatDate(s.due_date) },
                { key: 'principal_component', header: 'Principal', render: (s) => formatKES(s.principal_component) },
                { key: 'interest_component', header: 'Interest', render: (s) => formatKES(s.interest_component) },
                { key: 'total_due', header: 'EMI', className: 'font-semibold', render: (s) => formatKES(s.total_due) },
                { key: 'opening_balance', header: 'Balance', render: (s) => formatKES(s.opening_balance) },
                { key: 'status', header: 'Status', render: (s) => <StatusPill status={s.status} size="sm" /> },
              ]}
            />
          </CardContent>
        </Card>
      )}

      <Dialog open={repayOpen} onOpenChange={setRepayOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Record repayment</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(onRepay)} className="space-y-4">
            <div className="space-y-1">
              <Label>Installment</Label>
              <select {...register('installmentNumber')} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                {unpaidSchedule.length === 0 && <option value="">No unpaid installments</option>}
                {unpaidSchedule.map((row) => (
                  <option key={row.installment_number} value={row.installment_number}>
                    #{row.installment_number} · due {formatDate(row.due_date)} · {formatKES(row.total_due ?? 0)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Defaults to the earliest unpaid installment.</p>
            </div>
            <div className="space-y-1">
              <Label>Amount paid (KES)</Label>
              <Input type="number" step="0.01" {...register('amountPaid')} />
              {errors.amountPaid && <p className="text-xs text-destructive">{errors.amountPaid?.message as string}</p>}
            </div>
            <div className="space-y-1">
              <Label>Payment date</Label>
              <Input type="date" {...register('paymentDate')} />
              {errors.paymentDate && <p className="text-xs text-destructive">{errors.paymentDate?.message as string}</p>}
            </div>
            <div className="space-y-1">
              <Label>Payment method</Label>
              <select {...register('paymentMethod')} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="mpesa">M-Pesa</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cheque">Cheque</option>
                <option value="standing_order">Standing order</option>
              </select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Penalty (KES)</Label>
                <Input type="number" step="0.01" placeholder="0" {...register('penaltyAmount')} />
              </div>
              <div className="space-y-1">
                <Label>Receipt no. <span className="text-muted-foreground">(optional)</span></Label>
                <Input {...register('mpesaReceiptNumber')} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={()=>setRepayOpen(false)}>Cancel</Button>
              <Button type="submit" loading={isSubmitting}>Record</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={mpesaOpen} onOpenChange={setMpesaOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Disburse via M-Pesa (B2C)</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sends the loan amount straight to the member&apos;s phone. The loan flips to
              <span className="font-medium text-foreground"> disbursed</span> when Safaricom confirms.
            </p>
            <div className="space-y-1">
              <Label>Recipient phone</Label>
              <Input value={b2cPhone} onChange={(e) => setB2cPhone(e.target.value)} placeholder="2547…" />
            </div>
            <div className="space-y-1">
              <Label>Amount (KES)</Label>
              <Input type="number" min={1} step={1} value={b2cAmount} onChange={(e) => setB2cAmount(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMpesaOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                const amt = parseInt(b2cAmount, 10);
                if (!b2cPhone.trim()) { toast({ variant: 'destructive', title: 'Enter the recipient phone' }); return; }
                if (!amt || amt <= 0) { toast({ variant: 'destructive', title: 'Enter a whole-shilling amount' }); return; }
                setMpesaOpen(false);
                setB2cConfirmOpen(true);
              }}
            >
              Review &amp; send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MoneyActionDialog
        open={b2cConfirmOpen}
        onOpenChange={setB2cConfirmOpen}
        title="Disburse via M-Pesa"
        amount={parseInt(b2cAmount, 10) || 0}
        details={[
          { label: 'Recipient phone', value: b2cPhone.trim() },
          { label: 'Loan', value: l.id },
        ]}
        warning="Funds are sent to the member's phone immediately once confirmed. This cannot be undone."
        confirmLabel={`Send KES ${b2cAmount || '0'}`}
        onConfirm={async () => {
          const amt = parseInt(b2cAmount, 10);
          try {
            const res = await api.post<{ needsApproval: boolean }>('/mpesa/b2c', {
              phone:     b2cPhone.trim(),
              amount:    amt,
              occasion:  'Loan disbursement',
              commandId: 'BusinessPayment',
              loanId:    l.id,
            }, { headers: { 'Idempotency-Key': b2cIdempotencyKey } }); // gitleaks:allow — header name, not a secret; value is a client-generated crypto.randomUUID()
            toast({
              title: res.needsApproval ? 'Disbursement submitted for approval' : 'Disbursement initiated',
              description: res.needsApproval
                ? 'A second officer must approve this amount before it is sent.'
                : 'Loan will update when Safaricom confirms.',
            });
          } catch (err) {
            toast({ variant: 'destructive', title: 'Disbursement failed', description: err instanceof ApiError ? err.message : '' });
          }
        }}
      />

      <ConfirmDialog
        open={confirmApprove}
        onOpenChange={setConfirmApprove}
        title="Approve this loan?"
        description="The member will be able to receive disbursement once approved."
        confirmLabel="Approve"
        onConfirm={onApprove}
      />

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Reject this loan</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The member will be notified that their application was rejected. The reason is recorded on the loan.
            </p>
            <div className="space-y-1">
              <Label>Reason</Label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Why is this application being rejected?"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={rejectReason.trim().length < 5}
              loading={loanAction.isPending}
              onClick={onReject}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={disburseOpen} onOpenChange={setDisburseOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Mark this loan disbursed</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Records that {formatKES(l.principal_amount)} was handed to {l.member_name ?? 'the member'} outside
              M-Pesa and posts the disbursement to the books. Use &ldquo;Disburse via M-Pesa&rdquo; instead if the
              money should actually be sent.
            </p>
            <div className="space-y-1">
              <Label htmlFor="disburseDate">Disbursement date</Label>
              <Input id="disburseDate" type="date" value={disburseDate} onChange={(e) => setDisburseDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="disburseMethod">Payment method</Label>
              <select
                id="disburseMethod"
                value={disburseMethod}
                onChange={(e) => setDisburseMethod(e.target.value as typeof disburseMethod)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="cheque">Cheque</option>
                <option value="standing_order">Standing order</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="disburseRef">Reference <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="disburseRef" value={disburseRef} onChange={(e) => setDisburseRef(e.target.value)} placeholder="Cheque no., bank ref…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisburseOpen(false)}>Cancel</Button>
            <Button disabled={!disburseDate} loading={loanAction.isPending} onClick={onDisburse}>
              Mark disbursed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={defaultOpen} onOpenChange={setDefaultOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Mark this loan defaulted</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Flags this loan as uncollectible under normal repayment. It can then be written off by a different officer.
            </p>
            <div className="space-y-1">
              <Label>Reason</Label>
              <Textarea value={defaultReason} onChange={(e) => setDefaultReason(e.target.value)} placeholder="Why is this loan in default?" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDefaultOpen(false)}>Cancel</Button>
            <Button
              disabled={defaultReason.trim().length < 5}
              loading={loanAction.isPending}
              onClick={async () => {
                try {
                  await loanAction.mutateAsync({ action: 'default', reason: defaultReason });
                  toast({ title: 'Loan marked defaulted' });
                  setDefaultOpen(false);
                  setDefaultReason('');
                } catch (err) {
                  toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(err) });
                }
              }}
            >
              Mark defaulted
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={writeOffOpen} onOpenChange={setWriteOffOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Write off this loan</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Posts the outstanding balance ({formatKES(l.outstanding_balance ?? 0)}) to Loan Write-offs and removes it from Loans Receivable. This cannot be undone.
              Maker-checker: you cannot write off a loan you yourself marked defaulted.
            </p>
            <div className="space-y-1">
              <Label>Reason</Label>
              <Textarea value={writeOffReason} onChange={(e) => setWriteOffReason(e.target.value)} placeholder="Confirm why this debt is being written off" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWriteOffOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={writeOffReason.trim().length < 5}
              loading={loanAction.isPending}
              onClick={async () => {
                try {
                  await loanAction.mutateAsync({ action: 'writeOff', reason: writeOffReason });
                  toast({ title: 'Loan written off' });
                  setWriteOffOpen(false);
                  setWriteOffReason('');
                } catch (err) {
                  toast({ variant: 'destructive', title: 'Write-off failed', description: getErrorMessage(err) });
                }
              }}
            >
              Write off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
