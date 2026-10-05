/**
 * The weekly savings-update SMS (lib/sms/weekly-savings-update.ts).
 *
 * Two properties are worth pinning, mirroring contribution-statement.test.ts:
 *  1. It always states the member's own total and the group's total, and adds
 *     the outstanding/CTA line only when something is actually owed.
 *  2. It stays inside the GSM-7 alphabet.
 */
import { buildWeeklySavingsUpdateMessage, type WeeklySavingsUpdateRow } from '@/lib/sms/weekly-savings-update';

const PAYBILL = '500020109900';

function row(overrides: Partial<WeeklySavingsUpdateRow> = {}): WeeklySavingsUpdateRow {
  return {
    membership_id: 'm-1',
    group_id: 'g-1',
    member_id: 'u-1',
    phone: '254700000001',
    first_name: 'Amina',
    membership_no: 'BG102534',
    group_name: 'Umoja Chama',
    total_contributed: '24500',
    group_total_saved: '312000',
    outstanding: '0',
    ...overrides,
  };
}

const isAscii = (s: string) => /^[\x20-\x7E]*$/.test(s);

describe('buildWeeklySavingsUpdateMessage', () => {
  it('states the member total and the group total, with a CTA when something is outstanding', () => {
    const msg = buildWeeklySavingsUpdateMessage(row({ outstanding: '3200' }), PAYBILL);
    expect(msg).toBe(
      'Dear Amina, weekly update from Umoja Chama: Your total contribution to date is KES 24,500. ' +
        'Umoja Chama has saved KES 312,000 in total. You have KES 3,200 outstanding. ' +
        'Pay via M-Pesa Paybill 500020109900, Acc BG102534.',
    );
  });

  it('thanks a fully-paid-up member instead of showing a zero CTA', () => {
    const msg = buildWeeklySavingsUpdateMessage(row({ outstanding: '0' }), PAYBILL);
    expect(msg).toBe(
      'Dear Amina, weekly update from Umoja Chama: Your total contribution to date is KES 24,500. ' +
        "Umoja Chama has saved KES 312,000 in total. You're fully paid up - thank you!",
    );
    expect(msg).not.toMatch(/Paybill/);
  });

  it('still tells the member where to pay when the membership number is missing', () => {
    const msg = buildWeeklySavingsUpdateMessage(row({ outstanding: '500', membership_no: null }), PAYBILL);
    expect(msg).toMatch(/Pay via M-Pesa Paybill 500020109900\.$/);
    expect(msg).not.toMatch(/Acc/);
  });

  it('is plain ASCII in every shape, so it stays a GSM-7 message', () => {
    const shapes = [
      row({ outstanding: '3200' }),
      row({ outstanding: '0' }),
      row({ outstanding: '500', membership_no: null }),
      row({ total_contributed: '1234.5', group_total_saved: '99999.99', outstanding: '12.25' }),
    ];
    for (const shape of shapes) expect(isAscii(buildWeeklySavingsUpdateMessage(shape, PAYBILL))).toBe(true);
  });

  it('fits in two SMS segments for a realistic group name and amounts', () => {
    const msg = buildWeeklySavingsUpdateMessage(
      row({
        group_name: 'Ndengelwa Community Water Project',
        total_contributed: '128500',
        group_total_saved: '4582000',
        outstanding: '3200',
      }),
      PAYBILL,
    );
    // 160 chars for one single-part GSM-7 SMS; 153 per segment once concatenated.
    expect(msg.length).toBeLessThanOrEqual(306);
  });
});
