'use client';

/**
 * Organization Billing — plan + SMS credits.
 *
 * Deliberately its OWN page, not a card on the Funding Portal. That page is
 * the org's CAPITAL wallet (donor contributions, grants, disbursements to
 * groups) — SMS credits are a separate wallet (organization_billing_accounts
 * .sms_credits) with no GL posting and nothing to do with disbursement
 * capacity. Mirrors the group side, which manages its own SMS credits on a
 * dedicated Billing page too (components/layout/sidebar.tsx), not folded
 * into any "funding" concept. The plan section is read-only — an
 * organization never self-serve changes its plan, only Kitabu Yetu staff do.
 */

import { useQuery } from '@tanstack/react-query';
import { MessageSquare, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { SectionHeader } from '@/components/shared/dashboard-sections';
import { organizationApi } from '@/lib/api/endpoints';
import { enterpriseKeys } from '@/lib/api/enterprise-keys';
import { formatDate, formatKES } from '@/lib/utils';

const CAP_LABEL = (n: number | null) => (n === null ? 'Unlimited' : n.toLocaleString());

export default function OrganizationBillingPage() {
  const { data, isLoading } = useQuery({
    queryKey: enterpriseKeys.smsCredits(),
    queryFn: () => organizationApi.smsCredits(),
    staleTime: 30_000,
  });

  const { data: plan, isLoading: planLoading } = useQuery({
    queryKey: enterpriseKeys.plan(),
    queryFn: () => organizationApi.plan(),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description="This organization's plan and SMS credits — separate from the capital wallet on the Funding Portal."
      />

      <div className="space-y-3">
        <SectionHeader title="Plan" subtitle="Assigned by Kitabu Yetu staff — contact them to change your plan." />
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4 py-4">
            <div className="flex items-center gap-2.5">
              <Sparkles className="text-muted-foreground" size={18} />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground capitalize">
                  {planLoading ? '—' : plan ? plan.plan_type.replace('_', '+') : 'No plan assigned'}
                </p>
                <p className="text-lg font-semibold text-foreground">
                  {planLoading || !plan ? '—' : `${formatKES(plan.monthly_fee)}/mo`}
                </p>
              </div>
            </div>
            {plan && !planLoading && (
              <p className="text-xs text-muted-foreground">
                {CAP_LABEL(plan.max_linked_groups)} groups · {CAP_LABEL(plan.max_staff)} staff ·{' '}
                {CAP_LABEL(plan.max_funding_programs)} funding programs ·{' '}
                {Number(plan.sms_allowance_included).toLocaleString()} SMS/mo included ·{' '}
                <span className="capitalize">{plan.support_tier.replace('_', '+')}</span> support
                {plan.white_label_branding && ' · White-label'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          title="SMS credit balance"
          value={isLoading ? '—' : `${(data?.balance ?? 0).toLocaleString()} credits`}
          icon={MessageSquare}
        />
        <StatCard
          title="Rate per SMS"
          value={isLoading || data?.rate == null ? '—' : `KES ${data.rate.toFixed(4)}`}
          description="Negotiated rate — set by Kitabu Yetu staff"
        />
      </div>

      <div className="space-y-3">
        <SectionHeader
          title="Recent top-ups"
          subtitle="Manual entries, reconciled against bank/M-Pesa settlement separately."
        />
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Amount (KES)</th>
                  <th className="px-4 py-3 text-left">Credits added</th>
                  <th className="px-4 py-3 text-left">Rate applied</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : !data?.recent.length ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                      No top-ups yet.
                    </td>
                  </tr>
                ) : (
                  data.recent.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(r.created_at)}</td>
                      <td className="px-4 py-3">{Number(r.amount_paid).toLocaleString()}</td>
                      <td className="px-4 py-3">{Number(r.credits_added).toLocaleString()}</td>
                      <td className="px-4 py-3">{Number(r.rate_applied).toFixed(4)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.notes ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
