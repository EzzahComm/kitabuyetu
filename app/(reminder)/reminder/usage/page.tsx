'use client';

import { PageHeader } from '@/components/shared/page-header';
import { LogsTab } from '@/components/sms/tabs';
import { SmsCreditsPanel } from '@/components/sms/sms-credits-panel';

export default function ReminderUsagePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="SMS Usage" description="What you have sent, and what it cost" />
      {/* Spec §13: balance and usage first, in plain language. The raw
          message log stays below for anyone who wants the detail. */}
      <SmsCreditsPanel />
      <LogsTab />
    </div>
  );
}
