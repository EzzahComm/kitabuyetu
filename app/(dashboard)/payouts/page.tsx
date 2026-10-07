'use client';

/**
 * Member disbursements (migration 218).
 *
 *   Chairperson / Secretary  → initiate (member, amount, purpose)
 *   Treasurer                → review & approve or reject (never their own)
 *   Kitabu Yetu              → final sign-off; the system then executes
 *   System                   → posts the group ledger + member ledger together
 *
 * Every rule here is mirrored from the server (member-payouts.service.ts and
 * the migration-218 trigger) for guidance only — the UI hiding a button is
 * never the control.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, HandCoins, History, Scale, Search, Send, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { StatusPill } from '@/components/shared/status-pill';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuth, isTenantUser } from '@/lib/auth/context';
import { useHasPermission } from '@/lib/auth/use-permission';
import { api, ApiError } from '@/lib/api/client';
import { formatKES, formatDate } from '@/lib/utils';
import type { Tone } from '@/lib/ui/tokens';
import type { PaginatedResult } from '@/types/db.types';

type Purpose = 'savings_withdrawal' | 'merry_go_round' | 'other';
type Method = 'mpesa' | 'cash' | 'bank_transfer';
type PayoutStatus =
  | 'pending_approval'
  | 'awaiting_platform'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'dispatched'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'reconciled';

interface PayoutRow {
  id: string;
  reference: string;
  member_id: string;
  recipient_name: string | null;
  recipient_membership_no: string | null;
  payout_purpose: Purpose;
  purpose_description: string | null;
  notes: string | null;
  payment_method: Method;
  payment_reference: string | null;
  phone: string;
  amount: string;
  status: PayoutStatus;
  initiated_by: string;
  initiated_by_name: string | null;
  initiated_by_role: string | null;
  approved_by_name: string | null;
  rejection_reason: string | null;
  failure_reason: string | null;
  mpesa_receipt_number: string | null;
  journal_entry_id: string | null;
  created_at: string;
}
interface MemberRow {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  membership_no: string | null;
  group_status: string;
}
interface Eligibility {
  memberId: string;
  memberName: string;
  phone: string | null;
  withdrawableSavings: number;
  available: { cash: number; bank: number | null };
}
interface Detail {
  payout: PayoutRow;
  impact: {
    sourceAccountCode: string;
    groupAvailableBefore: number;
    groupAvailableAfter: number;
    memberWithdrawable: number | null;
    reducesSavings: boolean;
  };
  history: { action: string; actor_name: string | null; created_at: string }[];
}
interface ReconIssue {
  id: string;
  reference: string;
  memberName: string;
  amount: number;
  postedAmount: number | null;
  issue: 'missing_journal' | 'journal_voided' | 'amount_mismatch' | 'outcome_unknown';
}
interface Reconciliation {
  completed: { count: number; total: number };
  postedToLedger: { count: number; total: number };
  inFlight: { count: number; total: number };
  reconciled: boolean;
  issues: ReconIssue[];
}

const PURPOSE_LABEL: Record<Purpose, string> = {
  savings_withdrawal: 'Savings withdrawal',
  merry_go_round: 'Merry-go-round payout',
  other: 'Other disbursement',
};
const METHOD_LABEL: Record<Method, string> = {
  mpesa: 'M-Pesa (registered phone)',
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
};
const STATUS_LABEL: Record<PayoutStatus, string> = {
  pending_approval: 'Awaiting treasurer',
  awaiting_platform: 'Awaiting Kitabu Yetu',
  approved: 'Released',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  dispatched: 'Sent — awaiting M-Pesa',
  completed: 'Completed',
  failed: 'Failed',
  timed_out: 'Outcome unknown',
  reconciled: 'Reconciled',
};
const STATUS_TONE: Partial<Record<PayoutStatus, Tone>> = {
  pending_approval: 'pending',
  awaiting_platform: 'pending',
  approved: 'pending',
  dispatched: 'pending',
  cancelled: 'neutral',
  timed_out: 'warning',
};
const FILTERS: { value: '' | PayoutStatus; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'pending_approval', label: 'Pending' },
  { value: 'awaiting_platform', label: 'With Kitabu Yetu' },
  { value: 'completed', label: 'Completed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];
const ISSUE_LABEL: Record<ReconIssue['issue'], string> = {
  missing_journal: 'Paid, but not posted to the group ledger',
  journal_voided: 'Ledger entry was voided',
  amount_mismatch: 'Ledger amount differs from amount paid',
  outcome_unknown: 'No M-Pesa result — check the Safaricom statement',
};
const HISTORY_LABEL: Record<string, string> = {
  'disbursement.initiate': 'Submitted',
  'member_payout.treasurer_approve': 'Approved by treasurer',
  'member_payout.treasurer_reject': 'Rejected by treasurer',
  'member_payout.cancel': 'Cancelled by initiator',
  'member_payout.platform_approve': 'Signed off by Kitabu Yetu',
  'member_payout.platform_reject': 'Declined by Kitabu Yetu',
  'member_payout.journal_posted': 'Posted to group & member ledgers',
  'disbursement.dispatch': 'Sent to M-Pesa',
  'disbursement.failed': 'M-Pesa dispatch failed',
};

const selectClass = 'flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
const errMsg = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong');

export default function DisbursementsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const canAccess = useHasPermission('member_payouts.manage');
  const tenantUser = user && isTenantUser(user) ? user : null;
  const office = tenantUser?.groupRole;
  const canInitiate = office === 'chairperson' || office === 'secretary';
  const isTreasurer = office === 'treasurer';

  // Filters
  const [status, setStatus] = useState<'' | PayoutStatus>('');
  const [filterMember, setFilterMember] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  // Create flow
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [memberId, setMemberId] = useState('');
  const [purpose, setPurpose] = useState<Purpose>('savings_withdrawal');
  const [method, setMethod] = useState<Method>('mpesa');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [confirming, setConfirming] = useState(false);

  // Review flow
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const listParams = new URLSearchParams({ limit: '50' });
  if (status) listParams.set('status', status);
  if (filterMember) listParams.set('memberId', filterMember);
  if (filterFrom) listParams.set('from', filterFrom);
  if (filterTo) listParams.set('to', filterTo);
  const listQuery = listParams.toString();

  const payoutsQ = useQuery<PaginatedResult<PayoutRow>>({
    queryKey: ['payouts', 'list', listQuery],
    queryFn: () => api.get<PaginatedResult<PayoutRow>>(`/member-payouts?${listQuery}`),
    enabled: canAccess,
  });
  const reconQ = useQuery<Reconciliation>({
    queryKey: ['payouts', 'reconciliation'],
    queryFn: () => api.get<Reconciliation>('/member-payouts/reconciliation'),
    enabled: canAccess,
  });
  const membersQ = useQuery<PaginatedResult<MemberRow>>({
    queryKey: ['payouts', 'members'],
    queryFn: () => api.get<PaginatedResult<MemberRow>>('/members?status=active&limit=200'),
    enabled: canAccess,
  });
  const eligibilityQ = useQuery<Eligibility>({
    queryKey: ['payouts', 'eligibility', memberId],
    queryFn: () => api.get<Eligibility>(`/member-payouts/eligibility?memberId=${memberId}`),
    enabled: (creating || confirming) && !!memberId,
  });
  const detailQ = useQuery<Detail>({
    queryKey: ['payouts', 'detail', reviewId],
    queryFn: () => api.get<Detail>(`/member-payouts/${reviewId}`),
    enabled: !!reviewId,
  });

  const items = payoutsQ.data?.items ?? [];
  const members = useMemo(
    () => (membersQ.data?.items ?? []).filter((m) => m.group_status === 'active'),
    [membersQ.data],
  );
  const recon = reconQ.data;
  const elig = eligibilityQ.data;
  const selected = members.find((m) => m.id === memberId);
  const amt = /^\d+$/.test(amount) ? parseInt(amount, 10) : 0;
  const awaitingTreasurer = items.filter((p) => p.status === 'pending_approval').length;

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members.slice(0, 8);
    return members
      .filter((m) =>
        [`${m.first_name} ${m.last_name}`, m.membership_no ?? '', m.phone].some((v) => v.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [members, search]);

  const groupAvailable = elig ? (method === 'bank_transfer' ? elig.available.bank : elig.available.cash) : null;
  const amountError = (() => {
    if (!amount) return null;
    if (!/^\d+$/.test(amount) || amt <= 0) return 'Enter a whole-shilling amount greater than zero';
    if (amt > 250_000) return 'At most KES 250,000 per disbursement';
    if (elig && method === 'bank_transfer' && groupAvailable === null) return 'This group has no bank account set up';
    if (groupAvailable !== null && amt > groupAvailable) {
      return `Exceeds available group funds (${formatKES(groupAvailable)})`;
    }
    if (elig && purpose === 'savings_withdrawal' && amt > elig.withdrawableSavings) {
      return `Exceeds ${elig.memberName}'s withdrawable savings (${formatKES(elig.withdrawableSavings)})`;
    }
    if (elig && method === 'mpesa' && !elig.phone) return 'This member has no registered phone for M-Pesa';
    return null;
  })();
  const formIncomplete =
    !memberId ||
    !elig ||
    amt <= 0 ||
    !!amountError ||
    description.trim().length < 3 ||
    (method === 'bank_transfer' && !paymentReference.trim());

  const refresh = () => qc.invalidateQueries({ queryKey: ['payouts'] });

  const openCreate = () => {
    setSearch('');
    setMemberId('');
    setPurpose('savings_withdrawal');
    setMethod('mpesa');
    setAmount('');
    setDescription('');
    setNotes('');
    setPaymentReference('');
    // One key per submission: a double-click, refresh-retry or network retry
    // returns the same disbursement instead of creating a second one.
    setIdempotencyKey(crypto.randomUUID());
    setCreating(true);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ reference: string }>(
        '/member-payouts',
        {
          memberId,
          amount: amt,
          purpose,
          description: description.trim(),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          paymentMethod: method,
          ...(paymentReference.trim() ? { paymentReference: paymentReference.trim() } : {}),
        },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      ); // gitleaks:allow — header name, not a secret; value is a client-generated crypto.randomUUID()
      toast({
        title: `Disbursement ${res.reference} submitted`,
        description: 'Funds are reserved. The treasurer has been asked to approve it.',
      });
      setConfirming(false);
      await refresh();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Disbursement not submitted', description: errMsg(err) });
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, body: Record<string, unknown>, success: string) => {
    setBusy(true);
    try {
      await api.post(`/member-payouts/${id}`, body);
      toast({ title: success });
      setReviewId(null);
      setRejecting(false);
      setRejectReason('');
      await refresh();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Action failed', description: errMsg(err) });
    } finally {
      setBusy(false);
    }
  };

  const repost = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ posted: number; skipped: number }>('/member-payouts/reconciliation', {});
      toast({
        title:
          res.posted > 0
            ? `Posted ${res.posted} missing ledger entr${res.posted === 1 ? 'y' : 'ies'}`
            : 'Nothing to post',
        description:
          res.skipped > 0
            ? `${res.skipped} could not post — check the chart of accounts has 1001, 4001 and 5001.`
            : undefined,
      });
      await refresh();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Reconciliation failed', description: errMsg(err) });
    } finally {
      setBusy(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="space-y-6">
        <PageHeader title="Disbursements" />
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Disbursements are managed by the group&apos;s chairperson, secretary and treasurer. Your own disbursements
            appear in your passbook.
          </CardContent>
        </Card>
      </div>
    );
  }

  const detail = detailQ.data;
  const reviewing = detail?.payout;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Disbursements"
        description="Pay a member from group funds. The chairperson or secretary initiates, the treasurer approves and Kitabu Yetu signs off — then the group and member ledgers post together."
        actions={
          canInitiate ? (
            <Button onClick={openCreate}>
              <Send size={15} className="mr-2" /> New disbursement
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Disbursed"
          value={formatKES(recon?.completed.total ?? 0)}
          description={`${recon?.completed.count ?? 0} completed`}
          icon={HandCoins}
          accent="green"
          loading={reconQ.isLoading}
        />
        <StatCard
          title="In progress"
          value={formatKES(recon?.inFlight.total ?? 0)}
          description="Reserved, not yet paid"
          icon={Clock}
          accent="orange"
          loading={reconQ.isLoading}
        />
        <StatCard
          title="Awaiting treasurer"
          value={awaitingTreasurer}
          description={isTreasurer ? 'Needs your review' : 'Pending approval'}
          icon={ShieldCheck}
          accent="blue"
          loading={payoutsQ.isLoading}
        />
        <StatCard
          title="Ledgers"
          value={recon ? (recon.reconciled ? 'Reconciled' : `${recon.issues.length} to fix`) : '—'}
          description={recon ? `${formatKES(recon.postedToLedger.total)} posted` : undefined}
          icon={Scale}
          accent={recon && !recon.reconciled ? 'red' : 'brand'}
          loading={reconQ.isLoading}
        />
      </div>

      {recon && !recon.reconciled && (
        <Card className="border-amber-300">
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle size={18} className="text-amber-600" /> Reconciliation needs attention
            </CardTitle>
            {recon.issues.some((i) => i.issue === 'missing_journal') && (
              <Button size="sm" variant="outline" onClick={repost} loading={busy}>
                Post missing entries
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {recon.issues.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-medium">{i.reference}</span> · {i.memberName} · {formatKES(i.amount)}
                </span>
                <span className="text-muted-foreground">
                  {ISSUE_LABEL[i.issue]}
                  {i.issue === 'amount_mismatch' && i.postedAmount !== null
                    ? ` (ledger ${formatKES(i.postedAmount)})`
                    : ''}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <Button
              key={f.value || 'all'}
              size="sm"
              variant={status === f.value ? 'default' : 'outline'}
              onClick={() => setStatus(f.value)}
              role="tab"
              aria-selected={status === f.value}
              className="shrink-0"
            >
              {f.label}
            </Button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <select
            aria-label="Filter by member"
            value={filterMember}
            onChange={(e) => setFilterMember(e.target.value)}
            className={selectClass}
          >
            <option value="">All members</option>
            {(membersQ.data?.items ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.first_name} {m.last_name}
              </option>
            ))}
          </select>
          <Input
            type="date"
            aria-label="From date"
            className="h-11"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
          />
          <Input
            type="date"
            aria-label="To date"
            className="h-11"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
          />
        </div>
      </div>

      {payoutsQ.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : payoutsQ.isError ? (
        <Card>
          <CardContent className="py-10 text-center text-destructive">{errMsg(payoutsQ.error)}</CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <HandCoins className="mx-auto mb-3 opacity-40" size={32} />
            No disbursements match these filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((row) => {
            const toReview = row.status === 'pending_approval' && isTreasurer && row.initiated_by !== user?.id;
            return (
              <Card key={row.id}>
                <CardContent className="py-4 flex items-center justify-between flex-wrap gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{formatKES(Number(row.amount))}</span>
                      <StatusPill
                        status={row.status}
                        tone={STATUS_TONE[row.status]}
                        label={STATUS_LABEL[row.status]}
                        size="sm"
                      />
                      {row.status === 'completed' &&
                        (row.journal_entry_id ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
                            <CheckCircle2 size={13} /> Ledgers reconciled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                            <AlertTriangle size={13} /> Not posted
                          </span>
                        ))}
                    </div>
                    <p className="text-sm">
                      <span className="font-medium">{row.recipient_name ?? 'Unknown'}</span>
                      {row.recipient_membership_no ? ` · #${row.recipient_membership_no}` : ''} ·{' '}
                      {row.purpose_description ?? PURPOSE_LABEL[row.payout_purpose]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.reference} · {METHOD_LABEL[row.payment_method]} · by {row.initiated_by_name ?? 'unknown'}
                      {row.initiated_by_role ? ` (${row.initiated_by_role})` : ''} · {formatDate(row.created_at)}
                      {row.approved_by_name ? ` · approved by ${row.approved_by_name}` : ''}
                      {row.mpesa_receipt_number ? ` · M-Pesa ${row.mpesa_receipt_number}` : ''}
                      {row.status === 'rejected' && row.rejection_reason ? ` · ${row.rejection_reason}` : ''}
                      {row.status === 'failed' && row.failure_reason ? ` · ${row.failure_reason}` : ''}
                    </p>
                  </div>
                  <Button size="sm" variant={toReview ? 'default' : 'outline'} onClick={() => setReviewId(row.id)}>
                    {toReview ? 'Review' : 'Details'}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── New disbursement ─────────────────────────────────────────── */}
      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New disbursement</DialogTitle>
            <DialogDescription>The treasurer and Kitabu Yetu approve it before any money moves.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="payout-search">Member receiving</Label>
              {selected ? (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="text-sm">
                    <p className="font-medium">
                      {selected.first_name} {selected.last_name}
                    </p>
                    <p className="text-muted-foreground">
                      {selected.membership_no ? `#${selected.membership_no} · ` : ''}
                      {selected.phone} · Active
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setMemberId('')}>
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="payout-search"
                      className="pl-9 h-11"
                      placeholder="Search name, member number or phone"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <div
                    className="rounded-md border divide-y max-h-56 overflow-y-auto"
                    role="listbox"
                    aria-label="Members"
                  >
                    {membersQ.isLoading ? (
                      <Skeleton className="h-12 w-full" />
                    ) : matches.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground">No active member matches.</p>
                    ) : (
                      matches.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          role="option"
                          aria-selected={false}
                          onClick={() => setMemberId(m.id)}
                          className="w-full text-left p-3 min-h-11 hover:bg-muted focus:bg-muted focus:outline-none"
                        >
                          <span className="block text-sm font-medium">
                            {m.first_name} {m.last_name}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {m.membership_no ? `#${m.membership_no} · ` : ''}
                            {m.phone}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            {memberId && (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
                {eligibilityQ.isLoading || !elig ? (
                  <Skeleton className="h-12 w-full" />
                ) : (
                  <>
                    <Row label="Withdrawable savings" value={formatKES(elig.withdrawableSavings)} />
                    <Row label="Group funds (cash / M-Pesa)" value={formatKES(elig.available.cash)} />
                    <Row
                      label="Group funds (bank)"
                      value={elig.available.bank === null ? 'No bank account' : formatKES(elig.available.bank)}
                    />
                  </>
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="payout-purpose">Type</Label>
                <select
                  id="payout-purpose"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value as Purpose)}
                  className={selectClass}
                >
                  {(Object.keys(PURPOSE_LABEL) as Purpose[]).map((p) => (
                    <option key={p} value={p}>
                      {PURPOSE_LABEL[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="payout-method">Paid by</Label>
                <select
                  id="payout-method"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as Method)}
                  className={selectClass}
                >
                  {(Object.keys(METHOD_LABEL) as Method[]).map((m) => (
                    <option key={m} value={m}>
                      {METHOD_LABEL[m]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="payout-amount">Amount to disburse (KES)</Label>
              <Input
                id="payout-amount"
                inputMode="numeric"
                className="h-11 text-lg"
                value={amount}
                onChange={(e) => setAmount(e.target.value.trim())}
                placeholder="0"
                aria-invalid={!!amountError}
                aria-describedby="payout-amount-help"
              />
              <p
                id="payout-amount-help"
                className={`text-xs ${amountError ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {amountError ??
                  (groupAvailable !== null && amt > 0
                    ? `Group balance after: ${formatKES(groupAvailable - amt)}`
                    : purpose === 'savings_withdrawal'
                      ? "Reduces the member's savings balance."
                      : "Recorded on the member's passbook; savings unchanged.")}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="payout-description">Purpose</Label>
              <Input
                id="payout-description"
                className="h-11"
                value={description}
                maxLength={200}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Member emergency support"
              />
            </div>

            {method === 'bank_transfer' && (
              <div className="space-y-1">
                <Label htmlFor="payout-ref">Payee account / transfer reference</Label>
                <Input
                  id="payout-ref"
                  className="h-11"
                  value={paymentReference}
                  maxLength={100}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  placeholder="e.g. Equity 0123456789"
                />
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="payout-notes">Additional notes (optional)</Label>
              <Textarea
                id="payout-notes"
                value={notes}
                maxLength={500}
                rows={2}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Approved at the 3 Oct meeting, minute 4.2"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              className="w-full sm:w-auto"
              onClick={() => {
                setCreating(false);
                setConfirming(true);
              }}
              disabled={formIncomplete}
            >
              Review summary
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Pre-submission summary ───────────────────────────────────── */}
      <Dialog open={confirming} onOpenChange={(o) => !busy && setConfirming(o)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Disbursement summary</DialogTitle>
            <DialogDescription>Check every detail — this is what the treasurer will approve.</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-4 text-center">
            <p className="text-xs text-muted-foreground">Amount</p>
            <p className="text-2xl font-bold">{formatKES(amt)}</p>
          </div>
          <div className="text-sm space-y-1.5">
            <Row label="Recipient" value={selected ? `${selected.first_name} ${selected.last_name}` : '—'} />
            {selected?.membership_no && <Row label="Member #" value={selected.membership_no} />}
            <Row label="Purpose" value={description.trim()} />
            <Row label="Type" value={PURPOSE_LABEL[purpose]} />
            <Row label="Paid by" value={METHOD_LABEL[method]} />
            {method === 'mpesa' && <Row label="Phone" value={elig?.phone ?? '—'} />}
            {paymentReference.trim() && <Row label="Reference" value={paymentReference.trim()} />}
            <Row label="Initiated by" value={`${user?.firstName ?? ''} ${user?.lastName ?? ''} — ${office ?? ''}`} />
            <Row label="Group" value={tenantUser?.groupName ?? '—'} />
            {groupAvailable !== null && (
              <>
                <Row label="Group balance before" value={formatKES(groupAvailable)} />
                <Row label="Group balance after" value={formatKES(groupAvailable - amt)} strong />
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Funds are reserved now. Nothing is paid until the treasurer approves and Kitabu Yetu signs off.
          </p>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setConfirming(false);
                setCreating(true);
              }}
              disabled={busy}
            >
              Edit
            </Button>
            <Button onClick={submit} loading={busy}>
              Confirm &amp; submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Review / details ─────────────────────────────────────────── */}
      <Dialog
        open={!!reviewId}
        onOpenChange={(o) => {
          if (!o && !busy) {
            setReviewId(null);
            setRejecting(false);
            setRejectReason('');
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{reviewing ? `Disbursement ${reviewing.reference}` : 'Disbursement'}</DialogTitle>
          </DialogHeader>
          {detailQ.isError ? (
            <p className="text-sm text-destructive">{errMsg(detailQ.error)}</p>
          ) : !detail || !reviewing ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold">{formatKES(Number(reviewing.amount))}</span>
                <StatusPill
                  status={reviewing.status}
                  tone={STATUS_TONE[reviewing.status]}
                  label={STATUS_LABEL[reviewing.status]}
                />
              </div>

              <section className="space-y-1.5">
                <h3 className="font-semibold">Recipient</h3>
                <Row label="Member" value={reviewing.recipient_name ?? '—'} />
                {reviewing.recipient_membership_no && (
                  <Row label="Member #" value={reviewing.recipient_membership_no} />
                )}
                <Row label="Paid by" value={METHOD_LABEL[reviewing.payment_method]} />
                {reviewing.payment_method === 'mpesa' && <Row label="Phone" value={reviewing.phone} />}
                {reviewing.payment_reference && <Row label="Reference" value={reviewing.payment_reference} />}
              </section>

              <section className="space-y-1.5">
                <h3 className="font-semibold">Purpose</h3>
                <p>{reviewing.purpose_description}</p>
                <p className="text-muted-foreground">{PURPOSE_LABEL[reviewing.payout_purpose]}</p>
                {reviewing.notes && <p className="text-muted-foreground whitespace-pre-wrap">{reviewing.notes}</p>}
              </section>

              <section className="rounded-lg border p-3 space-y-1.5">
                <h3 className="font-semibold">Group financial impact</h3>
                <Row
                  label={`Available funds (${detail.impact.sourceAccountCode === '1002' ? 'bank' : 'cash / M-Pesa'})`}
                  value={formatKES(detail.impact.groupAvailableBefore)}
                />
                <Row label="− This disbursement" value={formatKES(Number(reviewing.amount))} />
                <Row label="Projected balance" value={formatKES(detail.impact.groupAvailableAfter)} strong />
              </section>

              <section className="rounded-lg border p-3 space-y-1.5">
                <h3 className="font-semibold">Member ledger impact</h3>
                <p className="text-muted-foreground">
                  {detail.impact.reducesSavings
                    ? `Recorded as a savings withdrawal: the member's savings fall by ${formatKES(Number(reviewing.amount))}.`
                    : "Recorded on the member's passbook as a disbursement received; their savings balance is unchanged."}
                </p>
                {detail.impact.memberWithdrawable !== null && (
                  <Row label="Withdrawable savings now" value={formatKES(detail.impact.memberWithdrawable)} />
                )}
              </section>

              <section className="space-y-1.5">
                <h3 className="font-semibold">Initiated by</h3>
                <p>
                  {reviewing.initiated_by_name} — {reviewing.initiated_by_role} · {formatDate(reviewing.created_at)}
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="font-semibold flex items-center gap-1.5">
                  <History size={15} /> Audit history
                </h3>
                <ol className="space-y-1.5 border-l pl-3">
                  {detail.history.map((h, i) => (
                    <li key={i} className="text-xs">
                      <span className="font-medium">{HISTORY_LABEL[h.action] ?? h.action}</span>
                      {h.actor_name ? ` · ${h.actor_name}` : ' · system'} · {formatDate(h.created_at)}
                    </li>
                  ))}
                </ol>
              </section>

              {rejecting && (
                <div className="space-y-1">
                  <Label htmlFor="payout-reject">Reason for rejection</Label>
                  <Textarea
                    id="payout-reject"
                    value={rejectReason}
                    rows={2}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Required — the initiator is told this reason"
                  />
                </div>
              )}
            </div>
          )}
          {reviewing && (
            <DialogFooter className="gap-2 flex-wrap">
              {reviewing.initiated_by === user?.id &&
                ['pending_approval', 'awaiting_platform'].includes(reviewing.status) && (
                  <Button
                    variant="outline"
                    onClick={() => act(reviewing.id, { action: 'cancel' }, 'Disbursement cancelled — funds released')}
                    disabled={busy}
                  >
                    Cancel request
                  </Button>
                )}
              {isTreasurer && reviewing.status === 'pending_approval' && reviewing.initiated_by !== user?.id && (
                <>
                  {rejecting ? (
                    <Button
                      variant="destructive"
                      onClick={() =>
                        act(
                          reviewing.id,
                          { action: 'reject', reason: rejectReason.trim() },
                          'Disbursement rejected — funds released',
                        )
                      }
                      disabled={rejectReason.trim().length < 5}
                      loading={busy}
                    >
                      Confirm rejection
                    </Button>
                  ) : (
                    <>
                      <Button variant="outline" onClick={() => setRejecting(true)} disabled={busy}>
                        Reject
                      </Button>
                      <Button
                        onClick={() =>
                          act(reviewing.id, { action: 'approve' }, 'Approved — sent to Kitabu Yetu for sign-off')
                        }
                        loading={busy}
                      >
                        Approve disbursement
                      </Button>
                    </>
                  )}
                </>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right ${strong ? 'font-semibold' : 'font-medium'}`}>{value}</span>
    </div>
  );
}
