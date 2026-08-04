'use client';

import { useState } from 'react';
import { Plus, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/shared/status-pill';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { PageHeader } from '@/components/shared/page-header';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useContributions, useRecordContribution, useSavingsPolicy } from '@/hooks/use-contributions';
import { useMembers } from '@/hooks/use-members';
import { api } from '@/lib/api/client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';
import type { Contribution } from '@/types/db.types';

type ContributionRow = Contribution & { member_name: string };

// Fields match CreateContributionSchema (lib/validators/contribution.schema.ts)
// exactly — the form previously sent periodMonth/periodYear (fields that
// don't exist on that schema, silently dropped by zod) and never sent the
// required contributionDate, so every submission 400'd server-side.
const schema = z.object({
  memberId:           z.string().min(1, 'Member required'),
  amount:             z.coerce.number().positive(),
  contributionDate:   z.string().min(1, 'Date required'),
  paymentMethod:      z.enum(['mpesa', 'cash', 'bank_transfer', 'cheque']),
  mpesaReceiptNumber: z.string().optional(),
  notes:              z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function ContributionsPage() {
  const [page, setPage]   = useState(1);
  const [open, setOpen]   = useState(false);
  const { toast }         = useToast();

  const now = new Date();
  const { data, isLoading, isError, error } = useContributions({ page, pageSize: 20 });
  // Only active members can receive a contribution. `limit` (not `pageSize`) is
  // the param the members API reads; its max is 100.
  const {
    data: membersData,
    isLoading: membersLoading,
    isError: membersError,
  } = useMembers({ limit: 100, status: 'active' });
  const memberOptions = membersData?.items ?? [];
  const record = useRecordContribution();
  const { data: savingsPolicy } = useSavingsPolicy();
  const limits = savingsPolicy?.limits;

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { paymentMethod: 'mpesa', contributionDate: now.toISOString().split('T')[0] },
  });

  const onSubmit = async (values: FormValues) => {
    try {
      await record.mutateAsync(values);
      toast({ title: 'Contribution recorded' });
      setOpen(false);
      reset();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(err) });
    }
  };

  const columns = [
    { key: 'memberName', header: 'Member', render: (row: ContributionRow) => <span className="font-medium">{row.member_name ?? row.member_id}</span> },
    { key: 'amount', header: 'Amount', render: (row: ContributionRow) => <span className="font-semibold text-green-600">{formatKES(row.amount)}</span> },
    { key: 'period', header: 'Date', render: (row: ContributionRow) => formatDate(row.contribution_date) },
    { key: 'paymentMethod', header: 'Method', render: (row: ContributionRow) => <Badge variant="outline" className="capitalize">{row.payment_method?.replace('_',' ')}</Badge> },
    { key: 'status', header: 'Status', render: (row: ContributionRow) => <StatusPill status={row.status} /> },
    { key: 'createdAt', header: 'Recorded', render: (row: ContributionRow) => formatDate(row.created_at) },
    {
      key: 'receipt', header: '',
      render: (row: ContributionRow) =>
        row.status === 'completed' ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
            onClick={() => api.openBlob(`/contributions/${row.id}/receipt`).catch((e) =>
              toast({ variant: 'destructive', title: 'Receipt failed', description: getErrorMessage(e) }))}
          >
            <FileText size={13} /> Receipt
          </button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contributions"
        description={`${data?.total ?? 0} total records`}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} className="mr-2" /> Record
          </Button>
        }
      />

      <PaginatedTable data={data} isLoading={isLoading} isError={isError} error={error} columns={columns} onPageChange={setPage} emptyMessage="No contributions recorded yet" />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record contribution</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1">
              <Label>Member</Label>
              <select
                {...register('memberId')}
                disabled={membersLoading || memberOptions.length === 0}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">
                  {membersLoading
                    ? 'Loading members…'
                    : memberOptions.length === 0
                      ? 'No active members found'
                      : 'Select member…'}
                </option>
                {memberOptions.map((m) => {
                  const first = m.first_name ?? '';
                  const last  = m.last_name ?? '';
                  const phone = m.phone ?? '';
                  // Identify members by name + Membership Number (the only
                  // public payment identifier) — never member_code/UUIDs.
                  const acct  = m.membership_no ?? '';
                  const label = `${first} ${last}`.trim() || acct || 'Member';
                  return (
                    <option key={m.id} value={m.id}>
                      {label}{acct ? ` (${acct})` : ''}{phone ? ` — ${phone}` : ''}
                    </option>
                  );
                })}
              </select>
              {membersError && (
                <p className="text-xs text-destructive">Couldn&apos;t load members. Refresh and try again.</p>
              )}
              {errors.memberId && <p className="text-xs text-destructive">{errors.memberId.message}</p>}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Amount (KES)</Label>
                <Input type="number" step="0.01" {...register('amount')} />
                {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
                {!errors.amount && limits && (limits.minContribution > 0 || limits.maxContribution !== null) && (
                  <p className="text-xs text-muted-foreground">
                    Group guidance: {formatKES(limits.minContribution)}
                    {limits.maxContribution !== null ? ` – ${formatKES(limits.maxContribution)}` : '+'}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label>Payment method</Label>
                <select {...register('paymentMethod')} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="mpesa">M-Pesa</option>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Contribution date</Label>
                <Input type="date" {...register('contributionDate')} />
                {errors.contributionDate && <p className="text-xs text-destructive">{errors.contributionDate.message}</p>}
              </div>
            </div>
            <div className="space-y-1">
              <Label>M-Pesa reference (optional)</Label>
              <Input placeholder="QAB1234XYZ" {...register('mpesaReceiptNumber')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" loading={isSubmitting}>Record</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
