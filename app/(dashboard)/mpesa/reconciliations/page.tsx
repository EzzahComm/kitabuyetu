'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Play, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { StatusPill } from '@/components/shared/status-pill';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/utils';

interface ReconRun {
  id: string;
  status: 'running' | 'completed' | 'failed';
  transactions_checked: number;
  mismatches_found: number;
  resolved_count: number;
  started_at: string;
  completed_at: string | null;
  initiated_by_name: string | null;
  notes: string | null;
}

export default function ReconciliationsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [reconType, setReconType] = useState<'stk' | 'paybill'>('stk');
  const [showTypeMenu, setShowTypeMenu] = useState(false);

  const { data, isLoading, isError, error } = useQuery<ReconRun[]>({
    queryKey: ['mpesa', 'reconciliations'],
    queryFn:  () => api.get<ReconRun[]>('/mpesa/reconcile'),
  });

  const runNow = async () => {
    setRunning(true);
    try {
      const url = reconType === 'paybill' ? '/mpesa/reconcile?type=paybill' : '/mpesa/reconcile';
      const res = await api.post<{ transactionsChecked: number; resolvedCount: number }>(url, {});
      const typeLabel = reconType === 'paybill' ? 'Paybill sweep' : 'STK reconciliation';
      toast({ title: `${typeLabel} complete`, description: `${res.transactionsChecked} checked, ${res.resolvedCount} resolved` });
      await qc.invalidateQueries({ queryKey: ['mpesa', 'reconciliations'] });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Reconciliation failed', description: err instanceof ApiError ? err.message : '' });
    } finally {
      setRunning(false);
      setShowTypeMenu(false);
    }
  };

  const runs = data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Link href="/mpesa" className="mt-1"><Button variant="ghost" size="icon" aria-label="Back to M-Pesa"><ArrowLeft size={16} /></Button></Link>
        <PageHeader
          className="flex-1"
          title="Reconciliation runs"
          description={
            reconType === 'paybill'
              ? 'Sweeps paybill payments and reconciles them with pending contributions.'
              : 'Sweeps stuck STK requests and resolves their real status with Daraja.'
          }
          actions={
            <>
              <div className="relative">
                <Button
                  variant="outline"
                  onClick={() => setShowTypeMenu(!showTypeMenu)}
                  className="gap-2"
                >
                  {reconType === 'paybill' ? 'Paybill Sweep' : 'STK Sweep'}
                  <ChevronDown size={14} />
                </Button>
                {showTypeMenu && (
                  <div className="absolute top-full right-0 mt-1 max-w-[calc(100vw-2rem)] min-w-[150px] rounded-md border bg-popover text-popover-foreground shadow-md z-10">
                    <button
                      onClick={() => { setReconType('stk'); setShowTypeMenu(false); }}
                      className={`w-full px-4 py-2 text-left text-sm hover:bg-muted ${reconType === 'stk' ? 'bg-muted font-medium' : ''}`}
                    >
                      STK Sweep
                    </button>
                    <button
                      onClick={() => { setReconType('paybill'); setShowTypeMenu(false); }}
                      className={`w-full px-4 py-2 text-left text-sm hover:bg-muted ${reconType === 'paybill' ? 'bg-muted font-medium' : ''}`}
                    >
                      Paybill Sweep
                    </button>
                  </div>
                )}
              </div>
              <Button onClick={runNow} loading={running}><Play size={15} className="mr-2" /> Run now</Button>
            </>
          }
        />
      </div>

      <PaginatedTable
        data={singlePage(runs)}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onPageChange={() => {}}
        emptyMessage="No reconciliation runs yet"
        columns={[
          { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} tone={r.status === 'running' ? 'pending' : undefined} size="sm" /> },
          { key: 'transactions_checked', header: 'Checked', render: (r) => r.transactions_checked },
          { key: 'mismatches_found', header: 'Mismatches', render: (r) => r.mismatches_found },
          { key: 'resolved_count', header: 'Resolved', className: 'font-medium', render: (r) => r.resolved_count },
          { key: 'started_at', header: 'Started', className: 'text-muted-foreground', render: (r) => formatDate(r.started_at) },
          { key: 'initiated_by_name', header: 'By', className: 'text-muted-foreground', render: (r) => r.initiated_by_name ?? 'Cron' },
        ]}
      />
    </div>
  );
}
