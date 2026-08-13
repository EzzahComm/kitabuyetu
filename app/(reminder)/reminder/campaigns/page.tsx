'use client';

import { PageHeader } from '@/components/shared/page-header';
import { CampaignsTab } from '@/components/sms/tabs';

export default function ReminderCampaignsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Campaigns" description="Send a message to the whole group, now or on a schedule" />
      <CampaignsTab />
    </div>
  );
}
