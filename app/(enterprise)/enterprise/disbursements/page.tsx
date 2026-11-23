'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { StatusPill } from '@/components/shared/status-pill';
import { MoneyDisplay } from '@/components/shared/money-display';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useHasOrganizationPermission } from '@/lib/auth/use-permission';
import { organizationApi } from '@/lib/api/endpoints';
import { enterpriseKeys } from '@/lib/api/enterprise-keys';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/utils';
import type { PaginatedResult } from '@/types/db.types';
import { PAYMENT_METHODS } from '@/lib/validators/organization.schema';

const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  mpesa: 'M-Pesa',
  cash: 'Cash',
  cheque: 'Cheque',
  bank_transfer: 'Bank transfer',
  standing_order: 'Standing order',
};

interface DisbursementRow {
  id: string;
  group_id: string;
  group_name?: string;
  funding_program_id: string | null;
  program_name?: string | null;
  disbursement_type: string;
  amount: string;
  status: string;
  reference: string;
  notes: string | null;
  created_at: string;
  /** NULL for anything disbursed before migration 150 — "not recorded". */
  payment_method: string | null;
  payment_reference: string | null;
}

export default function DisbursementsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const canManageDisbursements = useHasOrganizationPermission();
  const [page, setPage] = useState(1);

  const [busy, setBusy] = useState(false);

  const [rejecting, setRejecting] = useState<DisbursementRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data: walletData } = useQuery({
    queryKey: enterpriseKeys.wallet(),
    queryFn: () => organizationApi.wallet(),
    staleTime: 30_000,
  });
  const { data, isLoading, isError, error } = useQuery<PaginatedResult<DisbursementRow>>({
    queryKey: enterpriseKeys.disbursements({ page, limit: 20 }),
    queryFn: async () => {
      const res = await organizationApi.disbursements({ page, limit: 20 });
      return { ...res, pageSize: res.limit ?? 20, totalPages: Math.max(1, Math.ceil(res.total / (res.limit ?? 20))) };
    },
    staleTime: 30_000,
  });

  const availableBalance = walletData ? parseFloat(walletData.wallet.available_balance) : null;

  const refresh = () => qc.invalidateQueries({ queryKey: enterpriseKeys.disbursements() });
  const refreshWallet = () => qc.invalidateQueries({ queryKey: enterpriseKeys.wallet() });

  const reject = async () => {
    if (!rejecting || rejectReason.trim().length < 5) {
      toast({ variant: 'destructive', title: 'Give a rejection reason (5+ chars)' });
      return;
    }
    setBusy(true);
    try {
      await organizationApi.disbursementAction(rejecting.id, { action: 'reject', reason: rejectReason.trim() });
      toast({ title: 'Disbursement rejected — reservation released' });
      setRejecting(null);
      setRejectReason('');
      await Promise.all([refresh(), refreshWallet()]);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Rejection failed',
        description: err instanceof ApiError ? err.message : '',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Disbursements"
        description="Review branch disbursements and reject pending requests."
        breadcrumbs={[{ label: 'Portfolio', href: '/enterprise' }, { label: 'Disbursements' }]}
      />

      {availableBalance !== null && (
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <Banknote size={18} />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">Available wallet balance</p>
                <MoneyDisplay amount={availableBalance} size="md" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <PaginatedTable<DisbursementRow>
        data={data}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onPageChange={setPage}
        emptyMessage="No disbursements yet"
        emptyDescription="Send your first disbursement to a branch using the button above."
        emptyIcon={Banknote}
        columns={[
          {
            key: 'group',
            header: 'Branch',
            render: (r) => (
              <div>
                <p className="font-medium text-foreground">{r.group_name ?? '—'}</p>
                <p className="text-xs text-muted-foreground">{r.reference}</p>
              </div>
            ),
          },
          {
            key: 'program',
            header: 'Program',
            render: (r) => <span className="text-muted-foreground">{r.program_name ?? '—'}</span>,
          },
          {
            key: 'type',
            header: 'Type',
            render: (r) => (
              <span className="capitalize text-muted-foreground">{r.disbursement_type.replace(/_/g, ' ')}</span>
            ),
          },
          {
            key: 'amount',
            header: 'Amount',
            className: 'text-right',
            render: (r) => <MoneyDisplay amount={parseFloat(r.amount)} size="sm" />,
          },
          {
            // "Not recorded" is shown plainly rather than blank — a dash reads
            // as "no data available", when the real meaning is that nobody
            // captured how the money moved.
            key: 'paid_by',
            header: 'Paid by',
            render: (r) =>
              r.payment_method ? (
                <span className="text-muted-foreground">
                  {PAYMENT_METHOD_LABELS[r.payment_method as (typeof PAYMENT_METHODS)[number]] ?? r.payment_method}
                  {r.payment_reference ? ` · ${r.payment_reference}` : ''}
                </span>
              ) : (
                <span className="text-xs italic text-muted-foreground/70">Not recorded</span>
              ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (r) => (
              <StatusPill
                status={r.status}
                tone={r.status === 'pending_approval' ? 'pending' : r.status === 'rejected' ? 'negative' : 'positive'}
                label={r.status.replace(/_/g, ' ')}
                size="sm"
              />
            ),
          },
          {
            key: 'date',
            header: 'Date',
            render: (r) => <span className="text-muted-foreground">{formatDate(r.created_at)}</span>,
          },
          {
            key: 'actions',
            header: '',
            className: 'text-right',
            render: (r) =>
              r.status === 'pending_approval' && canManageDisbursements ? (
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRejecting(r);
                      setRejectReason('');
                    }}
                    disabled={busy}
                  >
                    Reject
                  </Button>
                </div>
              ) : null,
          },
        ]}
      />

      {/* Reject */}
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject disbursement</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label>Rejection reason</Label>
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Why is this disbursement being rejected?"
            />
          </div>
          <DialogFooter>
            <Button variant="destructive" onClick={reject} loading={busy} disabled={!canManageDisbursements}>
              Reject disbursement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
