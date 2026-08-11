'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, Landmark, Receipt, RefreshCw, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatCard } from '@/components/shared/stat-card';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { ExpandableText } from '@/components/shared/expandable-text';
import { StatusPill } from '@/components/shared/status-pill';
import { PageHeader } from '@/components/shared/page-header';
import { ConfirmDialog, MoneyActionDialog } from '@/components/shared/confirm-dialog';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api/client';
import { formatKES, formatDate, formatDateTime, getErrorMessage } from '@/lib/utils';

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

interface BankAccountRow {
  id:             string;
  bank_name:      string;
  shortcode:      string;
  account_number: string;
  label:          string | null;
  status:         'pending_approval' | 'active' | 'rejected' | 'disabled';
  created_at:     string;
  activated_at:   string | null;
}

interface SettlementRow {
  id:                string;
  bank_account_id:   string;
  bank_name?:        string;
  amount:            string;
  status:            string;
  requested_at:      string;
  completed_at:      string | null;
  failure_reason:    string | null;
}

interface VendorPaymentRow {
  id:            string;
  channel:       'b2c' | 'b2b';
  payee_name:    string;
  payee_phone:   string | null;
  payee_shortcode: string | null;
  payee_account: string | null;
  amount:        string;
  status:        string;
  requested_at:  string;
  completed_at:  string | null;
  failure_reason: string | null;
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

function reconciliationDuration(run: ReconciliationRun): string {
  if (!run.completed_at) return '—';
  const durSec = Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000);
  return `${durSec}s`;
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
        <StatusPill status={r.status} size="sm" />
        {r.failure_reason && (
          <ExpandableText lines={2} className="text-[10px] text-destructive mt-0.5 max-w-[180px]">
            {r.failure_reason}
          </ExpandableText>
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
  const [tab, setTab]   = useState<
    'transactions' | 'reconciliation' | 'reversals' | 'funding' | 'bank-accounts' | 'settlements' | 'vendor-payments'
  >('transactions');
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
      <PageHeader
        title="Treasury"
        description="M-Pesa balance, transactions, and reconciliation"
        actions={
          <Button variant="outline" size="sm" onClick={() => balanceMut.mutate()} loading={balanceMut.isPending}>
            <RefreshCw size={15} /> Refresh balance
          </Button>
        }
      />

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
          <TabsTrigger value="bank-accounts">Bank Accounts</TabsTrigger>
          <TabsTrigger value="settlements">Settlements</TabsTrigger>
          <TabsTrigger value="vendor-payments">Vendor Payments</TabsTrigger>
        </TabsList>

        {/* Transactions */}
        <TabsContent value="transactions">
          <PaginatedTable
            data={txQ.data ? { items: txQ.data.items, total: txQ.data.total, page, pageSize: 20, totalPages: txQ.data.totalPages } : null}
            isLoading={txQ.isLoading}
            isError={txQ.isError}
            error={txQ.error}
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
            <CardContent className="p-4 pt-0">
              <PaginatedTable
                data={singlePage(reconcileQ.data)}
                isLoading={reconcileQ.isLoading}
                isError={reconcileQ.isError}
                error={reconcileQ.error}
                onPageChange={() => {}}
                emptyMessage="No reconciliation runs yet."
                columns={[
                  { key: 'started_at', header: 'Started', render: (run: ReconciliationRun) => formatDateTime(run.started_at) },
                  { key: 'status', header: 'Status', render: (run: ReconciliationRun) => <StatusPill status={run.status} size="sm" /> },
                  { key: 'transactions_checked', header: 'Checked', render: (run: ReconciliationRun) => run.transactions_checked },
                  { key: 'mismatches_found', header: 'Mismatches', render: (run: ReconciliationRun) => run.mismatches_found },
                  { key: 'resolved_count', header: 'Resolved', className: 'font-medium text-green-700', render: (run: ReconciliationRun) => run.resolved_count },
                  { key: 'duration', header: 'Duration', className: 'text-muted-foreground', render: reconciliationDuration },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Reversals */}
        <TabsContent value="reversals">
          <Card>
            <CardHeader className="py-4"><CardTitle className="text-base">Reversal history</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              <PaginatedTable
                data={singlePage(reversalQ.data)}
                isLoading={reversalQ.isLoading}
                isError={reversalQ.isError}
                error={reversalQ.error}
                onPageChange={() => {}}
                emptyMessage="No reversals recorded."
                columns={[
                  { key: 'original_receipt_number', header: 'Original Receipt', className: 'font-mono text-xs', render: (r: ReversalRecord) => r.original_receipt_number },
                  { key: 'amount', header: 'Amount', className: 'font-medium', render: (r: ReversalRecord) => formatKES(r.amount) },
                  { key: 'remarks', header: 'Remarks', className: 'max-w-[180px]', render: (r: ReversalRecord) => <ExpandableText>{r.remarks}</ExpandableText> },
                  { key: 'status', header: 'Status', render: (r: ReversalRecord) => <StatusPill status={r.status} size="sm" /> },
                  { key: 'requested_by_name', header: 'Requested By', render: (r: ReversalRecord) => r.requested_by_name },
                  { key: 'created_at', header: 'Date', className: 'text-muted-foreground', render: (r: ReversalRecord) => formatDate(r.created_at) },
                ]}
              />
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
            <CardContent className="p-4">
              <PaginatedTable
                data={singlePage(fundingQ.data?.items)}
                isLoading={fundingQ.isLoading}
                isError={fundingQ.isError}
                error={fundingQ.error}
                onPageChange={() => {}}
                emptyMessage="No external funding received yet."
                emptyDescription="When a partner organization disburses funds to this group, it appears here."
                columns={[
                  { key: 'organization_name', header: 'Organization', className: 'font-medium', render: (d: ExternalFundingItem) => d.organization_name },
                  { key: 'program_name', header: 'Program', className: 'text-muted-foreground', render: (d: ExternalFundingItem) => d.program_name ?? '—' },
                  { key: 'disbursement_type', header: 'Type', className: 'capitalize', render: (d: ExternalFundingItem) => d.disbursement_type.replace(/_/g, ' ') },
                  { key: 'amount', header: 'Amount', className: 'font-medium', render: (d: ExternalFundingItem) => formatKES(d.amount) },
                  { key: 'status', header: 'Status', render: (d: ExternalFundingItem) => <StatusPill status={d.status} size="sm" /> },
                  { key: 'reference', header: 'Reference', className: 'font-mono text-xs', render: (d: ExternalFundingItem) => d.reference },
                  { key: 'created_at', header: 'Date', className: 'text-muted-foreground', render: (d: ExternalFundingItem) => formatDate(d.created_at) },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bank-accounts">
          <BankAccountsTab />
        </TabsContent>

        <TabsContent value="settlements">
          <SettlementsTab />
        </TabsContent>

        <TabsContent value="vendor-payments">
          <VendorPaymentsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Bank Accounts tab ─────────────────────────────────────────────────────

function BankAccountsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [bankName, setBankName]     = useState('');
  const [shortcode, setShortcode]   = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [label, setLabel]           = useState('');
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; action: 'activate' | 'disable' } | null>(null);
  const [rejectTarget, setRejectTarget]   = useState<string | null>(null);
  const [rejectReason, setRejectReason]   = useState('');

  const listQ = useQuery({
    queryKey: ['treasury-bank-accounts'],
    queryFn:  () => api.get<BankAccountRow[]>('/treasury/bank-accounts'),
    staleTime: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['treasury-bank-accounts'] });

  const createMut = useMutation({
    mutationFn: () => api.post('/treasury/bank-accounts', {
      bankName, shortcode, accountNumber, label: label || undefined,
    }),
    onSuccess: () => {
      setCreateOpen(false);
      setBankName(''); setShortcode(''); setAccountNumber(''); setLabel('');
      invalidate();
      toast({ title: 'Bank account submitted', description: 'Awaiting a second officer’s activation.' });
    },
    onError: (err) => toast({ variant: 'destructive', title: 'Failed to add bank account', description: getErrorMessage(err) }),
  });

  const actionMut = useMutation({
    mutationFn: (args: { id: string; action: 'activate' | 'reject' | 'disable'; reason?: string }) =>
      api.post(`/treasury/bank-accounts/${args.id}`, { action: args.action, reason: args.reason }),
    onSuccess: () => { invalidate(); toast({ title: 'Bank account updated' }); },
    onError: (err) => toast({ variant: 'destructive', title: 'Action failed', description: getErrorMessage(err) }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus size={15} /> Add bank account</Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <PaginatedTable
            data={singlePage(listQ.data)}
            isLoading={listQ.isLoading}
            isError={listQ.isError}
            error={listQ.error}
            onPageChange={() => {}}
            emptyMessage="No bank accounts registered."
            emptyDescription="Add one to enable M-Pesa float settlements to a real bank account."
            columns={[
              { key: 'bank_name', header: 'Bank', className: 'font-medium', render: (r: BankAccountRow) => r.bank_name },
              { key: 'shortcode', header: 'Shortcode', className: 'font-mono text-xs', render: (r: BankAccountRow) => r.shortcode },
              { key: 'account_number', header: 'Account No.', className: 'font-mono text-xs', render: (r: BankAccountRow) => r.account_number },
              { key: 'label', header: 'Label', className: 'text-muted-foreground', render: (r: BankAccountRow) => r.label ?? '—' },
              { key: 'status', header: 'Status', render: (r: BankAccountRow) => <StatusPill status={r.status} size="sm" /> },
              { key: 'created_at', header: 'Added', className: 'text-muted-foreground', render: (r: BankAccountRow) => formatDate(r.created_at) },
              {
                key: 'actions', header: '', render: (r: BankAccountRow) => (
                  <div className="flex gap-2 justify-end">
                    {r.status === 'pending_approval' && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setConfirmTarget({ id: r.id, action: 'activate' })}>
                          Activate
                        </Button>
                        <Button size="sm" variant="outline" className="text-destructive" onClick={() => setRejectTarget(r.id)}>
                          Reject
                        </Button>
                      </>
                    )}
                    {r.status === 'active' && (
                      <Button size="sm" variant="outline" onClick={() => setConfirmTarget({ id: r.id, action: 'disable' })}>
                        Disable
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add bank account</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Bank name</Label>
              <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. Equity Bank" />
            </div>
            <div className="space-y-1">
              <Label>Bank shortcode</Label>
              <Input value={shortcode} onChange={(e) => setShortcode(e.target.value)} placeholder="e.g. 247247" />
            </div>
            <div className="space-y-1">
              <Label>Account number</Label>
              <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Label (optional)</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Main settlement account" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMut.mutate()}
              loading={createMut.isPending}
              disabled={!bankName || !shortcode || !accountNumber}
            >
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmTarget}
        onOpenChange={(o) => !o && setConfirmTarget(null)}
        title={confirmTarget?.action === 'activate' ? 'Activate bank account' : 'Disable bank account'}
        description={
          confirmTarget?.action === 'activate'
            ? 'This confirms the bank details are correct. Once active, this account becomes a valid settlement destination.'
            : 'This account will no longer be available for new settlements.'
        }
        confirmLabel={confirmTarget?.action === 'activate' ? 'Activate' : 'Disable'}
        onConfirm={async () => { if (confirmTarget) await actionMut.mutateAsync({ id: confirmTarget.id, action: confirmTarget.action }); }}
      />

      <ConfirmDialog
        open={!!rejectTarget}
        onOpenChange={(o) => { if (!o) { setRejectTarget(null); setRejectReason(''); } }}
        title="Reject bank account"
        variant="danger"
        description={
          <div className="space-y-2">
            <p>Why is this being rejected?</p>
            <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason" />
          </div>
        }
        confirmLabel="Reject"
        onConfirm={async () => { if (rejectTarget && rejectReason) await actionMut.mutateAsync({ id: rejectTarget, action: 'reject', reason: rejectReason }); }}
      />
    </div>
  );
}

// ─── Settlements tab ───────────────────────────────────────────────────────

/** Client-generated idempotency key — one per submit attempt, so a retry of
 *  the SAME click reuses it while a fresh click gets a new one. */
const newIdempotencyKey = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function SettlementsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [bankAccountId, setBankAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [approveTarget, setApproveTarget] = useState<SettlementRow | null>(null);
  const [rejectTarget, setRejectTarget]   = useState<string | null>(null);
  const [rejectReason, setRejectReason]   = useState('');

  const listQ = useQuery({
    queryKey: ['treasury-settlements'],
    queryFn:  () => api.get<SettlementRow[]>('/treasury/settlements'),
    staleTime: 30_000,
  });
  const banksQ = useQuery({
    queryKey: ['treasury-bank-accounts'],
    queryFn:  () => api.get<BankAccountRow[]>('/treasury/bank-accounts'),
    staleTime: 60_000,
  });
  const activeBanks = (banksQ.data ?? []).filter((b) => b.status === 'active');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['treasury-settlements'] });

  const createMut = useMutation({
    mutationFn: () => api.post('/treasury/settlements',
      { bankAccountId, amount: Number(amount) },
      { headers: { 'Idempotency-Key': newIdempotencyKey() } },
    ),
    onSuccess: () => {
      setCreateOpen(false); setBankAccountId(''); setAmount('');
      invalidate();
      toast({ title: 'Settlement requested', description: 'Funds reserved — awaiting a second officer’s approval.' });
    },
    onError: (err) => toast({ variant: 'destructive', title: 'Failed to request settlement', description: getErrorMessage(err) }),
  });

  const actionMut = useMutation({
    mutationFn: (args: { id: string; action: 'approve' | 'reject'; reason?: string }) =>
      api.post(`/treasury/settlements/${args.id}`, { action: args.action, reason: args.reason }),
    onSuccess: () => { invalidate(); toast({ title: 'Settlement updated' }); },
    onError: (err) => toast({ variant: 'destructive', title: 'Action failed', description: getErrorMessage(err) }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)} disabled={activeBanks.length === 0}>
          <Plus size={15} /> Request settlement
        </Button>
      </div>

      {activeBanks.length === 0 && !banksQ.isLoading && (
        <p className="text-sm text-muted-foreground bg-muted/40 border rounded-lg px-4 py-3">
          Add and activate a bank account first — settlements can only be sent to an active destination.
        </p>
      )}

      <Card>
        <CardContent className="p-4">
          <PaginatedTable
            data={singlePage(listQ.data)}
            isLoading={listQ.isLoading}
            isError={listQ.isError}
            error={listQ.error}
            onPageChange={() => {}}
            emptyMessage="No settlements yet."
            emptyDescription="Sweep M-Pesa float to the group's bank account."
            columns={[
              { key: 'bank_name', header: 'Destination', className: 'font-medium', render: (r: SettlementRow) => r.bank_name ?? '—' },
              { key: 'amount', header: 'Amount', className: 'font-medium', render: (r: SettlementRow) => formatKES(r.amount) },
              { key: 'status', header: 'Status', render: (r: SettlementRow) => (
                <div>
                  <StatusPill status={r.status} size="sm" />
                  {r.failure_reason && (
                    <ExpandableText lines={2} className="text-[10px] text-destructive mt-0.5 max-w-[180px]">
                      {r.failure_reason}
                    </ExpandableText>
                  )}
                </div>
              ) },
              { key: 'requested_at', header: 'Requested', className: 'text-muted-foreground', render: (r: SettlementRow) => formatDate(r.requested_at) },
              { key: 'completed_at', header: 'Completed', className: 'text-muted-foreground', render: (r: SettlementRow) => r.completed_at ? formatDate(r.completed_at) : '—' },
              {
                key: 'actions', header: '', render: (r: SettlementRow) => r.status === 'pending_approval' ? (
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="outline" onClick={() => setApproveTarget(r)}>Approve</Button>
                    <Button size="sm" variant="outline" className="text-destructive" onClick={() => setRejectTarget(r.id)}>Reject</Button>
                  </div>
                ) : null,
              },
            ]}
          />
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Request settlement</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Destination bank account</Label>
              <select
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
              >
                <option value="">Select an account…</option>
                {activeBanks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.bank_name} — {b.account_number}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Amount (KES)</Label>
              <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Funds are reserved on request. The sweep only reaches M-Pesa after a
              second officer approves.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMut.mutate()}
              loading={createMut.isPending}
              disabled={!bankAccountId || !amount || Number(amount) <= 0}
            >
              Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MoneyActionDialog
        open={!!approveTarget}
        onOpenChange={(o) => !o && setApproveTarget(null)}
        title="Approve settlement"
        amount={approveTarget ? Number(approveTarget.amount) : 0}
        details={approveTarget ? [
          { label: 'Destination', value: approveTarget.bank_name ?? '—' },
          { label: 'Requested',   value: formatDate(approveTarget.requested_at) },
        ] : []}
        warning="Approving sends this sweep to M-Pesa immediately. It cannot be recalled."
        confirmLabel="Approve & send"
        onConfirm={async () => { if (approveTarget) await actionMut.mutateAsync({ id: approveTarget.id, action: 'approve' }); }}
      />

      <ConfirmDialog
        open={!!rejectTarget}
        onOpenChange={(o) => { if (!o) { setRejectTarget(null); setRejectReason(''); } }}
        title="Reject settlement"
        variant="danger"
        description={
          <div className="space-y-2">
            <p>Why is this being rejected? The reserved funds are released.</p>
            <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason (min 5 chars)" />
          </div>
        }
        confirmLabel="Reject"
        onConfirm={async () => { if (rejectTarget && rejectReason.length >= 5) await actionMut.mutateAsync({ id: rejectTarget, action: 'reject', reason: rejectReason }); }}
      />
    </div>
  );
}

// ─── Vendor Payments tab ───────────────────────────────────────────────────

function VendorPaymentsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen]   = useState(false);
  const [channel, setChannel]         = useState<'b2c' | 'b2b'>('b2c');
  const [payeeName, setPayeeName]     = useState('');
  const [payeePhone, setPayeePhone]   = useState('');
  const [payeeShortcode, setPayeeShortcode] = useState('');
  const [payeeAccount, setPayeeAccount]     = useState('');
  const [amount, setAmount]           = useState('');
  const [description, setDescription] = useState('');
  const [approveTarget, setApproveTarget] = useState<VendorPaymentRow | null>(null);
  const [rejectTarget, setRejectTarget]   = useState<string | null>(null);
  const [rejectReason, setRejectReason]   = useState('');

  const listQ = useQuery({
    queryKey: ['treasury-vendor-payments'],
    queryFn:  () => api.get<VendorPaymentRow[]>('/treasury/vendor-payments'),
    staleTime: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['treasury-vendor-payments'] });

  const createMut = useMutation({
    mutationFn: () => api.post('/treasury/vendor-payments',
      channel === 'b2c'
        ? { channel, payeeName, payeePhone, amount: Number(amount), description: description || undefined }
        : { channel, payeeName, payeeShortcode, payeeAccount, amount: Number(amount), description: description || undefined },
      { headers: { 'Idempotency-Key': newIdempotencyKey() } },
    ),
    onSuccess: () => {
      setCreateOpen(false);
      setPayeeName(''); setPayeePhone(''); setPayeeShortcode(''); setPayeeAccount('');
      setAmount(''); setDescription('');
      invalidate();
      toast({ title: 'Vendor payment requested', description: 'Funds reserved — awaiting a second officer’s approval.' });
    },
    onError: (err) => toast({ variant: 'destructive', title: 'Failed to request payment', description: getErrorMessage(err) }),
  });

  const actionMut = useMutation({
    mutationFn: (args: { id: string; action: 'approve' | 'reject'; reason?: string }) =>
      api.post(`/treasury/vendor-payments/${args.id}`, { action: args.action, reason: args.reason }),
    onSuccess: () => { invalidate(); toast({ title: 'Vendor payment updated' }); },
    onError: (err) => toast({ variant: 'destructive', title: 'Action failed', description: getErrorMessage(err) }),
  });

  const destination = (r: VendorPaymentRow) =>
    r.channel === 'b2c' ? (r.payee_phone ?? '—') : `${r.payee_shortcode ?? '—'} / ${r.payee_account ?? '—'}`;

  const canSubmit = payeeName && amount && Number(amount) > 0 &&
    (channel === 'b2c' ? !!payeePhone : (!!payeeShortcode && !!payeeAccount));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus size={15} /> New vendor payment</Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <PaginatedTable
            data={singlePage(listQ.data)}
            isLoading={listQ.isLoading}
            isError={listQ.isError}
            error={listQ.error}
            onPageChange={() => {}}
            emptyMessage="No vendor payments yet."
            emptyDescription="Pay suppliers directly from the group's M-Pesa float."
            columns={[
              { key: 'payee_name', header: 'Payee', className: 'font-medium', render: (r: VendorPaymentRow) => r.payee_name },
              { key: 'channel', header: 'Channel', render: (r: VendorPaymentRow) => (
                <Badge variant="outline" className="uppercase text-[10px]">{r.channel}</Badge>
              ) },
              { key: 'destination', header: 'Destination', className: 'font-mono text-xs', render: destination },
              { key: 'amount', header: 'Amount', className: 'font-medium', render: (r: VendorPaymentRow) => formatKES(r.amount) },
              { key: 'status', header: 'Status', render: (r: VendorPaymentRow) => (
                <div>
                  <StatusPill status={r.status} size="sm" />
                  {r.failure_reason && (
                    <ExpandableText lines={2} className="text-[10px] text-destructive mt-0.5 max-w-[180px]">
                      {r.failure_reason}
                    </ExpandableText>
                  )}
                </div>
              ) },
              { key: 'requested_at', header: 'Requested', className: 'text-muted-foreground', render: (r: VendorPaymentRow) => formatDate(r.requested_at) },
              {
                key: 'actions', header: '', render: (r: VendorPaymentRow) => r.status === 'pending_approval' ? (
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="outline" onClick={() => setApproveTarget(r)}>Approve</Button>
                    <Button size="sm" variant="outline" className="text-destructive" onClick={() => setRejectTarget(r.id)}>Reject</Button>
                  </div>
                ) : null,
              },
            ]}
          />
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New vendor payment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Channel</Label>
              <div className="flex gap-2">
                <Button
                  type="button" size="sm" className="flex-1"
                  variant={channel === 'b2c' ? 'default' : 'outline'}
                  onClick={() => setChannel('b2c')}
                >
                  Phone (B2C)
                </Button>
                <Button
                  type="button" size="sm" className="flex-1"
                  variant={channel === 'b2b' ? 'default' : 'outline'}
                  onClick={() => setChannel('b2b')}
                >
                  Paybill / Till (B2B)
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Payee name</Label>
              <Input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} />
            </div>
            {channel === 'b2c' ? (
              <div className="space-y-1">
                <Label>Payee phone</Label>
                <Input value={payeePhone} onChange={(e) => setPayeePhone(e.target.value)} placeholder="0712345678" />
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <Label>Paybill / Till shortcode</Label>
                  <Input value={payeeShortcode} onChange={(e) => setPayeeShortcode(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Account number</Label>
                  <Input value={payeeAccount} onChange={(e) => setPayeeAccount(e.target.value)} />
                </div>
              </>
            )}
            <div className="space-y-1">
              <Label>Amount (KES)</Label>
              <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Description (optional)</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMut.mutate()} loading={createMut.isPending} disabled={!canSubmit}>
              Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MoneyActionDialog
        open={!!approveTarget}
        onOpenChange={(o) => !o && setApproveTarget(null)}
        title="Approve vendor payment"
        amount={approveTarget ? Number(approveTarget.amount) : 0}
        details={approveTarget ? [
          { label: 'Payee',       value: approveTarget.payee_name },
          { label: 'Channel',     value: approveTarget.channel.toUpperCase() },
          { label: 'Destination', value: destination(approveTarget) },
        ] : []}
        warning="Approving sends this payment to M-Pesa immediately. It cannot be recalled."
        confirmLabel="Approve & send"
        onConfirm={async () => { if (approveTarget) await actionMut.mutateAsync({ id: approveTarget.id, action: 'approve' }); }}
      />

      <ConfirmDialog
        open={!!rejectTarget}
        onOpenChange={(o) => { if (!o) { setRejectTarget(null); setRejectReason(''); } }}
        title="Reject vendor payment"
        variant="danger"
        description={
          <div className="space-y-2">
            <p>Why is this being rejected? The reserved funds are released.</p>
            <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason (min 5 chars)" />
          </div>
        }
        confirmLabel="Reject"
        onConfirm={async () => { if (rejectTarget && rejectReason.length >= 5) await actionMut.mutateAsync({ id: rejectTarget, action: 'reject', reason: rejectReason }); }}
      />
    </div>
  );
}
