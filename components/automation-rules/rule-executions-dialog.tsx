'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { useRuleExecutions } from '@/hooks/use-automation-rules';
import { formatDateTime } from '@/lib/utils';
import type { AutomationChannel, AutomationRuleExecution } from '@/lib/services/automation-rules.service';
import { useState } from 'react';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  pending: 'secondary',
  sent: 'default',
  failed: 'destructive',
  suppressed: 'outline',
};

interface Props {
  channel: AutomationChannel;
  ruleId: string;
  ruleName: string;
}

export function RuleExecutionsDialog({ channel, ruleId, ruleName }: Props) {
  const [open, setOpen] = useState(false);
  const { data: executions, isLoading } = useRuleExecutions(channel, ruleId, open);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">Activity</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Recent activity — {ruleName}</DialogTitle></DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !executions || executions.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            This rule hasn&rsquo;t fired yet. It will show up here the next time its event happens.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Recipients</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {executions.map((e: AutomationRuleExecution) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-sm">{formatDateTime(e.created_at)}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[e.status] ?? 'outline'}>{e.status}</Badge></TableCell>
                  <TableCell>{e.recipients}</TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-muted-foreground">{e.reason ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
