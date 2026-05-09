'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { formatKES } from '@/lib/utils/currency';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BalanceResult {
  workingAccountBalance: number;
  utilityAccountBalance: number;
  chargesAccountBalance: number;
  queriedAt:             string;
}

interface MpesaTransaction {
  id:                   string;
  transaction_type:     string;
  direction:            'inbound' | 'outbound';
  mpesa_receipt_number: string | null;
  phone_number:         string | null;
  amount:               string;
  status:               string;
  reference:            string | null;
  description:          string | null;
  failure_reason:       string | null;
  created_at:           string;
  completed_at:         string | null;
}

interface TransactionPage {
  items:      MpesaTransaction[];
  total:      number;
  totalPages: number;
}

interface ReconciliationRun {
  id:                   string;
  status:               string;
  transactions_checked: number;
  mismatches_found:     number;
  resolved_count:       number;
  started_at:           string;
  completed_at:         string | null;
}

interface ReversalRecord {
  id:                      string;
  original_receipt_number: string;
  amount:                  string;
  status:                  string;
  remarks:                 string;
  requested_by_name:       string;
  created_at:              string;
}

interface ReconcileResult {
  reconciliationId:    string;
  transactionsChecked: number;
  mismatchesFound:     number;
  resolvedCount:       number;
}

// ─── API helpers — api.get / api.post return T directly ──────────────────────

const fetchBalance       = () => api.get<BalanceResult | null>('/mpesa/balance');
const triggerBalance     = () => api.post<{ message: string }>('/mpesa/balance', {});
const fetchTransactions  = (page: number) =>
  api.get<TransactionPage>(`/mpesa/transactions?page=${page}&limit=20`);
const fetchReversals     = () => api.get<ReversalRecord[]>('/mpesa/reversal');
const fetchReconciles    = () => api.get<ReconciliationRun[]>('/mpesa/reconcile');
const triggerReconcile   = () => api.post<ReconcileResult>('/mpesa/reconcile', {});

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    completed: 'bg-green-100 text-green-800',
    pending:   'bg-yellow-100 text-yellow-800',
    initiated: 'bg-blue-100 text-blue-800',
    failed:    'bg-red-100 text-red-800',
    timeout:   'bg-orange-100 text-orange-800',
    reversed:  'bg-purple-100 text-purple-800',
    cancelled: 'bg-gray-100 text-gray-600',
    running:   'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

function TypeBadge({ type, direction }: { type: string; direction: string }) {
  const labels: Record<string, string> = {
    stk_push:           'STK Push',
    c2b:                'C2B',
    b2c:                'B2C',
    b2b:                'B2B',
    reversal:           'Reversal',
    balance_query:      'Balance',
    transaction_status: 'TX Status',
  };
  const arrow  = direction === 'inbound' ? '↓' : '↑';
  const colour = direction === 'inbound' ? 'text-green-600' : 'text-blue-600';
  return (
    <span className="text-sm">
      <span className={`font-medium mr-1 ${colour}`}>{arrow}</span>
      {labels[type] ?? type}
    </span>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TreasuryPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [tab, setTab]   = useState<'transactions' | 'reconciliation' | 'reversals'>('transactions');
  const [reconcileMsg, setReconcileMsg] = useState<string | null>(null);

  const balanceQ = useQuery({
    queryKey: ['mpesa-balance'],
    queryFn:  fetchBalance,
    staleTime: 60_000,
  });

  const txQ = useQuery({
    queryKey: ['mpesa-transactions', page],
    queryFn:  () => fetchTransactions(page),
    staleTime: 30_000,
  });

  const reversalQ = useQuery({
    queryKey: ['mpesa-reversals'],
    queryFn:  fetchReversals,
    staleTime: 30_000,
    enabled:   tab === 'reversals',
  });

  const reconcileQ = useQuery({
    queryKey: ['mpesa-reconciliations'],
    queryFn:  fetchReconciles,
    staleTime: 30_000,
    enabled:   tab === 'reconciliation',
  });

  const balanceMut = useMutation({
    mutationFn: triggerBalance,
    onSuccess:  () =>
      setTimeout(() => qc.invalidateQueries({ queryKey: ['mpesa-balance'] }), 35_000),
  });

  const reconcileMut = useMutation({
    mutationFn: triggerReconcile,
    onSuccess: (res) => {
      setReconcileMsg(
        `Checked ${res.transactionsChecked} transactions — ${res.mismatchesFound} mismatches, ${res.resolvedCount} resolved.`,
      );
      qc.invalidateQueries({ queryKey: ['mpesa-transactions'] });
      qc.invalidateQueries({ queryKey: ['mpesa-reconciliations'] });
    },
  });

  const balance = balanceQ.data;

  return (
    <div className="space-y-6 p-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Treasury</h1>
          <p className="text-sm text-gray-500 mt-1">
            M-Pesa shortcode balance, transactions, and reconciliation
          </p>
        </div>
        <button
          type="button"
          onClick={() => balanceMut.mutate()}
          disabled={balanceMut.isPending}
          className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {balanceMut.isPending ? 'Querying…' : 'Refresh Balance'}
        </button>
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(
          [
            { label: 'Working Account', key: 'workingAccountBalance' },
            { label: 'Utility Account', key: 'utilityAccountBalance' },
            { label: 'Charges Account', key: 'chargesAccountBalance' },
          ] as { label: string; key: keyof BalanceResult }[]
        ).map(({ label, key }) => (
          <div key={key} className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-2">
              {balanceQ.isLoading
                ? '…'
                : balance
                  ? formatKES(balance[key] as number)
                  : 'KES —'}
            </p>
            {balance?.queriedAt && (
              <p className="text-xs text-gray-400 mt-1">
                {new Date(balance.queriedAt).toLocaleString('en-KE')}
              </p>
            )}
          </div>
        ))}
      </div>

      {balanceMut.isSuccess && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2">
          Balance query sent. Results appear within ~30 s — refresh to see updated figures.
        </p>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {(['transactions', 'reconciliation', 'reversals'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`py-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'border-green-600 text-green-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {/* Transactions */}
      {tab === 'transactions' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">All M-Pesa Transactions</h2>
            <span className="text-sm text-gray-500">
              {txQ.data ? `${txQ.data.total.toLocaleString()} total` : ''}
            </span>
          </div>

          {txQ.isLoading ? (
            <div className="p-8 text-center text-gray-400">Loading transactions…</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Type', 'Amount', 'Phone', 'Receipt', 'Status', 'Date'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {txQ.data?.items.map((tx) => (
                      <tr key={tx.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <TypeBadge type={tx.transaction_type} direction={tx.direction} />
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {formatKES(parseFloat(tx.amount))}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {tx.phone_number ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 font-mono text-xs">
                          {tx.mpesa_receipt_number ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={tx.status} />
                          {tx.failure_reason && (
                            <p className="text-xs text-red-600 mt-0.5 max-w-[180px] truncate" title={tx.failure_reason}>
                              {tx.failure_reason}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {new Date(tx.created_at).toLocaleDateString('en-KE')}
                        </td>
                      </tr>
                    ))}
                    {txQ.data?.items.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">
                          No transactions yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {txQ.data && txQ.data.totalPages > 1 && (
                <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
                  <p className="text-sm text-gray-600">Page {page} of {txQ.data.totalPages}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                      className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={page >= txQ.data.totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Reconciliation */}
      {tab === 'reconciliation' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-start justify-between gap-4">
            <div className="flex-1">
              <h3 className="font-semibold text-gray-800">Run Reconciliation</h3>
              <p className="text-sm text-gray-500 mt-1">
                Finds STK Push requests pending for &gt;5 minutes, queries Daraja for their
                actual status, and resolves mismatches automatically.
              </p>
              {reconcileMsg && (
                <p className="text-sm text-green-700 bg-green-50 rounded px-3 py-2 mt-2">
                  {reconcileMsg}
                </p>
              )}
              {reconcileMut.isError && (
                <p className="text-sm text-red-600 mt-2">
                  Reconciliation failed — check logs.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => reconcileMut.mutate()}
              disabled={reconcileMut.isPending}
              className="shrink-0 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {reconcileMut.isPending ? 'Running…' : 'Run Now'}
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">History</h3>
            </div>
            {reconcileQ.isLoading ? (
              <div className="p-8 text-center text-gray-400">Loading…</div>
            ) : (
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    {['Started', 'Status', 'Checked', 'Mismatches', 'Resolved', 'Duration'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {reconcileQ.data?.map((run) => {
                    const durSec = run.completed_at
                      ? Math.round(
                          (new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000,
                        )
                      : null;
                    return (
                      <tr key={run.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {new Date(run.started_at).toLocaleString('en-KE')}
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
                        <td className="px-4 py-3 text-sm">{run.transactions_checked}</td>
                        <td className="px-4 py-3 text-sm">{run.mismatches_found}</td>
                        <td className="px-4 py-3 text-sm font-medium text-green-700">{run.resolved_count}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {durSec !== null ? `${durSec}s` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  {reconcileQ.data?.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">
                        No reconciliation runs yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Reversals */}
      {tab === 'reversals' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-800">Reversal History</h3>
          </div>
          {reversalQ.isLoading ? (
            <div className="p-8 text-center text-gray-400">Loading…</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {['Original Receipt', 'Amount', 'Remarks', 'Status', 'Requested By', 'Date'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reversalQ.data?.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-xs font-mono text-gray-700">{r.original_receipt_number}</td>
                    <td className="px-4 py-3 text-sm font-medium">{formatKES(parseFloat(r.amount))}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-[180px] truncate">{r.remarks}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3 text-sm text-gray-600">{r.requested_by_name}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(r.created_at).toLocaleDateString('en-KE')}
                    </td>
                  </tr>
                ))}
                {reversalQ.data?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">
                      No reversals recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
