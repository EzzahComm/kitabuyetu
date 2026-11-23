'use client';

import dynamic from 'next/dynamic';
import { CreditCard, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { StatCard } from '@/components/shared/stat-card';
import { StatusPill } from '@/components/shared/status-pill';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminBilling } from '@/hooks/use-admin';
import { ENTERPRISE_SETUP_SERVICES } from '@/lib/billing/enterprise-setup-services';
import { PRODUCT_LABEL, type SubscriptionProduct } from '@/types/enums';
import { formatKES, formatDate } from '@/lib/utils';

// OPTIMIZATION_CLEANUP_AUDIT.md Medium #26 — code-split recharts out of the
// initial bundle for this rarely-visited admin page.
const RevenueByPlanChart = dynamic(() => import('./_charts').then((m) => m.RevenueByPlanChart), {
  ssr: false,
  loading: () => <Skeleton className="h-52 w-full" />,
});

const PLAN_COLORS: Record<string, string> = {
  starter: '#94a3b8',
  growth: '#3b82f6',
  premium: '#f59e0b',
  enterprise: '#7c3aed',
  premium_plus: '#7c3aed',
};

interface BillingSummary {
  active_subscriptions: number;
  expired_subscriptions: number;
  suspended_subscriptions: number;
  mrr: string;
  overdue_invoice_count: string;
  active_enterprise_subscriptions: string;
  enterprise_mrr: string;
}

interface PlanRevenueRow {
  product: SubscriptionProduct | 'enterprise';
  plan: string;
  count: string;
  revenue: string;
}

interface OutstandingInvoiceRow {
  id: string;
  invoice_number: string;
  amount_due: string;
  due_date: string;
  status: string;
  is_overdue: boolean;
  group_name: string | null;
}

interface RecentPaymentRow {
  id: string;
  amount: string;
  status: string;
  payment_method: string | null;
  created_at: string;
  group_name: string | null;
  invoice_number: string | null;
  stream: string;
}

export default function BillingAdminPage() {
  const { data, isLoading, isError, error } = useAdminBilling();

  const summary: Partial<BillingSummary> = data?.summary ?? {};
  const byPlan = ((data?.byPlan ?? []) as PlanRevenueRow[]).map((row) => ({
    ...row,
    label: `${row.product === 'enterprise' ? 'Enterprise' : (PRODUCT_LABEL[row.product] ?? row.product)} · ${row.plan === 'premium_plus' ? 'Premium+' : row.plan}`,
  }));
  const recentPayments: RecentPaymentRow[] = data?.recentPayments ?? [];
  const outstanding: OutstandingInvoiceRow[] = data?.outstanding ?? [];

  const mrr = parseFloat(summary.mrr ?? '0');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing Operations"
        description="Subscription management, revenue tracking, and invoice oversight"
      />

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Monthly Plan Value"
          value={isLoading ? '—' : formatKES(mrr)}
          description={`Enterprise: ${formatKES(summary.enterprise_mrr ?? '0')}/mo`}
          icon={CreditCard}
          className="border-green-200"
          iconClass="bg-green-50"
        />
        <StatCard
          title="Active Subscriptions"
          value={isLoading ? '—' : (summary.active_subscriptions ?? 0)}
          description={`${summary.suspended_subscriptions ?? 0} suspended`}
          icon={CheckCircle2}
          className="border-blue-200"
          iconClass="bg-blue-50"
        />
        <StatCard
          title="Expired"
          value={isLoading ? '—' : (summary.expired_subscriptions ?? 0)}
          description="Need renewal or follow-up"
          icon={Clock}
          className="border-amber-200"
          iconClass="bg-amber-50"
        />
        <StatCard
          title="Overdue Invoices"
          value={isLoading ? '—' : (summary.overdue_invoice_count ?? 0)}
          description="Outstanding balances"
          icon={AlertCircle}
          className="border-red-200"
          iconClass="bg-red-50"
        />
      </div>

      {/* Plan distribution chart + outstanding invoices */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Plan bar chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Monthly Plan Value by Product</CardTitle>
          </CardHeader>
          <CardContent>
            {byPlan.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No subscription data</p>
            ) : (
              <RevenueByPlanChart data={byPlan} colors={PLAN_COLORS} />
            )}
            <div className="mt-3 space-y-1.5">
              {byPlan.map((p) => (
                <div key={p.label} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: PLAN_COLORS[p.plan] }} />
                    <span className="capitalize text-muted-foreground font-medium">{p.label}</span>
                  </div>
                  <div className="flex items-center gap-4 text-muted-foreground">
                    <span>
                      {p.count} subscription{Number(p.count) === 1 ? '' : 's'}
                    </span>
                    <span className="font-semibold text-foreground">{formatKES(p.revenue)}/mo</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Outstanding invoices */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <AlertCircle size={14} className="text-amber-500" /> Outstanding Invoices
              </CardTitle>
              <span className="text-xs text-muted-foreground">{outstanding.length} shown</span>
            </div>
          </CardHeader>
          <CardContent>
            {outstanding.length === 0 ? (
              <div className="flex flex-col items-center py-8 gap-2 text-center">
                <CheckCircle2 size={24} className="text-green-500" />
                <p className="text-sm text-muted-foreground">No outstanding invoices</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {outstanding.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{inv.group_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{inv.invoice_number}</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span
                          className={`text-xs ${inv.is_overdue ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}
                        >
                          Due {formatDate(inv.due_date)}
                        </span>
                      </div>
                    </div>
                    <div className="text-right ml-3 shrink-0">
                      <p className="text-sm font-bold text-foreground">{formatKES(inv.amount_due)}</p>
                      <StatusPill status={inv.status} size="sm" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Enterprise setup rate card</CardTitle>
          <p className="text-xs text-muted-foreground">Use these rates when preparing a quote for the client.</p>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            {ENTERPRISE_SETUP_SERVICES.map(({ name, price }) => (
              <div key={name} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-sm">
                <dt>{name}</dt>
                <dd className="font-medium">{price}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {/* Recent payments table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Recent Payments</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <PaginatedTable
            data={singlePage(recentPayments)}
            isLoading={isLoading}
            isError={isError}
            error={error}
            onPageChange={() => {}}
            emptyMessage="No payments yet"
            columns={[
              {
                key: 'group_name',
                header: 'Billed account',
                render: (p) => <span className="font-medium text-foreground">{p.group_name ?? '—'}</span>,
              },
              {
                key: 'stream',
                header: 'Revenue stream',
                render: (p) => <span className="text-xs">{p.stream === 'sms_credits' ? 'SMS credits' : p.stream}</span>,
              },
              {
                key: 'invoice_number',
                header: 'Invoice',
                render: (p) => (
                  <span className="text-muted-foreground text-xs font-mono">{p.invoice_number ?? '—'}</span>
                ),
              },
              {
                key: 'amount',
                header: 'Amount',
                className: 'text-right',
                render: (p) => <span className="font-semibold">{formatKES(p.amount)}</span>,
              },
              {
                key: 'payment_method',
                header: 'Method',
                render: (p) => (
                  <span className="text-xs text-muted-foreground capitalize">
                    {p.payment_method?.replace('_', ' ') ?? '—'}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (p) => <StatusPill status={p.status} size="sm" />,
              },
              {
                key: 'created_at',
                header: 'Date',
                render: (p) => <span className="text-xs text-muted-foreground">{formatDate(p.created_at)}</span>,
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
