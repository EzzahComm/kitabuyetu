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
import { useLoans, useApplyLoan, useLoanPolicy } from '@/hooks/use-loans';
import { useMembers } from '@/hooks/use-members';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';
import type { Loan } from '@/types/db.types';

type LoanRow = Loan & { member_name: string };

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
  const { data: loanPolicy } = useLoanPolicy();
  const applyLoan = useApplyLoan();

  // Advisory defaults from the group's resolved LoanPolicy (group ->
  // organization -> platform cascade) — officers can still type a different
  // rate/term on any individual loan.
  const policyTerms = loanPolicy?.terms;

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<ApplyValues>({
    resolver: zodResolver(applySchema),
    defaultValues: { interestRate: 10, termMonths: 12 },
  });

  const openApply = () => {
    reset({
      interestRate: policyTerms?.interestRate ?? 10,
      termMonths:   policyTerms ? Math.min(policyTerms.maxTermMonths, 12) : 12,
    } as Partial<ApplyValues> as ApplyValues);
    setOpen(true);
  };

  const onSubmit = async (values: ApplyValues) => {
    try {
      await applyLoan.mutateAsync(values);
      toast({ title: 'Loan application submitted' });
      setOpen(false);
      reset();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(err) });
    }
  };

  const columns = [
    {
      key: 'id', header: 'Loan',
      render: (row: LoanRow) => (
        <Link href={`/loans/${row.id}`} className="font-mono text-xs text-brand-600 hover:underline">
          {row.id.slice(0, 8)}…
        </Link>
      ),
    },
    { key: 'memberName', header: 'Member', render: (row: LoanRow) => row.member_name ?? row.member_id },
    { key: 'principalAmount', header: 'Principal', render: (row: LoanRow) => <span className="font-semibold">{formatKES(row.principal_amount)}</span> },
    { key: 'interestRate', header: 'Rate', render: (row: LoanRow) => `${row.interest_rate}%` },
    { key: 'termMonths', header: 'Term', render: (row: LoanRow) => `${row.loan_term_months}m` },
    { key: 'status', header: 'Status', render: (row: LoanRow) => <StatusPill status={row.status} /> },
    { key: 'disbursedAt', header: 'Disbursed', render: (row: LoanRow) => row.disbursed_at ? formatDate(row.disbursed_at) : '—' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Loans</h1>
          <p className="text-sm text-muted-foreground">{data?.total ?? 0} total loans</p>
        </div>
        <Button onClick={openApply}>
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
          <PaginatedTable data={data} isLoading={isLoading} columns={columns} onPageChange={setPage} emptyMessage="No loans found" />
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
                {(membersData?.items ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
                ))}
              </select>
              {errors.memberId && <p className="text-xs text-destructive">{errors.memberId.message}</p>}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label>Principal amount (KES)</Label>
                <Input type="number" step="0.01" {...register('principalAmount')} />
                {errors.principalAmount && <p className="text-xs text-destructive">{errors.principalAmount.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Interest rate (%/month)</Label>
                <Input type="number" step="0.1" {...register('interestRate')} />
                {policyTerms && (
                  <p className="text-xs text-muted-foreground">
                    Group default {policyTerms.interestRate}% ({policyTerms.interestMethod === 'flat' ? 'flat' : 'reducing balance'})
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label>Term (months)</Label>
                <Input type="number" {...register('termMonths')} />
                {policyTerms && (
                  <p className="text-xs text-muted-foreground">Policy max {policyTerms.maxTermMonths} months</p>
                )}
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
