/**
 * Weekly / bi-weekly / quarterly repayment schedules (migration 149).
 *
 * Two invariants matter more than the arithmetic, and both are easy to break
 * with a plausible-looking edit to generate_loan_schedule:
 *
 *   1. EXISTING (monthly) LOANS MUST NOT MOVE. Migration 149 rewrote the whole
 *      function to thread frequency through it. Every loan in production is
 *      monthly, so any drift in the monthly arm silently repriced live debt.
 *
 *   2. CADENCE MUST NOT CHANGE THE PRICE. Repaying the same principal over the
 *      same term costs the same weekly or monthly; only the number and size of
 *      instalments differ. If this ever fails, someone made the flat branch
 *      depend on the instalment count instead of the term in months.
 *
 * Reminders are deliberately NOT tested here: handleLoanDueAlerts reads
 * loan_repayments.due_date and stages on day offsets alone, so it has no
 * concept of cadence to get wrong.
 */
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

type Freq = 'weekly' | 'biweekly' | 'monthly' | 'quarterly';

describe('loan repayment frequency', () => {
  let groupId: string, officerId: string, membershipId: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ groupId, officerId } = await createTestGroup('chairperson'));
    // rawQuery returns the rows array itself, not a pg QueryResult.
    const memberships = await rawQuery<{ id: string }>(
      `SELECT id FROM group_members WHERE group_id = $1 AND member_id = $2`,
      [groupId, officerId],
    );
    membershipId = memberships[0].id;
  });

  /** Creates a disbursed loan and generates its schedule. Returns the loan row
   *  plus its instalments. */
  async function makeLoan(opts: {
    principal: number; rate: number; termMonths: number;
    method: 'flat' | 'reducing_balance'; freq: Freq;
  }) {
    const [loan] = await rawQuery<{ id: string }>(
      `INSERT INTO loans
         (group_id, member_id, group_membership_id, principal_amount, interest_rate,
          loan_term_months, repayment_frequency, interest_method, status, disbursement_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'disbursed', DATE '2026-01-31')
       RETURNING id`,
      [groupId, officerId, membershipId, opts.principal.toFixed(2), opts.rate.toFixed(2),
       opts.termMonths, opts.freq, opts.method],
    );
    await rawQuery(`SELECT generate_loan_schedule($1)`, [loan.id]);

    const [totals] = await rawQuery<{ total_repayable: string }>(
      `SELECT total_repayable FROM loans WHERE id = $1`, [loan.id],
    );
    const installments = await rawQuery<{
      installment_number: number; due_date: Date; total_due: string; closing_balance: string;
    }>(
      `SELECT installment_number, due_date, total_due, closing_balance
       FROM loan_repayments WHERE loan_id = $1 ORDER BY installment_number`,
      [loan.id],
    );
    return { id: loan.id, totalRepayable: Number(totals.total_repayable), installments };
  }

  describe('invariant 1: the monthly arm is unchanged', () => {
    it('reproduces the live production figures for a flat monthly loan', async () => {
      // These are the exact numbers written to the four real THE FIONA'S loans
      // on 2026-08-16: 130,000 at 10%/month flat over 12 months.
      const loan = await makeLoan({
        principal: 130_000, rate: 10, termMonths: 12, method: 'flat', freq: 'monthly',
      });
      expect(loan.installments).toHaveLength(12);
      expect(loan.totalRepayable).toBeCloseTo(286_000, 2);
      expect(Number(loan.installments[0].total_due)).toBeCloseTo(23_833.33, 2);
    });

    it('defaults to monthly when the column is left alone', async () => {
      const [loan] = await rawQuery<{ repayment_frequency: string }>(
        `INSERT INTO loans
           (group_id, member_id, group_membership_id, principal_amount, interest_rate,
            loan_term_months, status)
         VALUES ($1,$2,$3,'50000.00','10.00',6,'pending')
         RETURNING repayment_frequency`,
        [groupId, officerId, membershipId],
      );
      expect(loan.repayment_frequency).toBe('monthly');
    });
  });

  describe('invariant 2: cadence changes the split, not the price', () => {
    // Flat interest is principal * (monthly rate) * term_months — an expression
    // with no frequency term in it at all.
    it.each<[Freq, number]>([
      ['weekly', 52], ['biweekly', 26], ['monthly', 12], ['quarterly', 4],
    ])('flat 10%%/mo over 12 months costs 286,000 whether %s (%i instalments)', async (freq, n) => {
      const loan = await makeLoan({
        principal: 130_000, rate: 10, termMonths: 12, method: 'flat', freq,
      });
      expect(loan.installments).toHaveLength(n);
      expect(loan.totalRepayable).toBeCloseTo(286_000, 2);
    });

    it('sums the instalments to exactly the total, with drift in the last one', async () => {
      // 52 roundings of a 2dp figure is where a naive schedule leaks cents.
      const loan = await makeLoan({
        principal: 130_000, rate: 10, termMonths: 12, method: 'flat', freq: 'weekly',
      });
      const sum = loan.installments.reduce((a, r) => a + Number(r.total_due), 0);
      expect(sum).toBeCloseTo(286_000, 2);
      expect(Number(loan.installments.at(-1)!.closing_balance)).toBeCloseTo(0, 2);
    });
  });

  describe('due dates step by the cadence', () => {
    it('spaces weekly instalments 7 days apart', async () => {
      const loan = await makeLoan({
        principal: 52_000, rate: 5, termMonths: 12, method: 'flat', freq: 'weekly',
      });
      const d0 = new Date(loan.installments[0].due_date).getTime();
      const d1 = new Date(loan.installments[1].due_date).getTime();
      expect((d1 - d0) / 86_400_000).toBe(7);
      // First instalment falls a week after disbursement, not on it.
      expect(new Date(loan.installments[0].due_date).toISOString().slice(0, 10)).toBe('2026-02-07');
    });

    it('does not skip February when stepping monthly from the 31st', async () => {
      // Postgres clamps 31 Jan + 1 month to 28 Feb. Worth pinning: the old
      // schedule had the same behaviour and members are used to it.
      const loan = await makeLoan({
        principal: 60_000, rate: 5, termMonths: 3, method: 'flat', freq: 'monthly',
      });
      const dates = loan.installments.map((r) => new Date(r.due_date).toISOString().slice(0, 10));
      expect(dates).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
    });
  });

  describe('reducing balance converts the rate to the period', () => {
    it('charges less total interest weekly than the flat equivalent', async () => {
      // A declining balance amortises faster when payments are more frequent,
      // so weekly reducing must cost strictly less than weekly flat.
      const reducing = await makeLoan({
        principal: 130_000, rate: 10, termMonths: 12, method: 'reducing_balance', freq: 'weekly',
      });
      expect(reducing.totalRepayable).toBeLessThan(286_000);
      expect(reducing.totalRepayable).toBeGreaterThan(130_000);
    });

    it('leaves the monthly reducing case identical to a 12-period amortisation', async () => {
      const loan = await makeLoan({
        principal: 130_000, rate: 10, termMonths: 12, method: 'reducing_balance', freq: 'monthly',
      });
      // Migration 148's verified figure: EMI 19,079.23 at 10%/month over 12.
      expect(Number(loan.installments[0].total_due)).toBeCloseTo(19_079.23, 2);
    });
  });

  it('rejects a cadence outside the check constraint', async () => {
    await expect(
      rawQuery(
        `INSERT INTO loans
           (group_id, member_id, group_membership_id, principal_amount, interest_rate,
            loan_term_months, repayment_frequency, status)
         VALUES ($1,$2,$3,'1000.00','5.00',6,'fortnightly','pending')`,
        [groupId, officerId, membershipId],
      ),
    ).rejects.toThrow(/loans_repayment_frequency_check/);
  });

  it('still produces one instalment when the term is shorter than the period', async () => {
    // A 1-month quarterly loan rounds to 0.33 periods; floored at 1 so the loan
    // gets a schedule and a next_payment_date rather than neither.
    const loan = await makeLoan({
      principal: 10_000, rate: 5, termMonths: 1, method: 'flat', freq: 'quarterly',
    });
    expect(loan.installments).toHaveLength(1);
    expect(loan.totalRepayable).toBeCloseTo(10_500, 2);
  });
});
