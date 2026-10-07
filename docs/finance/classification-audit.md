# Financial Classification Audit

Scope: how Kitabu Yetu classifies money movements into the group ledger, platform billing, and dashboards. This records what was verified in code, what was changed, and what is deliberately deferred.

## 1. Existing architecture (verified)

| Layer | Where | Notes |
|---|---|---|
| Chart of accounts | `accounts` (migration 004), seeded by `DEFAULT_ACCOUNTS` in `lib/services/accounting.service.ts` | Per group. Income `4001`–`4006`, expense `5001`–`5004`. |
| Double-entry journal | `journal_entries` / `journal_lines` (004; `entry_date` added in 091) | Posted entries only feed P&L and balance sheet. |
| Posting templates | `lib/services/posting-templates.service.ts` (`DEFAULT_TEMPLATES`) | Event → debit/credit lines. Missing accounts are skipped with a warning, never fail the business transaction. |
| Group P&L | `accountingService.getProfitAndLoss` | Sums all `income` and `expense` accounts over posted lines in the period. |
| Platform billing | `subscriptions`, `billing_accounts`, `invoices`, `payments` (005), `organization_billing_accounts` (051) | Separate from the group ledger. |
| Group analytics | `lib/services/analytics.service.ts` | Reads `contributions`, `loans`, `loan_repayments`, `welfare_*` directly, not the journal. |

## 2. Findings

### F1 — Platform subscription payments were posted into the group ledger (fixed)

`DR 5003 Platform Subscription (expense)` / `CR 1001 Cash and M-Pesa` was posted from two paths:

- `mpesa-stk.service.ts` (STK callback for invoice-bound payments)
- `billing.service.ts` `recordPayment`

Both paths paid Kitabu Yetu, not the group. The STK request uses the single platform shortcode (`SHORTCODE`), so group funds were never the source. The effect was that a platform charge reduced a group's recorded cash and appeared as a group operating expense.

**Change:** both postings are removed. Platform revenue stays in the billing tables.

### F2 — Group registration fee revenue was never posted (fixed)

The joining fee is group revenue, collected when a new member joins. Per the product owner it belongs to the group, like fines.

- `fulfilMatchingRequest` / `dispatchProduct` treated `registration` as an unknown product. It was routed to the treasurer's unrouted queue (`c2bToUnrouted`), so the group ledger never received the income.
- The STK path for `purpose: 'registration'` is deliberately a no-op (group verification is OTP-based, not paid). That is unchanged.

**Change:**
- New posting template `registration_fee`: `DR 1001 Cash and M-Pesa` / `CR 4003 Registration Fees`.
- `dispatchProduct` gains a `registration` case → `applyRegistrationFeeFromC2B`.
- Idempotent per M-Pesa receipt: skips if a posted journal already references the receipt.
- The event is added to the posting-policy validator enum so it can be overridden in the Policies UI.

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

## 3. Historical reclassification (report only, not executed)

Subscription postings made before this change remain in the ledger. Do not delete them automatically. Review this report first, then decide between a reversing entry per journal or a reclassification to a platform-owned account.

```sql
-- Historical platform-subscription postings that hit a group ledger.
SELECT je.id              AS journal_entry_id,
       je.group_id,
       je.entry_date,
       je.reference       AS receipt_or_invoice_ref,
       je.description,
       jl.debit           AS amount_kes
FROM journal_entries je
JOIN journal_lines jl ON jl.journal_entry_id = je.id
JOIN accounts a       ON a.id = jl.account_id
WHERE je.status = 'posted'
  AND je.description LIKE 'Platform subscription payment%'
  AND a.account_code = '5003'
ORDER BY je.entry_date, je.group_id;
```

Recommended treatment per row: post a reversing journal (`DR 1001` / `CR 5003`) with a reference to the original entry, so the original stays auditable. Do not edit or delete the original.

## 4. Target classification model (Phase 2 plan)

| Transaction | Owner | Group P&L | Platform billing | Notes |
|---|---|---|---|---|
| Member contribution | Group | Income (contributions) | No | Subtype needed (F6). |
| Registration fee (joining) | Group | Income `4003` | No | Implemented (F2). |
| Fine paid | Group | Income `4004` (target `4007`) | No | F3. |
| Loan interest | Group | Income `4002` | No | Already separate. |
| Loan principal repayment | Group | Balance sheet only | No | Already on `1101`. |
| Group expense | Group | Expense `5001` | No | Categories in F7. |
| Platform subscription | Platform | Not posted | Yes | Implemented (F1). |
| Changi$ha donation | Campaign | Not income until decided | No | F4. |
| Internal transfer | Same entity | Not income or expense | No | Balance movement only. |

## 5. Verification

- `npx tsc --noEmit`: clean.
- `npx eslint` on changed files: clean.
- `npx jest --testPathPatterns "accounting|posting-templates|mpesa|billing|allocation"`: 7 suites, 98 tests passing, plus the new registration-fee mapping test.
- Not run here: integration tests (`jest.integration*`), which need a live Postgres. The `registration` dispatch path and the subscription posting removal should be exercised there before deploy.
