'use client';

import { Card, CardContent } from '@/components/ui/card';
import { OpportunityCard } from './opportunity-card';
import { useOpportunities } from '@/hooks/use-crm';
import { useHasPermission } from '@/lib/auth/use-permission';
import type { OpportunityStage, OpportunityWithContact } from '@/lib/services/crm.service';

const STAGES: { value: OpportunityStage; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

function stageTotal(opportunities: OpportunityWithContact[]): number {
  return opportunities.reduce((sum, o) => sum + (o.amount != null ? Number(o.amount) : 0), 0);
}

export function PipelineBoard() {
  const { data: opportunities, isLoading } = useOpportunities();
  const canManage = useHasPermission('crm.manage');

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (!opportunities || opportunities.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          No opportunities yet. Add one from a contact&rsquo;s page to start tracking it through your pipeline.
        </CardContent>
      </Card>
    );
  }

  const byStage = STAGES.map((s) => ({
    ...s,
    items: opportunities.filter((o) => o.stage === s.value),
  }));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {byStage.map((column) => (
        <div key={column.value} className="space-y-3">
          <div className="flex items-baseline justify-between px-1">
            <h3 className="text-sm font-semibold">{column.label}</h3>
            <span className="text-xs text-muted-foreground">
              {column.items.length}
              {stageTotal(column.items) > 0 && ` · KES ${stageTotal(column.items).toLocaleString()}`}
            </span>
          </div>
          <div className="space-y-2">
            {column.items.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">Empty</p>
            ) : (
              column.items.map((o) => <OpportunityCard key={o.id} opportunity={o} canManage={canManage} />)
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
