# Platform Dashboard & Access Audit — 2026-10-07

**Scope:** backoffice (platform) dashboards, platform revenue classification,
platform-role least privilege, and organization route scoping.
**Status:** partial. Two defects fixed (revenue classification, support
finance leak). Remaining items are listed in §5 and are **not** implemented.
Not deployed.

Access principle applied: access follows the organizational hierarchy and role
permissions, not the URL, UI menu, or record ID.

---

## 1. Implementation map

| Area                       | Where it lives                                                                                                                                                                                  | Notes                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Authentication             | `lib/auth/jwt.ts`, `lib/auth/mfa.ts`, `proxy.ts`                                                                                                                                                | Edge proxy stamps `x-aud`, `x-role`, `x-organization-id`.                                                     |
| Tenant (group) RBAC        | `lib/auth/middleware.ts` `withPermission`/`withAnyPermission`, `lib/auth/permissions.ts`                                                                                                        | Permission strings resolved from `roles.permissions`. `super_admin` bypasses.                                 |
| Tenant role ladder         | `lib/auth/rbac.ts`, `withRole`/`withOneOf`                                                                                                                                                      | Numeric hierarchy; org coordinator ranks below member, so flat allowlists are used for org/platform.          |
| Backoffice (platform) RBAC | `lib/auth/middleware.ts` `withPlatformRole`, `withBackofficeAuth`                                                                                                                               | Flat allowlists on `platformRole`.                                                                            |
| Organization RBAC          | `lib/auth/organization-permissions.ts`, `withOrganizationAccess`                                                                                                                                | Coordinator/super_admin only. Flat map; `_permission` is currently unused.                                    |
| Subscription gate          | `lib/auth/subscription-gate.ts`                                                                                                                                                                 | Applied inside `withAuth` for tenant routes.                                                                  |
| Database RLS               | `supabase/migrations/20260101000009_010_rls_policies.sql` and later                                                                                                                             | Group isolation via `app_current_group_id()`. Org isolation is enforced in services (`organization_id = $n`). |
| Platform dashboard         | `app/api/admin/dashboard/route.ts`, `lib/services/admin.service.ts` (`getPlatformStats`, `getRevenueTrend`, `getRiskDashboardData`, `getMonitoringDashboardData`), `app/(admin)/admin/page.tsx` |                                                                                                               |
| Platform billing           | `app/api/admin/billing/route.ts`, `getBillingOverview`                                                                                                                                          |                                                                                                               |
| Payment spine              | `payments.allocation_status`, `payment_id` back-links (migration 057)                                                                                                                           | Links group product rows to payments.                                                                         |
| Group product rows         | `contributions`, `loan_repayments`, `welfare_pool_contributions`, `share_transactions` (each with `payment_id`)                                                                                 |                                                                                                               |
| Platform subscription link | `subscriptions.payment_id` (migration 138)                                                                                                                                                      | Exactly-once activation payment.                                                                              |
| Products & plans           | `types/enums.ts` (`SubscriptionProduct`, `PlanType`); DB `subscription_product` (migrations 127, 213); `plan_type` (001, 138)                                                                   | Products: `kitabu_yetu`, `chama_reminder`, `changisha`. Plans: `starter`, `growth`, `premium`, `enterprise`.  |
| Organization finance       | `lib/services/organization-finance.service.ts`                                                                                                                                                  | Ownership enforced in SQL (`organization_id = $n`).                                                           |

---

## 2. Findings

### F1 — Platform revenue included group customer money (fixed)

`getPlatformStats` and `getRevenueTrend` summed every completed row in
`payments`. `payments.group_id` is `NOT NULL`, so member contributions paid
through M-Pesa were reported as Kitabu Yetu revenue. This is the
"sum every transaction" pattern the brief forbids.

**Fix:** `lib/services/platform-revenue-classification.ts` defines the rules.
Platform revenue is payments referenced by `subscriptions.payment_id`, which is
the only definitive platform marker in the schema. Revenue is attributed by
**product and plan** from the subscription row. Group collections (rows linked
to contributions, loan repayments, welfare, or share transactions) and
everything else are reported separately as reconciliation totals, never as
revenue.

### F2 — Invoice-settling payments are platform revenue (owner decision, fixed)

The owner confirmed that invoices are billed by Kitabu Yetu to groups or
organizations. An invoice-linked payment is therefore platform revenue, and it
is attributed to the `invoices` stream. The rule requires
`invoices.billing_account_id IS NOT NULL`. Payments that also belong to a group
product row or to a subscription/SMS top-up are counted once, in the first
matching stream.

Earlier, `invoice_id` was not used as a marker, because `payment_accounts`
with `kind = 'invoice'` also resolves to `invoices` (`mpesa-payment-accounts.service.ts`
line 66). That was the open question, and the owner's answer resolves it.

### F3 — Support role could read platform finance (fixed)

`/api/admin/dashboard` (default stats, revenue trend) and `/api/admin/billing`
were allowed for `['super_admin', 'support']`. Support could read revenue, MRR,
billing summaries, and recent payments.

**Fix:**

- `/api/admin/billing` → `super_admin` only.
- `/api/admin/dashboard?widget=revenue_trend` → `super_admin` only
  (`canViewPlatformFinance`).
- Default stats → `redactPlatformStatsForRole`. Support receives operational
  counts and tickets; `revenue` is removed and `subscriptions.mrr` is removed.
  Fields are removed, not zeroed, so an absent figure is not read as a real zero.

### F4 — Organization ownership checks (verified, no defect)

`organization-finance.service.ts` contains several queries by bare `id`
(for example `fetchOrgDisbursement`, `organization_wallets WHERE id`). Each
caller was traced. `approveDisbursement` and `rejectDisbursement` first query
`WHERE id = $1 AND organization_id = $2`, and `getWalletForUpdate` and
`getProgramForUpdate` take `organizationId`. The bare-id reads run only after
that check, so no cross-organization path was found. This is recorded so the
pattern is not re-audited from scratch.

### F5 — Product/plan dimension was missing from platform finance (fixed)

The old `getBillingOverview.byPlan` grouped only by `plan_type`, mixing
`kitabu_yetu` and `chama_reminder` subscriptions. It is now grouped by
`(product, plan_type)`. Platform revenue and revenue trend carry the product
split (`byProductPlan`, `by_product`).

---

## 3. Changes in this branch

| File                                                              | Change                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/services/platform-revenue-classification.ts`                 | New. Classification SQL, product/plan breakdown, role-based redaction, finance-access predicate.                                                                                                                                                                      |
| `lib/services/admin.service.ts`                                   | `getPlatformStats` revenue is platform-only with product/plan breakdown plus `groupCollections` and `unclassified`. `getRevenueTrend` is platform-only and monthly, with `by_product`. `getBillingOverview` groups plans by product and lists platform payments only. |
| `app/api/admin/dashboard/route.ts`                                | Revenue trend restricted to super_admin. Default stats redacted for support.                                                                                                                                                                                          |
| `app/api/admin/billing/route.ts`                                  | super_admin only.                                                                                                                                                                                                                                                     |
| `app/(admin)/admin/page.tsx`                                      | Typed revenue fallback (the value now comes from a classified shape).                                                                                                                                                                                                 |
| `__tests__/unit/services/platform-revenue-classification.test.ts` | New. 12 tests covering classification rules (subscription, SMS top-up, invoice), no-double-count, product/plan attribution, finance access, and redaction.                                                                                                            |
| `docs/audits/PLATFORM_DASHBOARD_ACCESS_AUDIT_2026-10-07.md`       | This document.                                                                                                                                                                                                                                                        |

**Response-shape change:** `stats.revenue` keys changed from `total_collected`
to `total`. The only consumer is the admin overview page, which reads
`this_month` and `this_week`, and those keys are unchanged. No other code reads
`total_collected` from the admin payload.

**Verification:** `tsc --noEmit` clean; eslint clean on changed files;
Prettier clean; `admin-dashboard.test.ts` and the new test file pass (14/14).
The SQL has not been run against a live database.

---

## 4. Known limits of the platform revenue number

- **Revenue streams.** Platform revenue has three streams, each attributed
  with its own product key:
  - `subscription` — by `kitabu_yetu`, `chama_reminder`, `changisha` and plan.
  - `sms_credits` — SMS top-ups, group (`sms_credits`) and organization
    (`organization_sms_credits`), keyed on `payment_id`.
  - `invoices` — payments settling a platform invoice (F2).
- **Not yet verified against a live database.** The SQL is built from shared
  constants and has been checked by unit tests on its structure only. Run it
  against a database before relying on the numbers.
- **Outstanding receivables** (`getBillingOverview.outstanding`) read `invoices`
  as platform billing, per the owner's answer in F2.

---

## 5. Not implemented (from the brief)

These are open and were not built in this change:

- Hierarchical scope model (platform → organization → program → group →
  member) for drill-down and per-entity dashboards.
- Program and group financial dashboards, member self-service dashboard
  changes, and the Organization Finance dashboard breakdown.
- Dedicated financial classification column on `payments` (a migration with a
  backfill). This is the proper fix for F2 and §4.
- Scoped global search, the audit dashboard (filters and immutability review),
  security/access monitoring, and export authorization review (CSV, PDF, and
  report generation).
- Reconciliation / financial data health panel.
- RLS policy audit against the aggregate queries above.
- Integration tests against a live database for the new SQL, and a production
  build run.

**Decisions:**

1. **Resolved:** invoices are billed to groups or organizations, so
   invoice-settling payments are platform revenue (F2).
2. **Resolved:** SMS credit top-ups are platform revenue (`sms_credits` stream).
3. **Open:** whether platform support should see group-level operational counts
   (current behavior, unchanged) or only ticket data.
