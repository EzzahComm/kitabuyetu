'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import { RuleFormDialog } from '@/components/automation-rules/rule-form-dialog';
import { RuleCard } from '@/components/automation-rules/rule-card';
import { useAutomationRules } from '@/hooks/use-automation-rules';
import { useHasPermission } from '@/lib/auth/use-permission';
import type { AutomationChannel } from '@/lib/services/automation-rules.service';

function RulesList({ channel }: { channel?: AutomationChannel }) {
  const { data: rules, isLoading } = useAutomationRules(channel);
  const canManage = useHasPermission('crm.manage');

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (!rules || rules.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          No automation rules yet. Create one to send an SMS or email automatically when something happens —
          a contribution lands, a loan is approved, a meeting is scheduled.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {rules.map((rule) => <RuleCard key={`${rule.channel}-${rule.id}`} rule={rule} canManage={canManage} />)}
    </div>
  );
}

export default function AutomationRulesPage() {
  const canManage = useHasPermission('crm.manage');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automation"
        description="WHEN something happens, automatically THEN send an SMS or email — contribution receipts, loan updates, meeting reminders, and more, without an officer sending them by hand."
        actions={canManage ? <RuleFormDialog /> : undefined}
      />

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All rules</TabsTrigger>
          <TabsTrigger value="sms">SMS</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
        </TabsList>
        <TabsContent value="all"><RulesList /></TabsContent>
        <TabsContent value="sms"><RulesList channel="sms" /></TabsContent>
        <TabsContent value="email"><RulesList channel="email" /></TabsContent>
      </Tabs>
    </div>
  );
}
