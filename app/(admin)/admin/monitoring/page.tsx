'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, Play, Pause, Server, Smartphone, MessageSquare,
  ArrowDownLeft, ArrowUpRight, Zap, Info, RefreshCw,
} from 'lucide-react';
import { MetricCard } from '@/components/admin/metric-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { StatusPill } from '@/components/shared/status-pill';
import { MoneyDisplay } from '@/components/shared/money-display';
import { ChartCard, TrendChart } from '@/components/shared/charts';
import { tone, type Tone } from '@/lib/ui/tokens';
import { formatKES } from '@/lib/utils';
import type { MonitoringDashboardPayload } from '@/lib/services/admin.service';
import { adminFetch } from '@/hooks/use-admin';
import { relativeTime } from './_data';

const statusToneMap: Record<'operational' | 'degraded' | 'down', Tone> = {
  operational: 'positive', degraded: 'warning', down: 'negative',
};
const txnStatusTone: Record<'success' | 'pending' | 'failed', Tone> = {
  success: 'positive', pending: 'pending', failed: 'negative',
};
const typeStyle: Record<'C2B' | 'B2C' | 'STK', { label: string; cls: string; Icon: React.ElementType }> = {
  C2B: { label: 'C2B', cls: 'bg-green-50 text-green-700', Icon: ArrowDownLeft },
  B2C: { label: 'B2C', cls: 'bg-blue-50 text-blue-700', Icon: ArrowUpRight },
  STK: { label: 'STK', cls: 'bg-purple-50 text-purple-700', Icon: Zap },
};

const SERVICE_GROUPS: { title: MonitoringDashboardPayload['services'][number]['group']; Icon: React.ElementType }[] = [
  { title: 'M-Pesa / Daraja', Icon: Smartphone },
  { title: 'Messaging', Icon: MessageSquare },
  { title: 'Platform', Icon: Server },
];

const FEED_CAP = 40;

export default function MonitoringPage() {
  const { data, isLoading, error } = useQuery<MonitoringDashboardPayload>({
    queryKey: ['admin', 'monitoring-dashboard'],
    queryFn: () => adminFetch<MonitoringDashboardPayload>('/api/admin/dashboard?widget=monitoring_dashboard'),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const services = data?.services ?? [];
  const hourlyVolume = data?.hourlyVolume ?? [];
  const smsUsage = data?.smsUsage ?? { sentToday: 0, delivered: 0, failed: 0, pending: 0, creditsRemaining: 0, creditsTotal: 0 };
  const feed = data?.transactions ?? [];
  const [live, setLive] = React.useState(true);

  const mpesa = services.filter((s) => s.group === 'M-Pesa / Daraja');
  const mpesaSuccess = mpesa.length ? mpesa.reduce((a, s) => a + s.success, 0) / mpesa.length : 0;
  const txnsToday = hourlyVolume.reduce((a, h) => a + h.count, 0);
  const valueToday = hourlyVolume.reduce((a, h) => a + h.value, 0);
  const stk = services.find((s) => s.id === 'stk');
  const smsRate = smsUsage.sentToday ? (smsUsage.delivered / smsUsage.sentToday) * 100 : 0;
  const degraded = services.filter((s) => s.status !== 'operational');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900">
            <Activity size={20} className="text-blue-500" />
            Platform Monitoring
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Daraja, messaging &amp; API health with a real-time M-Pesa transaction feed
          </p>
        </div>
        <Button
          variant={live ? 'default' : 'outline'}
          size="sm"
          className={live ? 'bg-blue-600 text-xs hover:bg-blue-700' : 'text-xs'}
          onClick={() => setLive((l) => !l)}
        >
          {live ? <><Pause size={13} className="mr-1" /> Pause feed</> : <><Play size={13} className="mr-1" /> Resume feed</>}
        </Button>
      </div>

      {/* Degraded banner */}
      {degraded.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <RefreshCw size={14} className="shrink-0" />
          <span>
            <strong>{degraded.length} service{degraded.length > 1 ? 's' : ''} degraded</strong> — {degraded.map((s) => s.name).join(', ')}. Monitoring upstream.
          </span>
        </div>
      )}

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Transactions today" value={isLoading ? '—' : txnsToday.toLocaleString()} sub={isLoading ? 'Loading…' : formatKES(valueToday)} icon={Activity} accent="blue" />
        <MetricCard title="M-Pesa success" value={isLoading ? '—' : `${mpesaSuccess.toFixed(1)}%`} sub={isLoading ? 'Loading…' : 'C2B · B2C · STK avg'} icon={Smartphone} accent="green" />
        <MetricCard title="STK Push p95" value={isLoading ? '—' : `${stk?.latency ?? 0}ms`} sub={isLoading ? 'Loading…' : stk?.note} icon={Zap} accent={stk?.status === 'operational' ? 'green' : 'orange'} />
        <MetricCard title="SMS delivered" value={isLoading ? '—' : `${smsRate.toFixed(1)}%`} sub={isLoading ? 'Loading…' : `${smsUsage.delivered.toLocaleString()} of ${smsUsage.sentToday.toLocaleString()}`} icon={MessageSquare} accent="purple" />
      </div>

      {/* Service health grid */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-gray-900">Service health</CardTitle>
          <p className="text-xs text-muted-foreground">p95 latency and trailing success rate by service</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {SERVICE_GROUPS.map(({ title, Icon }) => (
            <div key={title}>
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Icon size={13} /> {title}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {services.filter((s) => s.group === title).map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">{s.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.note}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <StatusPill status={s.status} tone={statusToneMap[s.status]} label={s.status} size="sm" />
                      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                        {s.latency}ms · {s.success}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Volume chart + SMS usage */}
      <div className="grid gap-6 lg:grid-cols-3">
        <ChartCard title="Transaction value (today)" description="Hourly M-Pesa throughput" height={260} className="lg:col-span-2">
          <TrendChart data={hourlyVolume} xKey="hour" series={[{ key: 'value', label: 'Value' }]} />
        </ChartCard>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-900">SMS usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Credits remaining</span>
                <span className="font-semibold text-gray-900">
                  {smsUsage.creditsRemaining.toLocaleString()} / {smsUsage.creditsTotal.toLocaleString()}
                </span>
              </div>
              <Progress value={smsUsage.creditsTotal > 0 ? (smsUsage.creditsRemaining / smsUsage.creditsTotal) * 100 : 0} />
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Delivered', value: smsUsage.delivered, cls: 'text-green-600' },
                { label: 'Pending', value: smsUsage.pending, cls: 'text-amber-600' },
                { label: 'Failed', value: smsUsage.failed, cls: 'text-red-600' },
              ].map((x) => (
                <div key={x.label} className="rounded-lg bg-muted/50 p-2">
                  <p className={`text-lg font-bold ${x.cls}`}>{x.value.toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground">{x.label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Real-time transaction feed */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-gray-900">Real-time transaction feed</CardTitle>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {live ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                  </span>
                  Live
                </>
              ) : (
                <><Pause size={12} /> Paused</>
              )}
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50 backdrop-blur">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Organization</th>
                  <th className="hidden px-4 py-2 font-medium sm:table-cell">Phone</th>
                  <th className="hidden px-4 py-2 font-medium md:table-cell">Reference</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">Loading live transaction feed…</td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">Unable to load monitoring data right now.</td>
                  </tr>
                ) : feed.map((tx, i) => {
                  const ts = typeStyle[tx.type] ?? typeStyle.C2B;
                  return (
                    <tr key={tx.id} className={`border-t transition-colors hover:bg-muted/30 ${i === 0 && live ? 'animate-in fade-in slide-in-from-top-1' : ''}`}>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${ts.cls}`}>
                          <ts.Icon size={11} /> {ts.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-gray-900">{tx.org}</td>
                      <td className="hidden px-4 py-2.5 font-mono text-xs text-muted-foreground sm:table-cell">{tx.phone}</td>
                      <td className="hidden px-4 py-2.5 font-mono text-xs text-muted-foreground md:table-cell">{tx.ref}</td>
                      <td className="px-4 py-2.5 text-right">
                        <MoneyDisplay amount={tx.amount} size="sm" color={tx.status === 'failed' ? 'red' : 'default'} />
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPill status={tx.status} tone={txnStatusTone[tx.status]} label={tx.status} size="sm" />
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground tabular-nums">{relativeTime(tx.at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>The monitoring page now uses the live admin dashboard payload for service health, SMS usage, and recent M-Pesa activity. <span className="text-green-600">●</span></span>
      </div>
    </div>
  );
}
