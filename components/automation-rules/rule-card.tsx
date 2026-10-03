'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { RuleEditDialog } from './rule-edit-dialog';
import { RuleExecutionsDialog } from './rule-executions-dialog';
import { useUpdateAutomationRule } from '@/hooks/use-automation-rules';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';
import { useAuth, isTenantUser } from '@/lib/auth/context';
import type { AutomationRule } from '@/lib/services/automation-rules.service';

function humanizeEvent(eventType: string): string {
  return eventType.replace(/[._]/g, ' ');
}

function describeRecipient(spec: unknown): string {
  if (!spec || typeof spec !== 'object') return 'Unknown recipients';
  const s = spec as Record<string, unknown>;
  switch (s.type) {
    case 'all_members':
      return 'All members';
    case 'active_members':
      return 'Active members';
    case 'roles':
      return Array.isArray(s.roles) ? `Officers: ${(s.roles as string[]).join(', ')}` : 'Officers';
    case 'event_member':
      return 'The member on the event';
    case 'event_phone':
      return 'The phone number on the event';
    default:
      return 'Unknown recipients';
  }
}

interface Props {
  rule: AutomationRule;
  canManage: boolean;
}

export function RuleCard({ rule, canManage }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const updateRule = useUpdateAutomationRule();
  const [editOpen, setEditOpen] = useState(false);

  // This is the group portal (components/layout/sidebar.tsx): a rule is only
  // editable here when it belongs to THIS group. An organization-wide or
  // platform-default rule is inherited and shown read-only, matching the
  // ownership check automation-rules.service.ts enforces server-side —
  // otherwise Edit/pause controls would render for a rule a PATCH then 404s.
  const isOwnRule = isTenantUser(user) && rule.group_id === user.groupId;

  const onToggleActive = async (is_active: boolean) => {
    try {
      await updateRule.mutateAsync({ channel: rule.channel, id: rule.id, data: { is_active } });
      toast({ title: is_active ? 'Rule activated' : 'Rule paused' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{rule.name}</p>
            <Badge variant="outline">{rule.channel === 'sms' ? 'SMS' : 'Email'}</Badge>
            <Badge variant={rule.is_active ? 'default' : 'secondary'}>{rule.is_active ? 'Active' : 'Paused'}</Badge>
          </div>
          {rule.description && <p className="mt-1 text-sm text-muted-foreground">{rule.description}</p>}
          <p className="mt-2 text-xs text-muted-foreground">
            When <span className="font-medium text-foreground">{humanizeEvent(rule.event_type)}</span> happens, send{' '}
            <span className="font-medium text-foreground">{rule.template_key}</span> to{' '}
            <span className="font-medium text-foreground">{describeRecipient(rule.recipient_spec)}</span>.
          </p>
          {!rule.group_id && !rule.organization_id && (
            <p className="mt-1 text-xs text-muted-foreground">Platform default — inherited, not editable here.</p>
          )}
          {!rule.group_id && rule.organization_id && (
            <p className="mt-1 text-xs text-muted-foreground">Organization-wide rule.</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RuleExecutionsDialog channel={rule.channel} ruleId={rule.id} ruleName={rule.name} />
          {canManage && isOwnRule && (
            <>
              <Switch checked={rule.is_active} onCheckedChange={onToggleActive} disabled={updateRule.isPending} />
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                Edit
              </Button>
              <RuleEditDialog rule={rule} open={editOpen} onOpenChange={setEditOpen} />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
