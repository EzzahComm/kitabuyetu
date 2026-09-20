'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { GROUP_TYPES, GROUP_TYPE_LABELS } from '@/types/enums';
import type { EligibilityRule } from '@/lib/services/ecosystem.service';

/**
 * Authors eligibility_rules for an opportunity. `field` is never a free-text
 * input — it's implied by the rule `type`, since GroupEligibilityData
 * (ecosystem.service.ts) only ever exposes four attributes (created_at,
 * type, cash_balance, county), one per rule type. A free-text field name
 * would let an admin author a rule against a property that doesn't exist,
 * which evaluateRule() would just silently fail (caught, logged, counted as
 * a failed rule) — this editor makes that class of mistake structurally
 * impossible instead of catching it after the fact.
 */

const RULE_TYPES: { value: EligibilityRule['type']; label: string; field: string }[] = [
  { value: 'range', label: 'Group founded (by date)', field: 'created_at' },
  { value: 'enum_whitelist', label: 'Group type', field: 'type' },
  { value: 'geo', label: 'County', field: 'county' },
  { value: 'financial', label: 'Group balance (contributions + shares − loans)', field: 'cash_balance' },
  { value: 'external_check', label: 'External check (not yet available — always passes)', field: '' },
];

function newRule(type: EligibilityRule['type']): EligibilityRule {
  const meta = RULE_TYPES.find((t) => t.value === type)!;
  const base = { id: crypto.randomUUID(), name: meta.label, type, field: meta.field, error_message: '' };
  switch (type) {
    case 'range': return { ...base, operator: 'before_or_equal', value: '' };
    case 'enum_whitelist': return { ...base, values: [] };
    case 'geo': return { ...base, values: [] };
    case 'financial': return { ...base, operator: '>=', value: 0 };
    default: return { ...base, function: '' };
  }
}

interface Props {
  value: EligibilityRule[];
  onChange: (rules: EligibilityRule[]) => void;
}

export function EligibilityRulesEditor({ value, onChange }: Props) {
  const updateRule = (id: string, patch: Partial<EligibilityRule>) => {
    onChange(value.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const removeRule = (id: string) => onChange(value.filter((r) => r.id !== id));

  return (
    <div className="space-y-3">
      <Label>Eligibility rules (optional)</Label>
      <p className="text-xs text-muted-foreground">
        A group that doesn&rsquo;t meet these can still apply — this is shown to them as guidance, not a hard block.
      </p>

      {value.map((rule) => (
        <Card key={rule.id}>
          <CardContent className="space-y-2 p-3">
            <div className="flex items-start gap-2">
              <Select
                value={rule.type}
                onValueChange={(t) => updateRule(rule.id, newRule(t as EligibilityRule['type']))}
              >
                <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button type="button" variant="ghost" size="sm" onClick={() => removeRule(rule.id)}>Remove</Button>
            </div>

            {rule.type === 'range' && (
              <div className="grid grid-cols-2 gap-2">
                <Select value={rule.operator} onValueChange={(v) => updateRule(rule.id, { operator: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="before_or_equal">Founded on or before</SelectItem>
                    <SelectItem value="after">Founded after</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="date" value={rule.value ?? ''} onChange={(e) => updateRule(rule.id, { value: e.target.value })} />
              </div>
            )}

            {rule.type === 'enum_whitelist' && (
              <div className="flex flex-wrap gap-2">
                {GROUP_TYPES.map((gt) => {
                  const active = (rule.values ?? []).includes(gt);
                  return (
                    <Button
                      key={gt}
                      type="button"
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      onClick={() => updateRule(rule.id, {
                        values: active ? (rule.values ?? []).filter((v) => v !== gt) : [...(rule.values ?? []), gt],
                      })}
                    >
                      {GROUP_TYPE_LABELS[gt]}
                    </Button>
                  );
                })}
              </div>
            )}

            {rule.type === 'geo' && (
              <Input
                placeholder="Counties, comma-separated — e.g. Nairobi, Kiambu, Machakos"
                value={(rule.values ?? []).join(', ')}
                onChange={(e) => updateRule(rule.id, { values: e.target.value.split(',').map((v: string) => v.trim()).filter(Boolean) })}
              />
            )}

            {rule.type === 'financial' && (
              <div className="grid grid-cols-2 gap-2">
                <Select value={rule.operator} onValueChange={(v) => updateRule(rule.id, { operator: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value=">=">At least (≥)</SelectItem>
                    <SelectItem value=">">More than (&gt;)</SelectItem>
                    <SelectItem value="<=">At most (≤)</SelectItem>
                    <SelectItem value="<">Less than (&lt;)</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="number" placeholder="KES" value={rule.value ?? ''} onChange={(e) => updateRule(rule.id, { value: Number(e.target.value) })} />
              </div>
            )}

            <Input
              placeholder="Message shown to the group if they don't meet this rule"
              value={rule.error_message}
              onChange={(e) => updateRule(rule.id, { error_message: e.target.value })}
            />
          </CardContent>
        </Card>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, newRule('financial')])}>
        Add rule
      </Button>
    </div>
  );
}
