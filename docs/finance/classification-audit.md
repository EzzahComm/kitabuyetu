# Financial Classification Audit

Scope: how Kitabu Yetu classifies money movements into the group ledger, platform billing, and dashboards. This records what was verified in code, what was changed, and what is deliberately deferred.

## 1. Existing architecture (verified)

| Layer                | Where                                                                                                    | Notes                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Chart of accounts    | `accounts` (migration 004), seeded by `DEFAULT_ACCOUNTS` in `lib/services/accounting.service.ts`         | Per group. Income `4001`–`4006`, expense `5001`–`5004`.                                                       |
| Double-entry journal | `journal_entries` / `journal_lines` (004; `entry_date` added in 091)                                     | Posted entries only feed P&L and balance sheet.                                                               |
| Posting templates    | `lib/services/posting-templates.service.ts` (`DEFAULT_TEMPLATES`)                                        | Event → debit/credit lines. Missing accounts are skipped with a warning, never fail the business transaction. |
| Group P&L            | `accountingService.getProfitAndLoss`                                                                     | Sums all `income` and `expense` accounts over posted lines in the period.                                     |
| Platform billing     | `subscriptions`, `billing_accounts`, `invoices`, `payments` (005), `organization_billing_accounts` (051) | Separate from the group ledger.                                                                               |
| Group analytics      | `lib/services/analytics.service.ts`                                                                      | Reads `contributions`, `loans`, `loan_repayments`, `welfare_*` directly, not the journal.                     |

## 2. Findings

### F1 — Platform subscriptions and SMS top-ups are group expenses (implemented)

Per product direction, these are group expenses whoever paid the M-Pesa:

- **Subscription plans:** `DR 5003 Platform Subscription` / `CR 1001 Cash and M-Pesa`, posted by `subscription_payment` from the STK callback (invoice-bound payments) and `billing.recordPayment`.
- **SMS credit top-ups:** `DR 5002 SMS Expenses` / `CR 1001 Cash and M-Pesa`, posted by the new `sms_topup_expense` template inside `billingService.addSmsCredits`, after the exactly-once `sms_credits` insert. A replayed STK callback that credits nothing therefore posts nothing.
- Previously, STK top-ups with an invoice were booked to `5003` by the invoice-bound block. That block now skips `purpose = 'sms_topup'`.

The billing tables (`invoices`, `payments`, `sms_credits`) remain the platform-side record.

### F2 — Group membership (registration) fees are group revenue (implemented)

A registration is membership in a group. Its fee is group revenue, `DR 1001 Cash and M-Pesa` / `CR 4003 Registration Fees`, through the `registration_fee` template. Two paths post it:

- **PayBill joining fee** (`registration` product, via an open payment request): `dispatchProduct` → `applyRegistrationFeeFromC2B`. Idempotent per M-Pesa receipt.
- **STK invoice payment with `purpose = 'registration'`**: the invoice-bound block in `mpesa-stk.service.ts` selects `registration_fee` instead of `subscription_payment`.

### F3 — Fines are posted to generic "Other Income" (not changed)

`fine_collection` credits `4004 Other Income`. The prompt asks for a dedicated Fines metric.

Changing this needs a new `4007 Fines Income` account. Existing groups do not have it, and a missing account is silently skipped by the template engine. Fixing it safely requires an ensure-account step before posting, plus a migration for existing charts. Deferred to Phase 2.

### F4 — Changi$ha campaign donations are booked as income (not changed)

`campaign-donation-ledger.service.ts` credits `4006 Changi$ha Donations` (type `income`) when donations are received, before withdrawal. Money held for a campaign beneficiary is counted as group operating income in the P&L. This is a classification question for the product owner: liability (funds held) versus income. Deferred.

### F5 — Group analytics do not use the ledger (not changed)

`analytics.service.ts` sums source tables (`contributions`, `loan_repayments`, `welfare_*`) directly, while the P&L comes from the journal. Two sources of truth can disagree. A reconciliation check is needed before the dashboards are unified. Deferred.

### F6 — Contributions have no subtype (not changed)

`contributions` has no `contribution_type` column. Per-purpose totals (Regular Savings, Welfare, Investment, …) need a schema change. Deferred.

### F7 — Expenditure has no categories (not changed)

Group expenses post to `5001 Administrative Expenses` only. Category sub-accounts and configurable categories are a Phase 2 item.

### F8 — Transfers and refunds

Treasury transfers and refund/reversal linkage were not audited in this pass. Deferred.

## 3. Target classification model (Phase 2 plan)

| Transaction                | Owner                  | Group P&L                     | Platform billing     | Notes                          |
| -------------------------- | ---------------------- | ----------------------------- | -------------------- | ------------------------------ |
| Member contribution        | Group                  | Income (contributions)        | No                   | Subtype needed (F6).           |
| Registration fee (joining) | Group                  | Income `4003`                 | No                   | Implemented (F2).              |
| Fine paid                  | Group                  | Income `4004` (target `4007`) | No                   | F3.                            |
| Loan interest              | Group                  | Income `4002`                 | No                   | Already separate.              |
| Loan principal repayment   | Group                  | Balance sheet only            | No                   | Already on `1101`.             |
| Group expense              | Group                  | Expense `5001`                | No                   | Categories in F7.              |
| Platform subscription      | Group (expense `5003`) | Expense                       | Yes (billing tables) | Owner decision; see F1 caveat. |
| Changi$ha donation         | Campaign               | Not income until decided      | No                   | F4.                            |
| Internal transfer          | Same entity            | Not income or expense         | No                   | Balance movement only.         |

## 4. Verification

- `npx tsc --noEmit`: clean.
- `npx eslint` on changed files: clean.
- `npx jest --testPathPatterns "accounting|posting-templates|mpesa|billing|allocation"`: 7 suites, 98 tests passing, plus the new registration-fee mapping test.
- Not run here: integration tests (`jest.integration*`), which need a live Postgres. The `registration` dispatch path and the subscription posting removal should be exercised there before deploy.
