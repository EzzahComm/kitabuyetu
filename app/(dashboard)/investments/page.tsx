'use client';

import { useState } from 'react';
import { Plus, TrendingUp, TrendingDown, DollarSign, BarChart2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { PageHeader } from '@/components/shared/page-header';
import { useInvestments, useInvestmentSummary, useCreateInvestment, type InvestmentRow } from '@/hooks/use-investments';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';

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

const statusVariant: Record<string, 'warning' | 'success' | 'default' | 'secondary' | 'destructive'> = {
  pending_approval: 'warning',
  active:           'success',
  matured:          'default',
  liquidated:       'secondary',
  cancelled:        'destructive',
};

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

  const { data, isLoading }    = useInvestments({ page, limit: 20, ...(status !== 'all' ? { status } : {}) });
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
      render: (row: InvestmentRow) => row.current_value
        ? <span className="font-semibold text-sm text-green-600">{formatKES(row.current_value)}</span>
        : <span className="text-muted-foreground text-sm">—</span>,
    },
    {
      key: 'total_returns', header: 'Returns Earned',
      render: (row: InvestmentRow) => <span className="text-sm text-blue-600">{formatKES(row.total_returns ?? 0)}</span>,
    },
    {
      key: 'expected_return_rate', header: 'Expected Rate',
      render: (row: InvestmentRow) => row.expected_return_rate
        ? <span className="text-sm">{row.expected_return_rate}%</span>
        : <span className="text-muted-foreground text-sm">—</span>,
    },
    {
      key: 'status', header: 'Status',
      render: (row: InvestmentRow) => <Badge variant={statusVariant[row.status] ?? 'secondary'} className="capitalize text-xs">{row.status?.replace('_',' ')}</Badge>,
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
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} className="mr-2" /> Add Investment
          </Button>
        }
      />

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Principal</p>
            <p className="text-2xl font-bold mt-1">{formatKES(summary?.totalPrincipal ?? 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">{summary?.totalInvestments ?? 0} investments</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current Portfolio Value</p>
            <p className="text-2xl font-bold mt-1 text-green-600">{formatKES(summary?.totalCurrentValue ?? 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">{summary?.activeCount ?? 0} active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Returns Earned</p>
            <p className="text-2xl font-bold mt-1 text-blue-600">{formatKES(summary?.totalReturns ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Overall ROI</p>
            <div className="flex items-center gap-2 mt-1">
              {roi >= 0
                ? <TrendingUp className="text-green-500" size={20} />
                : <TrendingDown className="text-red-500" size={20} />
              }
              <p className={`text-2xl font-bold ${roi >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {roi.toFixed(1)}%
              </p>
            </div>
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
            columns={columns}
            onPageChange={setPage}
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
            <div className="grid grid-cols-2 gap-3">
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
