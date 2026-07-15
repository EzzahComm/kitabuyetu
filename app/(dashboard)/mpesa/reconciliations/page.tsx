'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Play, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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

const statusVariant: Record<string, 'success' | 'warning' | 'destructive'> = {
  completed: 'success', running: 'warning', failed: 'destructive',
};

export default function ReconciliationsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [reconType, setReconType] = useState<'stk' | 'paybill'>('stk');
  const [showTypeMenu, setShowTypeMenu] = useState(false);

  const { data, isLoading } = useQuery<ReconRun[]>({
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/mpesa"><Button variant="ghost" size="icon" aria-label="Back to M-Pesa"><ArrowLeft size={16} /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold">Reconciliation runs</h1>
            <p className="text-sm text-muted-foreground">
              {reconType === 'paybill' 
                ? 'Sweeps paybill payments and reconciles them with pending contributions.'
                : 'Sweeps stuck STK requests and resolves their real status with Daraja.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
              <div className="absolute top-full right-0 mt-1 bg-white border rounded-md shadow-md z-10 min-w-[150px]">
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
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Checked</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Mismatches</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Resolved</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Started</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">By</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No reconciliation runs yet</td></tr>
              ) : runs.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3"><Badge variant={statusVariant[r.status] ?? 'secondary'}>{r.status}</Badge></td>
                  <td className="px-4 py-3">{r.transactions_checked}</td>
                  <td className="px-4 py-3">{r.mismatches_found}</td>
                  <td className="px-4 py-3 font-medium">{r.resolved_count}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(r.started_at)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.initiated_by_name ?? 'Cron'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
