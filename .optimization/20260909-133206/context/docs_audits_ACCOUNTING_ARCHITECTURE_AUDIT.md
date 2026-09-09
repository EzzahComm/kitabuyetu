# Kitabu Yetu — Core Financial Accounting Architecture Audit

**Date:** 2026-07-16
**Scope:** The complete accounting/financial engine — chart of accounts, general ledger, journal/posting engine, wallet accounting, multi-tenant isolation, financial reporting, period management, budget control, financial controls, reconciliation, database architecture, event architecture, and the multi-tenant policy/configuration layer.
**Method:** Source-grounded review of the actual codebase — every migration under `supabase/migrations/` (100+ files) touching accounting, every `lib/services/*.ts` file that posts or reads financial data, every accounting-related API route and hook. No functionality is assumed; every finding below cites a specific file and line. Capabilities are explicitly labeled **IMPLEMENTED**, **PARTIAL**, **NOT FOUND**, **BYPASSES ACCOUNTING**, or **HARDCODED** — never inferred from documentation, comments, or naming alone.
**Benchmark set:** SAP S/4HANA, Oracle Financials Cloud, Microsoft Dynamics 365 Finance, Odoo Accounting, ERPNext, Apache Fineract, Mifos X, Temenos Transact, Finacle, Oracle FLEXCUBE.

---

## 1. Executive Summary

Kitabu Yetu's accounting core is **more sophisticated than a first look at the product would suggest**. There is a real chart-of-accounts table (`accounts`), a real double-entry journal schema (`journal_entries`/`journal_lines`), and — unusually for a codebase at this stage — **two independent, DB-level enforcement layers** guaranteeing every posted journal balances: a `BEFORE UPDATE` trigger (migration 009) and a `DEFERRABLE` constraint trigger (migration 027) added specifically after the team discovered application code was bypassing the first one. A trigger-maintained balance column ties `accounts.balance` to `journal_lines` with no possibility of drift for group-level cash. Group and organization-to-group disbursements have genuine maker-checker `CHECK` constraints. A budget-commitment system in `organization-finance.service.ts` reserves against *pending* disbursement requests, not just completed ones, closing the exact overspend race condition the audit brief worried about. An SMS trigger-rule engine implements genuine three-tier (group > organization > platform) policy inheritance — proof the team can build this pattern.

Set against that foundation, the audit's central question — **do Loans, Savings, Shares, Welfare, Payments, Subscriptions, and Organizations all converge into one authoritative accounting engine, or do they post independently?** — has an unambiguous, evidence-based answer: **they post independently, and four of them don't post at all.**

- **Six separate, hand-written raw-SQL posting code paths exist** for what should be one operation (create a balanced journal entry) — including two independently-written functions named `postContributionJournal` in two different files with different behavior.
- **Shares, Welfare, Dividends, and Subscriptions/Billing move real cash (member share purchases, welfare payouts, dividend distributions, SaaS plan payments) with zero corresponding journal entries.** The platform's own Trial Balance and P&L reports will systematically understate the business because these modules' cash movements never reach `journal_lines` — the very table those reports aggregate.
- **Manual journal entry creation has no maker-checker at all** — the one place in the system where a single actor can create, post, and void an arbitrarily large journal unilaterally, in a codebase that otherwise enforces distinct-approver constraints everywhere else money moves.
- **The organization-level wallet has no chart-of-accounts backing whatsoever** — it is a plain operational balance column that can diverge from reality with nothing to check it, by design (the `accounts` table's `group_id` is `NOT NULL`, so organizations structurally cannot own a ledger).
- **There is no reconciliation between the GL and real external cash** anywhere in the system — Daraja's own `AccountBalance` figure is fetched and displayed on the treasury page but never diffed against any ledger account.
- **A fully-built, RLS-isolated, per-group financial policy table (`group_constitutions` — loan interest rate, loan multiplier, share value, welfare amount, quorum, fine schedule) is seeded into every tenant's database and never read by a single line of application code.** The real loan-multiplier and credit-scoring logic instead uses one hardcoded global constant table, with no per-tenant override at all.
- **No period-locking mechanism exists anywhere** — a journal can be posted to any date, past or future, forever, with no concept of a closed fiscal period to reject against.

**Production Readiness Score: 40 / 100.** See §34 for the full breakdown. The GL core that IS used is genuinely well-engineered; the coverage of that core across the product, and the manual-journal control gap, are what keep this from being a credible regulated-institution accounting engine today.

---

## 2. Overall Accounting Architecture Assessment

**Where accounting starts:** `lib/services/accounting.service.ts` — this is the only file exposing a reusable, importable posting API (`createJournalEntry`, `postJournalEntry`, `voidJournalEntry`, plus `getTrialBalance`/`getProfitAndLoss`/`getBalanceSheet`/`detectBalanceDrift`). It is the intended "posting engine."

**Where accounting actually happens:** everywhere else, independently. `grep -ln "journal_entries|journal_lines" lib/services/*.ts` returns exactly six files: `accounting.service.ts` (the unused shared API), `contributions.service.ts`, `loans.service.ts`, `mpesa.service.ts`, `organization-finance.service.ts`, and `reallocations.service.ts`. None of the five domain files call `accountingService.createJournalEntry` — each hand-rolls its own `INSERT INTO journal_entries` / `INSERT INTO journal_lines`.

**Service boundaries found:**
| Conceptual engine | Actual implementation | Status |
|---|---|---|
| Posting engine | `accounting.service.ts` functions — used only by the manual "Accounting" screen | Exists, but bypassed by every automated flow |
| Journal engine | None — six independent raw-SQL implementations | Not centralized |
| Ledger engine | `journal_entries`/`journal_lines` tables + two DB triggers | Solid where reached |
| Account engine | `accounts` table, per-group chart, seeded defaults | Solid |
| Balance engine | `update_account_balance()` trigger, denormalized `accounts.balance` | Solid, trigger-guaranteed |
| Reporting engine | `accounting.service.ts` trial balance/P&L (real aggregation), balance sheet (real but unreachable/buggy — see §12) | Partial |
| Reconciliation engine | M-Pesa-transaction-matching jobs + GL-internal balance-drift job | Real, but never reaches external cash or the organization layer |

**Modular or tightly coupled?** Neither, cleanly — it is **fragmented**. Each domain service is internally cohesive but the accounting concern is copy-pasted across them rather than factored out, which is a different failure mode than tight coupling: there's no single choke point to hook a fix into, so a bug fixed in one posting function (e.g., migration 027's fix for the balance-bypass bug) does not automatically protect the other five raw-SQL posting sites.

---

## 3. Accounting Flow Diagram

```
                         ┌─────────────────────────┐
                         │   accounting.service.ts │   ← the ONE real posting API
                         │  createJournalEntry()   │      (used only by the manual
                         │  postJournalEntry()     │       "Accounting" UI screen)
                         │  voidJournalEntry()     │
                         └────────────┬────────────┘
                                      │
                     ╔════════════════╪═══════════════════╗
                     ║   journal_entries / journal_lines    ║  ← real double-entry core
                     ║   (two DB trigger layers enforce     ║     (migrations 004, 009, 027)
                     ║    debit = credit on every post)     ║
                     ╚════════════════╪═══════════════════╝
                                      │
        ┌───────────┬───────────┬────┴─────┬─────────────┬───────────────┐
        │           │           │           │             │               │
  contributions   loans     mpesa.service  org-finance  reallocations   [NOBODY]
  .service.ts   .service.ts  .ts (6 more   .service.ts   .service.ts    ← shares,
  (own raw SQL) (own raw SQL) posting fns)  (own raw SQL) (mirrorJournal) welfare,
        │           │           │           │             │             dividends,
        ▼           ▼           ▼           ▼             ▼             subscriptions
  DR Cash      DR Loans Rec   DR/CR per   DR 1001 Cash   copies/swaps   ALL bypass
  CR Contrib   CR Cash/       flow type   CR 4005 Ext.   posted lines   accounting
  (2 versions, Interest                   Funding        for corrections entirely —
  manual vs                              (group books                   real cash,
  M-Pesa,                                only — org side                zero GL trace
  different                              never posted)
  logic)
```

No arrow above passes through a shared choke point except the DB triggers themselves — which only validate *balance*, not *which service* is allowed to post or *how*.

---

## 4. Chart of Accounts Assessment

**IMPLEMENTED, per-tenant, extensible.** `accounts` (`supabase/migrations/20260101000003_004_accounting.sql:11-34`): `id`, `group_id` (NOT NULL, tenant scope), `account_code`, `name`, `type` (asset/liability/equity/income/expense enum), `parent_id` (self-FK for hierarchy, with a same-row guard), `is_system`, `is_active`, `balance` (denormalized). Unique on `(group_id, account_code)`.

A 17-account default COA is seeded per group via the `register_group` RPC (re-issued across at least five migrations as the RPC is redefined) and mirrored in `accounting.service.ts:10-49` (`DEFAULT_ACCOUNTS`): Cash and M-Pesa, Bank Account, Loans Receivable, Fixed Assets, Accounts Payable, Member Savings, Member Equity, Retained Surplus, Member Contributions, Interest Income — Loans, Registration Fees, Other Income, External Funding (4005, added later for the organization-funding flow), Administrative Expenses, SMS Expenses, Platform Subscription (5003), Loan Write-offs (5004).

**COA is per-tenant, not global** — enforced by the unique constraint and by RLS (`accounts_select`: `group_id = app_current_group_id()`). Tenants **can** add custom accounts (`createAccount`, gated only by role, not by `is_system`) and edit non-system accounts (`updateAccount ... AND is_system = false`).

**Notable gap — dead accounts.** `5003 Platform Subscription` and `5004 Loan Write-offs` are seeded into every group's chart but, per §7 and §15 findings, are **never actually debited/credited by any code path** — subscriptions bypass accounting entirely and no write-off workflow exists. A chart-of-accounts row with no possible posting path is a maintenance/audit hazard: an auditor reconciling the seeded chart against actual usage will find accounts that structurally can never carry a balance.

**Can the COA scale?** The per-tenant model scales horizontally (each group's chart is independent, properly indexed by `group_id`). It does **not** yet support multi-currency (no `currency` column on `accounts` at all — currency lives only on `organization_wallets`), and there is no cost-center/department/branch dimension on `accounts` for organizations with sub-units, despite the audit brief's requirement to support "cost centers, departments, branches, projects, donor funds, restricted funds" per tenant.

---

## 5. General Ledger Findings

**IMPLEMENTED, hybrid DB+app enforcement, genuinely hardened over time.** `journal_entries` (`004_accounting.sql:41-56`): `entry_date`, `reference`, `description`, `status` (draft/posted/void), `created_by`/`posted_by`/`posted_at`/`voided_by`/`voided_at`/`void_reason`, `group_id`, plus later additions — `is_test` (sandbox flag, migration 047), `group_membership_id`/`member_id` (member attribution, migration 060), `posted_via` (`user`/`system`, migration 062).

`journal_lines` (`004_accounting.sql:70-89`): `account_id`, `debit`/`credit` with `CHECK (debit >= 0 AND credit >= 0)` **and** `CONSTRAINT journal_lines_debit_xor_credit CHECK ((debit>0 AND credit=0) OR (credit>0 AND debit=0))` — a genuinely strict one-sided-line constraint at the DB level.

**Balance enforcement — two layers, and the history matters.**
1. `validate_journal_balance()` (migration 009) — `BEFORE UPDATE`, fires on transition to `status='posted'`, rejects unbalanced or empty entries.
2. `assert_posted_entry_balance()` (migration 027) — a `DEFERRABLE INITIALLY DEFERRED` constraint trigger added **specifically because** application code (`postContributionJournal`, `postDisbursementJournal`, `postRepaymentJournal` in `loans.service.ts`/`contributions.service.ts`) inserts `journal_entries` directly with `status='posted'`, never triggering the migration-009 UPDATE-based check. This is documented evidence of a real historical bug — a posting path that could have created an unbalanced, permanently-posted journal — caught and closed at the schema level rather than by fixing every call site individually. That is the right fix, but it is also evidence that the "many independent posting paths" problem in §7 has already bitten this codebase once.

**Immutability:** No DELETE policy exists on `journal_entries`/`journal_lines`. `voidJournalEntry` only flips `status` to `void` with a full audit trail (`voided_by`/`voided_at`/`void_reason`) — never deletes or edits lines. **No dedicated "reversed" state exists**; corrections use a mirror/contra-journal pattern (`mirrorJournal()` in `reallocations.service.ts`, paired with `payment_reallocations.reversal_journal_entry_id`/`new_journal_entry_id`).

**Historical reconstruction / opening balances — NOT FOUND.** No opening-balance mechanism exists for group onboarding (accounts seed at zero). `getBalanceSheet(asOf)` accepts an `asOf` parameter but **never uses it in the query** — it always reads the current `accounts.balance`, meaning "as of" reporting is not actually possible today (a genuine bug, not just a gap). `import_jobs.kind` is `CHECK (kind IN ('members'))` only — the table's own comment flags historical-financial-data import as a named future phase ("E7"), not yet built.

**Period locking — NOT FOUND.** See §13.

---

## 6. Journal Engine Findings

**Standardization: NO — six independently-authored posting implementations, confirmed by direct code reading, not naming similarity alone:**

1. `contributions.service.ts:231-277` — private `postContributionJournal`, DR 1001 Cash / CR 4001 Member Contributions, no split-rule support. `contributions.service.ts` imports `accountingService` but never calls it (dead import).
2. `mpesa.service.ts:707-794` — a **second, differently-named-the-same** `postContributionJournal`, which DOES run the split-rule engine (`loadActiveSplitRules`/`allocateSplit`) to distribute the credit side across multiple income accounts. Same conceptual operation, same function name, different file, different behavior, never sharing code with #1.
3. `loans.service.ts:239-263` — private `postDisbursementJournal` (manual/cash disbursement), DR 1101 Loans Receivable / CR 1001 Cash, no fee handling.
4. `mpesa.service.ts:2646-2758` — `applyLoanDisbursement` (B2C/Daraja disbursement), posts DR 1101 + DR charge expense (5001) / CR 1001, folding in the Safaricom fee — more complete than #3, and entirely separate from it.
5. `loans.service.ts:265-301` — private `postRepaymentJournal` (manual repayment), DR Cash / CR Loans Receivable + CR Interest Income.
6. `mpesa.service.ts:796-848` — `postLoanRepaymentJournal` (M-Pesa waterfall repayment), a **different** function from #5 for the same conceptual event.

Plus: `organization-finance.service.ts:134-146` (org→group funding, its own raw INSERT) and `reallocations.service.ts:322-349` (`mirrorJournal`, a seventh distinct posting mechanism for corrections).

**Are journals generated consistently?** No. The manual vs. automated (M-Pesa) path for the *same* business event (a contribution, a disbursement, a repayment) is posted by different code with different capabilities (split-engine support, fee folding) depending on which channel the money came through — meaning the resulting ledger for two economically identical transactions can look different depending on payment channel alone.

**Journal types actually implemented:** Savings Deposit/Contribution (2 implementations), Loan Disbursement (2), Loan Repayment (2), Organization Funding (1), Payment Correction/Reallocation (1, via mirror). **Journal types NOT implemented at all** (§7): Share Purchase/Redemption, Dividend, Welfare, Subscription/Platform billing, Write-off, formal Reversal-as-a-type (only mirror-copy exists), Vendor Payment/Payroll/Expense (no dedicated expense-recording flow beyond manual journals was found), Interest Accrual as a distinct scheduled event (interest is calculated at repayment time in the loan schedule, not accrued via a periodic journal).

---

## 7. Posting Engine Findings

This section is the audit's central finding — full module-by-module status:

| Module | Status | Evidence |
|---|---|---|
| Contributions/Savings | **PARTIAL — duplicated** | `contributions.service.ts:231` (manual) vs. `mpesa.service.ts:707` (M-Pesa) — different logic for the same operation |
| Loans — disbursement | **PARTIAL — duplicated** | `loans.service.ts:239` (manual) vs. `mpesa.service.ts:2646` (B2C, fee-aware) |
| Loans — repayment | **PARTIAL — duplicated** | `loans.service.ts:265` (manual) vs. `mpesa.service.ts:796` (M-Pesa waterfall) |
| Organization → group funding | **IMPLEMENTED (own engine)** | `organization-finance.service.ts:98-170`, DR 1001/CR 4005, group-side only |
| Organization wallet deposits | **BYPASSES ACCOUNTING** | `organization-finance.service.ts:201-236` — writes `organization_ledger` only, never `journal_entries`; no GL exists for organizations at all (`accounts.group_id` is `NOT NULL`) |
| **Shares** | **BYPASSES ACCOUNTING** | `shares.service.ts` — zero references to `journal`/`account_id` anywhere in the file; `createTransaction` (lines 218-388) records purchase/redemption/transfer with real `payment_method`/`payment_reference` fields but no DR Cash / CR Member Equity ever posted |
| **Welfare** | **BYPASSES ACCOUNTING** | `welfare.service.ts` — no `journal`/`account` reference at all; `recordPoolContribution` (222-240) and `disburse` (171-191) move real cash (M-Pesa receipts, payment methods) with zero ledger trace |
| **Dividends** | **BYPASSES ACCOUNTING** | `dividends.service.ts` (691 lines) — `approve`/`payAllocation`/`bulkPayAllocations` move real cash/M-Pesa payouts and compute withholding tax, none of it ever posted; no DR Retained Surplus / CR Dividends Payable entry exists |
| **Subscriptions/Billing** | **BYPASSES ACCOUNTING** | `billing.service.ts` (219 lines) — plan upgrades paid via M-Pesa STK (`app/(dashboard)/billing/page.tsx:67`), `fulfilStkCallback` explicitly routes subscription payments to update `invoices.paid_amount` with a comment "no domain action needed here" (`mpesa.service.ts:430-432`) — **the seeded `5003 Platform Subscription` expense account is dead code, confirmed by a repo-wide grep showing it appears nowhere outside its own seed definition** |
| M-Pesa/bank charges | **PARTIAL** | Posted only on the automated B2C path (`postStandaloneChargeJournal`, folded fee in `applyLoanDisbursement`); **never posted** on manual disbursement/repayment paths — the exact same charge is tracked when automated and silently absorbed when manual |
| Payment reallocation/correction | **IMPLEMENTED (own engine)** | `reallocations.service.ts:322` `mirrorJournal` — a working but separate posting mechanism |

**Atomicity/transactions:** each raw-SQL posting site does run inside its caller's `withTransaction`, so individual postings are internally atomic — the problem is not missing transactions, it is missing centralization.

**Idempotency/concurrency:** handled per-module where it exists (`disbursement_requests.idempotency_key`, row-level `FOR UPDATE` locks in `organization-finance.service.ts`'s budget check) — but there is no idempotency guarantee at the shared-posting-engine level, because there is no shared posting engine to guarantee it in.

**Practical consequence:** the platform's own Trial Balance, P&L, and (nominally) Balance Sheet reports will systematically **understate assets, liabilities, income, and expenses** for any group using shares, welfare, or dividends — three of the platform's named core VSLA/chama product features — and will never reflect subscription expense, because none of that cash ever reaches `journal_lines`.

---

## 8. Ledger Integrity Assessment

- **Every debit has a credit / every credit has a debit:** ENFORCED at the DB level for anything that does get posted (two-layer trigger system, §5). Cannot be circumvented through the ORM/service layer for the code paths that reach `journal_entries` at all.
- **No orphan entries:** `journal_lines.account_id` and `journal_lines.journal_entry_id` are both properly FK'd (`ON DELETE RESTRICT` / `ON DELETE CASCADE` respectively) — orphaning is structurally prevented for what's posted.
- **No negative balancing:** `journal_lines` CHECK constraints prevent negative debit/credit and same-line double-siding.
- **Source traceability:** journal headers carry `reference`/`description`/`created_by`/`group_membership_id`/`member_id` — traceable back to the initiating actor and member for entries that ARE posted.
- **Immutable ledger:** no DELETE path; corrections are additive (mirror/void), not destructive.
- **The integrity guarantee only covers what reaches the table.** Ledger integrity is a statement about `journal_lines` internal consistency — it says nothing about completeness. Given §7's findings, the ledger is internally perfectly balanced and simultaneously **missing** all share, welfare, dividend, and subscription cash movements. A perfectly balanced but incomplete ledger is arguably a more dangerous production risk than an unbalanced one, because it produces confidently-wrong reports rather than visibly-broken ones.

---

## 9. Wallet Accounting Assessment

**Group-level wallet = the GL Cash account itself. IMPLEMENTED as a first-class accounting entity, no drift possible.** There is no separate "group wallet" table — `accounts.balance` (trigger-maintained from `journal_lines`) *is* the group's cash position. `accounts.reserved_amount` (migration 066) sits on the same row, so "available = balance − reserved_amount" is computed against the real Cash account. The one caveat: `reserved_amount` itself is mutated directly by `disbursements.service.ts` application code (not journal-derived) — a reservation is an operational hold, not a journal entry, until it converts into a real posted journal at settlement. This is a narrow, deliberately-scoped exception, well-documented in the migration's own comments, and does not create a balance/GL mismatch since it lives on the same row.

**Organization-level wallet = purely operational, zero GL backing. This is the audit's second major structural finding.** `organization_wallets` (`available_balance`, `committed_balance`, `total_deposited`, `total_disbursed`, `total_returned`) is updated directly by application code with **no accounts/journal_entries table for organizations at all** — structurally impossible today, since `accounts.group_id` is `NOT NULL REFERENCES groups`. `deposit()` only appends to `organization_ledger` (an append-only log with `balance_after`, not a double-entry ledger) — the code's own comment concedes "M-Pesa/bank settlement is reconciled out-of-band for now." Even `settleOrgDisbursement()`, the one place double-entry IS invoked, posts **only to the receiving group's books** (DR 1001/CR 4005) — the organization's own wallet debit is a bare UPDATE with no offsetting journal anywhere on the organization side.

**Answer to the audit's key question:** wallets are accounting entities **only at the group level**. At the organization level, they are operational balances that can silently diverge from reality with nothing — no trigger, no reconciliation job, no GL row — to ever catch it.

---

## 10. Financial Module Integration

Restating §7 as an integration verdict: accounting is **duplicated, not centralized**, and for four modules, **absent, not duplicated**. Contributions, loan disbursement, and loan repayment each have two independently-coded posting paths (manual vs. M-Pesa channel) that happen to converge on the same journal tables but not the same code. Organization funding has its own bespoke engine, correctly double-entry on the receiving side only. Shares, Welfare, Dividends, and Subscriptions have no accounting integration at all — they are financially and operationally complete (real cash, real payment references, real business logic) but invisible to the GL.

---

## 11. Multi-Tenant Accounting Assessment

**Tenant isolation of the accounting tables themselves is solid.** `accounts`, `journal_entries`, `journal_lines` all have RLS **with `FORCE`**, scoped to `app_current_group_id()`. `organization_wallets`, `organization_ledger`, `funding_programs`, `organization_disbursements` all have RLS with `FORCE`, scoped to `app_current_organization_id()`. `disbursement_requests` is group-scoped with `FORCE`. No accounting table was found with zero RLS policy.

**Weaker spots, none of them the core GL tables:** `payment_accounts` (the payment-routing registry) has a policy that permits access when `app_current_group_id() IS NULL` — a session with no group context set can read/insert across tenants. The `mpesa_*` tables (`mpesa_transactions`, `mpesa_stk_requests`, `mpesa_b2c_transactions`, `mpesa_reconciliations`, etc.) have RLS but **no `FORCE`**, meaning the table-owner DB role bypasses the policy entirely — combined with `withAdminDb()` using the same role without `BYPASSRLS` being the only backstop (`lib/db/index.ts:100-119`), the isolation guarantee for these tables depends on every `withAdminDb` call site remembering its own `WHERE` clause, not on the database enforcing it.

**Can one tenant affect another?** Not through the core GL — that isolation is real and DB-enforced. Through the M-Pesa transaction tables, isolation is a matter of application-code discipline rather than an unconditional database guarantee.

---

## 12. Financial Reporting Assessment

`hooks/use-accounting.ts` exports six hooks, each backed by a real endpoint:

- **Trial Balance — IMPLEMENTED.** `getTrialBalance` (`accounting.service.ts:141-166`) is a genuine `LEFT JOIN journal_lines … WHERE status='posted' GROUP BY account`, not a stub.
- **Profit & Loss — IMPLEMENTED.** `getProfitAndLoss` (168-209) is a real date-bounded aggregation (`entry_date BETWEEN $2 AND $3`), correct sign handling per account type.
- **Balance Sheet — IMPLEMENTED server-side, effectively dead client-side, and buggy.** `getBalanceSheet` (211-246) is a real query, but (a) its `asOf` parameter is accepted and never used in the SQL — the report is always "as of now" regardless of the date requested; (b) `useBalanceSheet` is never imported anywhere in `app/`; (c) `accountingApi.balanceSheet` (`lib/api/endpoints.ts:142-143`) builds its request URL with **backslashes instead of forward slashes**, so even a hypothetical caller would hit a malformed path. Three independent defects stacked on one feature.
- **Cash Flow Statement, Statement of Changes in Equity — NOT FOUND.** Zero matches anywhere in `app/api/v1` or `lib/services`.
- **Per-member statements — PARTIAL/orphaned.** A React-email template (`emails/account-statement.tsx`) defines a full statement layout but is referenced nowhere outside its own file — designed, never wired.
- **Per-organization statements — IMPLEMENTED.** `organization-finance.service.ts`'s `getDashboard()` and `reports.service.ts`'s `financialReport` are real, working aggregate views.
- **Donor/grant-specific reports — NOT FOUND.** `organization_ledger` carries `funding_program_id` and programs carry `funding_source`, but no endpoint aggregates spend-by-donor into a report — only the raw ledger listing exists.
- **Group-level contribution/loan reports — IMPLEMENTED**, genuine grouped SQL (`reports.service.ts`), not stubs.

---

## 13. Period Management Findings

**NOT FOUND, unambiguously.** A targeted search for `fiscal_year|accounting_period|period_lock|close_period|closing_date|locked_period` across the entire repository returns zero files. `journal_entries.entry_date` has no CHECK constraint bounding it. `CreateJournalSchema` (`lib/validators/accounting.schema.ts:27-39`) validates only that `entryDate` is a valid calendar date — no relation to `CURRENT_DATE`, no period-boundary check. `createJournalEntry`/`postJournalEntry`/`voidJournalEntry` have no temporal guard whatsoever.

The only "period" concept anywhere is `cycles`/`cycle_shareouts` (chama savings-cycle governance), which has nothing to do with the general ledger. **A treasurer can post a journal dated arbitrarily in the past or future today, and every report will silently include it.** There is no way to "close the books" for a month or year — a hard requirement for any regulated financial reporting.

---

## 14. Budget Control Assessment

**IMPLEMENTED, and better than the audit brief anticipated.** `organization-finance.service.ts`'s `disburse()` computes `remaining = budget - disbursed_total - pending`, where `pending` sums `organization_disbursements WHERE status='pending_approval'` for the same program, under a `FOR UPDATE` row lock — meaning budget is reserved against **in-flight requests, not just completed ones**, directly closing the "two concurrent requests both pass check" overspend scenario the audit was specifically checking for. A DB-level `CHECK (disbursed_total <= budget)` backstops the application logic independently. Rejection correctly releases the reservation with a reversing ledger entry.

Maker-checker (the approval threshold) and budget-sufficiency are two separately-enforced gates, both real — this is a well-designed control.

**Gap: no budget variance/utilization reporting** beyond a simple client-side percentage bar (`spent/budget` in `app/(dashboard)/organization/page.tsx`) — no trend, forecast, or over/under-budget analysis exists.

---

## 15. Financial Controls Assessment

| Control point | Status | Evidence |
|---|---|---|
| Group B2C disbursement maker-checker | **IMPLEMENTED** | `CHECK (approved_by IS NULL OR approved_by <> initiated_by)`, migration 066 |
| Org→group disbursement maker-checker | **IMPLEMENTED** | `CHECK (approved_by IS NULL OR approved_by <> created_by)`, migration 067 |
| Payment reallocation maker-checker | **IMPLEMENTED** | `CHECK (approved_by IS NULL OR approved_by <> initiated_by)`, migration 063 |
| **Manual journal create/post/void** | **NOT FOUND** | `app/api/v1/accounting/journals/route.ts` gates all three actions behind one `withRole(req,'treasurer',…)` check; `posted_by`/`voided_by` have no distinct-actor constraint anywhere — the single weakest control point in an otherwise well-hardened system |
| Write-off workflow | **NOT FOUND** | `written_off` exists only as a loan-status enum value set via bulk import; no service method or route books a write-off journal at all — the seeded `5004 Loan Write-offs` account is unreachable |
| Period reopening | **N/A** | No period-locking exists to reopen (§13) |
| Large-transaction threshold (journals) | **NOT FOUND** | Thresholds exist for disbursements/reallocations only; `CreateJournalSchema` has no amount ceiling or threshold check at all |

The pattern is stark: every control that governs money crossing a trust boundary between two parties (group↔organization, group↔group via reallocation) has real dual control. The one control governing a single treasurer's unilateral power to fabricate or erase ledger history has none.

---

## 16. Reconciliation Findings

Two real, working layers exist — and one critical layer is missing entirely:

1. **M-Pesa transaction-matching** (`mpesa_reconcile` every 5 min, paybill sweep, `mpesa_reconcile_charges` daily) — compares Daraja's own transaction-status records against local domain records (contributions, repayments, invoices). Real, self-healing for lost callbacks.
2. **GL-internal consistency** (`accounting_balance_drift`, daily) — compares the denormalized `accounts.balance` against a fresh `SUM(debit-credit)` over `journal_lines`. Real, but this only verifies the trigger-maintained cache against its own source rows — it can never catch the §7/§9 gaps, because those gaps never produce journal rows to begin with.
3. **GL-to-real-cash reconciliation — NOT FOUND.** Daraja's `AccountBalance` API is called daily (`mpesa_balance_snapshot`) and the result is displayed on the treasury dashboard — but a repo-wide grep confirms **no code path ever compares that real M-Pesa balance to the `1001 Cash`/M-Pesa Float GL account.** The number an auditor would most want reconciled — "does the ledger's cash figure match the real M-Pesa balance" — is fetched and shown, never checked.
4. **Organization-layer reconciliation — NOT FOUND**, confirmed by the code's own comment ("reconciled out-of-band for now"). No cron job of any kind checks `organization_wallets`/`organization_ledger` against real bank/M-Pesa movement.

---

## 17. Database Architecture Findings

- **Primary keys:** UUID everywhere, consistent. IMPLEMENTED.
- **Foreign keys:** mostly strict (`journal_lines.account_id`/`journal_entry_id` properly FK'd with sensible `ON DELETE` actions). One notable gap: `organization_disbursements.group_journal_entry_id` is a bare UUID with **no FK constraint** — the migration comment admits this is a deliberate "soft link" because journals live per-group — meaning referential integrity between an org disbursement and the group journal it produced is not DB-enforced.
- **Indexes:** `journal_entries` has `(group_id, entry_date DESC)` and a status index. `journal_lines` has separate single-column indexes on `group_id`/`entry_id`/`account_id` but **no composite index tying account + date together** — the exact shape a growing trial-balance/date-range query needs. Mitigated today because trial balance reads the denormalized `accounts.balance` rather than always summing lines, but P&L's date-ranged query will degrade as `journal_lines` grows.
- **Uniqueness:** solid — `(group_id, account_code)`, idempotency keys, org-wallet currency uniqueness, replay-safe references, partial unique indexes for active corrections.
- **Partitioning/archiving:** **NOT FOUND.** No declarative partitioning on any table; `journal_lines` — the table that will hold "millions of journals" per the audit brief's own stated goal — is a single monolithic table with no date- or tenant-based partitioning strategy and no archival path.
- **Schema maturity:** 98 tracked migrations (not gitignored), with evidence of two concurrent workstreams (a governance-module stream dated June 2026, a payment/disbursement-hardening stream dated July 2026) and multiple same-day migrations — consistent with an actively-iterating schema, not a stable one.

---

## 18. Auditability Assessment

**Two genuinely different audit-trail mechanisms exist, neither of which covers manual journal activity:**
- `payment_events` (append-only, RLS-enforced immutability, JSONB `detail` blob, actor+timestamp) — scoped to the payment-registry/allocation subsystem. A `journal_posted` event fires when a journal results *from payment allocation*, but never from the manual journal API.
- `audit_logs` (a stronger, generic table — explicit before/after JSONB, `BEFORE UPDATE/DELETE` trigger enforcing true immutability, proper indexes) — confirmed writers include credit-scores, WhatsApp, imports, member-roles, dividends, and shares services. **`accounting.service.ts` is absent from this list** — creating, posting, or voiding a manual journal entry leaves no row in `audit_logs`, so the admin `/admin/audit-logs` screen has zero visibility into who did what to the ledger directly.

Auditors could reconstruct: every posted journal and its balanced lines (the ledger itself is complete for what it contains), every disbursement approval/rejection (maker-checker + `payment_events`), every dividend/share/member-role change (`audit_logs`). Auditors **could not** reconstruct: who created, posted, or voided any specific manual journal entry (no audit-log write), any share/welfare/dividend/subscription cash movement's accounting trail (because none exists), or any organization-level wallet movement's tie to a bank/M-Pesa statement (no reconciliation exists to produce that trail).

---

## 19. Scalability Assessment

- **Throughput:** each posting path runs synchronously inside the originating request's transaction — fine at current volume, but with six duplicated code paths, any future performance fix (e.g., moving to async/queued posting) has to be re-applied six times.
- **Indexes:** adequate for today's query patterns (denormalized balance short-circuits most balance reads); the missing `journal_lines` composite index is a real but not yet urgent risk.
- **Partitioning:** absent, and this is the single largest scalability gap relative to the "millions of journals" goal explicitly stated in the audit brief — there is no plan for what happens to query performance once `journal_lines` holds years of history across many tenants in one table.
- **Event-driven/queue-based posting:** does not exist for accounting. The payment-allocation subsystem has a real `event_outbox`/dead-letter/retry pattern (`lib/jobs/types.ts`); accounting posting is 100% synchronous request-response, structurally disconnected from that infrastructure even though it already exists in the codebase and could be reused.

---

## 20. Compliance Assessment

- **IFRS-style reporting:** Trial Balance and P&L are real; Balance Sheet is broken/unreachable (§12); Cash Flow and Statement of Changes in Equity don't exist. A full IFRS-compliant financial-statement set is **not producible today**, and would understate the business even if it were, due to §7's coverage gaps.
- **Audit retention / record retention:** journals are immutable-by-design (no DELETE path) — a genuine retention strength. No explicit retention *policy* (auto-archival after N years) was found, which matters less today given the absence of partitioning anyway.
- **AML/regulatory reporting:** no AML-specific reporting surface was found in this audit's scope (out of scope beyond noting its absence — a dedicated AML audit would be needed).
- **Kenya Data Protection Act:** out of scope for this accounting-specific audit; `audit_logs` capturing `ip_address`/`user_agent` is a relevant existing control worth noting for that separate review.
- **External audit readiness:** an external auditor sampling manual journal entries would find no maker-checker and no audit-log trail for who posted them — a direct, specific finding an auditor would flag on day one.

---

## 21. Enterprise ERP Gap Analysis

Compared to the benchmark set (SAP S/4HANA, Oracle Financials, Dynamics 365 Finance, Odoo, ERPNext, Apache Fineract, Mifos X, Temenos Transact, Finacle, Oracle FLEXCUBE):

| Capability | Enterprise ERP/core-banking norm | Kitabu Yetu today |
|---|---|---|
| Single posting engine | All modules post through one GL service/API | Six independent raw-SQL posting paths; four modules bypass the GL entirely |
| Sub-ledger reconciliation | Sub-ledgers (loans, shares) reconcile to GL control accounts automatically | No sub-ledger exists for shares/welfare/dividends at all — nothing to reconcile |
| Period close | Hard/soft close, locked periods, reopening workflow with approval | Does not exist in any form |
| Manual journal control | Maker-checker mandatory above a configurable threshold | No maker-checker of any kind |
| Multi-currency | Native, with FX revaluation | Not supported (no `currency` on `accounts`) |
| Configuration-driven policy | Rate/limit/threshold tables with inheritance (org > branch > product) | One genuine 3-tier example (SMS triggers); everything else is flat or hardcoded globally |
| Partitioned ledger storage | Standard at "millions of transactions" scale | No partitioning strategy exists |
| GL-to-cash reconciliation | Automated bank/mobile-money reconciliation to the Cash GL account | Fetched externally, never compared to any ledger figure |

Kitabu Yetu's GL *core* (where used) is closer to a real core-banking double-entry engine than a typical early-stage SaaS ledger — the trigger-enforced balance guarantee and reservation-based budget commitment are genuinely enterprise-grade patterns. The gap to the benchmark set is **breadth of coverage and process maturity** (period close, manual-journal controls, reconciliation to external cash), not the fundamental data model.

---

## 22. Multi-Tenant Configuration Architecture Assessment

Financial/business behavior is **inconsistently configurable** — some of it is genuinely tenant-driven, most of it is either hardcoded globally or configurable-in-schema-but-dead-in-code.

**Real, working per-tenant configuration found:**
- `groups.disbursement_approval_threshold` / `organizations.disbursement_approval_threshold` / `groups.reallocation_approval_threshold` — genuine, enforced thresholds.
- `group_contribution_splits` — a real, per-group table read live by the M-Pesa allocation path (`loadActiveSplitRules()`), with percentage AND priority both configurable.
- `organizations.enterprise_per_member_fee` / `enterprise_sms_free` / `enterprise_sms_rate` — negotiated per-organization billing overrides.
- `groups.mpesa_paybill_prefix` — explicitly documented as a white-label override point.
- `sms_trigger_rules` — the one genuine three-tier (group > organization > platform) policy-inheritance implementation in the codebase.

**The single most important finding in this section:** `group_constitutions` (migration 051) is a **complete, auto-seeded, fully RLS-isolated per-group financial policy table** — `share_value`, `max_shares_per_week`, `welfare_amount`, `loan_interest_rate`, `loan_interest_method`, `loan_multiplier`, `max_loan_term_months`, `quorum_percentage`, `signatory_requirements`, `cycle_duration_weeks`, `fine_schedule` (JSONB). A trigger seeds a default row into every new group's database automatically. **A repository-wide grep confirms this table is never read or written by a single line of application code.** It exists, is correctly isolated, and does nothing.

What actually governs these same business rules instead: `loans.interest_rate` is a free-form per-loan field set by an officer at creation time (not derived from any group config); the loan multiplier used in credit scoring is a single **hardcoded global constant table** in `credit-scores.service.ts` (`TIER_THRESHOLDS`, five tiers with fixed multipliers 10/5/3/1/0.5) with no per-group or per-organization override of any kind; credit-score weighting (`FINANCIAL_WEIGHTS`, `SOCIAL_WEIGHTS`) is likewise a single global constant. Share value is governed by `share_classes.par_value` (a real, distinct, working field) — unrelated to and never cross-checked against `group_constitutions.share_value`. Penalty amounts are manually-entered absolute figures, not a rate at all. Savings minimum/maximum and grace-period fields don't exist anywhere, configurable or hardcoded — the feature is simply absent.

**Verdict:** Kitabu Yetu is not yet a configuration-driven financial platform. It is a platform with one working example of tenant-configurable policy (SMS triggers, plus contribution splits and approval thresholds as narrower single-tier examples), one large orphaned attempt at exactly the right pattern (`group_constitutions`), and several core financial parameters (loan multiplier, credit-score weights) that are single hardcoded global constants with zero tenant override — the opposite of the "organizations operate independently on the same platform without code changes" goal stated in the audit brief.

---

## 23. Organization Policy Engine Assessment

There is no dedicated "organization policy engine." What exists at the organization level is a handful of individually-migrated columns (`disbursement_approval_threshold`, `enterprise_per_member_fee`, `enterprise_sms_free`, `enterprise_sms_rate`) added ad hoc over several migrations, each read directly by the one service that needs it (`organization-finance.service.ts`, `sms.service.ts`). There is no organization-level equivalent of `group_constitutions` — no single table an organization admin could edit to set policy defaults that cascade to its member groups. The `sms_trigger_rules` organization scope is the one place an organization can genuinely set a policy that its groups inherit (via the `organization_group_access` join and the `specificity()` resolver in `lib/sms/trigger-engine.ts`) — but this pattern has not been extended to any financial policy (interest rates, loan limits, approval workflows beyond the flat threshold).

---

## 24. Group Policy Engine Assessment

The intended group policy engine (`group_constitutions`) is fully built at the schema level — correct columns for the exact fields the audit brief asked about (loan interest rate/method/multiplier, share value, welfare amount, quorum, fine schedule), correctly RLS-isolated, correctly auto-seeded — and is **completely disconnected from runtime behavior**. `group_contribution_splits` is the one group-level policy table that IS wired in and working. Every other "group policy" a treasurer might expect to configure (loan terms, savings limits, penalty rates, grace periods) is either a hardcoded global constant or a free-form per-transaction field with no stored group default at all.

---

## 25. Policy Inheritance & Override Matrix

| Policy area | Platform default | Organization override | Group override | Member override | Actual inheritance engine |
|---|---|---|---|---|---|
| SMS trigger rules | Yes (seeded) | Yes (real) | Yes (real) | No | **Real 3-tier resolver** (`trigger-engine.ts`) |
| Disbursement approval threshold | No | Yes (own flat column) | Yes (own flat column, independent of org's) | No | None — two unrelated flat thresholds, not a cascading hierarchy |
| Contribution split | Implicit (100% savings if no rows) | No | Yes (real) | No | Flat, single-tier |
| Loan interest rate | No | No | `group_constitutions.loan_interest_rate` exists but is **never read** | Per-loan officer input (the real, used value) | No engine — orphaned column vs. free-form field |
| Loan multiplier | Hardcoded global (`credit-scores.service.ts`) | No | `group_constitutions.loan_multiplier` exists but is **never read** | No | No engine — hardcoded global wins by default |
| Default payment product | Implicit | No | Yes (`groups.default_product`) | Yes (`group_members.default_product`) | Real 2-tier (member > group), narrow scope |
| Feature flags | Yes (global boolean) | Schema supports `applies_to='plan'/'group'` targeting | No FK to target a specific group | No | Schema exists, **never evaluated** — de facto flat global toggle |

**Conclusion:** exactly one genuine multi-tier inheritance engine exists in the entire codebase (SMS triggers). Every other "override" is either a flat single-value column with no tier above or below it, or a schema column that inheritance could theoretically flow through but that nothing in the application ever reads.

---

## 26. Configuration Management Assessment

**No centralized configuration/policy service exists.** A repository-wide grep for `getEffectiveSetting`, `resolveConfig`, `getPolicy`, `inheritSettings`, `effectiveSetting`, `configEngine`, `policyEngine` returns zero matches. Configuration logic is scattered: each service reads its own column(s) directly from `groups`/`organizations` with no shared abstraction, no caching layer, and no validation layer beyond whatever CHECK constraints the migration happened to add. `feature_flags` has the richest-looking schema (rollout percentage, JSONB conditions, `applies_to` targeting) and is the clearest case of schema aspiration outrunning implementation — only the `enabled` boolean is ever evaluated by any code path.

---

## 27. Financial Policy Versioning Assessment

**NOT FOUND, in any form.** No table or column carries an effective-date range for a policy value (e.g., no `disbursement_approval_threshold_history`, no `valid_from`/`valid_to` on any config table). Changing `groups.disbursement_approval_threshold` today is a plain UPDATE with no record of the prior value, no effective-dating, and — per §18 — for the accounting-adjacent tables, no `audit_logs` write either unless the specific service happens to log it. Historical reporting using a policy as it existed at the time of a past transaction is not possible; the current column value is the only value that has ever existed, as far as the system can tell after the fact.

---

## 28. Tenant Isolation Assessment (Configuration)

RLS is correctly applied to every configuration table found, including the orphaned `group_constitutions` (proper `group_admin`-gated modify policy despite being dead code) and the working `group_contribution_splits`/`sms_trigger_rules`. The one platform-scope exception is `feature_flags`, correctly restricted to `super_admin` only — appropriate, since flags are (in practice) global rather than tenant-scoped. No cross-tenant configuration leak was found in any policy examined.

---

## 29. Recommended Target Architecture

### 29.1 The underlying problem: code-driven vs. policy-driven

Every duplicated posting function in §7, the orphaned `group_constitutions` table in §22, and the hardcoded `TIER_THRESHOLDS`/`FINANCIAL_WEIGHTS` constants in `credit-scores.service.ts` share one root cause. The codebase was built the way almost every fintech application starts — with business rules embedded directly in services:

```typescript
if (group.type === "VSLA") {
  interestRate = 10;
}

if (loan.amount > 50000) {
  requireApproval();
}
```

This works for one organization. It breaks down the moment every organization has its own constitution, its own loan products, its own approval rules, its own accounting rules, and its own reporting requirements — which is exactly the state the audit brief describes as the platform's goal (NGOs, SACCOs, cooperatives, VSLAs, chamas, donors, insurance companies, government programs, MFIs, all on one codebase). §22–§28 already showed this concretely: `group_constitutions` was a real attempt to escape the pattern above, seeded correctly, isolated correctly, and never wired in — because nothing in the codebase expects to *ask* a configuration layer for an answer; every service still expects the answer to already be a constant or a free-form field.

The fix is not another column on `groups` or `organizations`. It is a change of posture: **organizations are configurable financial institutions, and the platform is the engine they configure — not a codebase that is forked in spirit (via if/else branches) for every tenant that behaves differently.**

### 29.2 Recommended configuration hierarchy

```
Platform
│
├── Platform Defaults
├── Feature Catalog
├── Global Accounting Rules
├── Global Security Policies
└── Global Limits
         │
         ▼
Organization
│
├── Organization Policies
├── Financial Policies
├── Loan Products
├── Approval Workflows
├── Chart of Accounts
├── Notification Policies
├── Budget Policies
└── Reporting Policies
         │
         ▼
Programs (optional)
         │
         ▼
Groups
│
├── Constitution              ← this is precisely what group_constitutions (§22)
├── Meeting Rules                already models correctly at the schema level
├── Savings Rules
├── Welfare Rules
├── Loan Rules
├── Share Rules
├── Fine Rules
└── Member Permissions
         │
         ▼
Members
```

This is a direct generalization of the one tier that already works today: `sms_trigger_rules`' group > organization > platform resolution (§22, §25). The target state extends that same shape to every financial policy domain, not just notifications.

### 29.3 A centralized Configuration Service, not more columns

Rather than continuing to add columns to `groups`/`organizations` one migration at a time (the pattern that produced the six flat, uncoordinated overrides catalogued in §22), introduce one service every module asks:

```
Configuration Service
  Platform Config
  Organization Config
  Program Config
  Group Config
        │
        ▼
  Policy Resolver
        │
        ▼
Application Services
```

```
Loan Service
      │
      ▼
Configuration Service
      │
      ▼
Effective Loan Policy
      │
      ▼
Process Loan
```

The critical property: **no application service should ever know whether a rule came from the platform, the organization, or the group.** It asks for the *effective* value and receives one answer. This is what `lib/sms/trigger-engine.ts`'s `loadMatchingRules()`/`specificity()` already does for notifications (§22) — the recommendation is to extract that logic into a reusable resolver rather than reimplement it per domain.

### 29.4 Policy inheritance, concretely

```
Platform: Interest Rate = 10%
       │
       ▼
Organization: Interest Rate = 12%   (override)
       │
       ▼
Group: (no override)
       │
       ▼
Effective Rate = 12%
```

```
Platform: Loan Limit = 500,000
       │
       ▼
Organization: Loan Limit = 200,000   (override)
       │
       ▼
Group: Loan Limit = 150,000          (override)
       │
       ▼
Effective = 150,000
```

Contrast this with the current state documented in the Policy Inheritance & Override Matrix (§25): `groups.disbursement_approval_threshold` and `organizations.disbursement_approval_threshold` are two *independent* flat values today, not a cascading pair — there is no "organization sets 50,000, this group overrides to 30,000, that group inherits 50,000" capability anywhere in the codebase. The target architecture makes that the default shape for every policy, not a special case.

### 29.5 Organize policies into domains, not one config blob

```
AccountingPolicy      LoanPolicy          SavingsPolicy
SharesPolicy          DividendPolicy      FinePolicy
MeetingPolicy         NotificationPolicy  ApprovalPolicy
FraudPolicy           RiskPolicy          ReportingPolicy
SubscriptionPolicy    AuditPolicy
```

Each domain gets its own schema, validation, versioning, and lifecycle — rather than a single sprawling settings object that every team touches and no one owns. `AccountingPolicy` and `LoanPolicy` are the two domains directly implicated by this audit's Critical findings (§7, §14, §15) and should be built first.

### 29.6 Replace hardcoded rules with policy lookups

Instead of the `credit-scores.service.ts` pattern found in §22:

```ts
// today — global, no tenant override possible
const TIER_THRESHOLDS = [
  { tier: 'excellent', min: 85, loanMultiplier: 10 },
  // ...
];
```

```ts
// target
const loanInterest = ConfigurationService
  .getLoanPolicy(groupId)
  .interestRate;
```

Instead of the ad hoc threshold checks scattered per-module (§15 — real for disbursements, absent for manual journals):

```ts
// target — one call, same shape, everywhere money moves
if (approvalPolicy.requiresApproval(amount)) { ... }
```

Business rules stop living in `if`/`else` branches inside services and become data the Configuration Service resolves — which is also what closes the manual-journal maker-checker gap (§15) without a bespoke threshold column: it becomes the same `ApprovalPolicy` domain every other money-movement path already uses.

### 29.7 A single Policy Resolution Engine for every financial request

```
Loan Request
     │
     ▼
Policy Resolver
     │
     ▼
Platform → Organization → Program → Group → Member Exceptions
     │
     ▼
Effective Policy
     │
     ▼
Loan Service
```

The loan service (or contribution service, or disbursement service) receives only the fully-resolved policy object and never needs to know where any individual value came from. This is the mechanism that would let the six duplicated posting functions in §6/§7 collapse into one: today `loans.service.ts` and `mpesa.service.ts` each hardcode which accounts to hit and which fee logic applies; under this architecture, both call the same resolver for "what does a loan disbursement post today, for this group" and both call the same posting engine with the answer.

### 29.8 Version every policy — never overwrite

Policies change over time, but historical transactions must remain reproducible — directly closing the Financial Policy Versioning gap in §27 (today, changing `groups.disbursement_approval_threshold` is a bare UPDATE with no record of the prior value).

```
Policy Version 1 — Interest Rate 10%  — effective Jan 2026
Policy Version 2 — Interest Rate 12%  — effective Jul 2026
```

A loan issued in March continues to use Version 1's rate for all its future reporting and recalculation; a loan issued in August uses Version 2. Neither changes retroactively when the organization edits its policy again in September. This is the mechanism that makes historical financial statements (§12, §20) trustworthy under IFRS-style reporting even as tenants actively tune their own rules.

### 29.9 Make accounting itself configurable — posting templates

This is the direct architectural fix for §6/§7's central finding. Instead of code like the private `postContributionJournal`/`postDisbursementJournal`/`postRepaymentJournal` functions found duplicated across `contributions.service.ts`, `loans.service.ts`, and `mpesa.service.ts`:

```
Transaction: Savings Deposit
       │
       ▼
Posting Template
  Debit  → Cash
  Credit → Member Savings
```

Organizations map these templates to the specific accounts in *their own* chart of accounts (§4) without any code change. Adding Share, Welfare, Dividend, and Subscription postings — the four modules found in §7 to bypass accounting entirely — becomes an exercise in authoring a new posting-template row, not a new hand-written SQL function per module. This is the single highest-leverage architectural change in this recommendation, because it simultaneously fixes the duplication problem (§6), the missing-module-coverage problem (§7, §10), and the configuration problem (§22) with one mechanism.

### 29.10 Custom, organization-defined loan products

Rather than one implicit global loan type, let organizations define their own catalogue:

```
Emergency Loan · Development Loan · School Fees Loan · Agriculture Loan · Business Loan
```

Each product carries its own eligibility rules, interest calculation, grace period, repayment schedule, fees, penalties, approval workflow, ledger mappings (via the posting templates in §29.9), and notification templates (reusing the `sms_trigger_rules` pattern in §22) — managed by the organization through the UI, not by an engineer editing `loans.service.ts`.

### 29.11 Feature flags scoped to the tenant, not just global

§22 found `feature_flags` has schema support for per-plan/per-group targeting (`applies_to`, `conditions` JSONB) that is never evaluated by any code path — a de facto global boolean list today. The target state actually evaluates that targeting, so:

```
Dividend Module   — enabled  → Organization A,  disabled → Organization B
Insurance Module  — enabled  → Organization X,  disabled → Organization Y
```

lets one codebase serve fundamentally different customer segments (a donor-funded NGO program vs. a dividend-paying SACCO) without a fork.

### 29.12 Reinforce tenant isolation at every new layer

Every tenant must have its own Chart of Accounts, loan products, approval workflows, budgets, reports, policies, notification templates, posting templates, financial periods, and audit logs — and, per §11/§28, this needs to be backed by the same real RLS discipline already demonstrated on `accounts`/`journal_entries`/`journal_lines`, not the weaker no-`FORCE` pattern found on the `mpesa_*` tables. No tenant should ever be able to read or influence another tenant's configuration or financial data, and every new policy table introduced by this architecture should ship with `FORCE ROW LEVEL SECURITY` from its first migration, not added later as a hardening pass.

### 29.13 Consolidated list of concrete changes

In order of foundational importance:

1. **A single, mandatory posting engine.** `accountingService.createJournalEntry` becomes the *only* way any code writes to `journal_entries`/`journal_lines`, driven by the posting templates in §29.9 rather than per-module hand-written SQL. This alone would have prevented the migration-027 bug and the `contributions.service.ts`/`mpesa.service.ts` naming collision (§6).
2. **Posting templates per business event** (§29.9), so Share/Welfare/Dividend/Subscription postings become configuration, not new code.
3. **A real organization-level chart of accounts and journal** (§9), so `organization_wallets` movements post real double-entry lines on both sides of an org→group transfer.
4. **Manual journal maker-checker** (§15), implemented as the same `ApprovalPolicy` domain (§29.6) every other money-movement path uses, not a bespoke constraint.
5. **Accounting periods** — a `fiscal_periods` table enforced by a trigger, with an audited reopening workflow (§13).
6. **A GL-to-cash reconciliation job** comparing the Cash/M-Pesa-Float account to the daily Daraja `AccountBalance` snapshot already being fetched (§16).
7. **The Configuration Service and Policy Resolution Engine** (§29.3, §29.7), generalizing the one proven pattern in the codebase (`lib/sms/trigger-engine.ts`) — retiring `group_constitutions` as a real, wired-in table under this engine, or removing it if superseded.
8. **Policy versioning with effective dates** (§29.8) on every configurable financial value.
9. **Partitioning `journal_lines`** by tenant and/or date ahead of the "millions of journals" goal (§17, §19).

### 29.14 Long-term vision

The platform should evolve from a VSLA application into a configuration-first financial operating system. In that model, the core engine handles authentication, workflows, accounting, payments, approvals, auditing, and reporting; organizations define *how* those capabilities behave through configuration, not code; groups inherit and optionally override approved policies within organization-defined limits; and every financial transaction is processed using the effective policy in force at the time it was created, preserving consistency, auditability, and regulatory compliance even as every tenant's rules evolve independently. This is what would let Kitabu Yetu serve informal savings groups, NGOs, SACCOs, and donor-funded programs on one platform without the if/else-per-tenant pattern that produced today's duplication.

---

## 30. Prioritized Engineering Roadmap (30/60/90 Days)

**Days 0–30 (stop the bleeding):**
- Fix the Balance Sheet URL bug and wire `asOf` into the query (small, high-value, already-built feature currently broken three ways).
- Add `CHECK (posted_by IS NULL OR posted_by <> created_by)` to `journal_entries` and gate the void action similarly — closes the single weakest control point immediately.
- Add a GL-to-Daraja-cash reconciliation check using the existing daily `mpesa_balance_snapshot` data — no new integration needed, just a comparison and an alert.
- Write `audit_logs` entries from `accounting.service.ts`'s three mutating functions.

**Days 31–60 (stop the duplication):**
- Consolidate the two `postContributionJournal` implementations into one, routed through `accountingService.createJournalEntry`.
- Consolidate the two loan-disbursement and two loan-repayment posting paths the same way.
- Build the missing Share/Welfare/Dividend/Subscription posting integrations using the now-consolidated engine — this is the single highest-impact fix in the whole audit, since it's the difference between "the reports are wrong" and "the reports are right."

**Days 61–90 (close the books, generalize policy):**
- Build `fiscal_periods` with close/reopen workflow and posting-date enforcement.
- Extract the SMS trigger-engine's inheritance resolver into a reusable policy engine; wire `group_constitutions` fields (or their replacement) into loan creation and credit scoring as the first real consumer.
- Design and begin `journal_lines` partitioning ahead of scale, and add the missing `(account_id, entry_date)` composite index in the interim.

---

## 31. Implementation Backlog

**Critical**
- Consolidate posting into one engine; wire Shares/Welfare/Dividends/Subscriptions into it (§7, §10).
- Manual journal maker-checker (§15).
- GL-to-real-cash reconciliation (§16).
- Fix Balance Sheet (URL bug + unused `asOf`) (§12).

**High**
- Organization-level chart of accounts / double-entry for org wallet movements (§9).
- Fiscal period locking + reopening workflow (§13, §5).
- Write-off workflow with maker-checker (§15).
- Audit-log coverage for manual journal actions (§18).
- `organization_disbursements.group_journal_entry_id` FK (§17).

**Medium**
- Generalized policy-inheritance engine; wire `group_constitutions` or its replacement into loan/credit-scoring logic (§22–§26).
- Policy effective-dating (§27).
- Budget variance/utilization reporting (§14).
- `journal_lines` composite index on `(account_id, entry_date)` (§17).
- Feature-flag targeting actually evaluated at runtime, or the dead columns removed (§22).

**Low**
- Cash Flow Statement / Statement of Changes in Equity (§12).
- Donor/grant-specific reporting (§12).
- Wire the orphaned `AccountStatement` email template into a real per-member statement flow (§12).
- `journal_lines` partitioning strategy (§19).

---

## 32. Risk Matrix (Likelihood × Impact)

| Risk | Likelihood | Impact | Rating |
|---|---|---|---|
| Trial Balance/P&L understate the business (Shares/Welfare/Dividends/Subscriptions invisible) | High (already true today) | Severe | **Critical** |
| A treasurer fabricates/erases ledger history via manual journal with no second approver | Medium | Severe | **Critical** |
| Organization wallet balance silently diverges from real bank/M-Pesa position | Medium | Severe | **Critical** |
| Real M-Pesa cash position never checked against the GL | High (structurally guaranteed to eventually diverge) | High | **High** |
| Duplicated posting logic diverges further as one path is patched and the other isn't | Medium | High | **High** |
| `journal_lines` performance degrades at scale (no partitioning/composite index) | Low today, High at stated scale goal | Medium | **Medium** |
| Policy set in `group_constitutions` is assumed by a future developer to be authoritative | Medium | Medium | **Medium** |
| Feature-flag rollout percentage is assumed to work by whoever seeded it | Low | Low | **Low** |

---

## 33. Configuration Hardening Roadmap

1. Decide, explicitly, whether `group_constitutions` is the intended future policy table (wire it in) or dead schema (drop it) — its current orphaned state is itself a hazard, since it looks authoritative to anyone reading the schema.
2. Generalize the SMS trigger-engine's inheritance resolver into a shared utility, and migrate the flat disbursement/reallocation thresholds onto it as the second and third consumers, proving the abstraction before extending it further.
3. Add effective-dating to every configurable financial value before any of them are exposed to organization-level self-service editing — versioning is much cheaper to build before multiple tenants have accumulated undated history than after.
4. Either wire `feature_flags.rollout_pct`/`conditions`/`applies_to` into real evaluation logic, or remove them — a config knob that visibly exists but silently does nothing is worse than no knob at all.
5. Extend the organization/group threshold pattern (a real, working precedent) to loan interest rate, loan multiplier, and savings limits, replacing the hardcoded global constants in `credit-scores.service.ts`.

---

## 34. Production Readiness Score: 40 / 100

| Category | Score | Basis |
|---|---|---|
| Core double-entry engine (where used) | 15/20 | Genuinely strong — two-layer DB enforcement, trigger-maintained balances, real budget reservation system |
| Posting engine centralization | 3/15 | One real shared function exists and is used by almost nothing; six duplicated raw-SQL paths |
| Financial module coverage | 2/15 | Four major cash-moving modules (Shares, Welfare, Dividends, Subscriptions) have zero GL integration |
| Financial controls | 5/15 | Excellent for disbursements/reallocations; nonexistent for manual journals and write-offs |
| Reconciliation | 5/10 | Real at the transaction-matching and GL-internal layers; absent for GL-to-cash and the organization layer entirely |
| Multi-tenant configuration/policy | 6/15 | One genuine 3-tier engine (SMS), several working flat overrides, one large fully-orphaned policy table, core loan/credit parameters hardcoded globally |
| Period management & auditability | 4/10 | No period locking at all; strong audit-log design that the accounting service itself doesn't use |

**Verdict:** the accounting *engine*, narrowly defined as the double-entry core, is closer to production-grade than the rest of the platform surveyed this session (B2C 34/100, B2B 31/100) — its trigger-level guarantees and budget-reservation logic are genuinely well-engineered. But the audit's central question was never "is the ledger internally consistent" — it was "do all financial modules converge into one authoritative engine." The answer is no, decisively, and the consequence is that the platform's own financial statements are wrong today for any group using shares, welfare, or dividends. That single finding, combined with zero period-locking and zero manual-journal control, is disqualifying for a "regulated financial institution" bar regardless of how well-built the underlying trigger machinery is.

---

## Final Verdict

**Is this architecture suitable for a production-grade, multi-tenant fintech platform today? No — not because the ledger is poorly built, but because it is incompletely adopted.** The critical blockers, in order: (1) four core financial modules bypass accounting entirely; (2) manual journal entries have no maker-checker in a system that otherwise takes dual control seriously; (3) there is no mechanism to close a financial period, ever; (4) the organization layer has no ledger at all, only an operational balance; (5) the real M-Pesa cash position is never reconciled against the books that are supposed to represent it.

**Maturity comparison:** the core data model and its DB-level integrity guarantees would not be out of place in a lean core-banking system (closer to early Mifos X/Apache Fineract territory than to a hobby project). The *process* maturity around it — period close, universal posting-engine adoption, manual-journal governance, GL-to-cash reconciliation — is well behind even Odoo/ERPNext's out-of-the-box defaults, let alone Temenos/FLEXCUBE-class systems.

**Target architecture, restated simply:** one posting engine every module is required to use; every module wired into it; a real fiscal-period lifecycle; maker-checker on every path that touches the ledger, not just the ones that cross a tenant boundary; a real organization-side ledger; and a policy-inheritance engine generalized from the one pattern (SMS triggers) that already proves the team can build it correctly. None of this requires new invention — every missing piece has a working, in-repository precedent to generalize from.
