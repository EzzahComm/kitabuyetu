'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { StatusPill } from '@/components/shared/status-pill';
import { useInvestments, useInvestmentSummary, useCreateInvestment, type InvestmentRow } from '@/hooks/use-investments';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';
import { useHasPermission } from '@/lib/auth/use-permission';

const createSchema = z.object({
  name:               z.string().min(3),
  description:        z.string().optional(),
  investmentType:     z.enum(['real_estate','shares','bonds','fixed_deposit','business','land','treasury_bills','money_market','other']),
  principalAmount:    z.coerce.number().positive(),
  expectedReturnRate: z.coerce.number().min(0).max(100).optional(),
  startDate:          z.string().min(1, 'Start date required'),
  maturityDate:       z.string().optional(),
  custodian:          z.string().optional(),
  notes:              z.string().optional(),
});

type CreateInvestmentForm = z.infer<typeof createSchema>;

const typeLabels: Record<string, string> = {
  real_estate: 'Real Estate', shares: 'Shares', bonds: 'Bonds',
  fixed_deposit: 'Fixed Deposit', business: 'Business', land: 'Land',
  treasury_bills: 'Treasury Bills', money_market: 'Money Market', other: 'Other',
};

export default function InvestmentsPage() {
  const [page, setPage]     = useState(1);
  const [status, setStatus] = useState('all');
  const [open, setOpen]     = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const canManage = useHasPermission('investments.manage');

  const { data, isLoading, isError, error } = useInvestments({ page, limit: 20, ...(status !== 'all' ? { status } : {}) });
  const { data: summary }      = useInvestmentSummary();
  const createInvestment       = useCreateInvestment();

  const form = useForm<CreateInvestmentForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { investmentType: 'shares' },
  });

  const onSubmit = async (values: CreateInvestmentForm) => {
    try {
      await createInvestment.mutateAsync(values);
      toast({ title: 'Investment recorded successfully' });
      setOpen(false); form.reset();
    } catch (e) { toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) }); }
  };

  const roi = summary?.roi ?? 0;
  // With nothing revalued and no returns recorded, every holding is carried at
  // cost and the ROI formula yields exactly 0% — which reads as a real
  // measurement rather than "no data yet". Show a dash until there is
  // something to measure.
  const roiMeasurable = summary?.roiMeasurable ?? false;

  const columns = [
    {
      key: 'name', header: 'Investment',
      render: (row: InvestmentRow) => (
        <div>
          <p className="font-medium text-sm">{row.name}</p>
          <p className="text-xs text-muted-foreground">{typeLabels[row.investment_type] ?? row.investment_type}</p>
        </div>
      ),
    },
    {
      key: 'principal_amount', header: 'Principal',
      render: (row: InvestmentRow) => <span className="font-semibold text-sm">{formatKES(row.principal_amount)}</span>,
    },
    {
      key: 'current_value', header: 'Current Value',
      // A holding with no revaluation is carried at cost, which is what the
      // portfolio total sums it as. Show that here rather than an em-dash,
      // otherwise the summary card and this column visibly disagree.
      render: (row: InvestmentRow) => row.current_value
        ? <span className="font-semibold text-sm text-green-600">{formatKES(row.current_value)}</span>
        : <span className="text-sm text-muted-foreground" title="Not revalued yet — shown at cost">{formatKES(row.principal_amount)}</span>,
    },
    {
      key: 'total_returns', header: 'Returns Earned',
      render: (row: InvestmentRow) => <span className="text-sm text-blue-600">{formatKES(row.total_returns ?? 0)}</span>,
    },
    {
      key: 'total_expenses', header: 'Running Costs',
      render: (row: InvestmentRow) => Number(row.total_expenses ?? 0) > 0
        ? <span className="text-sm text-amber-700">{formatKES(row.total_expenses)}</span>
        : <span className="text-muted-foreground text-sm">—</span>,
    },
    {
      key: 'status', header: 'Status',
      render: (row: InvestmentRow) => (
        <StatusPill status={row.status} tone={row.status === 'pending_approval' ? 'pending' : undefined} size="sm" />
      ),
    },
    {
      key: 'start_date', header: 'Start Date',
      render: (row: InvestmentRow) => <span className="text-xs">{formatDate(row.start_date)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Investments"
        description="Group investment portfolio tracking"
        actions={
          canManage ? (
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} className="mr-2" /> Add Investment
            </Button>
          ) : undefined
        }
      />

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Principal" value={formatKES(summary?.totalPrincipal ?? 0)} description={`${summary?.totalInvestments ?? 0} investments`} />
        <StatCard
          title="Current Portfolio Value"
          value={formatKES(summary?.totalCurrentValue ?? 0)}
          description={`${summary?.heldCount ?? 0} held`}
        />
        <StatCard
          title="Total Returns Earned"
          value={formatKES(summary?.totalReturns ?? 0)}
          description={
            Number(summary?.totalExpenses ?? 0) > 0
              ? `less ${formatKES(summary?.totalExpenses ?? 0)} running costs`
              : undefined
          }
        />
        {/* Not converted to StatCard: ROI's sign is a real positive/negative
            signal (colored value text + swapped Trending icon), which
            StatCard's plain string|number value can't represent — see
            component-reference guidance to skip rather than force this. */}
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Overall ROI
            </p>
            {roiMeasurable ? (
              <div className="flex items-center gap-2 mt-1">
                {roi >= 0
                  ? <TrendingUp className="text-green-500" size={20} />
                  : <TrendingDown className="text-red-500" size={20} />
                }
                <p className={`text-2xl font-bold ${roi >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {roi.toFixed(1)}%
                </p>
              </div>
            ) : (
              <div className="mt-1">
                <p className="text-2xl font-bold text-muted-foreground">—</p>
                <p className="text-xs text-muted-foreground">
                  Update a value, or record a return or expense, to measure
                </p>
              </div>
            )}
            {roiMeasurable && Number(summary?.totalExpenses ?? 0) > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">Net of running costs</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
        <TabsList>
          {['all','pending_approval','active','matured','liquidated'].map((s) => (
            <TabsTrigger key={s} value={s} className="capitalize">{s.replace('_',' ')}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={status} className="mt-4">
          <PaginatedTable
            data={data}
            isLoading={isLoading}
            isError={isError}
            error={error}
            columns={columns}
            onPageChange={setPage}
            onRowClick={(row) => router.push(`/investments/${row.id}`)}
            emptyMessage="No investments recorded yet"
          />
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Record Investment</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1">
              <Label>Investment Name</Label>
              <Input {...form.register('name')} placeholder="e.g. Nairobi Land Plot — Ruai" />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message as string}</p>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Type</Label>
                <select {...form.register('investmentType')} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  {Object.entries(typeLabels).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Principal Amount (KES)</Label>
                <Input type="number" step="0.01" {...form.register('principalAmount')} />
              </div>
              <div className="space-y-1">
                <Label>Expected Return Rate (%)</Label>
                <Input type="number" step="0.1" placeholder="e.g. 12" {...form.register('expectedReturnRate')} />
              </div>
              <div className="space-y-1">
                <Label>Custodian / Institution</Label>
                <Input placeholder="e.g. KCB, NSE" {...form.register('custodian')} />
              </div>
              <div className="space-y-1">
                <Label>Start Date</Label>
                <Input type="date" {...form.register('startDate')} />
              </div>
              <div className="space-y-1">
                <Label>Maturity Date</Label>
                <Input type="date" {...form.register('maturityDate')} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Input placeholder="Additional details…" {...form.register('notes')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" loading={form.formState.isSubmitting}>Record Investment</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
