'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Loader2, RefreshCw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from '@/lib/api/client';

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
interface Paged<T> { items: T[]; total: number; page: number; pageSize: number; totalPages: number }

const fmtMoney = (v: string | number | null | undefined) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(Number(v ?? 0));

const TIER_LABEL: Record<Tier, string> = {
  excellent: 'Excellent',
  good:      'Good',
  fair:      'Fair',
  poor:      'Poor',
  high_risk: 'High risk',
};
const TIER_BADGE: Record<Tier, 'default' | 'success' | 'secondary' | 'warning' | 'destructive' | 'outline'> = {
  excellent: 'success',
  good:      'default',
  fair:      'secondary',
  poor:      'warning',
  high_risk: 'destructive',
};

export default function CreditScoresPage() {
  const { toast } = useToast();
  const qc        = useQueryClient();
  const [busy, setBusy] = useState(false);

  const summaryQ = useQuery<Summary>({
    queryKey: ['credit-scores', 'summary'],
    queryFn:  () => api.get<Summary>('/credit-scores/summary'),
  });
  const listQ = useQuery<Paged<CreditScore>>({
    queryKey: ['credit-scores', 'list'],
    queryFn:  () => api.get<Paged<CreditScore>>('/credit-scores?limit=100'),
  });

  const items   = listQ.data?.items ?? [];
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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Credit Scores</h1>
          <p className="text-sm text-muted-foreground">Member reliability rated on contribution, loan repayment, savings, share ownership, and dividend history.</p>
        </div>
        <Button disabled={busy} onClick={recomputeAll}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Recompute all
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Avg overall score" value={summary?.averageOverall ?? '—'} loading={summaryQ.isLoading} />
        <Stat label="Members scored"    value={`${summary?.scoredMembers ?? 0} / ${summary?.totalMembers ?? 0}`} loading={summaryQ.isLoading} />
        <Stat label="Excellent / Good"  value={`${(summary?.byTier.excellent ?? 0) + (summary?.byTier.good ?? 0)}`} sub={`${summary?.byTier.excellent ?? 0} excellent · ${summary?.byTier.good ?? 0} good`} loading={summaryQ.isLoading} />
        <Stat label="Poor / High risk"  value={`${(summary?.byTier.poor ?? 0) + (summary?.byTier.high_risk ?? 0)}`} sub={`${summary?.byTier.poor ?? 0} poor · ${summary?.byTier.high_risk ?? 0} high risk`} loading={summaryQ.isLoading} />
      </div>

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
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3 text-right">Overall</th>
                  <th className="px-4 py-3 text-right">Financial</th>
                  <th className="px-4 py-3">Tier</th>
                  <th className="px-4 py-3 text-right">Loan limit</th>
                  <th className="px-4 py-3">Last computed</th>
                </tr>
              </thead>
              <tbody>
                {listQ.isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground"><Users className="mx-auto mb-2 h-6 w-6" />No scored members yet.</td></tr>
                ) : items.map((s) => (
                  <tr key={s.id} className="border-b last:border-b-0 hover:bg-muted/30 cursor-pointer">
                    <td className="px-4 py-3" colSpan={6}>
                      <Link href={`/credit-scores/${s.member_id}`} className="grid grid-cols-6 gap-4 -my-3 py-3">
                        <div>
                          <p className="font-medium">{s.member_first_name} {s.member_last_name}</p>
                          <p className="font-mono text-xs text-muted-foreground">{s.member_phone}</p>
                        </div>
                        <div className="self-center text-right font-mono text-base font-semibold">{Number(s.overall_score).toFixed(0)}</div>
                        <div className="self-center text-right font-mono text-sm">{Number(s.financial_score).toFixed(0)}</div>
                        <div className="self-center"><Badge variant={TIER_BADGE[s.reliability_tier]}>{TIER_LABEL[s.reliability_tier]}</Badge></div>
                        <div className="self-center text-right font-mono">{fmtMoney(s.loan_eligibility_limit)}</div>
                        <div className="self-center text-xs text-muted-foreground">{new Date(s.computed_at).toLocaleString()}</div>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, sub, loading }: { label: string; value: string; sub?: string; loading?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold">{loading ? '—' : value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
