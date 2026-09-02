'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { SmsCreditsPanel } from '@/components/sms/sms-credits-panel';
import {
  TABS, type TabKey,
  ComposeTab, CampaignsTab, TemplatesTab, SchedulesTab, LogsTab, OptOutsTab,
} from '@/components/sms/tabs';
import { FailuresTab, ReminderHistoryTab } from '@/components/sms/ops-tabs';

export default function SmsPage() {
  const [tab, setTab] = useState<TabKey>('compose');

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader title="SMS Centre" description="Send, schedule, and track messages via TextSMS Kenya" />

      {/* Tab navigation */}
      <div className="flex gap-1 border-b">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* Spec §13 — the customer-facing credits view, above the working tabs. */}
      <SmsCreditsPanel />

      {tab === 'compose'   && <ComposeTab />}
      {tab === 'campaigns' && <CampaignsTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'schedules' && <SchedulesTab />}
      {tab === 'logs'      && <LogsTab />}
      {tab === 'failures'  && <FailuresTab />}
      {tab === 'history'   && <ReminderHistoryTab />}
      {tab === 'optouts'   && <OptOutsTab />}
    </div>
  );
}
