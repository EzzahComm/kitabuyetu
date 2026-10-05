/**
 * The monthly contribution/welfare statement SMS (lib/sms/contribution-statement.ts).
 *
 * Two properties are worth pinning:
 *  1. The message tells the member what they owe AND exactly where to pay it: the
 *     plain membership number for contributions, the `-W` suffix for welfare.
 *  2. It stays inside the GSM-7 alphabet. One stray character (an em dash was
 *     enough, in an earlier draft) switches the message to UCS-2 and multiplies
 *     what every reminder costs.
 */
import { buildStatementMessage, type ContributionStatementRow } from '@/lib/sms/contribution-statement';

const PAYBILL = '500020109900';

function row(overrides: Partial<ContributionStatementRow> = {}): ContributionStatementRow {
  return {
    membership_id: 'm-1',
    group_id: 'g-1',
    member_id: 'u-1',
    phone: '254700000001',
    first_name: 'Amina',
    membership_no: 'BG102534',
    group_name: 'Umoja Chama',
    outstanding_contribution: '0',
    contribution_months: 0,
    outstanding_welfare: '0',
    welfare_months: 0,
    total_contributed: '0',
    total_welfare_contributed: '0',
    group_balance: '0',
    ...overrides,
  };
}

// Printable ASCII is a strict subset of GSM-7, which is all this test needs to prove.
const isAscii = (s: string) => /^[\x20-\x7E]*$/.test(s);

describe('buildStatementMessage', () => {
  it('contribution arrears only: amount, months, paid-to-date, and the plain membership number', () => {
    const msg = buildStatementMessage(
      row({
        outstanding_contribution: '1500.00',
        contribution_months: 3,
        total_contributed: '4500',
        group_balance: '82000',
      }),
      PAYBILL,
    );
    expect(msg).toBe(
      'Dear Amina, Umoja Chama balance update: Contribution arrears KES 1,500 (3 mo, KES 4,500 paid to date). ' +
        'Pay via M-Pesa Paybill 500020109900, Acc BG102534. Group balance KES 82,000.',
    );
  });

  it('welfare arrears only: the welfare account carries the -W suffix', () => {
    const msg = buildStatementMessage(
      row({
        outstanding_welfare: '600',
        welfare_months: 3,
        total_welfare_contributed: '1200',
        group_balance: '82000',
      }),
      PAYBILL,
    );
    expect(msg).toBe(
      'Dear Amina, Umoja Chama balance update: Welfare arrears KES 600 (3 mo, KES 1,200 paid to date). ' +
        'Pay via M-Pesa Paybill 500020109900, Acc BG102534-W. Group balance KES 82,000.',
    );
  });

  it('both: lists each obligation and names which account pays which, with the paybill only once', () => {
    const msg = buildStatementMessage(
      row({
        outstanding_contribution: '34220.00',
        contribution_months: 4,
        total_contributed: '15000',
        outstanding_welfare: '800',
        welfare_months: 4,
        total_welfare_contributed: '3200',
      }),
      PAYBILL,
    );
    expect(msg).toContain('Contribution arrears KES 34,220 (4 mo, KES 15,000 paid to date).');
    expect(msg).toContain('Welfare arrears KES 800 (4 mo, KES 3,200 paid to date).');
    expect(msg).toContain('Acc BG102534 (contribution) or BG102534-W (welfare).');
    expect(msg.match(/Paybill/g)).toHaveLength(1);
  });

  it('does not mention an obligation that is not owed', () => {
    const contributionOnly = buildStatementMessage(
      row({ outstanding_contribution: '500', contribution_months: 1 }),
      PAYBILL,
    );
    expect(contributionOnly).not.toMatch(/welfare/i);
    const welfareOnly = buildStatementMessage(row({ outstanding_welfare: '200', welfare_months: 1 }), PAYBILL);
    expect(welfareOnly).not.toMatch(/contribution/i);
  });

  it('keeps fractional amounts to two decimals, in both arrears and paid-to-date', () => {
    const msg = buildStatementMessage(
      row({ outstanding_contribution: '1234.5', contribution_months: 1, total_contributed: '999.25' }),
      PAYBILL,
    );
    expect(msg).toContain('KES 1,234.5 (1 mo, KES 999.25 paid to date)');
  });

  it('still tells the member where to pay when the membership number is missing', () => {
    const msg = buildStatementMessage(
      row({ membership_no: null, outstanding_contribution: '500', contribution_months: 1, group_balance: '-300' }),
      PAYBILL,
    );
    expect(msg).toMatch(/Pay via M-Pesa Paybill 500020109900\. Group balance KES -300\.$/);
    expect(msg).not.toMatch(/Acc/);
  });

  it('is plain ASCII in every shape, so it stays a GSM-7 message', () => {
    const shapes = [
      row({ outstanding_contribution: '1500.00', contribution_months: 3 }),
      row({ outstanding_welfare: '600', welfare_months: 3 }),
      row({
        outstanding_contribution: '34220.00',
        contribution_months: 4,
        outstanding_welfare: '800',
        welfare_months: 4,
      }),
      row({ membership_no: null, outstanding_contribution: '500', contribution_months: 1 }),
    ];
    for (const shape of shapes) expect(isAscii(buildStatementMessage(shape, PAYBILL))).toBe(true);
  });

  it('a typical two-obligation message fits in two SMS segments', () => {
    const msg = buildStatementMessage(
      row({
        group_name: 'Ndengelwa Community Water Project',
        outstanding_contribution: '34220.00',
        contribution_months: 4,
        total_contributed: '128500',
        outstanding_welfare: '800',
        welfare_months: 4,
        total_welfare_contributed: '9600',
        group_balance: '245000',
      }),
      PAYBILL,
    );
    // 160 chars for one single-part GSM-7 SMS; 153 per segment once concatenated.
    expect(msg.length).toBeLessThanOrEqual(306);
  });
});
