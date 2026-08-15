'use client';

/**
 * Funding Portal — the self-service view for an Organization's own coordinator.
 *
 * An Organization is not a group — it is a funder/monitor (bank, SACCO,
 * foundation, NGO) that oversees many groups; see `(admin)/admin/organizations`
 * for the platform-side registry of these entities. This page is the same
 * Organization entity's own operational view, not a separate concept — it is
 * labeled "Funding Portal" (rather than "Organization Portal") so it isn't
 * mistaken for the admin registry, or for the unrelated B2B "Workspace"
 * concept in `(enterprise)`. This dashboard gives its coordinators:
 *   - the wallet position (capital in / committed / deployed)
 *   - funding programs (budget envelopes) with create/pause controls
 *   - one-click disbursement into a linked group (dual-ledger, atomic)
 *   - portfolio metrics aggregated ONLY over linked groups (RLS-enforced)
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Wallet, Landmark, Users, TrendingUp, PiggyBank, ArrowDownToLine,
  ArrowRightLeft, Plus, PauseCircle, PlayCircle, FolderKanban,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { useToast } from '@/hooks/use-toast';
import { adminApi } from '@/lib/api/client';
import { organizationApi } from '@/lib/api/endpoints';
import { formatKES, formatDate } from '@/lib/utils';
import type { OrganizationGroupSummary } from '@/types/api.types';
import type { PaginatedResult } from '@/types/db.types';
import type { SetApprovalPolicyInput } from '@/lib/validators/accounting.schema';
import type { EffectiveThreshold } from '@/lib/services/approval-policy.service';
import { INTEREST_METHODS, REPAYMENT_FREQUENCIES } from '@/lib/validators/organization.schema';

// ─── Data hooks ───────────────────────────────────────────────────────────────

interface DashboardPayload {
  financial: {
    walletBalance: string; committedFunds: string; totalDeposited: string;
    totalDisbursed: string; totalReturned: string;
  };
  portfolio: {
    linkedGroups: number; activeMembers: number; totalSavings: string;
    loanPortfolio: string; activeLoans: number; loanRepayments: string;
    activePrograms: number;
  };
  programs: Program[];
}

interface Program {
  id: string; name: string; program_type: string; budget: string;
  disbursed_total: string; status: string; funding_source: string | null;
}

interface Disbursement {
  id: string; group_name?: string; program_name?: string | null;
  disbursement_type: string; amount: string; status: string;
  reference: string; created_at: string;
}

interface TrialBalanceLine {
  accountCode: string; accountName: string; accountType: string; netBalance: string;
}

interface ProgramBudgetLine {
  id: string; name: string; programType: string; status: string;
  budget: number; disbursed: number; reserved: number; remaining: number;
  utilizationPct: number; expectedUtilizationPct: number | null;
  variancePct: number | null; startsOn: string | null; endsOn: string | null;
}

interface DonorSpendLine {
  fundingSource: string; programCount: number;
  totalBudget: number; totalDisbursed: number; totalReserved: number;
  remaining: number; utilizationPct: number;
  programs: { id: string; name: string; budget: number; disbursed: number }[];
  byGroup: { groupId: string; groupName: string | null; amount: number }[];
}

const ORG_POLICY_LABELS: Record<string, string> = {
  org_disbursement_threshold:   'Your own disbursement maker-checker',
  group_disbursement_threshold: 'Default for linked groups’ disbursements',
  journal_threshold:            'Default for linked groups’ manual journals',
};

// Value/label pairs mirrored from lib/validators/organization.schema.ts's
// PROGRAM_TYPES (was missing 'insurance'/'investment' here, so this portal's
// create-program dialog couldn't offer two program types the enterprise
// portal's own equivalent dialog and the server both already support).
const PROGRAM_TYPES = [
  ['grant', 'Grant'], ['revolving_fund', 'Revolving Fund'], ['loan_capital', 'Loan Capital'],
  ['matching_contribution', 'Matching Contribution'], ['seed_capital', 'Seed Capital'],
  ['emergency_support', 'Emergency Support'], ['operational_support', 'Operational Support'],
  ['scholarship', 'Scholarship'], ['insurance', 'Insurance'], ['investment', 'Investment'],
] as const;

const DISBURSEMENT_TYPES = [
  ['grant', 'Grant'], ['revolving_fund', 'Revolving Fund'], ['loan_capital', 'Loan Capital'],
  ['matching_contribution', 'Matching Contribution'], ['seed_capital', 'Seed Capital'],
  ['emergency_support', 'Emergency Support'], ['operational_support', 'Operational Support'],
] as const;

const INTEREST_METHOD_LABELS: Record<(typeof INTEREST_METHODS)[number], string> = {
  flat: 'Flat', reducing_balance: 'Reducing balance',
};
const REPAYMENT_FREQUENCY_LABELS: Record<(typeof REPAYMENT_FREQUENCIES)[number], string> = {
  none: 'None', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', bullet: 'Bullet (single payment)',
};
/** Standard convention, matching this file's own hardcoded choice — see
 *  ProgramDialog's comment for why the waterfall order isn't a user control. */
const STANDARD_WATERFALL: { order: ('penalty' | 'interest' | 'principal')[] } = {
  order: ['penalty', 'interest', 'principal'],
};

export default function FundingPortalPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [depositOpen, setDepositOpen]   = useState(false);
  const [programOpen, setProgramOpen]   = useState(false);
  const [disburseOpen, setDisburseOpen] = useState(false);

  const { data: dash, isLoading } = useQuery<DashboardPayload>({
    queryKey: ['organization', 'dashboard'],
    queryFn:  () => adminApi.get('/organization/dashboard'),
    staleTime: 30_000,
    refetchInterval: 120_000,
  });

  const { data: groupsPage } = useQuery<PaginatedResult<OrganizationGroupSummary>>({
    queryKey: ['organization', 'groups'],
    queryFn:  () => organizationApi.groups(),
    staleTime: 60_000,
  });
  const groups = groupsPage?.items;

  const { data: disb } = useQuery<{ items: Disbursement[] }>({
    queryKey: ['organization', 'disbursements'],
    queryFn:  () => adminApi.get('/organization/disbursements?limit=10'),
    staleTime: 30_000,
  });

  const { data: accounting, isError: accountingIsError, error: accountingError } = useQuery<{ trialBalance: TrialBalanceLine[] }>({
    queryKey: ['organization', 'accounting'],
    queryFn:  () => adminApi.get('/organization/accounting'),
    staleTime: 30_000,
  });

  const { data: budgetReport, isError: budgetReportIsError, error: budgetReportError } = useQuery<{ items: ProgramBudgetLine[] }>({
    queryKey: ['organization', 'budget-report'],
    queryFn:  () => adminApi.get('/organization/programs?report=budget'),
    staleTime: 30_000,
  });

  const { data: donorReport } = useQuery<{ items: DonorSpendLine[] }>({
    queryKey: ['organization', 'donor-report'],
    queryFn:  () => adminApi.get('/organization/programs?report=donor'),
    staleTime: 30_000,
  });

  const { data: policies, isLoading: loadingPolicies } = useQuery<EffectiveThreshold[]>({
    queryKey: ['organization', 'policies'],
    queryFn:  organizationApi.policies,
    staleTime: 30_000,
  });
  const [policyEdits, setPolicyEdits] = useState<Record<string, string>>({});
  const setPolicy = useMutation({
    mutationFn: (body: SetApprovalPolicyInput) => organizationApi.setPolicy(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization', 'policies'] });
      toast({ title: 'Policy updated' });
    },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Update failed', description: e.message }),
  });

  const toggleProgram = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      adminApi.patch(`/organization/programs/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization'] });
      toast({ title: 'Program updated' });
    },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Update failed', description: e.message }),
  });

  const f = dash?.financial;
  const p = dash?.portfolio;
  const linkedGroups = groups ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Funding Portal"
        description="Fund, monitor and support your linked groups"
        actions={
          <>
            <Button size="sm" variant="outline" className="gap-1.5 h-9" onClick={() => setDepositOpen(true)}>
              <ArrowDownToLine size={15} /> Deposit
            </Button>
            <Button size="sm" className="gap-1.5 h-9" onClick={() => setDisburseOpen(true)}>
              <ArrowRightLeft size={15} /> Disburse funds
            </Button>
          </>
        }
      />

      {/* Financial position */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Wallet balance" value={formatKES(parseFloat(f?.walletBalance ?? '0'))}
                    description={`${formatKES(parseFloat(f?.committedFunds ?? '0'))} committed`} icon={Wallet} />
          <StatCard title="Total deposited" value={formatKES(parseFloat(f?.totalDeposited ?? '0'))} icon={ArrowDownToLine} />
          <StatCard title="Total disbursed" value={formatKES(parseFloat(f?.totalDisbursed ?? '0'))}
                    description={`${formatKES(parseFloat(f?.totalReturned ?? '0'))} returned`} icon={ArrowRightLeft} />
          <StatCard title="Active programs" value={String(p?.activePrograms ?? 0)} icon={FolderKanban} />
        </div>
      )}

      {/* Portfolio */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Linked groups" value={String(p?.linkedGroups ?? 0)} icon={Landmark} />
        <StatCard title="Active members" value={(p?.activeMembers ?? 0).toLocaleString()} icon={Users} />
        <StatCard title="Savings mobilized" value={formatKES(parseFloat(p?.totalSavings ?? '0'))} icon={PiggyBank} />
        <StatCard title="Loan portfolio" value={formatKES(parseFloat(p?.loanPortfolio ?? '0'))}
                  description={`${p?.activeLoans ?? 0} active · ${formatKES(parseFloat(p?.loanRepayments ?? '0'))} repaid`} icon={TrendingUp} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Funding programs */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Funding programs</CardTitle>
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => setProgramOpen(true)}>
                <Plus size={13} /> New program
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {(dash?.programs ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No programs yet — create a funding envelope to start disbursing.
              </p>
            ) : (
              <div className="space-y-2.5">
                {(dash?.programs ?? []).map((pr) => {
                  const spent = parseFloat(pr.disbursed_total);
                  const budget = parseFloat(pr.budget);
                  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
                  return (
                    <div key={pr.id} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{pr.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">
                            {pr.program_type.replace(/_/g, ' ')}
                            {pr.funding_source ? ` · ${pr.funding_source}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant={pr.status === 'active' ? 'success' : 'outline'} className="text-xs capitalize">
                            {pr.status}
                          </Badge>
                          <Button
                            size="sm" variant="ghost" className="h-7 w-7 p-0"
                            title={pr.status === 'active' ? 'Pause program' : 'Reactivate program'}
                            onClick={() => toggleProgram.mutate({
                              id: pr.id,
                              status: pr.status === 'active' ? 'paused' : 'active',
                            })}
                          >
                            {pr.status === 'active' ? <PauseCircle size={15} /> : <PlayCircle size={15} />}
                          </Button>
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatKES(spent)} of {formatKES(budget)} disbursed
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent disbursements */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent disbursements</CardTitle>
          </CardHeader>
          <CardContent>
            {(disb?.items ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No disbursements yet.</p>
            ) : (
              <div className="space-y-2.5">
                {(disb?.items ?? []).map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{d.group_name ?? d.id}</p>
                      <p className="text-xs text-muted-foreground capitalize truncate">
                        {d.disbursement_type.replace(/_/g, ' ')}
                        {d.program_name ? ` · ${d.program_name}` : ''} · {formatDate(d.created_at)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold">{formatKES(parseFloat(d.amount))}</p>
                      <p className="text-[11px] font-mono text-muted-foreground">{d.reference}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Trial balance — the organization's own chart of accounts */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Trial balance</CardTitle>
          <p className="text-xs text-muted-foreground">
            Your organization&apos;s own ledger — deposits post to Cash/Donor
            Contributions, disbursements to Cash/Program Disbursements.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <PaginatedTable
            data={singlePage((accounting?.trialBalance ?? []).map((line) => ({ ...line, id: line.accountCode })))}
            isLoading={false}
            isError={accountingIsError}
            error={accountingError}
            onPageChange={() => {}}
            emptyMessage="No activity posted yet."
            columns={[
              { key: 'accountCode', header: 'Code', className: 'font-mono text-xs text-muted-foreground', render: (line) => line.accountCode },
              { key: 'accountName', header: 'Account', render: (line) => line.accountName },
              { key: 'accountType', header: 'Type', className: 'text-xs text-muted-foreground capitalize', render: (line) => line.accountType },
              { key: 'netBalance', header: 'Balance', className: 'text-right font-medium tabular-nums', render: (line) => formatKES(parseFloat(line.netBalance)) },
            ]}
          />
        </CardContent>
      </Card>

      {/* Budget variance / utilization — per-program deployment report */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Budget utilization</CardTitle>
          <p className="text-xs text-muted-foreground">
            Per program: settled disbursements, amounts reserved under pending
            approval, and — for dated programs — variance against the share of
            the program window already elapsed.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <PaginatedTable
            data={singlePage(budgetReport?.items)}
            isLoading={false}
            isError={budgetReportIsError}
            error={budgetReportError}
            onPageChange={() => {}}
            emptyMessage="No programs yet."
            columns={[
              {
                key: 'name', header: 'Program', render: (line) => (
                  <>
                    <p className="font-medium">{line.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {line.programType.replace(/_/g, ' ')} · {line.status}
                    </p>
                  </>
                ),
              },
              { key: 'budget', header: 'Budget', className: 'text-right tabular-nums', render: (line) => formatKES(line.budget) },
              { key: 'disbursed', header: 'Disbursed', className: 'text-right tabular-nums', render: (line) => formatKES(line.disbursed) },
              { key: 'reserved', header: 'Reserved', className: 'text-right tabular-nums', render: (line) => line.reserved > 0 ? formatKES(line.reserved) : '—' },
              { key: 'remaining', header: 'Remaining', className: 'text-right tabular-nums', render: (line) => formatKES(line.remaining) },
              { key: 'utilizationPct', header: 'Utilization', className: 'text-right tabular-nums font-medium', render: (line) => `${line.utilizationPct.toFixed(1)}%` },
              {
                key: 'variancePct', header: 'Schedule variance', className: 'text-right tabular-nums', render: (line) => (
                  line.variancePct === null ? (
                    <span className="text-muted-foreground">undated</span>
                  ) : (
                    <span className={line.variancePct < -10 ? 'text-amber-600 dark:text-amber-500' : ''}>
                      {line.variancePct >= 0 ? '+' : ''}{line.variancePct.toFixed(1)}%
                    </span>
                  )
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      {/* Donor/grant spend report — programs rolled up by funding source */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Donor / grant report</CardTitle>
          <p className="text-xs text-muted-foreground">
            Programs grouped by funding source, with settled spend broken down
            by the linked group that received it.
          </p>
        </CardHeader>
        <CardContent>
          {(donorReport?.items ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No funding programs yet.</p>
          ) : (
            <div className="space-y-4">
              {(donorReport?.items ?? []).map((d) => (
                <div key={d.fundingSource} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="font-medium">{d.fundingSource}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.programCount} program{d.programCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="flex gap-4 text-sm tabular-nums">
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Budget</p>
                        <p>{formatKES(d.totalBudget)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Disbursed</p>
                        <p>{formatKES(d.totalDisbursed)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Remaining</p>
                        <p>{formatKES(d.remaining)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Utilization</p>
                        <p className="font-medium">{d.utilizationPct.toFixed(1)}%</p>
                      </div>
                    </div>
                  </div>
                  {d.byGroup.length > 0 && (
                    <div className="mt-2.5 pt-2.5 border-t">
                      <p className="text-xs text-muted-foreground mb-1.5">Settled spend by recipient group</p>
                      <div className="flex flex-wrap gap-1.5">
                        {d.byGroup.map((g) => (
                          <Badge key={g.groupId} variant="secondary" className="font-normal">
                            {g.groupName ?? 'Unknown group'} · {formatKES(g.amount)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Approval policies — Configuration Service / Policy Resolution Engine */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Approval policies</CardTitle>
          <p className="text-xs text-muted-foreground">
            Your own disbursement threshold, plus the defaults you hand down
            to linked groups — any group can still set its own override.
          </p>
        </CardHeader>
        <CardContent>
          {loadingPolicies ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="space-y-2.5">
              {(policies ?? []).map((p) => {
                const editValue = policyEdits[p.key] ?? String(p.threshold);
                const dirty = editValue !== String(p.threshold);
                return (
                  <div key={p.key} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{ORG_POLICY_LABELS[p.key] ?? p.key}</p>
                      <Badge variant={p.source === 'organization' ? 'success' : 'outline'} className="text-xs capitalize mt-1">
                        {p.source === 'organization' ? 'Your override' : `Inherited — ${p.source}`}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Input
                        type="number" min={0} className="h-8 w-32"
                        value={editValue}
                        onChange={(e) => setPolicyEdits((prev) => ({ ...prev, [p.key]: e.target.value }))}
                      />
                      <Button
                        size="sm" variant="outline" className="h-8"
                        disabled={!dirty || setPolicy.isPending || !(parseFloat(editValue) >= 0)}
                        onClick={() => setPolicy.mutate({ key: p.key, threshold: parseFloat(editValue) })}
                      >
                        Set
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Linked groups */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Linked groups</CardTitle>
        </CardHeader>
        <CardContent>
          {linkedGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No groups linked yet. Group links are managed by the platform team.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {linkedGroups.map((g) => (
                <div key={g.groupId} className="rounded-lg border p-3">
                  <p className="font-medium text-sm truncate">{g.groupName}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {g.groupType && <Badge variant="outline" className="text-xs capitalize">{g.groupType}</Badge>}
                    <span>{g.activeMemberCount ?? 0} members</span>
                    <span>{formatKES(parseFloat(g.totalContributions ?? '0'))} saved</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <DepositDialog open={depositOpen} onClose={() => setDepositOpen(false)} />
      <ProgramDialog open={programOpen} onClose={() => setProgramOpen(false)} />
      <DisburseDialog
        open={disburseOpen}
        onClose={() => setDisburseOpen(false)}
        groups={linkedGroups}
        programs={(dash?.programs ?? []).filter((pr) => pr.status === 'active')}
      />
    </div>
  );
}

// ─── Deposit dialog ───────────────────────────────────────────────────────────

function DepositDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('');

  const deposit = useMutation({
    mutationFn: () => organizationApi.deposit({
      amount: parseFloat(amount),
      source: source || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization'] });
      toast({ title: 'Deposit recorded', description: 'Wallet balance updated.' });
      setAmount(''); setSource('');
      onClose();
    },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Deposit failed', description: e.message }),
  });

  const ok = parseFloat(amount) > 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Record a deposit</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Amount (KES)</Label>
            <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000000" />
          </div>
          <div className="space-y-1">
            <Label>Funding source <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. World Bank FY26 tranche" />
          </div>
          <p className="text-xs text-muted-foreground">
            Recorded on the organization ledger. Bank/M-Pesa settlement is reconciled separately.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => deposit.mutate()} disabled={!ok || deposit.isPending}>Record deposit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── New program dialog ───────────────────────────────────────────────────────

function ProgramDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName]     = useState('');
  const [type, setType]     = useState<(typeof PROGRAM_TYPES)[number][0]>('grant');
  const [budget, setBudget] = useState('');
  const [source, setSource] = useState('');

  // Financial-product terms (migration 116) — this dialog is the only place a
  // product gets created, and until now none of these had a form field at
  // all despite existing in the schema/validator since Phase 1.
  const [repayable, setRepayable]           = useState(false);
  const [interestMethod, setInterestMethod] = useState<(typeof INTEREST_METHODS)[number]>('flat');
  const [interestRate, setInterestRate]     = useState('');
  const [frequency, setFrequency]           = useState<(typeof REPAYMENT_FREQUENCIES)[number]>('monthly');
  const [tenorMonths, setTenorMonths]       = useState('');
  // Processing fee (migration 125) — independent of `repayable`, so its own
  // field, always visible.
  const [feePct, setFeePct] = useState('');

  const create = useMutation({
    mutationFn: () => organizationApi.createProgram({
      name,
      programType: type,
      budget: parseFloat(budget),
      fundingSource: source || undefined,
      isRepayable: repayable,
      ...(repayable ? {
        interestMethod,
        interestRateAnnual: parseFloat(interestRate),
        repaymentFrequency: frequency,
        tenorMonths: parseInt(tenorMonths, 10),
        // Standard order, not exposed as a control — see STANDARD_WATERFALL.
        repaymentWaterfall: STANDARD_WATERFALL,
      } : {}),
      processingFeePct: feePct ? parseFloat(feePct) : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization'] });
      toast({ title: 'Program created' });
      setName(''); setBudget(''); setSource(''); setType('grant');
      setRepayable(false); setInterestMethod('flat'); setInterestRate('');
      setFrequency('monthly'); setTenorMonths(''); setFeePct('');
      onClose();
    },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Create failed', description: e.message }),
  });

  const ok = name.trim().length >= 3 && parseFloat(budget) > 0
    && (!repayable || (parseFloat(interestRate) >= 0 && parseInt(tenorMonths, 10) > 0));
  const monthlyEquivalent = parseFloat(interestRate) > 0 ? (parseFloat(interestRate) / 12).toFixed(2) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>New funding program</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Program name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Women Empowerment Fund" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Type</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={type} onChange={(e) => setType(e.target.value as (typeof PROGRAM_TYPES)[number][0])}
              >
                {PROGRAM_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Budget (KES)</Label>
              <Input type="number" min={1} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="5000000" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Funding source <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Donor / internal budget line" />
          </div>

          <div className="flex items-center justify-between rounded-md border border-input px-3 py-2">
            <div>
              <p className="text-sm font-medium">Repayable</p>
              <p className="text-xs text-muted-foreground">Groups owe this capital back, with interest</p>
            </div>
            <input
              type="checkbox" checked={repayable}
              onChange={(e) => setRepayable(e.target.checked)}
              className="h-4 w-4"
            />
          </div>

          {repayable && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Interest method</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={interestMethod}
                    onChange={(e) => setInterestMethod(e.target.value as (typeof INTEREST_METHODS)[number])}
                  >
                    {INTEREST_METHODS.map((m) => <option key={m} value={m}>{INTEREST_METHOD_LABELS[m]}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Interest rate — annual %</Label>
                  <Input
                    type="number" min={0} step="0.01" value={interestRate}
                    onChange={(e) => setInterestRate(e.target.value)}
                    placeholder="120"
                  />
                  {monthlyEquivalent && (
                    <p className="text-xs text-muted-foreground">≈ {monthlyEquivalent}% per month</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Repayment frequency</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as (typeof REPAYMENT_FREQUENCIES)[number])}
                  >
                    {REPAYMENT_FREQUENCIES.filter((f) => f !== 'none').map((f) => (
                      <option key={f} value={f}>{REPAYMENT_FREQUENCY_LABELS[f]}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Tenor (months)</Label>
                  <Input
                    type="number" min={1} value={tenorMonths}
                    onChange={(e) => setTenorMonths(e.target.value)}
                    placeholder="1"
                  />
                </div>
              </div>
            </>
          )}

          <div className="space-y-1">
            <Label>Processing fee — % of allocated amount <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              type="number" min={0} max={100} step="0.01" value={feePct}
              onChange={(e) => setFeePct(e.target.value)}
              placeholder="3"
            />
            <p className="text-xs text-muted-foreground">
              Retained by the organization, deducted from what actually leaves the wallet —
              the group&apos;s principal is unaffected. Enter a grossed-up amount at
              disbursement time if you need a specific net figure to reach the group.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!ok || create.isPending}>Create program</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Disburse dialog ──────────────────────────────────────────────────────────

function DisburseDialog({ open, onClose, groups, programs }: {
  open: boolean; onClose: () => void;
  groups: { groupId: string; groupName: string }[];
  programs: Program[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [groupId, setGroupId]   = useState('');
  const [amount, setAmount]     = useState('');
  const [type, setType]         = useState<(typeof DISBURSEMENT_TYPES)[number][0]>('grant');
  const [programId, setProgramId] = useState('');
  const [notes, setNotes]       = useState('');

  const disburse = useMutation({
    mutationFn: () => organizationApi.disburse({
      groupId,
      amount: parseFloat(amount),
      disbursementType: type,
      fundingProgramId: programId || undefined,
      notes: notes || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization'] });
      toast({ title: 'Funds disbursed', description: 'Both ledgers updated.' });
      setGroupId(''); setAmount(''); setNotes(''); setProgramId(''); setType('grant');
      onClose();
    },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Disbursement failed', description: e.message }),
  });

  const ok = !!groupId && parseFloat(amount) > 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Disburse funds to a group</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Group</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={groupId} onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">Select a linked group…</option>
              {groups.map((g) => <option key={g.groupId} value={g.groupId}>{g.groupName}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Type</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={type} onChange={(e) => setType(e.target.value as (typeof DISBURSEMENT_TYPES)[number][0])}
              >
                {DISBURSEMENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Amount (KES)</Label>
              <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="250000" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Fund from program <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={programId} onChange={(e) => setProgramId(e.target.value)}
            >
              <option value="">Wallet (no program)</option>
              {programs.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Purpose / milestone" />
          </div>
          <p className="text-xs text-muted-foreground">
            Debits the organization wallet and posts a balanced journal entry
            (Cash / External Funding) in the group&apos;s own books — atomically.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => disburse.mutate()} disabled={!ok || disburse.isPending}>Disburse</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
