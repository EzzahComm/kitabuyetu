'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Loader2, RefreshCw, Users, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/shared/status-pill';
import { Input } from '@/components/ui/input';
import { PaginatedTable } from '@/components/shared/paginated-table';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from '@/lib/api/client';
import type { PaginatedResult } from '@/types/db.types';
import type { Tone } from '@/lib/ui/tokens';

type Tier = 'excellent' | 'good' | 'fair' | 'poor' | 'high_risk';

interface CreditScore {
  id: string; member_id: string;
  computed_at: string;
  financial_score: string; social_score: string; overall_score: string;
  reliability_tier: Tier;
  loan_eligibility_limit: string;
  member_first_name: string; member_last_name: string; member_phone: string;
}
interface Summary {
  totalMembers: number; scoredMembers: number;
  averageOverall: string;
  byTier: Record<Tier, number>;
}
interface TierThreshold { tier: Tier; min: number; loanMultiplier: number }
interface TierPolicy { thresholds: TierThreshold[]; source: 'group' | 'organization' | 'platform' }

const fmtMoney = (v: string | number | null | undefined) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(Number(v ?? 0));

const TIER_LABEL: Record<Tier, string> = {
  excellent: 'Excellent',
  good:      'Good',
  fair:      'Fair',
  poor:      'Poor',
  high_risk: 'High risk',
};
// Reliability-tier → StatusPill tone mapping. Kept in sync with the same
// tiers on the member detail page (credit-scores/[memberId]) and the risk
// analytics page (analytics/risk) — a severity gradient from favorable to
// unfavorable, since none of these tier names are in the shared STATUS_TONE
// map (only "high_risk" is, coincidentally already 'negative').
const TIER_TONE: Record<Tier, Tone> = {
  excellent: 'positive',
  good:      'positive',
  fair:      'warning',
  poor:      'negative',
  high_risk: 'negative',
};

export default function CreditScoresPage() {
  const { toast } = useToast();
  const qc        = useQueryClient();
  const router    = useRouter();
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);

  const summaryQ = useQuery<Summary>({
    queryKey: ['credit-scores', 'summary'],
    queryFn:  () => api.get<Summary>('/credit-scores/summary'),
  });
  const listQ = useQuery<PaginatedResult<CreditScore>>({
    queryKey: ['credit-scores', 'list', page],
    queryFn:  () => api.get<PaginatedResult<CreditScore>>(`/credit-scores?page=${page}&limit=50`),
  });
  const policyQ = useQuery<TierPolicy>({
    queryKey: ['credit-scores', 'policy'],
    queryFn:  () => api.get<TierPolicy>('/credit-scores/policy'),
  });
  const [policyEdits, setPolicyEdits] = useState<Record<Tier, { min: string; loanMultiplier: string }>>({} as never);
  const setPolicy = useMutation({
    mutationFn: (thresholds: TierThreshold[]) => api.put<TierPolicy>('/credit-scores/policy', { thresholds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit-scores', 'policy'] });
      toast({ title: 'Scoring policy updated' });
    },
    onError: (err: unknown) => toast({ variant: 'destructive', title: 'Update failed', description: err instanceof ApiError ? err.message : '' }),
  });

  const summary = summaryQ.data;

  const recomputeAll = async () => {
    if (!confirm('Recompute scores for every active member? This may take a few seconds for large groups.')) return;
    setBusy(true);
    try {
      const result = await api.post<{ recomputed: number; failed: { memberId: string; reason: string }[] }>('/credit-scores/recompute', {});
      toast({
        title: `Recomputed ${result.recomputed} member(s)`,
        description: result.failed.length > 0 ? `${result.failed.length} failed — check the audit log.` : undefined,
        variant: result.failed.length > 0 ? 'destructive' : 'default',
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['credit-scores', 'summary'] }),
        qc.invalidateQueries({ queryKey: ['credit-scores', 'list'] }),
      ]);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Recompute failed', description: err instanceof ApiError ? err.message : '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Credit Scores"
        description="Member reliability rated on contribution, loan repayment, savings, share ownership, and dividend history."
        actions={
          <Button disabled={busy} onClick={recomputeAll}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Recompute all
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-4">
        <StatCard title="Avg overall score" value={summaryQ.isLoading ? '—' : (summary?.averageOverall ?? '—')} />
        <StatCard title="Members scored"    value={summaryQ.isLoading ? '—' : `${summary?.scoredMembers ?? 0} / ${summary?.totalMembers ?? 0}`} />
        <StatCard title="Excellent / Good"  value={summaryQ.isLoading ? '—' : `${(summary?.byTier.excellent ?? 0) + (summary?.byTier.good ?? 0)}`} description={`${summary?.byTier.excellent ?? 0} excellent · ${summary?.byTier.good ?? 0} good`} />
        <StatCard title="Poor / High risk"  value={summaryQ.isLoading ? '—' : `${(summary?.byTier.poor ?? 0) + (summary?.byTier.high_risk ?? 0)}`} description={`${summary?.byTier.poor ?? 0} poor · ${summary?.byTier.high_risk ?? 0} high risk`} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Scoring policy</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            The reliability-tier ladder used to compute each member&apos;s tier
            and advisory loan limit (savings × multiplier). Overriding here
            only affects this group.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {policyQ.isLoading ? (
            <div className="p-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {['Tier', 'Min score', 'Loan multiplier', ''].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(policyQ.data?.thresholds ?? []).map((t) => {
                  const edit = policyEdits[t.tier] ?? { min: String(t.min), loanMultiplier: String(t.loanMultiplier) };
                  return (
                    <tr key={t.tier} className="border-t hover:bg-muted/20">
                      <td className="px-4 py-2"><StatusPill status={t.tier} tone={TIER_TONE[t.tier]} label={TIER_LABEL[t.tier]} /></td>
                      <td className="px-4 py-2">
                        <Input
                          type="number" min={0} max={100} className="h-8 w-24"
                          value={edit.min}
                          onChange={(e) => setPolicyEdits((prev) => ({ ...prev, [t.tier]: { ...edit, min: e.target.value } }))}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          type="number" min={0} step="0.5" className="h-8 w-24"
                          value={edit.loanMultiplier}
                          onChange={(e) => setPolicyEdits((prev) => ({ ...prev, [t.tier]: { ...edit, loanMultiplier: e.target.value } }))}
                        />
                      </td>
                      <td />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
        {policyQ.data && (
          <div className="flex items-center justify-between px-4 pb-4">
            <Badge variant={policyQ.data.source === 'group' ? 'success' : 'outline'} className="text-xs capitalize">
              {policyQ.data.source === 'group' ? 'Your override' : `Inherited — ${policyQ.data.source}`}
            </Badge>
            <Button
              size="sm" variant="outline" className="h-8 gap-1.5"
              disabled={Object.keys(policyEdits).length === 0 || setPolicy.isPending}
              onClick={() => {
                const merged = (policyQ.data?.thresholds ?? []).map((t) => {
                  const edit = policyEdits[t.tier];
                  return edit
                    ? { tier: t.tier, min: parseFloat(edit.min), loanMultiplier: parseFloat(edit.loanMultiplier) }
                    : t;
                });
                setPolicy.mutate(merged);
                setPolicyEdits({} as never);
              }}
            >
              <SlidersHorizontal size={13} /> Save policy
            </Button>
          </div>
        )}
      </Card>

      {summary && summary.scoredMembers === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Activity className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No scores computed yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Click <strong>Recompute all</strong> to score every active member based on their contribution, loan, share, and dividend history.
            </p>
          </CardContent>
        </Card>
      )}

      {summary && summary.scoredMembers > 0 && (
        <PaginatedTable<CreditScore>
          data={listQ.data}
          isLoading={listQ.isLoading}
          onPageChange={setPage}
          onRowClick={(s) => router.push(`/credit-scores/${s.member_id}`)}
          emptyMessage="No scored members yet"
          emptyIcon={Users}
          columns={[
            { key: 'member', header: 'Member', render: (s) => (
              <div>
                <p className="font-medium">{s.member_first_name} {s.member_last_name}</p>
                <p className="font-mono text-xs text-muted-foreground">{s.member_phone}</p>
              </div>
            ) },
            { key: 'overall', header: 'Overall', className: 'text-right', render: (s) => <span className="font-mono text-base font-semibold">{Number(s.overall_score).toFixed(0)}</span> },
            { key: 'financial', header: 'Financial', className: 'text-right', render: (s) => <span className="font-mono">{Number(s.financial_score).toFixed(0)}</span> },
            { key: 'tier', header: 'Tier', render: (s) => <StatusPill status={s.reliability_tier} tone={TIER_TONE[s.reliability_tier]} label={TIER_LABEL[s.reliability_tier]} /> },
            { key: 'limit', header: 'Loan limit', className: 'text-right', render: (s) => <span className="font-mono">{fmtMoney(s.loan_eligibility_limit)}</span> },
            { key: 'computed_at', header: 'Last computed', render: (s) => <span className="text-xs text-muted-foreground">{new Date(s.computed_at).toLocaleString()}</span> },
          ]}
        />
      )}
    </div>
  );
}
