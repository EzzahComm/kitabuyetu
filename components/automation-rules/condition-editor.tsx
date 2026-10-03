'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

/**
 * Authors a single {field, op, value} leaf — the subset of the condition DSL
 * (lib/sms/conditions.ts) automation-rules.service.ts accepts for authoring.
 * `in`/`nin` are left out: they take an array value, which needs a list
 * input this first UI pass doesn't build. No condition at all (the default)
 * stores `{}`, which evaluateCondition() treats as "always matches".
 */
const OPS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'does not equal' },
  { value: 'gt', label: 'is greater than' },
  { value: 'gte', label: 'is at least' },
  { value: 'lt', label: 'is less than' },
  { value: 'lte', label: 'is at most' },
  { value: 'contains', label: 'contains' },
  { value: 'exists', label: 'is present' },
] as const;

export interface ConditionValue {
  enabled: boolean;
  field: string;
  op: string;
  value: string;
}

export const DEFAULT_CONDITION: ConditionValue = { enabled: false, field: '', op: 'eq', value: '' };

export function toConditions(value: ConditionValue): unknown {
  if (!value.enabled || !value.field.trim()) return {};
  if (value.op === 'exists') return { field: value.field.trim(), op: 'exists' };
  return { field: value.field.trim(), op: value.op, value: value.value };
}

export function fromConditions(raw: unknown): ConditionValue {
  if (raw && typeof raw === 'object') {
    const c = raw as Record<string, unknown>;
    if (typeof c.field === 'string' && typeof c.op === 'string') {
      return { enabled: true, field: c.field, op: c.op, value: c.value === undefined ? '' : String(c.value) };
    }
  }
  return DEFAULT_CONDITION;
}

interface Props {
  value: ConditionValue;
  onChange: (value: ConditionValue) => void;
}

export function ConditionEditor({ value, onChange }: Props) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label htmlFor="condition_enabled">Only fire when a condition matches</Label>
        <Switch
          id="condition_enabled"
          checked={value.enabled}
          onCheckedChange={(enabled) => onChange({ ...value, enabled })}
        />
      </div>
      {!value.enabled ? (
        <p className="text-xs text-muted-foreground">Off — this rule fires on every {'{event}'}, no extra check.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Input
            placeholder="Payload field, e.g. amount"
            value={value.field}
            onChange={(e) => onChange({ ...value, field: e.target.value })}
          />
          <Select value={value.op} onValueChange={(op) => onChange({ ...value, op })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {value.op !== 'exists' && (
            <Input
              placeholder="Value, e.g. 1000"
              value={value.value}
              onChange={(e) => onChange({ ...value, value: e.target.value })}
            />
          )}
        </div>
      )}
    </div>
  );
}
