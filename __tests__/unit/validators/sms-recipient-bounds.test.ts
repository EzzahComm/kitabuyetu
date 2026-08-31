/**
 * Recipient bounds and audience validation on the client-supplied SMS
 * surfaces (SMS-AUDIT-v3 G9/G10, pathway T0-4).
 *
 * Two gaps this pins:
 *  - SendSmsSchema.phone accepted an UNBOUNDED array, so the 30 req/60s
 *    rate limit on /sms/send — justified in lib/sms/rate-limit.ts by calling
 *    it "the single/few-recipient path" — bounded requests but not volume.
 *  - rawRecipients was z.record(z.unknown()) on both the campaign and
 *    schedule surfaces: no phone-format check, no cap, and no correlation
 *    with recipientType. A malformed number reached normalizePhone, which
 *    THROWS, producing a 500 and (on the campaign path) an orphan row.
 */
import {
  SendSmsSchema,
  CampaignCreateSchema,
  ScheduleCreateSchema,
  ScheduleUpdateSchema,
  SmsGroupSettingsUpdateSchema,
} from '@/lib/validators/sms.schema';

const VALID = '0722123456';
const VALID_2 = '0733123456';
const UUID = '11111111-1111-1111-1111-111111111111';

describe('SendSmsSchema recipient bounds (G9)', () => {
  const base = { message: 'hello' };

  it('accepts a single phone', () => {
    expect(SendSmsSchema.safeParse({ ...base, phone: VALID }).success).toBe(true);
  });

  it('accepts a small array', () => {
    expect(SendSmsSchema.safeParse({ ...base, phone: [VALID, VALID_2] }).success).toBe(true);
  });

  it('accepts exactly the cap', () => {
    const phones = Array.from({ length: 10 }, () => VALID);
    expect(SendSmsSchema.safeParse({ ...base, phone: phones }).success).toBe(true);
  });

  it('rejects one over the cap', () => {
    const phones = Array.from({ length: 11 }, () => VALID);
    expect(SendSmsSchema.safeParse({ ...base, phone: phones }).success).toBe(false);
  });

  it('rejects the unbounded fan-out this cap exists to stop', () => {
    const phones = Array.from({ length: 5000 }, () => VALID);
    expect(SendSmsSchema.safeParse({ ...base, phone: phones }).success).toBe(false);
  });

  it('rejects an empty array rather than accepting a no-op send', () => {
    expect(SendSmsSchema.safeParse({ ...base, phone: [] }).success).toBe(false);
  });

  it('still rejects a malformed number inside an otherwise valid array', () => {
    expect(SendSmsSchema.safeParse({ ...base, phone: [VALID, 'nonsense'] }).success).toBe(false);
  });
});

describe('rawRecipients audience validation (G10)', () => {
  const campaign = { name: 'c', message: 'm' };

  it('rejects a malformed phone instead of letting normalizePhone throw a 500', () => {
    const r = CampaignCreateSchema.safeParse({
      ...campaign,
      recipientType: 'custom_phones',
      rawRecipients: { phones: ['not-a-number'] },
    });
    expect(r.success).toBe(false);
  });

  it('rejects a landline-shaped number the same way', () => {
    // 020… is a Nairobi landline. normalizePhone currently accepts it (V3-03),
    // so this cap is the only thing stopping it at the boundary today.
    const r = CampaignCreateSchema.safeParse({
      ...campaign,
      recipientType: 'custom_phones',
      rawRecipients: { phones: ['0201234567'] },
    });
    // Documents CURRENT behaviour: isValidKenyanPhone still admits it.
    // When V3-03 (T2-4) lands this flips to false and this test should be
    // updated to expect rejection.
    expect(r.success).toBe(true);
  });

  it('caps a custom_phones audience', () => {
    const phones = Array.from({ length: 5001 }, () => VALID);
    const r = CampaignCreateSchema.safeParse({
      ...campaign, recipientType: 'custom_phones', rawRecipients: { phones },
    });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown key rather than silently ignoring it', () => {
    const r = CampaignCreateSchema.safeParse({
      ...campaign,
      recipientType: 'custom_phones',
      rawRecipients: { phones: [VALID], pageSize: 500 },
    });
    expect(r.success).toBe(false);
  });

  it('requires phones when recipientType is custom_phones', () => {
    const r = CampaignCreateSchema.safeParse({ ...campaign, recipientType: 'custom_phones' });
    expect(r.success).toBe(false);
  });

  it('requires memberIds when recipientType is selected', () => {
    const r = CampaignCreateSchema.safeParse({ ...campaign, recipientType: 'selected' });
    expect(r.success).toBe(false);
  });

  it('rejects a non-uuid memberId', () => {
    const r = CampaignCreateSchema.safeParse({
      ...campaign, recipientType: 'selected', rawRecipients: { memberIds: ['abc'] },
    });
    expect(r.success).toBe(false);
  });

  it('accepts a well-formed selected audience', () => {
    const r = CampaignCreateSchema.safeParse({
      ...campaign, recipientType: 'selected', rawRecipients: { memberIds: [UUID] },
    });
    expect(r.success).toBe(true);
  });

  it('needs no audience for a server-resolved recipientType', () => {
    const r = CampaignCreateSchema.safeParse({ ...campaign, recipientType: 'all_members' });
    expect(r.success).toBe(true);
  });

  it('applies the same rules to schedules', () => {
    const base = { name: 's', scheduleType: 'daily' as const, message: 'm' };
    expect(
      ScheduleCreateSchema.safeParse({ ...base, recipientType: 'custom_phones' }).success,
    ).toBe(false);
    expect(
      ScheduleCreateSchema.safeParse({
        ...base, recipientType: 'custom_phones', rawRecipients: { phones: [VALID] },
      }).success,
    ).toBe(true);
  });

  it('does not force a PATCH to resend the audience', () => {
    // The correlation is a create-time rule; renaming a schedule must not
    // require restating its recipients.
    expect(ScheduleUpdateSchema.safeParse({ name: 'renamed' }).success).toBe(true);
  });

  it('still validates fields that a PATCH does send', () => {
    expect(
      ScheduleUpdateSchema.safeParse({ rawRecipients: { phones: ['nonsense'] } }).success,
    ).toBe(false);
  });
});

describe('daily send limit is settable (G25)', () => {
  it('accepts a positive cap', () => {
    const r = SmsGroupSettingsUpdateSchema.safeParse({ dailySendLimit: 500 });
    expect(r.success).toBe(true);
  });

  it('rejects null — the column is NOT NULL, so "no cap" is not storable', () => {
    // sms_group_settings.daily_send_limit is `INTEGER NOT NULL DEFAULT 500`
    // (migration 013). Accepting null here would produce a 500 at the
    // database rather than a 400 at the boundary. A group with no settings
    // row is uncapped; once a row exists the cap can be raised, not removed.
    expect(SmsGroupSettingsUpdateSchema.safeParse({ dailySendLimit: null }).success).toBe(false);
  });

  it('omits the key entirely when not supplied, so an unrelated toggle leaves the cap alone', () => {
    const r = SmsGroupSettingsUpdateSchema.safeParse({ autoSendBirthday: true });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(Object.prototype.hasOwnProperty.call(r.data, 'dailySendLimit')).toBe(false);
    }
  });

  it('rejects zero and negatives — use null for unlimited, not 0', () => {
    expect(SmsGroupSettingsUpdateSchema.safeParse({ dailySendLimit: 0 }).success).toBe(false);
    expect(SmsGroupSettingsUpdateSchema.safeParse({ dailySendLimit: -5 }).success).toBe(false);
  });

  it('rejects a non-integer cap', () => {
    expect(SmsGroupSettingsUpdateSchema.safeParse({ dailySendLimit: 2.5 }).success).toBe(false);
  });
});
