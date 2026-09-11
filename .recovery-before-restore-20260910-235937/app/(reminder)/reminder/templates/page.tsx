'use client';

import { PageHeader } from '@/components/shared/page-header';
import { TemplatesTab } from '@/components/sms/tabs';

export default function ReminderTemplatesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Templates" description="Reusable message wording. {{first_name}} and {{group_name}} are filled in per recipient." />
      <TemplatesTab />
    </div>
  );
}
