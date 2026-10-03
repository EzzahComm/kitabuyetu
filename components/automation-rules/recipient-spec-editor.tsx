'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { TARGETABLE_ROLES } from '@/lib/sms/events';

export type RecipientType = 'all_members' | 'active_members' | 'roles' | 'event_member' | 'event_phone';

export interface RecipientSpecValue {
  type: RecipientType;
  roles: string[];
  field: string;
}

export const DEFAULT_RECIPIENT_SPEC: RecipientSpecValue = { type: 'active_members', roles: [], field: '' };

const TYPE_LABELS: Record<RecipientType, string> = {
  all_members: 'All members',
  active_members: 'Active members only',
  roles: 'Specific officer roles',
  event_member: 'The member named on the event (e.g. the borrower)',
  event_phone: 'The phone number carried on the event (e.g. the M-Pesa payer)',
};

/** Turn the form's local state into the JSONB shape sms_trigger_rules / email_trigger_rules expect. */
export function toRecipientSpec(value: RecipientSpecValue): unknown {
  switch (value.type) {
    case 'roles':
      return { type: 'roles', roles: value.roles };
    case 'event_member':
    case 'event_phone':
      return { type: value.type, field: value.field.trim() };
    default:
      return { type: value.type };
  }
}

/** Reverse of toRecipientSpec — used to seed the editor from an existing rule. */
export function fromRecipientSpec(raw: unknown): RecipientSpecValue {
  if (raw && typeof raw === 'object') {
    const spec = raw as Record<string, unknown>;
    if (spec.type === 'roles' && Array.isArray(spec.roles)) {
      return { type: 'roles', roles: spec.roles.filter((r): r is string => typeof r === 'string'), field: '' };
    }
    if ((spec.type === 'event_member' || spec.type === 'event_phone') && typeof spec.field === 'string') {
      return { type: spec.type, roles: [], field: spec.field };
    }
    if (spec.type === 'all_members' || spec.type === 'active_members') {
      return { type: spec.type, roles: [], field: '' };
    }
  }
  return DEFAULT_RECIPIENT_SPEC;
}

interface Props {
  channel: 'sms' | 'email';
  value: RecipientSpecValue;
  onChange: (value: RecipientSpecValue) => void;
}

export function RecipientSpecEditor({ channel, value, onChange }: Props) {
  const types: RecipientType[] =
    channel === 'sms'
      ? ['active_members', 'all_members', 'roles', 'event_member', 'event_phone']
      : ['active_members', 'all_members', 'roles', 'event_member'];

  return (
    <div className="space-y-2">
      <Label htmlFor="recipient_type">Who receives it *</Label>
      <Select value={value.type} onValueChange={(v) => onChange({ ...value, type: v as RecipientType })}>
        <SelectTrigger id="recipient_type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {types.map((t) => (
            <SelectItem key={t} value={t}>
              {TYPE_LABELS[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {value.type === 'roles' && (
        <div className="flex flex-wrap gap-2 pt-1">
          {TARGETABLE_ROLES.map((role) => {
            const active = value.roles.includes(role);
            return (
              <Button
                key={role}
                type="button"
                size="sm"
                variant={active ? 'default' : 'outline'}
                onClick={() =>
                  onChange({
                    ...value,
                    roles: active ? value.roles.filter((r) => r !== role) : [...value.roles, role],
                  })
                }
              >
                {role}
              </Button>
            );
          })}
        </div>
      )}

      {(value.type === 'event_member' || value.type === 'event_phone') && (
        <Input
          placeholder={
            value.type === 'event_member'
              ? 'Payload field holding the member id, e.g. memberId'
              : 'Payload field holding the phone, e.g. phone'
          }
          value={value.field}
          onChange={(e) => onChange({ ...value, field: e.target.value })}
        />
      )}
    </div>
  );
}
