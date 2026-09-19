'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useUpdateOpportunity } from '@/hooks/use-crm';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage, formatDate } from '@/lib/utils';
import type { OpportunityStage, OpportunityWithContact } from '@/lib/services/crm.service';

const STAGES: { value: OpportunityStage; label: string }[] = [
  { value: 'draft',     label: 'Draft' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'proposal',  label: 'Proposal' },
  { value: 'won',       label: 'Won' },
  { value: 'lost',      label: 'Lost' },
];

interface Props {
  opportunity: OpportunityWithContact;
  canManage: boolean;
}

export function OpportunityCard({ opportunity, canManage }: Props) {
  const { toast } = useToast();
  const updateOpportunity = useUpdateOpportunity();

  const onMove = async (stage: OpportunityStage) => {
    if (stage === opportunity.stage) return;
    try {
      await updateOpportunity.mutateAsync({ id: opportunity.id, data: { stage } });
      toast({ title: `Moved to ${stage}` });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <p className="text-sm font-medium leading-snug">{opportunity.title}</p>
        <Link href={`/crm/${opportunity.contact_id}`} className="block truncate text-xs text-muted-foreground hover:text-foreground hover:underline">
          {opportunity.contact_name}
        </Link>
        {opportunity.amount != null && (
          <p className="text-sm font-semibold">KES {Number(opportunity.amount).toLocaleString()}</p>
        )}
        <p className="text-xs text-muted-foreground">Updated {formatDate(opportunity.updated_at)}</p>
        {canManage && (
          <Select value={opportunity.stage} onValueChange={(v) => onMove(v as OpportunityStage)} disabled={updateOpportunity.isPending}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STAGES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </CardContent>
    </Card>
  );
}
