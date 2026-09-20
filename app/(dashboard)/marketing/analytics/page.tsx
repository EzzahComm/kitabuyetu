'use client';

import { useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Loader2, MessageSquare, Mail, Zap, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { useMarketingAnalytics } from '@/hooks/use-marketing-analytics';
import { getErrorMessage } from '@/lib/utils';

const AutomationVolumeChart = dynamic(() => import('./_charts').then((m) => m.AutomationVolumeChart), { ssr: false });

const PERIOD_OPTIONS = [
  { value: 7,  label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
];

const STAGE_LABELS: Record<string, string> = {
  draft: 'Draft', qualified: 'Qualified', proposal: 'Proposal', won: 'Won', lost: 'Lost',
};

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const fmtInt = (v: number) => new Intl.NumberFormat('en-KE').format(v);
const fmtMoney = (v: number) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(v);

export default function MarketingAnalyticsPage() {
  const [days, setDays] = useState(30);
  const { data: a, isLoading, isError, error } = useMarketingAnalytics(days);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketing analytics"
        description="Campaign delivery, automation health, and pipeline snapshot across SMS and email — separate from financial reporting."
        actions={
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        }
      />

      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load marketing analytics</AlertTitle>
          <AlertDescription>{getErrorMessage(error)}</AlertDescription>
        </Alert>
      ) : isLoading || !a ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="SMS campaigns" value={fmtInt(a.sms.campaigns)}
              description={`${fmtInt(a.sms.sent)}/${fmtInt(a.sms.recipients)} sent · ${pct(a.sms.deliveryRate)} delivery`}
              icon={MessageSquare} accent="blue"
            />
            <StatCard
              title="Email campaigns" value={fmtInt(a.email.campaigns)}
              description={`${fmtInt(a.email.sent)}/${fmtInt(a.email.recipients)} sent · ${pct(a.email.deliveryRate)} delivery`}
              icon={Mail} accent="purple"
            />
            <StatCard
              title="Automation sends" value={fmtInt(a.automation.sent)}
              description={`${fmtInt(a.automation.failed)} failed · ${fmtInt(a.automation.suppressed)} suppressed`}
              icon={Zap} accent="orange"
            />
            <StatCard
              title="Opted-in contacts" value={`${fmtInt(a.crm.optedInContacts)}/${fmtInt(a.crm.totalContacts)}`}
              description={`${pct(a.crm.optInRate)} opt-in rate`}
              icon={Users} accent="green"
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base">Automation volume — SMS vs email</CardTitle></CardHeader>
              <CardContent>
                <div className="h-64">
                  {a.automation.total === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      No automation rules have fired in this period.
                    </div>
                  ) : (
                    <AutomationVolumeChart points={a.automationVolume} />
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Email opens</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <p className="text-3xl font-bold">{pct(a.email.openRate)}</p>
                <p className="text-sm text-muted-foreground">{fmtInt(a.email.opened)} of {fmtInt(a.email.sent)} sent emails opened</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Pipeline snapshot</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {Object.entries(STAGE_LABELS).map(([stage, label]) => {
                  const s = a.crm.opportunitiesByStage[stage];
                  return (
                    <div key={stage} className="rounded-md border p-3 text-center">
                      <Badge variant="outline" className="mb-1">{label}</Badge>
                      <p className="text-xl font-semibold">{s ? fmtInt(s.count) : 0}</p>
                      {s && s.amount > 0 && <p className="text-xs text-muted-foreground">{fmtMoney(s.amount)}</p>}
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {fmtInt(a.crm.activitiesInPeriod)} activities logged in this period. See the full board at{' '}
                <Link href="/crm/pipeline" className="text-primary hover:underline">/crm/pipeline</Link>.
              </p>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">Generated {new Date(a.generatedAt).toLocaleString()}</p>
        </>
      )}
    </div>
  );
}
