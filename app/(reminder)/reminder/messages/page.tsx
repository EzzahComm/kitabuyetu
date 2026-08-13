'use client';

import { useState } from 'react';
import { Send, Clock } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { ComposeTab, SchedulesTab } from '@/components/sms/tabs';

/**
 * Compose and Schedules share a page here rather than getting a nav slot each:
 * the product's IA has one "Messages" entry, and scheduling is a property of a
 * message rather than a separate activity.
 */
const SUB_TABS = [
  { key: 'compose',   label: 'Compose',   icon: Send },
  { key: 'scheduled', label: 'Scheduled', icon: Clock },
] as const;

type SubTab = (typeof SUB_TABS)[number]['key'];

export default function ReminderMessagesPage() {
  const [tab, setTab] = useState<SubTab>('compose');

  return (
    <div className="space-y-6">
      <PageHeader title="Messages" description="Write a message now, or set one to go out on a schedule" />

      <div className="flex gap-1 border-b">
        {SUB_TABS.map(({ key, label, icon: Icon }) => (
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

      {tab === 'compose'   && <ComposeTab />}
      {tab === 'scheduled' && <SchedulesTab />}
    </div>
  );
}
