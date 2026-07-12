'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, Landmark, Receipt, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { StatCard } from '@/components/shared/stat-card';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { api } from '@/lib/api/client';
import { formatKES, formatDate, formatDateTime } from '@/lib/utils';

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

interface ExternalFundingItem {
  id:                string;
  organization_name: string;
  program_name:      string | null;
  disbursement_type: string;
  amount:            string;
  status:            string;
  reference:         string;
  notes:             string | null;
  created_at:        string;
}

interface ExternalFundingPage {
  items:         ExternalFundingItem[];
  total:         number;
  totalReceived: string;
}

// ─── API helpers — api.get / api.post return T directly ──────────────────────

const fetchBalance      = () => api.get<BalanceResult | null>('/mpesa/balance');
const triggerBalance    = () => api.post<{ message: string }>('/mpesa/balance', {});
const fetchTransactions = (page: number) =>
  api.get<TransactionPage>(`/mpesa/transactions?page=${page}&limit=20`);
const fetchReversals    = () => api.get<ReversalRecord[]>('/mpesa/reversal');
const fetchReconciles   = () => api.get<ReconciliationRun[]>('/mpesa/reconcile');
const triggerReconcile  = () => api.post<ReconcileResult>('/mpesa/reconcile', {});
const fetchFunding      = () => api.get<ExternalFundingPage>('/treasury/external-funding?limit=50');

// ─── Shared display helpers ──────────────────────────────────────────────────

const statusVariant: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  completed: 'success',
  resolved:  'success',
  pending:   'warning',
  initiated: 'warning',
  running:   'warning',
  failed:    'destructive',
  timeout:   'destructive',
  reversed:  'secondary',
  cancelled: 'secondary',
};

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={statusVariant[status] ?? 'secondary'}>{status}</Badge>;
}

const typeLabels: Record<string, string> = {
  stk_push:           'STK Push',
  c2b:                'C2B',
  b2c:                'B2C',
  b2b:                'B2B',
  reversal:           'Reversal',
  balance_query:      'Balance',
  transaction_status: 'TX Status',
};

function TypeBadge({ type, direction }: { type: string; direction: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Badge variant="outline" className="uppercase text-[10px]">{typeLabels[type] ?? type}</Badge>
      <span className={`text-xs ${direction === 'inbound' ? 'text-green-600' : 'text-amber-600'}`}>
        {direction === 'inbound' ? '↓' : '↑'}
      </span>
    </div>
  );
}

const accounts = [
  { label: 'Working Account', key: 'workingAccountBalance', icon: Wallet },
  { label: 'Utility Account', key: 'utilityAccountBalance', icon: Landmark },
  { label: 'Charges Account', key: 'chargesAccountBalance', icon: Receipt },
] as const;

const txColumns = [
  { key: 'type',    header: 'Type',    render: (r: MpesaTransaction) => <TypeBadge type={r.transaction_type} direction={r.direction} /> },
  { key: 'amount',  header: 'Amount',  render: (r: MpesaTransaction) => <span className="font-medium">{formatKES(r.amount)}</span> },
  { key: 'phone',   header: 'Phone',   render: (r: MpesaTransaction) => r.phone_number ?? '—' },
  { key: 'receipt', header: 'Receipt', render: (r: MpesaTransaction) => <span className="font-mono text-xs">{r.mpesa_receipt_number ?? '—'}</span> },
  {
    key: 'status', header: 'Status',
    render: (r: MpesaTransaction) => (
      <div>
        <StatusBadge status={r.status} />
        {r.failure_reason && (
          <p className="text-[10px] text-destructive mt-0.5 max-w-[180px] truncate" title={r.failure_reason}>
            {r.failure_reason}
          </p>
        )}
      </div>
    ),
  },
  { key: 'date', header: 'Date', render: (r: MpesaTransaction) => formatDate(r.created_at) },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TreasuryPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [tab, setTab]   = useState<'transactions' | 'reconciliation' | 'reversals' | 'funding'>('transactions');
  const [reconcileMsg, setReconcileMsg] = useState<string | null>(null);

  const balanceQ = useQuery({ queryKey: ['mpesa-balance'], queryFn: fetchBalance, staleTime: 60_000 });
  const txQ      = useQuery({ queryKey: ['mpesa-transactions', page], queryFn: () => fetchTransactions(page), staleTime: 30_000 });
  const reversalQ = useQuery({ queryKey: ['mpesa-reversals'], queryFn: fetchReversals, staleTime: 30_000, enabled: tab === 'reversals' });
  const reconcileQ = useQuery({ queryKey: ['mpesa-reconciliations'], queryFn: fetchReconciles, staleTime: 30_000, enabled: tab === 'reconciliation' });
  const fundingQ   = useQuery({ queryKey: ['treasury-external-funding'], queryFn: fetchFunding, staleTime: 60_000, enabled: tab === 'funding' });

  const balanceMut = useMutation({
    mutationFn: triggerBalance,
    onSuccess:  () => setTimeout(() => qc.invalidateQueries({ queryKey: ['mpesa-balance'] }), 35_000),
  });

  const reconcileMut = useMutation({
    mutationFn: triggerReconcile,
    onSuccess: (res) => {
      setReconcileMsg(`Checked ${res.transactionsChecked} transactions — ${res.mismatchesFound} mismatches, ${res.resolvedCount} resolved.`);
      qc.invalidateQueries({ queryKey: ['mpesa-transactions'] });
      qc.invalidateQueries({ queryKey: ['mpesa-reconciliations'] });
    },
  });

  const balance = balanceQ.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Treasury</h1>
          <p className="text-sm text-muted-foreground">M-Pesa balance, transactions, and reconciliation</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => balanceMut.mutate()} loading={balanceMut.isPending}>
          <RefreshCw size={15} /> Refresh balance
        </Button>
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {accounts.map(({ label, key, icon }) => (
          <StatCard
            key={key}
            title={label}
            icon={icon}
            value={balanceQ.isLoading ? '…' : balance ? formatKES(balance[key]) : '—'}
            description={balance?.queriedAt ? `As of ${formatDateTime(balance.queriedAt)}` : undefined}
          />
        ))}
      </div>

      {balanceMut.isSuccess && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2">
          Balance query sent. Results appear within ~30 s — refresh to see updated figures.
        </p>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
          <TabsTrigger value="reversals">Reversals</TabsTrigger>
          <TabsTrigger value="funding">External funding</TabsTrigger>
        </TabsList>

        {/* Transactions */}
        <TabsContent value="transactions">
          <PaginatedTable
            data={txQ.data ? { items: txQ.data.items, total: txQ.data.total, page, pageSize: 20, totalPages: txQ.data.totalPages } : null}
            isLoading={txQ.isLoading}
            columns={txColumns}
            onPageChange={setPage}
            emptyMessage="No transactions yet."
          />
        </TabsContent>

        {/* Reconciliation */}
        <TabsContent value="reconciliation" className="space-y-4">
          <Card>
            <CardContent className="p-5 flex items-start justify-between gap-4">
              <div className="flex-1 space-y-1">
                <h3 className="font-semibold">Run reconciliation</h3>
                <p className="text-sm text-muted-foreground">
                  Finds STK Push requests pending for &gt;5 minutes, queries Daraja for their
                  actual status, and resolves mismatches automatically.
                </p>
                {reconcileMsg && (
                  <p className="text-sm text-green-700 bg-green-50 rounded px-3 py-2 mt-2">{reconcileMsg}</p>
                )}
                {reconcileMut.isError && (
                  <p className="text-sm text-destructive mt-2">Reconciliation failed — check logs.</p>
                )}
              </div>
              <Button className="shrink-0" onClick={() => reconcileMut.mutate()} loading={reconcileMut.isPending}>
                Run now
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-4"><CardTitle className="text-base">History</CardTitle></CardHeader>
            <CardContent className="p-0">
              {reconcileQ.isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Loading…</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {['Started', 'Status', 'Checked', 'Mismatches', 'Resolved', 'Duration'].map((h) => (
                        <TableHead key={h}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reconcileQ.data?.map((run) => {
                      const durSec = run.completed_at
                        ? Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)
                        : null;
                      return (
                        <TableRow key={run.id}>
                          <TableCell>{formatDateTime(run.started_at)}</TableCell>
                          <TableCell><StatusBadge status={run.status} /></TableCell>
                          <TableCell>{run.transactions_checked}</TableCell>
                          <TableCell>{run.mismatches_found}</TableCell>
                          <TableCell className="font-medium text-green-700">{run.resolved_count}</TableCell>
                          <TableCell className="text-muted-foreground">{durSec !== null ? `${durSec}s` : '—'}</TableCell>
                        </TableRow>
                      );
                    })}
                    {reconcileQ.data?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                          No reconciliation runs yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Reversals */}
        <TabsContent value="reversals">
          <Card>
            <CardHeader className="py-4"><CardTitle className="text-base">Reversal history</CardTitle></CardHeader>
            <CardContent className="p-0">
              {reversalQ.isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Loading…</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {['Original Receipt', 'Amount', 'Remarks', 'Status', 'Requested By', 'Date'].map((h) => (
                        <TableHead key={h}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reversalQ.data?.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.original_receipt_number}</TableCell>
                        <TableCell className="font-medium">{formatKES(r.amount)}</TableCell>
                        <TableCell className="max-w-[180px] truncate">{r.remarks}</TableCell>
                        <TableCell><StatusBadge status={r.status} /></TableCell>
                        <TableCell>{r.requested_by_name}</TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(r.created_at)}</TableCell>
                      </TableRow>
                    ))}
                    {reversalQ.data?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                          No reversals recorded.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* External funding — org → group disbursements received */}
        <TabsContent value="funding" className="space-y-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-semibold">Funding received from partner organizations</h3>
                  <p className="text-sm text-muted-foreground">
                    Grants, revolving funds and other capital injected by organizations linked
                    to this group. Each receipt is posted to your books automatically
                    (Cash / External Funding).
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs uppercase text-muted-foreground tracking-wide">Total received</p>
                  <p className="text-xl font-bold text-green-700">
                    {fundingQ.isLoading ? '…' : formatKES(fundingQ.data?.totalReceived ?? 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              {fundingQ.isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Loading…</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {['Organization', 'Program', 'Type', 'Amount', 'Status', 'Reference', 'Date'].map((h) => (
                        <TableHead key={h}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(fundingQ.data?.items ?? []).map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{d.organization_name}</TableCell>
                        <TableCell className="text-muted-foreground">{d.program_name ?? '—'}</TableCell>
                        <TableCell className="capitalize">{d.disbursement_type.replace(/_/g, ' ')}</TableCell>
                        <TableCell className="font-medium">{formatKES(d.amount)}</TableCell>
                        <TableCell><StatusBadge status={d.status} /></TableCell>
                        <TableCell className="font-mono text-xs">{d.reference}</TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(d.created_at)}</TableCell>
                      </TableRow>
                    ))}
                    {(fundingQ.data?.items ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                          No external funding received yet. When a partner organization
                          disburses funds to this group, it appears here.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
