'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/shared/status-pill';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useLoans, useApplyLoan } from '@/hooks/use-loans';
import { useMembers } from '@/hooks/use-members';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate } from '@/lib/utils';

const applySchema = z.object({
  memberId:       z.string().min(1),
  principalAmount: z.coerce.number().positive().min(100),
  interestRate:   z.coerce.number().positive().max(100),
  termMonths:     z.coerce.number().int().positive().max(120),
  purpose:        z.string().min(3),
});
type ApplyValues = z.infer<typeof applySchema>;

export default function LoansPage() {
  const [page, setPage]   = useState(1);
  const [status, setStatus] = useState('all');
  const [open, setOpen]   = useState(false);
  const { toast }         = useToast();

  const { data, isLoading } = useLoans({ page, pageSize: 20, status: status === 'all' ? undefined : status });
  const { data: membersData } = useMembers({ pageSize: 200 });
  const applyLoan = useApplyLoan();

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<ApplyValues>({
    resolver: zodResolver(applySchema),
    defaultValues: { interestRate: 10, termMonths: 12 },
  });

  const onSubmit = async (values: ApplyValues) => {
    try {
      await applyLoan.mutateAsync(values);
      toast({ title: 'Loan application submitted' });
      setOpen(false);
      reset();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Failed', description: err.message });
    }
  };

  const columns = [
    {
      key: 'id', header: 'Loan',
      render: (row: any) => (
        <Link href={`/loans/${row.id}`} className="font-mono text-xs text-brand-600 hover:underline">
          {row.id.slice(0, 8)}…
        </Link>
      ),
    },
    { key: 'memberName', header: 'Member', render: (row: any) => row.memberName ?? row.memberId },
    { key: 'principalAmount', header: 'Principal', render: (row: any) => <span className="font-semibold">{formatKES(row.principalAmount)}</span> },
    { key: 'interestRate', header: 'Rate', render: (row: any) => `${row.interestRate}%` },
    { key: 'termMonths', header: 'Term', render: (row: any) => `${row.termMonths}m` },
    { key: 'status', header: 'Status', render: (row: any) => <StatusPill status={row.status} /> },
    { key: 'disbursedAt', header: 'Disbursed', render: (row: any) => row.disbursedAt ? formatDate(row.disbursedAt) : '—' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Loans</h1>
          <p className="text-sm text-muted-foreground">{data?.total ?? 0} total loans</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} className="mr-2" /> Apply
        </Button>
      </div>

      <Tabs value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
        <TabsList>
          {['all','pending','active','completed','defaulted'].map((s) => (
            <TabsTrigger key={s} value={s} className="capitalize">{s}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={status} className="mt-4">
          <PaginatedTable data={data as any} isLoading={isLoading} columns={columns} onPageChange={setPage} emptyMessage="No loans found" />
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Apply for loan</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1">
              <Label>Member</Label>
              <select {...register('memberId')} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="">Select member…</option>
                {(membersData?.items ?? []).map((m: any) => (
                  <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
                ))}
              </select>
              {errors.memberId && <p className="text-xs text-destructive">{errors.memberId.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label>Principal amount (KES)</Label>
                <Input type="number" step="0.01" {...register('principalAmount')} />
                {errors.principalAmount && <p className="text-xs text-destructive">{errors.principalAmount.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Interest rate (%/month)</Label>
                <Input type="number" step="0.1" {...register('interestRate')} />
              </div>
              <div className="space-y-1">
                <Label>Term (months)</Label>
                <Input type="number" {...register('termMonths')} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Purpose</Label>
              <Input placeholder="Business expansion…" {...register('purpose')} />
              {errors.purpose && <p className="text-xs text-destructive">{errors.purpose.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" loading={isSubmitting}>Submit application</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
