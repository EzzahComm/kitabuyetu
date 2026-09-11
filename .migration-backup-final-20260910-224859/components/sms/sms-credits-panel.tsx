'use client';

import { MessageSquare, TrendingDown, CalendarClock, Wallet } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SectionHeader } from '@/components/dashboard/sms/shared';
import { PaginatedTable, singlePage, type PaginatedTableColumn } from '@/components/shared/paginated-table';
import { useSmsAnalytics } from '@/hooks/use-sms-analytics';
import type { FeatureUsage } from '@/lib/services/sms-analytics.service';

/**
 * The customer's SMS credits view (spec §13).
 *
 * §18 governs the wording here: "The customer should never have to understand
 * the underlying billing complexity." So this says Credits, Used, Remaining and
 * Low Balance — and never wallet, ledger, reservation, settlement, drawdown or
 * provider cost. Those are real concepts in the code underneath and belong in
 * the admin surface, not in front of a chama treasurer.
 */

/** Below this many credits the balance reads as a warning (spec §9). */
const LOW_BALANCE = 500;
const URGENT_BALANCE = 100;

/** Turn a notification_type into something a person would recognise. */
function featureLabel(feature: string | null): string {
  if (feature === null) return 'Earlier messages';
  return feature
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const featureColumns: PaginatedTableColumn<FeatureUsage & { id: string }>[] = [
  {
    key: 'feature',
    header: 'What it was for',
    render: (f) => (
      <span className={f.feature === null ? 'text-muted-foreground' : 'text-foreground'}>
        {featureLabel(f.feature)}
      </span>
    ),
  },
  { key: 'messages', header: 'Messages', render: (f) => f.messages.toLocaleString() },
  { key: 'credits', header: 'Credits', render: (f) => Math.round(f.credits).toLocaleString() },
];

export function SmsCreditsPanel() {
  const { data, isLoading, isError, error } = useSmsAnalytics();

  const balance = data ? Math.floor(data.balance) : null;
  const low     = balance !== null && balance < LOW_BALANCE;
  const urgent  = balance !== null && balance < URGENT_BALANCE;

  const features = (data?.byFeature ?? []).map((f, i) => ({
    ...f,
    id: f.feature ?? `unattributed-${i}`,
  }));

  return (
    <div className="space-y-6">
      {/* Balance first and largest: it is the only number that decides whether
          the product works today. */}
      <Card className={urgent ? 'border-destructive/40' : low ? 'border-amber-300' : undefined}>
        <CardContent className="flex flex-wrap items-end justify-between gap-4 py-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              SMS Credits
            </p>
            {isLoading ? (
              <div className="mt-2 h-9 w-32 animate-pulse rounded bg-muted" />
            ) : (
              <p className="mt-1 text-4xl font-bold text-foreground">
                {balance?.toLocaleString() ?? '—'}
              </p>
            )}
            {/* The breakdown matters: a group on a plan it has not topped up
                sees its whole balance come from the bundled allowance, and
                without this the big number looks unexplained. */}
            <p className="mt-1 text-sm text-muted-foreground">
              1 credit sends 1 SMS
              {data && data.allowanceRemaining > 0 && (
                <> · {data.allowanceRemaining.toLocaleString()} included in your plan
                  {data.purchasedBalance > 0 && <> + {Math.floor(data.purchasedBalance).toLocaleString()} purchased</>}
                </>
              )}
            </p>
          </div>
          {urgent ? <Badge variant="destructive">Very low balance</Badge>
                  : low ? <Badge variant="warning">Low balance</Badge>
                  : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<MessageSquare size={15} />}
          label="Used this month"
          value={data ? Math.round(data.usageThisMonth).toLocaleString() : '—'}
          hint={data ? `${Math.round(data.usageLastMonth).toLocaleString()} last month` : undefined}
        />
        <StatCard
          icon={<TrendingDown size={15} />}
          label="Expected each month"
          // Null means "we have nothing to base this on" — saying 0 would look
          // like a claim rather than an absence.
          value={data?.projectedMonthly != null ? Math.round(data.projectedMonthly).toLocaleString() : '—'}
          hint={data?.projectedMonthly == null ? 'Not enough activity yet' : 'Based on recent sending'}
        />
        <StatCard
          icon={<CalendarClock size={15} />}
          label="Credits should last"
          value={data?.daysRemaining != null ? `~${data.daysRemaining} days` : '—'}
          hint={data?.daysRemaining == null ? 'Not enough activity yet' : undefined}
        />
      </div>

      <div className="space-y-3">
        <SectionHeader
          title="What you have used credits on"
          subtitle={data?.hasUnattributedHistory
            // Honesty rather than a silent bucket: notification_type is only
            // ~5% populated, because the column postdates most sending. Calling
            // that "Other" would imply we know and are not saying.
            ? 'Messages sent before we started recording categories appear as “Earlier messages”.'
            : undefined}
        />
        <PaginatedTable
          data={singlePage(features)}
          isLoading={isLoading}
          isError={isError}
          error={error}
          columns={featureColumns}
          onPageChange={() => {}}
          emptyIcon={Wallet}
          emptyMessage="No messages sent yet"
          emptyDescription="Your usage will appear here once you start sending."
        />
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, hint }: {
  icon: React.ReactNode; label: string; value: string; hint?: string;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {icon} {label}
        </p>
        <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
