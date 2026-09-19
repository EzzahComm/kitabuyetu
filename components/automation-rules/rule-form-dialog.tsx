'use client';

import * as React from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { RecipientSpecEditor, DEFAULT_RECIPIENT_SPEC, toRecipientSpec, type RecipientSpecValue } from './recipient-spec-editor';
import { ConditionEditor, DEFAULT_CONDITION, toConditions, type ConditionValue } from './condition-editor';
import { useCreateAutomationRule, useSmsTemplates } from '@/hooks/use-automation-rules';
import { useEmailTemplates } from '@/hooks/use-email';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';
import { SMS_EVENTS } from '@/lib/sms/events';
import type { AutomationChannel } from '@/lib/services/automation-rules.service';

function humanize(key: string): string {
  return key.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

const EVENT_OPTIONS = Object.entries(SMS_EVENTS).map(([key, value]) => ({ value, label: humanize(key) }));

interface Props {
  trigger?: React.ReactNode;
}

export function RuleFormDialog({ trigger }: Props) {
  const { toast } = useToast();
  const createRule = useCreateAutomationRule();
  const { data: smsTemplates } = useSmsTemplates();
  const { data: emailTemplates } = useEmailTemplates();

  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<AutomationChannel>('sms');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [eventType, setEventType] = useState('');
  const [templateKey, setTemplateKey] = useState('');
  const [delaySeconds, setDelaySeconds] = useState('0');
  const [maxRetries, setMaxRetries] = useState('3');
  const [recipient, setRecipient] = useState<RecipientSpecValue>(DEFAULT_RECIPIENT_SPEC);
  const [condition, setCondition] = useState<ConditionValue>(DEFAULT_CONDITION);

  const templates = channel === 'sms' ? (smsTemplates ?? []) : (emailTemplates ?? []);
  const activeTemplates = templates.filter((t) => t.is_active);

  const reset = () => {
    setChannel('sms'); setName(''); setDescription(''); setEventType(''); setTemplateKey('');
    setDelaySeconds('0'); setMaxRetries('3'); setRecipient(DEFAULT_RECIPIENT_SPEC); setCondition(DEFAULT_CONDITION);
  };

  const valid = name.trim() && eventType && templateKey
    && (recipient.type !== 'roles' || recipient.roles.length > 0)
    && (recipient.type !== 'event_member' && recipient.type !== 'event_phone' || recipient.field.trim());

  const onSubmit = async () => {
    try {
      await createRule.mutateAsync({
        channel,
        name: name.trim(),
        description: description.trim() || undefined,
        event_type: eventType,
        template_key: templateKey,
        recipient_spec: toRecipientSpec(recipient),
        conditions: toConditions(condition),
        delay_seconds: Number(delaySeconds) || 0,
        max_retries: Number(maxRetries) || 0,
      });
      toast({ title: 'Automation rule created' });
      reset();
      setOpen(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        {trigger ?? <Button>New rule</Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>New automation rule</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="r_channel">Channel *</Label>
            <Select value={channel} onValueChange={(v) => { setChannel(v as AutomationChannel); setTemplateKey(''); }}>
              <SelectTrigger id="r_channel"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="email">Email</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="r_name">Name *</Label>
            <Input id="r_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Loan approval notice" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="r_description">Description</Label>
            <Textarea id="r_description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this rule for?" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="r_event">When this happens *</Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger id="r_event"><SelectValue placeholder="Select an event" /></SelectTrigger>
              <SelectContent>
                {EVENT_OPTIONS.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <ConditionEditor value={condition} onChange={setCondition} />

          <div className="space-y-1.5">
            <Label htmlFor="r_template">Send this template *</Label>
            <Select value={templateKey} onValueChange={setTemplateKey}>
              <SelectTrigger id="r_template"><SelectValue placeholder={activeTemplates.length ? 'Select a template' : `No active ${channel} templates yet`} /></SelectTrigger>
              <SelectContent>
                {activeTemplates.map((t) => <SelectItem key={t.template_key} value={t.template_key}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <RecipientSpecEditor channel={channel} value={recipient} onChange={setRecipient} />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="r_delay">Delay (seconds)</Label>
              <Input id="r_delay" type="number" min={0} max={2592000} value={delaySeconds} onChange={(e) => setDelaySeconds(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r_retries">Max retries</Label>
              <Input id="r_retries" type="number" min={0} max={10} value={maxRetries} onChange={(e) => setMaxRetries(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onSubmit} disabled={!valid || createRule.isPending}>
            {createRule.isPending ? 'Creating…' : 'Create rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
