'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/shared/status-pill';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { PageHeader } from '@/components/shared/page-header';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useLoans, useApplyLoan, useLoanPolicy } from '@/hooks/use-loans';
import { useMembers } from '@/hooks/use-members';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';
import {
  LOAN_REPAYMENT_FREQUENCIES, installmentCount, type LoanRepaymentFrequency,
} from '@/lib/validators/loan.schema';
import type { Loan } from '@/types/db.types';

const FREQUENCY_LABELS: Record<LoanRepaymentFrequency, string> = {
  weekly:    'Weekly',
  biweekly:  'Every 2 weeks',
  monthly:   'Monthly',
  quarterly: 'Quarterly',
};

type LoanRow = Loan & { member_name: string };

const applySchema = z.object({
  memberId:       z.string().min(1),
  principalAmount: z.coerce.number().positive().min(100),
  interestRate:   z.coerce.number().positive().max(100),
  loanTermMonths:     z.coerce.number().int().positive().max(120),
  repaymentFrequency: z.enum(LOAN_REPAYMENT_FREQUENCIES),
  purpose:        z.string().min(3),
});
type ApplyValues = z.infer<typeof applySchema>;

export default function LoansPage() {
  const [page, setPage]   = useState(1);
  const [status, setStatus] = useState('all');
  const [open, setOpen]   = useState(false);
  const { toast }         = useToast();

  const { data, isLoading, isError, error } = useLoans({ page, pageSize: 20, status: status === 'all' ? undefined : status });
  const { data: membersData } = useMembers({ pageSize: 200 });
  const { data: loanPolicy } = useLoanPolicy();
  const applyLoan = useApplyLoan();

  // Advisory defaults from the group's resolved LoanPolicy (group ->
  // organization -> platform cascade) — officers can still type a different
  // rate/term on any individual loan.
  const policyTerms = loanPolicy?.terms;
  // Empty when the group has not declared fixed durations, which keeps the
  // free-text term box for policies written before term options existed.
  const termOptions = policyTerms?.termOptions ?? [];

  const { register, handleSubmit, reset, control, formState: { errors, isSubmitting } } = useForm<ApplyValues>({
    resolver: zodResolver(applySchema),
    defaultValues: { interestRate: 10, loanTermMonths: 12, repaymentFrequency: 'monthly' },
  });

  // Watched so the officer sees the instalment count change as they pick a
  // cadence — a 12-month loan is 12 payments monthly but 52 weekly, and that
  // is the single most surprising consequence of this field.
  const watchedTerm = useWatch({ control, name: 'loanTermMonths' });
  const watchedFreq = useWatch({ control, name: 'repaymentFrequency' });

  const openApply = () => {
    reset({
      interestRate: policyTerms?.interestRate ?? 10,
      // Prefer the longest offered term, which is what the old
      // min(maxTermMonths, 12) effectively picked; fall back to the ceiling
      // when no fixed durations are declared.
      loanTermMonths:   termOptions.length > 0
                          ? termOptions[termOptions.length - 1]
                          : policyTerms ? Math.min(policyTerms.maxTermMonths, 12) : 12,
      repaymentFrequency: 'monthly',
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
    {
      key: 'term', header: 'Term',
      render: (row: LoanRow) =>
        `${row.loan_term_months}m${row.repayment_frequency && row.repayment_frequency !== 'monthly'
          ? ` · ${FREQUENCY_LABELS[row.repayment_frequency].toLowerCase()}`
          : ''}`,
    },
    { key: 'status', header: 'Status', render: (row: LoanRow) => <StatusPill status={row.status} /> },
    { key: 'disbursedAt', header: 'Disbursed', render: (row: LoanRow) => row.disbursed_at ? formatDate(row.disbursed_at) : '—' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Loans"
        description={`${data?.total ?? 0} total loans`}
        actions={
          <Button onClick={openApply}>
            <Plus size={16} className="mr-2" /> Apply
          </Button>
        }
      />

      <Tabs value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
        <TabsList>
          {['all','pending','active','completed','defaulted'].map((s) => (
            <TabsTrigger key={s} value={s} className="capitalize">{s}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={status} className="mt-4">
          <PaginatedTable data={data} isLoading={isLoading} isError={isError} error={error} columns={columns} onPageChange={setPage} emptyMessage="No loans found" />
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
                {/* A dropdown when the group has declared the lengths it
                    offers, a free number box otherwise. The server enforces
                    the same list, so this is convenience rather than the
                    control itself. */}
                {termOptions.length > 0 ? (
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    {...register('loanTermMonths')}
                  >
                    {termOptions.map((t) => (
                      <option key={t} value={t}>{t === 1 ? '1 month' : `${t} months`}</option>
                    ))}
                  </select>
                ) : (
                  <Input type="number" {...register('loanTermMonths')} />
                )}
                {policyTerms && (
                  <p className="text-xs text-muted-foreground">
                    {termOptions.length > 0
                      ? `This group lends for ${termOptions.join(', ')} months`
                      : `Policy max ${policyTerms.maxTermMonths} months`}
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Repayment frequency</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                {...register('repaymentFrequency')}
              >
                {LOAN_REPAYMENT_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>
                ))}
              </select>
              {/* The term stays in months whatever the cadence, so spell out
                  what the officer is actually creating. Cadence changes the
                  number and size of instalments, never the total cost. */}
              <p className="text-xs text-muted-foreground">
                {watchedTerm > 0 && watchedFreq
                  ? `${installmentCount(Number(watchedTerm), watchedFreq)} instalments over ${watchedTerm} month${Number(watchedTerm) === 1 ? '' : 's'} — same total cost either way`
                  : 'Term stays in months; this only changes how often instalments fall due'}
              </p>
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
