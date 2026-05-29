'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/shared/status-pill';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useContributions, useRecordContribution } from '@/hooks/use-contributions';
import { useMembers } from '@/hooks/use-members';
import { api } from '@/lib/api/client';
import { FileText } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { formatKES, formatDate } from '@/lib/utils';

const schema = z.object({
  memberId:      z.string().min(1, 'Member required'),
  amount:        z.coerce.number().positive(),
  paymentMethod: z.enum(['mpesa', 'cash', 'bank_transfer', 'cheque']),
  reference:     z.string().optional(),
  periodMonth:   z.coerce.number().int().min(1).max(12),
  periodYear:    z.coerce.number().int().min(2020).max(2099),
  notes:         z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function ContributionsPage() {
  const [page, setPage]   = useState(1);
  const [open, setOpen]   = useState(false);
  const { toast }         = useToast();

  const now = new Date();
  const { data, isLoading } = useContributions({ page, pageSize: 20 });
  const { data: membersData } = useMembers({ pageSize: 200 });
  const record = useRecordContribution();

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { paymentMethod: 'mpesa', periodMonth: now.getMonth() + 1, periodYear: now.getFullYear() },
  });

  const onSubmit = async (values: FormValues) => {
    try {
      await record.mutateAsync(values);
      toast({ title: 'Contribution recorded' });
      setOpen(false);
      reset();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Failed', description: err.message });
    }
  };

  const columns = [
    { key: 'memberName', header: 'Member', render: (row: any) => <span className="font-medium">{row.memberName ?? row.memberId}</span> },
    { key: 'amount', header: 'Amount', render: (row: any) => <span className="font-semibold text-green-600">{formatKES(row.amount)}</span> },
    { key: 'period', header: 'Period', render: (row: any) => `${row.periodYear}-${String(row.periodMonth).padStart(2,'0')}` },
    { key: 'paymentMethod', header: 'Method', render: (row: any) => <Badge variant="outline" className="capitalize">{row.paymentMethod?.replace('_',' ')}</Badge> },
    { key: 'status', header: 'Status', render: (row: any) => <StatusPill status={row.status} /> },
    { key: 'createdAt', header: 'Date', render: (row: any) => formatDate(row.createdAt) },
    {
      key: 'receipt', header: '',
      render: (row: any) =>
        (row.status === 'completed' || row.status === 'confirmed') ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
            onClick={() => api.openBlob(`/contributions/${row.id}/receipt`).catch((e) =>
              toast({ variant: 'destructive', title: 'Receipt failed', description: e.message }))}
          >
            <FileText size={13} /> Receipt
          </button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Contributions</h1>
          <p className="text-sm text-muted-foreground">{data?.total ?? 0} total records</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} className="mr-2" /> Record
        </Button>
      </div>

      <PaginatedTable data={data as any} isLoading={isLoading} columns={columns} onPageChange={setPage} emptyMessage="No contributions recorded yet" />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record contribution</DialogTitle></DialogHeader>
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
              <div className="space-y-1">
                <Label>Amount (KES)</Label>
                <Input type="number" step="0.01" {...register('amount')} />
                {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
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
              <div className="space-y-1">
                <Label>Month</Label>
                <Input type="number" min={1} max={12} {...register('periodMonth')} />
              </div>
              <div className="space-y-1">
                <Label>Year</Label>
                <Input type="number" min={2020} max={2099} {...register('periodYear')} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>M-Pesa reference (optional)</Label>
              <Input placeholder="QAB1234XYZ" {...register('reference')} />
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
