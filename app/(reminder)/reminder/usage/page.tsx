'use client';

import { PageHeader } from '@/components/shared/page-header';
import { BalanceCard, LogsTab } from '@/components/sms/tabs';

export default function ReminderUsagePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="SMS Usage" description="What you have sent, and what it cost" />
      <BalanceCard />
      <LogsTab />
    </div>
  );
}
