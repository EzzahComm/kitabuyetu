'use client';

import { PageHeader } from '@/components/shared/page-header';
import { PlanPurchase, useCurrentPlanSummary } from '@/components/billing/plan-purchase';

/** The Changi$ha plan: a group needs an active one to create and launch fundraising campaigns. */
export default function ChangishaPlanPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Changi$ha plan" description={useCurrentPlanSummary('changisha')} />
      <PlanPurchase product="changisha" />
    </div>
  );
}
