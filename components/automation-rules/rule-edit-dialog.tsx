'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { RecipientSpecEditor, fromRecipientSpec, toRecipientSpec } from './recipient-spec-editor';
import { ConditionEditor, fromConditions, toConditions } from './condition-editor';
import {
  useUpdateAutomationRule,
  useSmsTemplates,
  useFrequencyCaps,
  useUpsertFrequencyCap,
} from '@/hooks/use-automation-rules';
import { useEmailTemplates } from '@/hooks/use-email';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';
import type { AutomationRule, FrequencyCapCategory } from '@/lib/services/automation-rules.service';

const CAP_CATEGORIES: FrequencyCapCategory[] = ['transactional', 'marketing', 'promotional'];

interface Props {
  rule: AutomationRule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RuleEditDialog({ rule, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const updateRule = useUpdateAutomationRule();
  const { data: smsTemplates } = useSmsTemplates();
  const { data: emailTemplates } = useEmailTemplates();

  const [description, setDescription] = useState(rule.description ?? '');
  const [templateKey, setTemplateKey] = useState(rule.template_key);
  const [recipient, setRecipient] = useState(() => fromRecipientSpec(rule.recipient_spec));
  const [condition, setCondition] = useState(() => fromConditions(rule.conditions));
  const [delaySeconds, setDelaySeconds] = useState(String(rule.delay_seconds));
  const [maxRetries, setMaxRetries] = useState(String(rule.max_retries));

  const templates = rule.channel === 'sms' ? (smsTemplates ?? []) : (emailTemplates ?? []);
  const activeTemplates = templates.filter((t) => t.is_active || t.template_key === templateKey);

  const onSave = async () => {
    try {
      await updateRule.mutateAsync({
        channel: rule.channel,
        id: rule.id,
        data: {
          description: description.trim() || undefined,
          template_key: templateKey,
          recipient_spec: toRecipientSpec(recipient),
          conditions: toConditions(condition),
          delay_seconds: Number(delaySeconds) || 0,
          max_retries: Number(maxRetries) || 0,
        },
      });
      toast({ title: 'Rule updated' });
      onOpenChange(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const onToggleActive = async (is_active: boolean) => {
    try {
      await updateRule.mutateAsync({ channel: rule.channel, id: rule.id, data: { is_active } });
      toast({ title: is_active ? 'Rule activated' : 'Rule paused' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">{rule.is_active ? 'Active' : 'Paused'}</p>
              <p className="text-xs text-muted-foreground">
                {rule.channel === 'sms' ? 'SMS' : 'Email'} · fires on {rule.event_type}
              </p>
            </div>
            <Switch checked={rule.is_active} onCheckedChange={onToggleActive} disabled={updateRule.isPending} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="e_description">Description</Label>
            <Textarea
              id="e_description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <ConditionEditor value={condition} onChange={setCondition} />

          <div className="space-y-1.5">
            <Label htmlFor="e_template">Template</Label>
            <Select value={templateKey} onValueChange={setTemplateKey}>
              <SelectTrigger id="e_template">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {activeTemplates.map((t) => (
                  <SelectItem key={t.template_key} value={t.template_key}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <RecipientSpecEditor channel={rule.channel} value={recipient} onChange={setRecipient} />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="e_delay">Delay (seconds)</Label>
              <Input
                id="e_delay"
                type="number"
                min={0}
                max={2592000}
                value={delaySeconds}
                onChange={(e) => setDelaySeconds(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e_retries">Max retries</Label>
              <Input
                id="e_retries"
                type="number"
                min={0}
                max={10}
                value={maxRetries}
                onChange={(e) => setMaxRetries(e.target.value)}
              />
            </div>
          </div>

          {rule.channel === 'email' && <FrequencyCapSection ruleId={rule.id} open={open} />}
        </div>
        <DialogFooter>
          <Button onClick={onSave} disabled={!templateKey || updateRule.isPending}>
            {updateRule.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Daily send cap for an email rule — e.g. "at most 1 marketing email per recipient per day". */
function FrequencyCapSection({ ruleId, open }: { ruleId: string; open: boolean }) {
  const { toast } = useToast();
  const { data: caps } = useFrequencyCaps(ruleId, open);
  const upsertCap = useUpsertFrequencyCap();

  const [category, setCategory] = useState<FrequencyCapCategory>('transactional');
  const [maxPerDay, setMaxPerDay] = useState('1');

  const onSaveCap = async () => {
    try {
      await upsertCap.mutateAsync({ id: ruleId, category, max_per_day: Number(maxPerDay) || 1 });
      toast({ title: 'Frequency cap saved' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-2 rounded-md border p-3">
      <Label>Frequency cap (optional)</Label>
      <p className="text-xs text-muted-foreground">
        Limit how many emails one recipient can get from this rule per day, regardless of how many times it fires.
      </p>
      {!!caps?.length && (
        <ul className="space-y-1 text-xs">
          {caps.map((c) => (
            <li key={c.id} className="flex justify-between">
              <span className="capitalize">{c.category}</span>
              <span>
                {c.max_per_day} / day{!c.is_active && ' (off)'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Select value={category} onValueChange={(v) => setCategory(v as FrequencyCapCategory)}>
          <SelectTrigger className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CAP_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          min={1}
          max={9999}
          className="w-24"
          value={maxPerDay}
          onChange={(e) => setMaxPerDay(e.target.value)}
        />
        <Button type="button" variant="outline" size="sm" onClick={onSaveCap} disabled={upsertCap.isPending}>
          {upsertCap.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
