'use client';

import { PageHeader } from '@/components/shared/page-header';
import { PlanPurchase, useCurrentPlanSummary } from '@/components/billing/plan-purchase';

/**
 * The only page a Chama Reminder group can reach before it has paid — the
 * layout's own carve-out, mirroring the server's: a lock that also blocks
 * paying is an outage, not a business model.
 */
export default function ReminderSubscriptionPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Subscription" description={useCurrentPlanSummary('chama_reminder')} />
      <PlanPurchase product="chama_reminder" />
    </div>
  );
}
