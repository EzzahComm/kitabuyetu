'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Coins, Loader2, Plus, ReceiptText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/shared/status-pill';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { PageHeader } from '@/components/shared/page-header';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from '@/lib/api/client';
import type { PaginatedResult } from '@/types/db.types';

interface Declaration {
  id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  pool_amount: string;
  policy_type: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'paid' | 'cancelled';
  total_eligible_members: number;
  total_allocated: string;
  total_paid: string;
  declared_at: string;
}
interface ShareClass { id: string; name: string; code: string }

const fmtMoney = (v: string | number | null | undefined) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 2 }).format(Number(v ?? 0));

const POLICY_LABEL: Record<string, string> = {
  proportional_to_shares: 'Proportional to shares',
  flat_per_member:        'Flat per member',
  weighted:               'Weighted (coming in E5.2)',
};

const newDeclSchema = z.object({
  periodLabel:        z.string().min(2),
  periodStart:        z.string().min(1),
  periodEnd:          z.string().min(1),
  poolAmount:         z.coerce.number().positive(),
  policyType:         z.enum(['proportional_to_shares', 'flat_per_member']),
  withholdingTaxRate: z.coerce.number().min(0).max(0.9999).default(0),
  shareClassIds:      z.array(z.string()).default([]),
  notes:              z.string().optional().or(z.literal('')),
});
type NewDeclForm = z.infer<typeof newDeclSchema>;

export default function DividendsPage() {
  const { toast } = useToast();
  const qc        = useQueryClient();
  const router    = useRouter();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);

  const listQ = useQuery<PaginatedResult<Declaration>>({
    queryKey: ['dividends', 'list', page],
    queryFn:  () => api.get<PaginatedResult<Declaration>>(`/dividends?page=${page}&limit=20`),
  });
  const classesQ = useQuery<{ items: ShareClass[] }>({
    queryKey: ['share-classes', 'active'],
    queryFn:  () => api.get<{ items: ShareClass[] }>('/share-classes?active=true'),
    enabled:  open,
  });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<NewDeclForm>({
    resolver: zodResolver(newDeclSchema),
    defaultValues: {
      policyType: 'proportional_to_shares',
      withholdingTaxRate: 0,
      shareClassIds: [],
    },
  });

  const onCreate = async (v: NewDeclForm) => {
    try {
      const body: Record<string, unknown> = {
        periodLabel: v.periodLabel,
        periodStart: v.periodStart,
        periodEnd:   v.periodEnd,
        poolAmount:  v.poolAmount,
        policyType:  v.policyType,
        withholdingTaxRate: v.withholdingTaxRate,
        shareClassIds: v.shareClassIds ?? [],
      };
      if (v.notes) body.notes = v.notes;
      await api.post<Declaration>('/dividends', body);
      toast({ title: 'Declaration created' });
      setOpen(false);
      reset({ policyType: 'proportional_to_shares', withholdingTaxRate: 0, shareClassIds: [] });
      qc.invalidateQueries({ queryKey: ['dividends', 'list'] });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Create failed', description: err instanceof ApiError ? err.message : 'Unknown error' });
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Dividends"
        description="Declare, approve, and pay out dividend distributions to shareholders."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} className="mr-2" /> New declaration
          </Button>
        }
      />

      <PaginatedTable<Declaration>
        data={listQ.data}
        isLoading={listQ.isLoading}
        onPageChange={setPage}
        onRowClick={(d) => router.push(`/dividends/${d.id}`)}
        emptyMessage="No dividend declarations yet"
        emptyIcon={Coins}
        emptyDescription="Create one to start distributing earnings to shareholders."
        columns={[
          { key: 'period', header: 'Period', render: (d) => (
            <div>
              <p className="font-medium">{d.period_label}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(d.period_start).toLocaleDateString()} → {new Date(d.period_end).toLocaleDateString()}
              </p>
            </div>
          ) },
          { key: 'policy', header: 'Policy', render: (d) => <span className="text-xs text-muted-foreground">{POLICY_LABEL[d.policy_type] ?? d.policy_type}</span> },
          { key: 'status', header: 'Status', render: (d) => <StatusPill status={d.status} tone={d.status === 'pending_approval' ? 'pending' : undefined} /> },
          { key: 'pool', header: 'Pool', className: 'text-right', render: (d) => <span className="font-mono">{fmtMoney(d.pool_amount)}</span> },
          { key: 'members', header: 'Members', className: 'text-right', render: (d) => <span className="font-mono">{d.total_eligible_members || '—'}</span> },
          { key: 'allocated', header: 'Allocated', className: 'text-right', render: (d) => <span className="font-mono">{fmtMoney(d.total_allocated)}</span> },
          { key: 'paid', header: 'Paid', className: 'text-right', render: (d) => {
            const allocated = Number(d.total_allocated);
            const paid      = Number(d.total_paid);
            const pct       = allocated > 0 ? Math.round((paid / allocated) * 100) : 0;
            return <span className="font-mono">{fmtMoney(d.total_paid)} <span className="text-xs text-muted-foreground">({pct}%)</span></span>;
          } },
        ]}
      />

      {/* New declaration modal */}
      <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); setOpen(v); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ReceiptText className="h-5 w-5" /> New dividend declaration</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onCreate)} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="periodLabel">Period label</Label>
                <Input id="periodLabel" placeholder="FY 2025" {...register('periodLabel')} />
                {errors.periodLabel && <p className="text-xs text-red-600">{errors.periodLabel.message}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="poolAmount">Pool amount (KES)</Label>
                <Input id="poolAmount" type="number" step={0.01} placeholder="100000" {...register('poolAmount')} />
                {errors.poolAmount && <p className="text-xs text-red-600">{errors.poolAmount.message}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="periodStart">Period start</Label>
                <Input id="periodStart" type="date" {...register('periodStart')} />
                {errors.periodStart && <p className="text-xs text-red-600">{errors.periodStart.message}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="periodEnd">Period end</Label>
                <Input id="periodEnd" type="date" {...register('periodEnd')} />
                {errors.periodEnd && <p className="text-xs text-red-600">{errors.periodEnd.message}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="policyType">Distribution policy</Label>
                <select id="policyType" {...register('policyType')} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="proportional_to_shares">Proportional to shares</option>
                  <option value="flat_per_member">Flat per member</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="withholdingTaxRate">Withholding tax (0–0.9999)</Label>
                <Input id="withholdingTaxRate" type="number" step={0.0001} placeholder="0.05 for 5%" {...register('withholdingTaxRate')} />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Eligible share classes (leave empty = all active classes)</Label>
              <div className="rounded-md border p-2 max-h-32 overflow-y-auto space-y-1">
                {(classesQ.data?.items ?? []).map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" value={c.id} {...register('shareClassIds')} />
                    <span>{c.name} <span className="text-muted-foreground">({c.code})</span></span>
                  </label>
                ))}
                {(classesQ.data?.items ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No active classes — create one in /shares/classes first.</p>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" placeholder="Optional context" {...register('notes')} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create declaration
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
