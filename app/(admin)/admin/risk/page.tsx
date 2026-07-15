'use client';

import * as React from 'react';
import {
  ShieldAlert, ShieldCheck, UserCheck, AlertTriangle, Banknote,
  ArrowRight, Check, X, Eye, Info,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { MetricCard } from '@/components/admin/metric-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/shared/status-pill';
import { MoneyDisplay } from '@/components/shared/money-display';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { ChartCard, BarSeriesChart } from '@/components/shared/charts';
import { tone, type Tone } from '@/lib/ui/tokens';
import { formatKES } from '@/lib/utils';
import { type Severity } from './_data';
import type { RiskDashboardPayload } from '@/lib/services/admin.service';
import { adminFetch } from '@/hooks/use-admin';

const severityTone: Record<Severity, Tone> = {
  critical: 'negative', high: 'negative', medium: 'warning', low: 'neutral',
};

const RISK_DIMENSIONS = ['Fraud', 'AML', 'Credit', 'Liquidity', 'Compliance'] as const;

function heatmapCellClass(score: number): string {
  if (score >= 60) return 'bg-red-100 text-red-800';
  if (score >= 40) return 'bg-amber-100 text-amber-800';
  if (score >= 20) return 'bg-yellow-100 text-yellow-800';
  return 'bg-green-100 text-green-800';
}

function legendToneClass(label: string): string {
  if (label === 'Low') return 'bg-green-100';
  if (label === 'Moderate') return 'bg-yellow-100';
  if (label === 'Elevated') return 'bg-amber-100';
  return 'bg-red-100';
}

function ago(min: number): string {
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ${min % 60}m ago`;
}

export default function RiskDashboardPage() {
  const { data, isLoading, error } = useQuery<RiskDashboardPayload>({
    queryKey: ['admin', 'risk-dashboard'],
    queryFn: () => adminFetch<RiskDashboardPayload>('/api/admin/dashboard?widget=risk_dashboard'),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const alerts = data?.alerts ?? [];
  const kyc = data?.kyc ?? [];

  // Pending confirm action (fraud escalate/dismiss or KYC approve/reject).
  const [pending, setPending] = React.useState<
    | { kind: 'escalate' | 'dismiss'; alert: RiskDashboardPayload['alerts'][number] }
    | { kind: 'approve' | 'reject'; item: RiskDashboardPayload['kyc'][number] }
    | null
  >(null);

  const openAlerts = alerts.filter((a) => a.status === 'open').length;
  const flaggedVolume = alerts.reduce((sum, a) => sum + a.amount, 0);
  const highRiskKyc = kyc.filter((k) => k.risk === 'high').length;

  function resolvePending() {
    if (!pending) return;
    setPending(null);
  }

  return (
    <div className="space-y-6">
      {/* Header — matches the backoffice header pattern */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900">
            <ShieldAlert size={20} className="text-red-500" />
            Risk &amp; Fraud
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Platform-wide risk posture, live fraud signals, and the KYC verification queue
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="text-xs">
            Export report <ArrowRight size={12} className="ml-1" />
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Open fraud alerts" value={isLoading ? '—' : openAlerts} sub={isLoading ? 'Loading…' : `${alerts.length} in feed`} icon={AlertTriangle} accent="red" />
        <MetricCard title="Flagged volume" value={isLoading ? '—' : formatKES(flaggedVolume)} sub={isLoading ? 'Loading…' : 'Under review'} icon={Banknote} accent="orange" />
        <MetricCard title="KYC pending" value={isLoading ? '—' : kyc.length} sub={isLoading ? 'Loading…' : `${highRiskKyc} high-risk`} icon={UserCheck} accent="blue" />
        <MetricCard title="Platform risk" value={isLoading ? '—' : data?.summary.platformRisk ?? 'Moderate'} sub={isLoading ? 'Loading…' : 'Composite signal'} icon={ShieldCheck} accent="green" />
      </div>

      {/* Heatmap + trend */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Risk heatmap */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-gray-900">Risk heatmap</CardTitle>
            <p className="text-xs text-muted-foreground">Risk score (0–100) by segment and dimension</p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 text-sm">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left text-xs font-medium text-muted-foreground">Segment</th>
                  {RISK_DIMENSIONS.map((d) => (
                    <th key={d} className="px-2 py-1 text-center text-xs font-medium text-muted-foreground">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.heatmap ?? []).map((row) => (
                  <tr key={row.segment}>
                    <td className="whitespace-nowrap px-2 py-1 text-xs font-medium text-gray-700">{row.segment}</td>
                    {row.scores.map((score, i) => (
                      <td key={i} className="p-0">
                        <div
                          className={`flex h-9 items-center justify-center rounded-md text-xs font-semibold tabular-nums ${heatmapCellClass(score)}`}
                          title={`${row.segment} · ${RISK_DIMENSIONS[i]}: ${score}/100`}
                        >
                          {score}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
              {[
                { label: 'Low', c: '#DCFCE7' }, { label: 'Moderate', c: '#FEF9C3' },
                { label: 'Elevated', c: '#FEF3C7' }, { label: 'High', c: '#FEE2E2' },
              ].map((l) => (
                <span key={l.label} className="flex items-center gap-1.5">
                  <span className={`h-3 w-3 rounded ${legendToneClass(l.label)}`} /> {l.label}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Alert trend */}
        <ChartCard title="Alerts (7 days)" description="Raised vs resolved" height={260}>
          <BarSeriesChart
            data={data?.alertTrend ?? []}
            xKey="day"
            money={false}
            series={[
              { key: 'alerts', label: 'Raised', color: tone.negative.solid },
              { key: 'resolved', label: 'Resolved', color: tone.positive.solid },
            ]}
          />
        </ChartCard>
      </div>

      {/* Live fraud feed + KYC queue */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Fraud feed */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle size={14} className="text-red-500" /> Live fraud feed
              </CardTitle>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
                Live
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Loading live fraud signals…</div>
            ) : error ? (
              <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Unable to load risk data right now.</div>
            ) : alerts.length === 0 ? (
              <EmptyState
                size="sm"
                icon={ShieldCheck}
                title="No active fraud signals"
                description="New anomalies from the rules engine and Daraja feed will surface here in real time."
              />
            ) : (
              alerts.map((a) => (
                <div key={a.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusPill status={a.severity} tone={severityTone[a.severity]} label={a.severity} size="sm" />
                        <span className="truncate text-sm font-semibold text-gray-900">{a.type}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{a.org} · {a.detail}</p>
                      <p className="mt-1 font-mono text-[11px] text-gray-400">{a.id} · {ago(a.ago)}</p>
                    </div>
                    <MoneyDisplay amount={a.amount} size="sm" color="red" className="shrink-0" />
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPending({ kind: 'escalate', alert: a })}>
                      <Eye size={12} className="mr-1" /> Escalate
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setPending({ kind: 'dismiss', alert: a })}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* KYC queue */}
        <Card id="kyc">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <UserCheck size={14} className="text-blue-500" /> KYC verification queue
              </CardTitle>
              <span className="text-xs text-muted-foreground">{kyc.length} pending</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Loading verification queue…</div>
            ) : error ? (
              <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Unable to load verification queue right now.</div>
            ) : kyc.length === 0 ? (
              <EmptyState
                size="sm"
                icon={ShieldCheck}
                title="Queue clear"
                description="Every submitted identity document has been reviewed. New submissions appear here automatically."
              />
            ) : (
              kyc.map((k) => (
                <div key={k.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600">
                    {k.name.split(' ').map((n) => n[0]).join('')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-gray-900">{k.name}</span>
                      <StatusPill status={k.risk} tone={k.risk === 'high' ? 'negative' : k.risk === 'medium' ? 'warning' : 'positive'} label={`${k.risk} risk`} size="sm" />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{k.docType} · {k.org} · {k.submitted}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="icon" variant="outline" className="h-9 w-9 text-green-600 hover:bg-green-50" title="Approve" aria-label={`Approve ${k.name}`} onClick={() => setPending({ kind: 'approve', item: k })}>
                      <Check size={14} />
                    </Button>
                    <Button size="icon" variant="outline" className="h-9 w-9 text-red-600 hover:bg-red-50" title="Reject" aria-label={`Reject ${k.name}`} onClick={() => setPending({ kind: 'reject', item: k })}>
                      <X size={14} />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>The risk feed now renders data from the platform dashboard endpoint, with local UI actions still available for operator review.</span>
      </div>

      {/* Confirmation modals for every risk action */}
      <ConfirmDialog
        open={pending?.kind === 'escalate'}
        onOpenChange={(o) => !o && setPending(null)}
        title="Escalate this alert?"
        description={pending?.kind === 'escalate' ? `${pending.alert.org} · ${formatKES(pending.alert.amount)} will be sent to compliance for manual review and the org's payouts paused.` : ''}
        confirmLabel="Escalate to compliance"
        onConfirm={resolvePending}
      />
      <ConfirmDialog
        open={pending?.kind === 'dismiss'}
        onOpenChange={(o) => !o && setPending(null)}
        variant="danger"
        title="Dismiss this alert?"
        description="Marking it a false positive removes it from the feed and trains the rules engine. This is logged against your account."
        confirmLabel="Dismiss as false positive"
        onConfirm={resolvePending}
      />
      <ConfirmDialog
        open={pending?.kind === 'approve'}
        onOpenChange={(o) => !o && setPending(null)}
        title="Approve verification?"
        description={pending?.kind === 'approve' ? `${pending.item.name} (${pending.item.org}) will be marked KYC-verified and gain full account access.` : ''}
        confirmLabel="Approve"
        onConfirm={resolvePending}
      />
      <ConfirmDialog
        open={pending?.kind === 'reject'}
        onOpenChange={(o) => !o && setPending(null)}
        variant="danger"
        title="Reject verification?"
        description={pending?.kind === 'reject' ? `${pending.item.name}'s submission will be rejected and they'll be asked to resubmit. The member is notified.` : ''}
        confirmLabel="Reject submission"
        onConfirm={resolvePending}
      />
    </div>
  );
}
