# Optimization & correctness audit — plan

**Goal:** verify that the platform's functionality is *accurate*, not merely present — and that it stays fast as real groups accumulate data.

**Method (non-negotiable, learned the hard way this month):** every finding is reproduced against the production database inside a rolled-back transaction before it is reported, and every fix is re-verified the same way. Reading code is how findings are *located*; running them is how they are *confirmed*. Three of today's four confirmed defects looked fine in the source.

---

## Why these areas, and not a generic sweep

Today's hardening pass found four real defects. They were not random — they share shapes, and those shapes tell us where else to look:

| Defect | Shape |
|---|---|
| `computeTotalRepayable` divided by 12 | **A formula implemented twice**, one copy drifting |
| Loan CSV import aborted at COMMIT | **A deferred constraint** firing outside the error handler's scope |
| Every plan granted 50 SMS | **A column never set**, silently taking its default |
| Retried SMS delivered free | **A state machine with an unhandled edge** (reserve → release → deliver) |

The audit hunts those four shapes deliberately, rather than re-reading everything at uniform depth.

---

## Phase 1 — Duplicated business logic (highest value)

The `computeTotalRepayable` bug existed because one formula lived in two places and only one was fixed. Find the rest.

- Every financial calculation implemented in **both** TypeScript and SQL: interest, balances, penalties, dividends, share value, credit scores, allocation splits, trial balance.
- For each: compute the same inputs through both paths and diff. Any disagreement is a finding.
- Known instance already accepted: `installmentCount()` in `loan.schema.ts` mirrors `generate_loan_schedule`'s formula for UI preview, documented at both ends. Confirm it still agrees.
- Vocabulary duplication: enums defined in both Postgres and TypeScript (`payment_method`, `loan_status`, frequencies, plan types). Assert each TS list matches `pg_enum` exactly.

## Phase 2 — Silent defaults and unset columns

The SMS allowance was wrong for every customer because two INSERTs omitted a column.

- Enumerate every `INSERT` against a table with `NOT NULL DEFAULT` columns and check whether the default is *intended* or *accidental*.
- Particular focus on money and entitlement columns: rates, fees, limits, allowances, tenors, `interest_method`.
- Cross-check what the marketing surfaces promise (`PLAN_COPY`, pricing page, feature lists) against what the system actually stores and enforces. `"Higher SMS allowance"` was advertised for months and never delivered.

## Phase 3 — Deferred constraints and transaction boundaries

The importer's per-row `try/catch` could never catch its own failure.

- Every `DEFERRABLE INITIALLY DEFERRED` constraint trigger: identify which code paths write the covered tables, and whether their error handling is still in scope at COMMIT.
- Every `withTransaction` block containing a loop with per-item error collection — the importer's exact shape.
- Confirm the rule that a caught JS error does **not** un-abort a Postgres transaction is respected everywhere a query is wrapped in `try/catch` inside a transaction.

## Phase 4 — Money state machines

The retry path delivered without billing because one transition was missing.

- Trace every billing state machine end to end for unhandled transitions: SMS (`reserved → consumed | released`), M-Pesa (STK, C2B, B2C, reversals), subscriptions (`active → expired → reactivated`), disbursements (`pending_approval → approved → completed | rejected | failed | timed_out`), loans (`pending → … → written_off`).
- For each: is there a path where the **external side effect happens but the internal record doesn't**, or vice versa? That is the exact shape of the retry leak.
- Reconciliation: does every ledger entry balance, and does every posted journal have a corresponding real-world event?

## Phase 5 — Query performance against realistic volume

Correctness first, but this is where "stays working" lives.

- `EXPLAIN ANALYZE` the hot paths at realistic scale: contribution lists, member lists, loan schedules (**now up to 52 rows per loan-year after migration 149**), SMS usage logs, trial balance, the daily reminder sweep.
- Missing indexes on foreign keys and on every column used in a `WHERE` by a scheduled job.
- N+1 patterns: loops issuing one query per iteration — the importer and any per-row service loop.
- Unbounded queries: any `SELECT` without `LIMIT` on a table that grows per-transaction (`sms_usage_logs`, `payment_events`, `audit_logs`, `loan_repayments`).
- Confirm `pg_stat_statements` for the genuinely slow queries in production rather than guessing.

## Phase 6 — Dead and unreachable code

`getEffectiveLoanTerms()` had **zero callers** while the UI displayed its result — the policy was decorative and loans silently took a column default instead.

- Exported functions with no callers, especially in services (that is how the loan-policy bug hid).
- Config and policy values that are *read and displayed* but never *enforced*. `maxTermMonths` and `loanMultiplier` are known instances, deliberately advisory — confirm nothing else is accidentally so.
- Feature flags, env vars, and columns referenced nowhere.

---

## Explicitly out of scope

- Cosmetic refactors, renames, and style churn.
- Rewriting anything that is correct but unfashionable.
- Performance work with no measurement behind it.

## Deliverable

One markdown file per phase in `docs/audits/`, each finding carrying: reproduction, blast radius (how many live rows/tenants affected), severity, and a recommended fix. **Fixes are proposed, not applied** — except where a defect is actively losing money or corrupting data, which gets flagged immediately rather than filed.

## Sequencing

Phases 1–4 are correctness and run first; 5–6 follow. Each phase ends with a decision point rather than rolling straight into the next, because the findings will reshape what is worth looking at.
