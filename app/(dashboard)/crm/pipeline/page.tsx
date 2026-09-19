'use client';

import { PageHeader } from '@/components/shared/page-header';
import { PipelineBoard } from '@/components/crm/pipeline-board';
import { RecentActivityFeed } from '@/components/crm/recent-activity-feed';

export default function CrmPipelinePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Pipeline"
        description="Every opportunity across your contacts, by stage. Move a card as it progresses — donors, grants, partnerships, anything you're working toward."
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <PipelineBoard />
        </div>
        <div className="xl:col-span-1">
          <RecentActivityFeed />
        </div>
      </div>
    </div>
  );
}
