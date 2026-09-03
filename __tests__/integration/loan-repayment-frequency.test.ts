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
  let groupId: string, officerId: string, membershipId: string, internalSourceId: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ groupId, officerId } = await createTestGroup('chairperson'));
    // rawQuery returns the rows array itself, not a pg QueryResult.
    const memberships = await rawQuery<{ id: string }>(
      `SELECT id FROM group_members WHERE group_id = $1 AND member_id = $2`,
      [groupId, officerId],
    );
    membershipId = memberships[0].id;

    // Every group is auto-provisioned an 'internal_savings' funding source.
    // A disbursed loan MUST be fully attributed to one (deferred constraint
    // trigger, migration 118) — see makeLoan().
    const sources = await rawQuery<{ id: string }>(
      `SELECT id FROM group_funding_sources
       WHERE group_id = $1 AND source_type = 'internal_savings'`,
      [groupId],
    );
    internalSourceId = sources[0].id;
  });

  /** Creates a disbursed loan and generates its schedule. Returns the loan row
   *  plus its instalments. */
  async function makeLoan(opts: {
    principal: number; rate: number; termMonths: number;
    method: 'flat' | 'reducing_balance'; freq: Freq;
  }) {
    // The loan and its funding split MUST be written in one statement. A
    // disbursed loan has to be fully attributed to a funding source (deferred
    // constraint trigger, migration 118), and that check runs at COMMIT —
    // rawQuery gives each call its own connection, so inserting the loan
    // first and the split second would fail at the end of the first call,
    // before the split existed. A data-modifying CTE keeps both in one
    // transaction. These tests write loans directly rather than going through
    // loansService, which is what would normally create the split.
    const [loan] = await rawQuery<{ id: string }>(
      `WITH new_loan AS (
         INSERT INTO loans
           (group_id, member_id, group_membership_id, principal_amount, interest_rate,
            loan_term_months, repayment_frequency, interest_method, status, disbursement_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'disbursed', DATE '2026-01-31')
         RETURNING id, group_id
       )
       INSERT INTO loan_funding_splits (group_id, loan_id, funding_source_id, amount)
       SELECT group_id, id, $9, $4 FROM new_loan
       RETURNING loan_id AS id`,
      [groupId, officerId, membershipId, opts.principal.toFixed(2), opts.rate.toFixed(2),
       opts.termMonths, opts.freq, opts.method, internalSourceId],
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
      // 130,000 at 10% p.a. flat over 12 months (1 year) -> 143,000. These
      // were 286,000 / 23,833.33 before migration 167: the four real THE
      // FIONA'S loans written on 2026-08-16 at this same principal and rate
      // were scheduled at 10%/month, not 10%/year, and were reissued at
      // these corrected figures once the bug was found.
      const loan = await makeLoan({
        principal: 130_000, rate: 10, termMonths: 12, method: 'flat', freq: 'monthly',
      });
      expect(loan.installments).toHaveLength(12);
      expect(loan.totalRepayable).toBeCloseTo(143_000, 2);
      // 143,000 / 12 = 11,916.666...; the schedule truncates each instalment
      // to 11,916.66 and the last one absorbs the remaining cents of drift.
      expect(Number(loan.installments[0].total_due)).toBeCloseTo(11_916.66, 2);
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
    // Flat interest is principal * (annual rate) * (term_months / 12) — an
    // expression with no frequency term in it at all.
    it.each<[Freq, number]>([
      ['weekly', 52], ['biweekly', 26], ['monthly', 12], ['quarterly', 4],
    ])('flat 10%% p.a. over 12 months costs 143,000 whether %s (%i instalments)', async (freq, n) => {
      const loan = await makeLoan({
        principal: 130_000, rate: 10, termMonths: 12, method: 'flat', freq,
      });
      expect(loan.installments).toHaveLength(n);
      expect(loan.totalRepayable).toBeCloseTo(143_000, 2);
    });

    it('sums the instalments to exactly the total, with drift in the last one', async () => {
      // 52 roundings of a 2dp figure is where a naive schedule leaks cents.
      const loan = await makeLoan({
        principal: 130_000, rate: 10, termMonths: 12, method: 'flat', freq: 'weekly',
      });
      const sum = loan.installments.reduce((a, r) => a + Number(r.total_due), 0);
      expect(sum).toBeCloseTo(143_000, 2);
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

    it('sticks to the 28th once a month-end date clamps through February', async () => {
      // A real quirk, PRE-DATING migration 149 and deliberately left alone.
      // Due dates are accumulated from the PREVIOUS due date, not from the
      // disbursement anchor: v_due_date := v_due_date + v_interval. Postgres
      // clamps 31 Jan + 1 month to 28 Feb, and every later step then adds a
      // month to the 28th — so the schedule never recovers to month-end.
      //
      // A loan disbursed on the 31st therefore collects on the 28th for the
      // rest of its life. For a chama that meets on the last day of the month
      // that is a permanent 2-3 day drift. Changing it would move the due
      // dates of every existing loan, so it is pinned here rather than fixed.
      const loan = await makeLoan({
        principal: 60_000, rate: 5, termMonths: 3, method: 'flat', freq: 'monthly',
      });
      const dates = loan.installments.map((r) => new Date(r.due_date).toISOString().slice(0, 10));
      expect(dates).toEqual(['2026-02-28', '2026-03-28', '2026-04-28']);
    });
  });

  describe('reducing balance converts the rate to the period', () => {
    it('charges less total interest weekly than the flat equivalent', async () => {
      // A declining balance amortises faster when payments are more frequent,
      // so weekly reducing must cost strictly less than weekly flat.
      const reducing = await makeLoan({
        principal: 130_000, rate: 10, termMonths: 12, method: 'reducing_balance', freq: 'weekly',
      });
      expect(reducing.totalRepayable).toBeLessThan(143_000);
      expect(reducing.totalRepayable).toBeGreaterThan(130_000);
    });

    it('leaves the monthly reducing case identical to a 12-period amortisation', async () => {
      const loan = await makeLoan({
        principal: 130_000, rate: 10, termMonths: 12, method: 'reducing_balance', freq: 'monthly',
      });
      // Migration 148's figure (EMI 19,079.23 at 10%/month) was superseded by
      // migration 167: the rate is annual, so the period rate used inside the
      // amortisation formula is now 10%/12 rather than 10% outright.
      expect(Number(loan.installments[0].total_due)).toBeCloseTo(11_429.07, 2);
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
    // 10,000 at 5% p.a. flat, prorated over a 1-month (1/12-year) term:
    // 10,000 * (1 + 0.05 * 1/12) = 10,041.67. (Was 10,500 pre-167, when the
    // rate was applied as 5%/month flat regardless of term length.)
    const loan = await makeLoan({
      principal: 10_000, rate: 5, termMonths: 1, method: 'flat', freq: 'quarterly',
    });
    expect(loan.installments).toHaveLength(1);
    expect(loan.totalRepayable).toBeCloseTo(10_041.67, 2);
  });
});
