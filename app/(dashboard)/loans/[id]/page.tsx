'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle, XCircle, DollarSign, Smartphone } from 'lucide-react';
import { api, ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusPill } from '@/components/shared/status-pill';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog, MoneyActionDialog } from '@/components/shared/confirm-dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useLoan, useLoanAction, useRecordRepayment } from '@/hooks/use-loans';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate } from '@/lib/utils';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

const repaySchema = z.object({
  amount:        z.coerce.number().positive(),
  paymentMethod: z.enum(['mpesa', 'cash', 'bank_transfer']),
  reference:     z.string().optional(),
});

export default function LoanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();
  const { toast } = useToast();
  const [repayOpen, setRepayOpen] = useState(false);
  const [mpesaOpen, setMpesaOpen] = useState(false);
  const [b2cPhone,  setB2cPhone]  = useState('');
  const [b2cAmount, setB2cAmount] = useState('');
  const [b2cIdempotencyKey, setB2cIdempotencyKey] = useState('');
  const [b2cConfirmOpen, setB2cConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | null>(null);

  const { data: loan, isLoading } = useLoan(id);
  const loanAction   = useLoanAction(id);
  const recordRepay  = useRecordRepayment(id);

  type RepayForm = z.infer<typeof repaySchema>;
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<RepayForm>({
    resolver: zodResolver(repaySchema),
    defaultValues: { paymentMethod: 'mpesa' as const },
  });

  const handleAction = async (action: string) => {
    try {
      await loanAction.mutateAsync({ action });
      toast({ title: `Loan ${action}d successfully` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Action failed', description: err.message });
    }
  };

  const onRepay = async (values: any) => {
    try {
      await recordRepay.mutateAsync(values);
      toast({ title: 'Repayment recorded' });
      setRepayOpen(false);
      reset();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Failed', description: err.message });
    }
  };

  if (isLoading) {
    return <div className="space-y-4">{Array.from({length:4}).map((_,i)=><Skeleton key={i} className="h-24 w-full"/>)}</div>;
  }

  if (!loan) return <p className="text-muted-foreground">Loan not found</p>;

  const l = loan as any;
  const schedule: any[] = l.repaymentSchedule ?? [];

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Go back" onClick={() => router.back()}><ArrowLeft size={18}/></Button>
        <div>
          <h1 className="text-2xl font-bold">Loan Details</h1>
          <p className="text-xs font-mono text-muted-foreground">{l.id}</p>
        </div>
        <StatusPill status={l.status} className="ml-auto" />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Card><CardContent className="p-4 space-y-2">
          <p className="text-sm text-muted-foreground">Member</p>
          <p className="font-semibold">{l.memberName ?? l.memberId}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 space-y-2">
          <p className="text-sm text-muted-foreground">Principal</p>
          <p className="font-bold text-xl">{formatKES(l.principalAmount)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 space-y-2">
          <p className="text-sm text-muted-foreground">Interest rate / Term</p>
          <p className="font-semibold">{l.interestRate}% /mo × {l.termMonths} months</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 space-y-2">
          <p className="text-sm text-muted-foreground">Outstanding balance</p>
          <p className="font-bold text-xl text-red-600">{formatKES(l.outstandingBalance ?? l.principalAmount)}</p>
        </CardContent></Card>
      </div>

      <div className="flex gap-2 flex-wrap">
        {l.status === 'pending' && (
          <>
            <Button variant="default" onClick={() => setConfirmAction('approve')} loading={loanAction.isPending}>
              <CheckCircle size={16} className="mr-2"/> Approve
            </Button>
            <Button variant="destructive" onClick={() => setConfirmAction('reject')} loading={loanAction.isPending}>
              <XCircle size={16} className="mr-2"/> Reject
            </Button>
          </>
        )}
        {l.status === 'approved' && (
          <>
            <Button onClick={() => handleAction('disburse')} loading={loanAction.isPending} variant="outline">
              <DollarSign size={16} className="mr-2"/> Mark disbursed
            </Button>
            <Button onClick={() => {
              setB2cPhone(l.memberPhone ?? l.member_phone ?? '');
              setB2cAmount(String(Math.round(Number(l.principalAmount ?? 0))));
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
        {l.status === 'active' && (
          <Button onClick={() => setRepayOpen(true)}>
            <DollarSign size={16} className="mr-2"/> Record repayment
          </Button>
        )}
      </div>

      {schedule.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Repayment Schedule</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {['#','Due Date','Principal','Interest','EMI','Balance','Status'].map((h)=>(
                    <th key={h} className="px-4 py-2 text-left font-medium text-muted-foreground text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedule.map((s: any) => (
                  <tr key={s.installmentNumber} className="border-t hover:bg-muted/20">
                    <td className="px-4 py-2">{s.installmentNumber}</td>
                    <td className="px-4 py-2">{formatDate(s.dueDate)}</td>
                    <td className="px-4 py-2">{formatKES(s.principalComponent)}</td>
                    <td className="px-4 py-2">{formatKES(s.interestComponent)}</td>
                    <td className="px-4 py-2 font-semibold">{formatKES(s.emiAmount)}</td>
                    <td className="px-4 py-2">{formatKES(s.openingBalance)}</td>
                    <td className="px-4 py-2">
                      <StatusPill status={s.status} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Dialog open={repayOpen} onOpenChange={setRepayOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Record repayment</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(onRepay)} className="space-y-4">
            <div className="space-y-1">
              <Label>Amount (KES)</Label>
              <Input type="number" step="0.01" {...register('amount')} />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount?.message as string}</p>}
            </div>
            <div className="space-y-1">
              <Label>Payment method</Label>
              <select {...register('paymentMethod')} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="mpesa">M-Pesa</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Reference (optional)</Label>
              <Input {...register('reference')} />
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
        open={confirmAction !== null}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title={confirmAction === 'approve' ? 'Approve this loan?' : 'Reject this loan?'}
        description={
          confirmAction === 'approve'
            ? 'The member will be able to receive disbursement once approved.'
            : 'The member will be notified that their loan application was rejected.'
        }
        variant={confirmAction === 'reject' ? 'danger' : 'default'}
        confirmLabel={confirmAction === 'approve' ? 'Approve' : 'Reject'}
        onConfirm={async () => {
          if (confirmAction) await handleAction(confirmAction);
        }}
      />
    </div>
  );
}
