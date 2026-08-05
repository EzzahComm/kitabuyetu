# Kitabu Yetu — Capital & Investment Layer (Realigned Spec)

**This supersedes `kitabu-yetu-capital-layer-prompt.md` for implementation purposes.**
The original spec's *business semantics are adopted wholesale*; its *schema, precision, vocabulary, and architectural mechanism are corrected* to match the codebase. See [impact-report.md](./impact-report.md) for the evidence behind every correction.

**Status:** awaiting sign-off on the six open decisions in impact-report §7. Do not begin Phase 1 until they are answered.

---

## 1. Corrected non-negotiables

These replace the original §0 non-negotiables. Changes are marked.

1. **Ledger is truth; counters are derived and provably equal.** *(amended — original said "never store a balance in a mutable counter")* This codebase already maintains counters (`organization_wallets.*`, `funding_programs.disbursed_total`, `accounts.balance`) via triggers and transactional updates. Keep them. Satisfy the intent by shipping `rebuild_organization_capital_balances(organization_id)` plus a nightly reconciliation job that asserts equality against the ledger and writes drift to `capital_reconciliation_alerts`. A counter that cannot be rebuilt from the ledger is a defect.

2. **Every money-moving operation is a single atomic transaction.** *(amended — original mandated a Postgres RPC)* Use the established `withAdminDb` / `withTransaction` service-layer pattern over raw `pg`, as every existing money path does. Atomicity is the requirement; `SECURITY DEFINER` RPCs are reserved for their existing narrow purpose (RLS privilege escalation), not adopted as the money API.

3. **Money is `numeric(15,2)`.** *(corrected from `numeric(14,2)`)* Interest rates are `numeric(5,2)` expressed as a **percentage** (12.50 = 12.5%), matching `loans.interest_rate` — never a `numeric(5,4)` ratio.

4. **Actors are `members(id)`.** *(corrected from `auth.users`)* `auth.users` does not exist in this database.

5. **Every write returns the existing structured error envelope** (`lib/utils/response.ts` — `ok()`, and the `ValidationError`/`NotFoundError` family). Do not invent a new one. *(unchanged)*

6. **RLS is written on every new table, but is not the live enforcement boundary.** The app role has `BYPASSRLS` today; the `app_tenant` cutover has not happened. Enforce authorization in the service layer *and* write the RLS policies for the post-cutover world. Verify new policies under the `app_tenant` CI job — that job is the only place RLS is actually exercised, and it has caught real bugs three times.

7. **No mock or seed data in any production code path.** *(unchanged)*

8. **Reuse, don't rebuild:** `idempotency_keys` (migration 057) for idempotency; `mpesa_unrouted` for suspense; `posting-templates.service.ts` for all GL postings; the `permissions text[]` RBAC system for authorization; `audit_logs` for the audit trail.

---

## 2. Corrected vocabulary

| Concept | Original spec | **Use instead** |
|---|---|---|
| Money type | `numeric(14,2)` | `numeric(15,2)` |
| Interest rate | `numeric(5,4)` ratio | `numeric(5,2)` percentage |
| Interest method | `flat \| declining_balance \| none` | `flat \| reducing_balance` (+ `is_repayable=false` for grants) |
| Actor FK | `auth.users` | `members(id)` |
| Table prefix | `cap_*` | extend `organization_*` / `funding_*`; new group-side tables unprefixed |
| Financial product | `cap_financial_products` (new) | **extend `funding_programs`** |
| Allocation | `cap_allocations` (new) | **extend `organization_disbursements`** |
| Capital movements | `cap_capital_movements` (new) | **extend `organization_ledger`** |
| Org roles | `org_admin\|portfolio_manager\|field_officer\|finance\|auditor` | **pending D-C** — recommend permission strings on the live RBAC system, keeping `org_role ∈ {lead,staff}` |

---

## 3. Schema deltas

### 3.1 Extend `funding_programs` (the financial product)

```sql
ALTER TABLE funding_programs
  ADD COLUMN product_code          text,
  ADD COLUMN is_repayable          boolean NOT NULL DEFAULT false,
  ADD COLUMN capital_model         text NOT NULL DEFAULT 'liability',
  ADD COLUMN loss_bearer           text NOT NULL DEFAULT 'group',
  ADD COLUMN shared_loss_ratio     numeric(5,4),
  ADD COLUMN interest_method       varchar,
  ADD COLUMN interest_rate_annual  numeric(5,2),
  ADD COLUMN repayment_frequency   text,
  ADD COLUMN grace_period_days     integer NOT NULL DEFAULT 0,
  ADD COLUMN tenor_months          integer,
  ADD COLUMN revenue_owner         text NOT NULL DEFAULT 'organization',
  ADD COLUMN revenue_share_ratio   numeric(5,4),
  ADD COLUMN repayment_waterfall   jsonb,
  ADD COLUMN member_visibility     text NOT NULL DEFAULT 'aggregate';
```

Database-level constraints (mirroring the original §5.2, adjusted):
- `capital_model IN ('liability','pass_through')` — only `liability` implemented
- `loss_bearer IN ('group','organization','shared')` — only `group` implemented
- `interest_method IN ('flat','reducing_balance')` — **matches `loans_interest_method_check`**
- `is_repayable = false` → `interest_rate_annual IS NULL AND repayment_frequency = 'none'`
- `is_repayable = true` → `repayment_frequency <> 'none' AND tenor_months IS NOT NULL AND repayment_waterfall IS NOT NULL`
- `revenue_owner = 'shared'` → `revenue_share_ratio BETWEEN 0 AND 1`
- `loss_bearer = 'shared'` → `shared_loss_ratio BETWEEN 0 AND 1`
- `UNIQUE (organization_id, product_code)`

`program_type` already carries `seed_capital`, `revolving_fund`, `loan_capital`, `grant`, and six more — **reuse it**, do not add `product_type`.
`eligibility_criteria jsonb` already exists — **reuse it** for the original §5.3 rule shape, do not add `eligibility_rules`.

### 3.2 Extend `organization_disbursements` (the allocation)

Already has: maker-checker (`chk_org_disb_maker_checker`: `approved_by <> created_by`), `ledger_entry_id`, `group_journal_entry_id`, `funding_program_id`, `group_id`, `amount`, rejection fields.

```sql
ALTER TABLE organization_disbursements
  ADD COLUMN allocation_code       text UNIQUE,   -- ALC-2026-000148
  ADD COLUMN proposed_by           uuid REFERENCES members(id),
  ADD COLUMN is_repayable          boolean NOT NULL DEFAULT false,
  ADD COLUMN interest_rate_annual  numeric(5,2),  -- SNAPSHOT at disbursement
  ADD COLUMN repayment_frequency   text,          -- SNAPSHOT
  ADD COLUMN tenor_months          integer,       -- SNAPSHOT
  ADD COLUMN first_repayment_date  date,
  ADD COLUMN maturity_date         date,
  ADD COLUMN purpose               text;
```

**Snapshot discipline is retained from the original spec and is mandatory:** changing a product's rate must never retroactively alter an existing allocation.

Extend the `status` CHECK from `pending_approval|approved|completed|rejected|returned|cancelled` to add `active|overdue|fully_repaid|written_off`, and enforce the transition machine in a trigger:

```
pending_approval → approved → completed → active → {fully_repaid | overdue | written_off}
overdue → {active | fully_repaid | written_off}
pending_approval → {rejected | cancelled}
```
(`completed` is the existing name for the original spec's `disbursed`.)

### 3.3 Extend `organization_ledger` (capital movements)

Add to `entry_type`: `recovery_principal`, `revenue_interest`, `revenue_penalty`, `write_off`, `recovery_reversal`.
Add `idempotency_key text UNIQUE` and `reverses_entry_id uuid REFERENCES organization_ledger(id)`.
Add a trigger raising on UPDATE/DELETE — reversals are new rows with opposite `direction`.

### 3.4 New tables

`group_funding_sources`, `loan_funding_splits`, `allocation_schedule`, `allocation_events`, `repayment_splits`, `capital_reconciliation_alerts` — shapes exactly as the original §5.5–5.8, with money as `numeric(15,2)` and actor FKs to `members(id)`.

**The keystone invariant, enforced by a deferred constraint trigger** (following migration 027's `trg_assert_posted_balance_deferred` precedent — note that on a partitioned table, constraint triggers must be created per-partition):

```
sum(loan_funding_splits.amount) = loans.principal_amount   -- for every disbursed loan
```

---

## 4. Service layer

New: `lib/services/capital-allocation.service.ts`, `capital-products.service.ts`, `funding-sources.service.ts`, `capital-waterfall.service.ts`.

The waterfall engine stays **a pure, separately-testable function** as the original §7 demands — but as a pure TypeScript function with property-based tests, not a Postgres function, matching where the rest of this codebase's financial computation lives (`accounting.service.ts`, `member-balances.service.ts`). It must not be inlined into the write path.

Waterfall rules are adopted unchanged from the original §7: configured order, per-component `revenue_split` summing to 1.0, residual handling, pro-rata multi-source apportionment (or `source_priority`), and rounding allocated to the last component so splits sum **exactly** to the repayment. Assert equality before commit; never let rounding create or destroy value.

Modified existing services — the highest-risk surface:
- `loansService.disburse()` — accept a funding plan; write `loan_funding_splits`; **default to internal savings so existing behaviour cannot break**
- `loansService.recordRepayment()` — write `repayment_splits`; propagate to allocation + `organization_ledger` in the same transaction
- `posting-templates.service.ts` — **new template events** for capital-funded disbursement/repayment. Template overrides may only remap account codes (line structure is locked by design), so a new event is required rather than an override of the existing loan events.

---

## 5. Authorization

Pending D-C. Recommended: permission strings on the existing RBAC system rather than an `org_role` enum fork —

```
capital.product.manage      capital.allocation.propose
capital.allocation.approve  capital.allocation.disburse
capital.allocation.writeoff capital.repayment.record
capital.report.view
```

Seeded via a migration following the 110/112/113 precedent, resolved through `lib/auth/permissions.ts`, gated with `withPermission`. **Separation of duties (`approved_by <> proposed_by`) is a database CHECK, not a UI rule** — the existing `chk_org_disb_maker_checker` already sets this precedent.

For sensitive operations (disburse, write-off), extend `assertAuthFresh`'s existing pattern of re-verifying the permission against live `roles.permissions` rather than trusting the JWT claim.

---

## 6. Phasing (revised)

Phase boundaries and acceptance criteria are adopted from the original §12, with these corrections:

- **Phase 0** — this document + [impact-report.md](./impact-report.md). **Complete; awaiting sign-off.**
- **Phase 1** — extend `funding_programs`; product CRUD + capitalization. *Accept when:* a product capitalized to KES 10,000,000 shows available 10,000,000 / allocated 0, and cross-organization denial tests pass under the `app_tenant` CI job.
- **Phase 1a (landed, migration 115)** — `group_funding_sources` shipped ahead of the rest as unblocked groundwork: it depends on none of the six open decisions, and every later phase depends on it. Includes the table + constraints, an auto-provisioning `AFTER INSERT` trigger on `groups` (`SECURITY DEFINER`, per the migration-099 lesson), a backfill of all existing groups with an apply-time assertion, RLS, `lib/services/funding-sources.service.ts`, and an integration suite. No money moves; no GL posting; no balances stored.
- **Phase 2** — allocation lifecycle on `organization_disbursements`; eligibility; schedule; wiring allocation-backed rows into `group_funding_sources`. *Accept when:* the reference scenario runs — EZZAHCOMM allocates KES 1,000,000 to The Fionas; org shows 9,000,000 available / 1,000,000 allocated; group shows the funding source; self-approval is rejected; an ineligible group is refused without an override and accepted with a logged one.
- **Phase 3** — `loan_funding_splits` + backfill. **Note: production has 0 loans**, so the backfill's live blast radius is zero — but the balance-diff assertion ships exactly as specified regardless.
- **Phase 4** — waterfall, `repayment_splits`, M-Pesa attribution via existing `idempotency_keys`, suspense via existing `mpesa_unrouted`.
- **Phase 5** — reporting views under a `reporting` schema; metric definitions in `metrics.md`.
- **Phase 6** — reconciliation job, drift alerts, full RLS denial suite under `app_tenant`, rollback rehearsal.

Every phase: `tsc --noEmit`, `eslint`, full Jest suite, and `next build` verified **per phase, not batched**. Migrations are **not** auto-deployed by CI/CD on this project — each new migration must be handed over for manual application, with a verification query.

---

## 7. Unchanged from the original spec

Adopted without modification: the business objective and reference scenario (§1); the domain model and the attribution principle (§4); eligibility rule shape (§5.3); the waterfall engine's rules (§7); RLS actor tiers and the denial-test list (§9); metric definitions and the requirement to document them exactly (§10); route/UI structure (§11); testing requirements (§13); the non-goals list (§14); and the documentation deliverables (§15).

The original document remains the reference for all of the above. This file records only what had to change to fit the codebase.
