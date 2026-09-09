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

## Phase 7 — Group-configured contribution splitting (shares / savings / welfare)

Not from today's hardening pass — added on request, but it fits the same "promise vs. reality" shape as Phase 2's SMS allowance.

The landing page advertises this as working out of the box: `components/landing/features.tsx` lists **"Auto-split contributions — Split into savings, welfare, and loans automatically."** The actual system (`lib/utils/split-allocator.ts`, `lib/services/contribution-splits.service.ts`, `group_contribution_splits`, settings UI at `/settings/contribution-splits`) is real and well-built — largest-remainder rounding, unit-tested, no float drift — but `loadActiveSplitRules()` returns `[]` for any group that hasn't explicitly configured rules, and the allocator then sends **100% to one default account**. Nothing auto-populates sensible shares/savings/welfare defaults for a new group.

- Confirm how many real groups have any `group_contribution_splits` rows at all. If none do, "automatically" has never actually happened for a single live group — same shape as the SMS allowance that was advertised for months and never delivered.
- Confirm every contribution-recording path actually calls `postContributionJournal` (`accounting.service.ts`) rather than writing to `contributions` some other way that silently skips the allocator: STK, manual/C2B entry, CSV import, unrouted reassignment, reconciliation.
- `lib/validators/contribution-splits.schema.ts` vs whatever validation `app/(dashboard)/settings/contribution-splits/page.tsx` does client-side — the codebase already has a documented convention of hand-duplicated zod schemas staying "in sync manually" (`register/page.tsx`, `groups/new/page.tsx`), and that exact pattern is how the `ngo_group` enum drift shipped. Confirm percentage-sum and duplicate-priority/account-code validation agree on both sides.
- Confirm the deliberate exclusion of contribution splits from the generic posting-templates engine (`ACCOUNTING_ARCHITECTURE_AUDIT.md` §29.9 — unbounded credit-line count was the stated reason) still holds; nothing since should have quietly reintroduced a second posting path for contributions.

## Phase 8 — Use of email as a channel

Also added on request. The email subsystem (five provider adapters with SMTP fallback, DB-templated with a 26-key inline fallback, campaigns, delivery-tracking webhooks, analytics) is bigger than its footprint in the product suggests, and two concrete gaps turned up just from reading it — neither yet reproduced against production, per the method above.

- **No bounce/complaint suppression.** `sendEmail` / `sendEmailWithFallback` (`lib/email/provider.ts`) never check `email_logs` for a prior `bounced` or `complained` status before sending. A hard-bounced or complained address gets mailed forever — a real sender-reputation risk (providers suspend accounts over sustained bounce/complaint rates), and the same "recorded but never enforced" shape as Phase 6's `getEffectiveLoanTerms()`.
- **String-interpolated tenant scoping.** `getEmailAnalytics` (`lib/services/delivery-tracking.service.ts`) builds `` `AND group_id = '${groupId}'` `` directly into the query instead of binding it as a parameter. Not exploitable today — its only caller passes the JWT-derived `auth.groupId`, never raw input — but it's the same shape found in ten other service files (`sms.service.ts`, `import.service.ts`, `members.service.ts`, `dividends.service.ts`, `shares.service.ts`, `credit-scores.service.ts`, others) via a quick grep for `${...Id}` inside a query string. Worth a project-wide parameterization sweep, not just this file.
- **Template drift.** `renderTemplate` is DB-first with an inline fallback (`DEFAULT_TEMPLATES`, 26 keys, `lib/email/templates/defaults.ts`) — Phase 1's "vocabulary duplication" shape exactly. Confirm each DB-seeded template's variables still match what callers pass in `vars`, and that the inline fallback hasn't drifted from whatever the DB copy has since been edited to.
- Confirm nothing assumes every member has an email. `queueAnnouncement` iterates a caller-supplied `memberEmails` array — confirm every caller filters out members with no email first rather than queuing a send to `undefined`/`''`.
- No credits, quota, or billing exists for email at all, unlike SMS's fully metered allowance system (reservation → consumption, per-plan allowances, top-ups). Confirm that's a deliberate product decision and not an oversight, and that no plan/pricing copy promises a capped or paid email allowance the system doesn't enforce.

---

## Explicitly out of scope

- Cosmetic refactors, renames, and style churn.
- Rewriting anything that is correct but unfashionable.
- Performance work with no measurement behind it.

## Deliverable

One markdown file per phase in `docs/audits/`, each finding carrying: reproduction, blast radius (how many live rows/tenants affected), severity, and a recommended fix. **Fixes are proposed, not applied** — except where a defect is actively losing money or corrupting data, which gets flagged immediately rather than filed.

## Sequencing

Phases 1–4 and 7–8 are correctness and run first; 5–6 follow. Each phase ends with a decision point rather than rolling straight into the next, because the findings will reshape what is worth looking at. 7 and 8 are numbered after 6 only because they were added later — they are not lower priority than 1–4.
