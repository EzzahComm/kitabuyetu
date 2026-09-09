/**
 * Static guard against code↔schema drift on columns that do not exist.
 *
 * Motivation (docs/audits/PRODUCTION_SCHEMA_DRIFT_AUDIT.md, findings H1/H2):
 * `members` has no `full_name` column — it has first_name/last_name — and
 * `loan_repayments` has no `amount` column, only `amount_paid`. Six SQL call
 * sites across four services selected those nonexistent columns. In
 * production this meant `email_birthday` failed 96 consecutive times,
 * `email_weekly_summary` failed 15 times, and email campaigns could not
 * resolve a single recipient.
 *
 * Every one of those services already had unit tests, and none of them
 * caught it: the tests mock `db.query` and return hand-written rows that
 * *include* a `full_name` key, so they assert against a row shape the
 * database cannot actually produce. Mocking the database means the SQL text
 * itself is never validated by anything.
 *
 * This test closes that specific hole by inspecting the SQL in the source
 * files directly. It is deliberately a lint-style check, not a behavioural
 * one:
 *
 *   - What it proves: no service reintroduces these two known-bad column
 *     references.
 *   - What it does NOT prove: that any other column in any other query
 *     exists. Only a real-Postgres test (see `test:integration`) can do
 *     that. This is a targeted regression guard, not a schema validator.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVICES = join(process.cwd(), 'lib', 'services');

function read(file: string): string {
  return readFileSync(join(SERVICES, file), 'utf8');
}

/**
 * Only the SQL matters here. Reading `m.full_name` off a *result row* in
 * TypeScript is correct and expected — the queries alias the concatenation
 * back to `full_name`, so `row.full_name` / `m.full_name` in JS is the
 * intended shape (statement-email.service.ts:89 does exactly this). It is
 * only `m.full_name` appearing inside the SQL sent to Postgres that is a
 * bug, so the check is scoped to template literals.
 */
function sqlLiteralsOf(file: string): string {
  return (read(file).match(/`[^`]*`/g) ?? []).join('\n');
}

describe('schema column drift', () => {
  // Verified against production 2026-07-30: `full_name` exists only on
  // `next_of_kin` and `person`. Any `<alias>.full_name` where the alias is
  // bound to `members` is a parse-time error in Postgres.
  const MEMBERS_FULL_NAME = /\bm\.full_name\b/;

  describe.each([
    ['member-email.service.ts'],
    ['report-email.service.ts'],
    ['statement-email.service.ts'],
    ['campaign.service.ts'],
  ])('%s', (file) => {
    it('never selects m.full_name (members has first_name/last_name)', () => {
      expect(sqlLiteralsOf(file)).not.toMatch(MEMBERS_FULL_NAME);
    });

    it('builds the display name by concatenating first_name and last_name', () => {
      expect(sqlLiteralsOf(file)).toMatch(/m\.first_name\s*\|\|\s*' '\s*\|\|\s*m\.last_name/);
    });
  });

  it('billing-email.service.ts remains the reference implementation', () => {
    // This file always did it correctly; it is what the fix was modelled on.
    // If it ever regresses, the pattern the others copied is gone too.
    expect(read('billing-email.service.ts')).toMatch(
      /m\.first_name\s*\|\|\s*' '\s*\|\|\s*m\.last_name\s+AS full_name/,
    );
  });

  it('report-email.service.ts sums loan_repayments.amount_paid, not amount', () => {
    const sql = read('report-email.service.ts');
    expect(sql).toMatch(/SUM\(amount_paid\)[\s\S]*FROM loan_repayments/);
    // `SUM(amount)` immediately followed by FROM loan_repayments was the bug.
    expect(sql).not.toMatch(/SUM\(amount\)\s*,0\)\s*AS total FROM loan_repayments/);
  });
});
