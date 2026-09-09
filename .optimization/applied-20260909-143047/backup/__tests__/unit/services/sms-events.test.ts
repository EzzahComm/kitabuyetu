import { parseRecipientSpec, isSmsEventType, SMS_EVENTS } from '@/lib/sms/events';

describe('parseRecipientSpec', () => {
  it('accepts event-sourced phone and member specs', () => {
    expect(parseRecipientSpec({ type: 'event_phone', field: 'phone' }))
      .toEqual({ type: 'event_phone', field: 'phone' });
    expect(parseRecipientSpec({ type: 'event_member', field: 'member_id' }))
      .toEqual({ type: 'event_member', field: 'member_id' });
  });

  it('rejects an event spec with a missing or empty field', () => {
    expect(parseRecipientSpec({ type: 'event_phone' })).toBeNull();
    expect(parseRecipientSpec({ type: 'event_phone', field: '' })).toBeNull();
  });

  it('accepts roles that exist in the member_role enum', () => {
    expect(parseRecipientSpec({ type: 'roles', roles: ['treasurer', 'chairperson'] }))
      .toEqual({ type: 'roles', roles: ['treasurer', 'chairperson'] });
  });

  it('rejects "group_admin" — renamed to chairperson in migration 050', () => {
    // Guards the enum cast in resolveSmsRecipients: a role no longer in
    // member_role would reach Postgres as `$2::member_role[]` and throw
    // mid-dispatch. Rules written before the rename must fail as config errors.
    expect(parseRecipientSpec({ type: 'roles', roles: ['group_admin'] })).toBeNull();
  });

  it('rejects the whole spec when any role is unknown, rather than narrowing the audience', () => {
    expect(parseRecipientSpec({ type: 'roles', roles: ['treasurer', 'bogus'] })).toBeNull();
    expect(parseRecipientSpec({ type: 'roles', roles: [] })).toBeNull();
  });

  it('accepts membership specs and rejects unknown types', () => {
    expect(parseRecipientSpec({ type: 'all_members' })).toEqual({ type: 'all_members' });
    expect(parseRecipientSpec({ type: 'active_members' })).toEqual({ type: 'active_members' });
    expect(parseRecipientSpec({ type: 'everyone' })).toBeNull();
    expect(parseRecipientSpec(null)).toBeNull();
    expect(parseRecipientSpec('roles')).toBeNull();
  });
});

describe('isSmsEventType', () => {
  it('recognises catalogued events and rejects others', () => {
    expect(isSmsEventType(SMS_EVENTS.PAYMENT_RECEIVED)).toBe(true);
    expect(isSmsEventType('payment.received')).toBe(true);
    expect(isSmsEventType('payment.exploded')).toBe(false);
  });
});
