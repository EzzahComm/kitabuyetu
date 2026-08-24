'use client';

/**
 * Investment detail.
 *
 * The investments module shipped with a create-only UI: the service, the API
 * routes and the hooks for updating, approving and recording returns all
 * existed, but nothing imported them, so through the product a group could add
 * an investment and never touch it again. Every holding stayed at
 * `pending_approval` with a NULL `current_value` forever, which is what made
 * the portfolio summary read as a loss.
 *
 * This page is the missing front end. It writes through the existing
 * PATCH /investments/:id and POST /investments/:id/returns routes — no new
 * service methods, no schema change.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, CheckCircle, Ban, TrendingUp, Coins, Landmark, CalendarClock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { StatusPill } from '@/components/shared/status-pill';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useInvestment, useUpdateInvestment, useRecordInvestmentReturn,
  type InvestmentReturnRow, type InvestmentShareRow,
} from '@/hooks/use-investments';
import { useHasPermission } from '@/lib/auth/use-permission';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

const typeLabels: Record<string, string> = {
  real_estate: 'Real Estate', shares: 'Shares', bonds: 'Bonds',
  fixed_deposit: 'Fixed Deposit', business: 'Business', land: 'Land',
  treasury_bills: 'Treasury Bills', money_market: 'Money Market', other: 'Other',
};

// Mirrors RecordReturnSchema. `coupon` is deliberately absent — it is not a
// member of the public.return_type enum and posting it fails at INSERT.
const returnSchema = z.object({
  returnType:    z.enum(['dividend', 'interest', 'capital_gain', 'rental_income', 'other']),
  amount:        z.coerce.number().positive(),
  returnDate:    z.string().min(1, 'Date required'),
  receiptNumber: z.string().optional(),
  notes:         z.string().optional(),
});
type ReturnForm = z.infer<typeof returnSchema>;

const returnTypeLabels: Record<ReturnForm['returnType'], string> = {
  dividend: 'Dividend', interest: 'Interest', capital_gain: 'Capital gain',
  rental_income: 'Rental income', other: 'Other',
};

export default function InvestmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const { data: inv, isLoading, isError, error } = useInvestment(id);
  const updateInvestment = useUpdateInvestment(id);
  const recordReturn     = useRecordInvestmentReturn(id);
  const canManage        = useHasPermission('investments.manage');

  const [approveOpen, setApproveOpen]     = useState(false);
  const [cancelOpen, setCancelOpen]       = useState(false);
  const [maturedOpen, setMaturedOpen]     = useState(false);
  const [revalueOpen, setRevalueOpen]     = useState(false);
  const [revalueAmount, setRevalueAmount] = useState('');
  const [liquidateOpen, setLiquidateOpen] = useState(false);
  const [liquidateAmount, setLiquidateAmount] = useState('');
  const [returnOpen, setReturnOpen]       = useState(false);

  const returnForm = useForm<ReturnForm>({
    resolver: zodResolver(returnSchema),
    defaultValues: {
      returnType: 'dividend',
      returnDate: new Date().toISOString().slice(0, 10),
    },
  });

  const runUpdate = async (
    body: Parameters<typeof updateInvestment.mutateAsync>[0],
    successTitle: string,
    onDone?: () => void,
  ) => {
    try {
      await updateInvestment.mutateAsync(body);
      toast({ title: successTitle });
      onDone?.();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(e) });
    }
  };

  const onRecordReturn = async (values: ReturnForm) => {
    try {
      await recordReturn.mutateAsync({
        returnType:    values.returnType,
        amount:        values.amount,
        returnDate:    values.returnDate,
        receiptNumber: values.receiptNumber?.trim() || undefined,
        notes:         values.notes?.trim() || undefined,
      });
      toast({ title: 'Return recorded' });
      setReturnOpen(false);
      returnForm.reset({
        returnType: 'dividend',
        returnDate: new Date().toISOString().slice(0, 10),
      });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(e) });
    }
  };

  if (isLoading) {
    return <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }
  if (isError) return <p className="text-destructive">{getErrorMessage(error)}</p>;
  if (!inv)    return <p className="text-muted-foreground">Investment not found</p>;

  const returns   = inv.returns ?? [];
  const shares    = inv.shares ?? [];
  const revalued  = inv.current_value !== null;
  const totalReturns = returns.reduce((sum, r) => sum + Number(r.amount), 0);
  // Carried at cost until someone records a revaluation, which is exactly how
  // the portfolio summary values it.
  const carryingValue = revalued ? Number(inv.current_value) : Number(inv.principal_amount);
  const isOpen = inv.status !== 'liquidated' && inv.status !== 'cancelled';

  const returnColumns = [
    {
      key: 'return_date', header: 'Date',
      render: (r: InvestmentReturnRow) => <span className="text-sm">{formatDate(r.return_date)}</span>,
    },
    {
      key: 'return_type', header: 'Type',
      render: (r: InvestmentReturnRow) => (
        <span className="text-sm">{returnTypeLabels[r.return_type as ReturnForm['returnType']] ?? r.return_type}</span>
      ),
    },
    {
      key: 'amount', header: 'Amount',
      render: (r: InvestmentReturnRow) => <span className="font-semibold text-sm text-blue-600">{formatKES(r.amount)}</span>,
    },
    {
      key: 'receipt_number', header: 'Receipt',
      render: (r: InvestmentReturnRow) => r.receipt_number
        ? <span className="text-sm">{r.receipt_number}</span>
        : <span className="text-muted-foreground text-sm">—</span>,
    },
    {
      key: 'recorded_by_name', header: 'Recorded by',
      render: (r: InvestmentReturnRow) => <span className="text-xs">{r.recorded_by_name}</span>,
    },
  ];

  const shareColumns = [
    {
      key: 'member_name', header: 'Member',
      render: (s: InvestmentShareRow) => <span className="text-sm font-medium">{s.member_name}</span>,
    },
    {
      key: 'amount_contributed', header: 'Contributed',
      render: (s: InvestmentShareRow) => <span className="text-sm font-semibold">{formatKES(s.amount_contributed)}</span>,
    },
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" aria-label="Back to investments" asChild className="mt-1">
          <Link href="/investments"><ArrowLeft size={18} /></Link>
        </Button>
        <PageHeader
          className="flex-1"
          title={inv.name}
          description={typeLabels[inv.investment_type] ?? inv.investment_type}
          actions={<StatusPill status={inv.status} tone={inv.status === 'pending_approval' ? 'pending' : undefined} />}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Card><CardContent className="p-4 space-y-1">
          <p className="text-sm text-muted-foreground">Principal</p>
          <p className="font-bold text-xl">{formatKES(inv.principal_amount)}</p>
        </CardContent></Card>

        <Card><CardContent className="p-4 space-y-1">
          <p className="text-sm text-muted-foreground">
            {revalued ? 'Current value' : 'Carrying value'}
          </p>
          <p className="font-bold text-xl">{formatKES(carryingValue)}</p>
          {!revalued && (
            <p className="text-xs text-muted-foreground">
              At cost — no revaluation recorded yet
            </p>
          )}
        </CardContent></Card>

        <Card><CardContent className="p-4 space-y-1">
          <p className="text-sm text-muted-foreground">Returns earned</p>
          <p className="font-bold text-xl text-blue-600">{formatKES(totalReturns)}</p>
          <p className="text-xs text-muted-foreground">
            {returns.length === 0 ? 'None recorded' : `${returns.length} recorded`}
          </p>
        </CardContent></Card>

        <Card><CardContent className="p-4 space-y-1">
          <p className="text-sm text-muted-foreground">Expected rate</p>
          <p className="font-semibold">
            {inv.expected_return_rate ? `${inv.expected_return_rate}%` : <span className="text-muted-foreground">Not set</span>}
          </p>
          {inv.custodian && <p className="text-xs text-muted-foreground">Held with {inv.custodian}</p>}
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-4 grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div className="flex items-center gap-2">
            <CalendarClock size={15} className="text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Started</span>
            <span className="ml-auto font-medium">{formatDate(inv.start_date)}</span>
          </div>
          <div className="flex items-center gap-2">
            <CalendarClock size={15} className="text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Matures</span>
            <span className="ml-auto font-medium">
              {inv.maturity_date ? formatDate(inv.maturity_date) : '—'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Landmark size={15} className="text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Recorded by</span>
            <span className="ml-auto font-medium">{inv.created_by_name}</span>
          </div>
          {inv.approved_by_name && (
            <div className="flex items-center gap-2">
              <CheckCircle size={15} className="text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Approved by</span>
              <span className="ml-auto font-medium">{inv.approved_by_name}</span>
            </div>
          )}
          {inv.liquidation_value && (
            <div className="flex items-center gap-2">
              <Coins size={15} className="text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Liquidated for</span>
              <span className="ml-auto font-medium">{formatKES(inv.liquidation_value)}</span>
            </div>
          )}
          {inv.notes && (
            <p className="sm:col-span-2 text-muted-foreground border-t pt-3">{inv.notes}</p>
          )}
        </CardContent>
      </Card>

      {canManage && isOpen && (
        <div className="flex gap-2 flex-wrap">
          {inv.status === 'pending_approval' && (
            <>
              <Button onClick={() => setApproveOpen(true)} loading={updateInvestment.isPending}>
                <CheckCircle size={16} className="mr-2" /> Approve
              </Button>
              <Button variant="outline" onClick={() => setCancelOpen(true)} loading={updateInvestment.isPending}>
                <Ban size={16} className="mr-2" /> Cancel
              </Button>
            </>
          )}
          {(inv.status === 'active' || inv.status === 'matured') && (
            <>
              <Button onClick={() => { setRevalueAmount(String(Math.round(carryingValue))); setRevalueOpen(true); }}>
                <TrendingUp size={16} className="mr-2" /> Update value
              </Button>
              <Button variant="outline" onClick={() => setReturnOpen(true)}>
                <Coins size={16} className="mr-2" /> Record return
              </Button>
              {inv.status === 'active' && (
                <Button variant="outline" onClick={() => setMaturedOpen(true)} loading={updateInvestment.isPending}>
                  Mark matured
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => { setLiquidateAmount(String(Math.round(carryingValue))); setLiquidateOpen(true); }}
              >
                Liquidate
              </Button>
            </>
          )}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Returns</CardTitle></CardHeader>
        <CardContent>
          <PaginatedTable
            data={singlePage(returns)}
            isLoading={false}
            onPageChange={() => {}}
            columns={returnColumns}
            emptyMessage="No returns recorded yet"
            emptyDescription={
              canManage && (inv.status === 'active' || inv.status === 'matured')
                ? 'Record a dividend, interest payment or capital gain as it is received.'
                : undefined
            }
          />
        </CardContent>
      </Card>

      {/* member_investment_shares has no writer anywhere in the product, so
          this section stays hidden rather than showing an empty table that
          implies per-member stakes are being tracked. */}
      {shares.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Member contributions</CardTitle></CardHeader>
          <CardContent>
            <PaginatedTable
              data={singlePage(shares)}
              isLoading={false}
              onPageChange={() => {}}
              columns={shareColumns}
              emptyMessage="None"
            />
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title="Approve this investment?"
        description="It becomes an active holding and starts counting toward the group's portfolio."
        confirmLabel="Approve"
        onConfirm={() => runUpdate({ status: 'active' }, 'Investment approved')}
      />

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this investment?"
        description="It will be excluded from the portfolio entirely. The record is kept for audit."
        confirmLabel="Cancel investment"
        cancelLabel="Keep"
        variant="danger"
        onConfirm={() => runUpdate({ status: 'cancelled' }, 'Investment cancelled')}
      />

      <ConfirmDialog
        open={maturedOpen}
        onOpenChange={setMaturedOpen}
        title="Mark as matured?"
        description="The holding stays in the portfolio and can still be revalued or liquidated."
        confirmLabel="Mark matured"
        onConfirm={() => runUpdate({ status: 'matured' }, 'Marked matured')}
      />

      <Dialog open={revalueOpen} onOpenChange={setRevalueOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Update current value</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              What is this holding worth today? This is what the portfolio total uses.
            </p>
            <div className="space-y-1">
              <Label htmlFor="revalue-amount">Current value (KES)</Label>
              <Input
                id="revalue-amount"
                type="number"
                step="0.01"
                min="0"
                value={revalueAmount}
                onChange={(e) => setRevalueAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Cost was {formatKES(inv.principal_amount)}.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevalueOpen(false)}>Cancel</Button>
            <Button
              loading={updateInvestment.isPending}
              disabled={!(Number(revalueAmount) > 0)}
              onClick={() => runUpdate(
                { currentValue: Number(revalueAmount) },
                'Value updated',
                () => setRevalueOpen(false),
              )}
            >
              Save value
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={liquidateOpen} onOpenChange={setLiquidateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Liquidate this investment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Record what the group actually received on exit. The holding leaves the
              active portfolio and is carried at this figure.
            </p>
            <div className="space-y-1">
              <Label htmlFor="liquidate-amount">Amount received (KES)</Label>
              <Input
                id="liquidate-amount"
                type="number"
                step="0.01"
                min="0"
                value={liquidateAmount}
                onChange={(e) => setLiquidateAmount(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLiquidateOpen(false)}>Cancel</Button>
            <Button
              loading={updateInvestment.isPending}
              disabled={!(Number(liquidateAmount) > 0)}
              onClick={() => runUpdate(
                { status: 'liquidated', liquidationValue: Number(liquidateAmount) },
                'Investment liquidated',
                () => setLiquidateOpen(false),
              )}
            >
              Liquidate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Record a return</DialogTitle></DialogHeader>
          <form onSubmit={returnForm.handleSubmit(onRecordReturn)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="return-type">Type</Label>
                <select
                  id="return-type"
                  {...returnForm.register('returnType')}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {(Object.keys(returnTypeLabels) as ReturnForm['returnType'][]).map((v) => (
                    <option key={v} value={v}>{returnTypeLabels[v]}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="return-amount">Amount (KES)</Label>
                <Input id="return-amount" type="number" step="0.01" {...returnForm.register('amount')} />
                {returnForm.formState.errors.amount && (
                  <p className="text-xs text-destructive">{returnForm.formState.errors.amount.message}</p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="return-date">Date received</Label>
                <Input id="return-date" type="date" {...returnForm.register('returnDate')} />
                {returnForm.formState.errors.returnDate && (
                  <p className="text-xs text-destructive">{returnForm.formState.errors.returnDate.message}</p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="return-receipt">Receipt number</Label>
                <Input id="return-receipt" placeholder="Optional" {...returnForm.register('receiptNumber')} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="return-notes">Notes</Label>
              <Input id="return-notes" placeholder="Optional" {...returnForm.register('notes')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setReturnOpen(false)}>Cancel</Button>
              <Button type="submit" loading={returnForm.formState.isSubmitting}>Record return</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
