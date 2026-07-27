'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from '@/lib/api/client';

// OPTIMIZATION_CLEANUP_AUDIT.md Medium #26 — recharts is code-split out of
// this page's initial bundle; it's only needed once history has >1 point.
const ScoreHistoryChart = dynamic(() => import('./_charts').then((m) => m.ScoreHistoryChart), { ssr: false });

type Tier = 'excellent' | 'good' | 'fair' | 'poor' | 'high_risk';

interface ComponentScore {
  score: number;
  weight: number;
  raw: Record<string, unknown>;
}
interface CreditScore {
  id: string; member_id: string;
  computed_at: string;
  financial_score: string; social_score: string; overall_score: string;
  components: Record<string, ComponentScore>;
  reliability_tier: Tier;
  loan_eligibility_limit: string;
  member_first_name: string; member_last_name: string; member_phone: string;
}

const TIER_BADGE: Record<Tier, 'default' | 'success' | 'secondary' | 'warning' | 'destructive' | 'outline'> = {
  excellent: 'success', good: 'default', fair: 'secondary', poor: 'warning', high_risk: 'destructive',
};
const TIER_LABEL: Record<Tier, string> = {
  excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor', high_risk: 'High risk',
};
const COMPONENT_LABEL: Record<string, string> = {
  // Financial (E6 Part 1)
  contribution_consistency: 'Contribution consistency',
  loan_repayment:           'Loan repayment timeliness',
  savings_growth:           'Savings growth',
  share_ownership:          'Share ownership',
  dividend_participation:   'Dividend participation',
  // Social (E6.2)
  meeting_attendance:       'Meeting attendance',
  welfare_participation:    'Welfare participation',
  leadership_role:          'Leadership role',
};
const COMPONENT_HINT: Record<string, string> = {
  contribution_consistency: '% of last 12 months with at least one completed contribution',
  loan_repayment:           '% of repayments paid on or before due date · defaults cap at 30',
  savings_growth:           'Last 12 months total vs prior 12 months · ratio × 50',
  share_ownership:          'Percentile rank of shares held among shareholders',
  dividend_participation:   'Received at least one paid dividend in last 12 months',
  meeting_attendance:       '% of meetings attended in last 12 months (excused excluded)',
  welfare_participation:    'Contributed to welfare pool in last 12 months · 100/40 binary',
  leadership_role:          'Officer role (admin/treasurer/secretary) = 100, member = 50',
};

const fmtMoney = (v: string | number | null | undefined) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(Number(v ?? 0));

export default function CreditScoreDetailPage() {
  const params = useParams<{ memberId: string }>();
  const id     = params.memberId;
  const qc     = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const latestQ = useQuery<CreditScore>({
    queryKey: ['credit-score', id, 'latest'],
    queryFn:  () => api.get<CreditScore>(`/credit-scores/${id}`),
    retry:    false,
  });
  const historyQ = useQuery<{ items: CreditScore[] }>({
    queryKey: ['credit-score', id, 'history'],
    queryFn:  () => api.get<{ items: CreditScore[] }>(`/credit-scores/${id}/history?limit=24`),
  });

  const recompute = async () => {
    setBusy(true);
    try {
      await api.post<CreditScore>(`/credit-scores/${id}/recompute`, {});
      toast({ title: 'Score recomputed' });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['credit-score', id, 'latest'] }),
        qc.invalidateQueries({ queryKey: ['credit-score', id, 'history'] }),
        qc.invalidateQueries({ queryKey: ['credit-scores', 'summary'] }),
        qc.invalidateQueries({ queryKey: ['credit-scores', 'list'] }),
      ]);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Recompute failed', description: err instanceof ApiError ? err.message : '' });
    } finally {
      setBusy(false);
    }
  };

  if (latestQ.isLoading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const noScoreYet = latestQ.isError;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start gap-3">
        <Link href="/credit-scores" className="text-muted-foreground hover:text-foreground mt-1">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <PageHeader
          className="flex-1"
          title={!noScoreYet && latestQ.data ? `${latestQ.data.member_first_name} ${latestQ.data.member_last_name}` : 'Member credit score'}
          description={!noScoreYet && latestQ.data ? latestQ.data.member_phone : undefined}
          actions={
            <Button disabled={busy} onClick={recompute}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Recompute now
            </Button>
          }
        >
          {!noScoreYet && latestQ.data && (
            <Badge variant={TIER_BADGE[latestQ.data.reliability_tier]}>
              {TIER_LABEL[latestQ.data.reliability_tier]}
            </Badge>
          )}
        </PageHeader>
      </div>

      {noScoreYet ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Activity className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No score on record yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Click <strong>Recompute now</strong> above to score this member based on their contribution, loan, share, and dividend history.
            </p>
          </CardContent>
        </Card>
      ) : (
        latestQ.data && <ScoreDetail latest={latestQ.data} history={historyQ.data?.items ?? []} />
      )}
    </div>
  );
}

function ScoreDetail({ latest, history }: { latest: CreditScore; history: CreditScore[] }) {
  const componentEntries = Object.entries(latest.components) as [string, ComponentScore][];

  return (
    <>
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Overall score"    value={Number(latest.overall_score).toFixed(0)} sub="/ 100" />
        <Stat label="Financial"        value={Number(latest.financial_score).toFixed(0)} sub="/ 100" />
        <Stat label="Social"           value={Number(latest.social_score).toFixed(0)} sub="placeholder (E6.2)" />
        <Stat label="Loan eligibility" value={fmtMoney(latest.loan_eligibility_limit)} sub={`based on ${TIER_LABEL[latest.reliability_tier].toLowerCase()} tier`} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Component breakdown</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {componentEntries.map(([key, c]) => (
            <div key={key}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{COMPONENT_LABEL[key] ?? key}</p>
                  <p className="text-xs text-muted-foreground">{COMPONENT_HINT[key]}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-lg font-semibold">{c.score.toFixed(0)}</p>
                  <p className="text-xs text-muted-foreground">weight {(c.weight * 100).toFixed(0)}%</p>
                </div>
              </div>
              <ScoreBar value={c.score} />
              <RawMetrics raw={c.raw} />
            </div>
          ))}
        </CardContent>
      </Card>

      {history.length > 1 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Score history</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ScoreHistoryChart history={history} />
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Last computed {new Date(latest.computed_at).toLocaleString()}.
        {history.length > 0 && ` · ${history.length} snapshot(s) on record.`}
      </p>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function ScoreBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  const tone = v >= 85 ? 'bg-green-500' : v >= 70 ? 'bg-blue-500' : v >= 55 ? 'bg-amber-500' : v >= 40 ? 'bg-orange-500' : 'bg-red-500';
  return (
    <div className="mt-2 h-2 w-full rounded-full bg-muted">
      <div className={`h-2 rounded-full transition-all ${tone}`} style={{ width: `${v}%` }} />
    </div>
  );
}

function RawMetrics({ raw }: { raw: Record<string, unknown> }) {
  const entries = Object.entries(raw).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {entries.map(([k, v]) => (
        <span key={k} className="font-mono">
          {k}: <span className="text-foreground">{formatRawValue(v)}</span>
        </span>
      ))}
    </div>
  );
}
function formatRawValue(v: unknown): string {
  if (typeof v === 'number') {
    if (Math.abs(v) >= 1000)        return v.toLocaleString();
    if (Number.isInteger(v))        return v.toString();
    return v.toFixed(2);
  }
  if (v === null)                    return '—';
  return String(v);
}
