/**
 * Loan CSV import (HARDENING_AUDIT_2026-08-16, findings 1-3).
 *
 * Every loan import used to abort at COMMIT. The importer wrote loans with no
 * loan_funding_splits row, and `trg_assert_loan_attribution_on_status` is
 * DEFERRABLE INITIALLY DEFERRED covering every status the importer can produce
 * ('active' — its default — plus completed/defaulted/written_off). Because the
 * check fires at COMMIT, the importer's per-row try/catch could never see it:
 * the whole transaction failed with an opaque check_violation and none of the
 * row-level diagnostics the importer exists to produce.
 *
 * Two more defects rode along in the same path:
 *   - No schedule was ever generated. trg_loans_generate_schedule is AFTER
 *     UPDATE and needs a transition INTO 'disbursed'; a plain INSERT at
 *     'active' never fires it, so imported borrowers got no instalments and —
 *     because handleLoanDueAlerts reads loan_repayments — no reminders at all.
 *   - total_repayable came from a TypeScript copy of the interest formula that
 *     still divided the rate by 12. After migration 148 made interest_rate
 *     monthly, that understated interest 12x.
 *
 * These tests exist so all three stay fixed. The first one is the whole point:
 * it only fails at COMMIT, so a test that never commits would not catch it.
 */
import type { TenantContext } from '@/lib/db';
import { importService } from '@/lib/services/import.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

describe('loan CSV import', () => {
  let ctx: TenantContext;
  let groupId: string, officerId: string, memberPhone: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ groupId, officerId } = await createTestGroup('chairperson'));
    ctx = { userId: officerId, groupId, role: 'chairperson' } as TenantContext;

    const members = await rawQuery<{ phone: string }>(
      `SELECT phone FROM members WHERE id = $1`, [officerId],
    );
    memberPhone = members[0].phone;
  });

  /** Runs a one-row loan CSV all the way through preview -> commit.
   *  `method` blank omits the column entirely, which is the case that must
   *  fall back to the group's loan policy. */
  async function importOne(status: string, method = '', rate = '10.00', term = 12) {
    const header = 'member_phone,principal_amount,interest_rate,term_months,disbursement_date,status'
      + (method ? ',interest_method' : '');
    const row = `${memberPhone},130000,${rate},${term},2026-01-16,${status}`
      + (method ? `,${method}` : '');

    const job = await importService.previewLoans(ctx, Buffer.from([header, row].join('\n')), 'loans.csv');
    return importService.commitLoans(ctx, job.id);
  }

  /** interest_method of the most recently imported loan. */
  async function latestMethod(): Promise<string> {
    const rows = await rawQuery<{ interest_method: string }>(
      `SELECT interest_method FROM loans WHERE group_id = $1
        ORDER BY created_at DESC LIMIT 1`, [groupId],
    );
    return rows[0].interest_method;
  }

  it('commits an active loan instead of aborting at COMMIT', async () => {
    // The regression that matters. Before the fix this threw check_violation
    // when withTransaction committed, not on any individual statement.
    const res = await importOne('active');
    expect(res.imported).toBe(1);
    expect(res.skipped).toBe(0);
  });

  it('attributes the imported loan to the group internal savings source', async () => {
    const rows = await rawQuery<{ source_type: string; amount: string }>(
      `SELECT s.source_type, sp.amount
         FROM loan_funding_splits sp
         JOIN group_funding_sources s ON s.id = sp.funding_source_id
         JOIN loans l ON l.id = sp.loan_id
        WHERE l.group_id = $1`,
      [groupId],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].source_type).toBe('internal_savings');
    expect(Number(rows[0].amount)).toBeCloseTo(130_000, 2);
  });

  it('generates a repayment schedule, so reminders have something to read', async () => {
    const rows = await rawQuery<{ n: string }>(
      `SELECT count(*) AS n FROM loan_repayments r
        JOIN loans l ON l.id = r.loan_id WHERE l.group_id = $1`,
      [groupId],
    );
    expect(Number(rows[0].n)).toBe(12);
  });

  it('takes total_repayable from generate_loan_schedule, not a TS formula', async () => {
    const rows = await rawQuery<{ total_repayable: string }>(
      `SELECT total_repayable FROM loans WHERE group_id = $1 LIMIT 1`, [groupId],
    );
    const total = Number(rows[0].total_repayable);
    // importOne()'s default fixture is 130,000 at 10% p.a. flat over 12
    // months (1 year): 130,000 * (1 + 0.10 * 1) = 143,000. Asserted directly
    // against that formula, not as "not equal to some other number" — the
    // deleted computeTotalRepayable() this test was written against also
    // produced 143,000 for these inputs (by dividing a monthly rate by 12),
    // which is why a "not equal" sentinel stopped being able to tell the two
    // apart once migration 167 made 143,000 the correct total too.
    expect(total).toBeCloseTo(143_000, 2);
  });

  describe('interest method follows the group loan policy', () => {
    it('takes the policy method when the column is absent, not the column default', async () => {
      // The whole point. loans.interest_method DEFAULTS to 'reducing_balance'
      // in the schema, while the resolved loan policy defaults to 'flat'. An
      // import that relied on the column default priced a loan book
      // differently from the loans the same group creates in the app — and
      // the app had the identical bug until getEffectiveLoanTerms was finally
      // wired into loansService.apply().
      await importOne('active');
      expect(await latestMethod()).toBe('flat');
    });

    it('lets a row override the policy, for historical loans on older terms', async () => {
      await importOne('active', 'reducing_balance');
      expect(await latestMethod()).toBe('reducing_balance');
    });

    it('accepts the spellings a treasurer would actually type', async () => {
      await importOne('active', 'Reducing');
      expect(await latestMethod()).toBe('reducing_balance');
    });
  });

  it('leaves a completed loan owing nothing', async () => {
    const res = await importOne('completed');
    expect(res.imported).toBe(1);

    const rows = await rawQuery<{ outstanding_balance: string; next_payment_date: string | null }>(
      `SELECT outstanding_balance, next_payment_date FROM loans
        WHERE group_id = $1 AND status = 'completed'`,
      [groupId],
    );
    expect(Number(rows[0].outstanding_balance)).toBe(0);
    expect(rows[0].next_payment_date).toBeNull();
  });
});
