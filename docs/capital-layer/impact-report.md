# Capital & Investment Layer — Phase 0 Impact Report

**Status:** Phase 0 complete. **Blocked pending review — no schema work has begun.**
**Date:** 2026-08-05
**Source spec:** `kitabu-yetu-capital-layer-prompt.md` (EZZAHCOMM NEXUS)
**Method:** Live production schema introspection (`information_schema`, `pg_constraint`, `pg_type`, `pg_policies` against project `qztcgryhoanennsizcll`) plus source reading. Every claim below cites either a real column/constraint observed in production or a file path. Nothing here is inferred from the spec's own assumptions.

---

## 0. Executive summary — read this first

The spec is well-constructed financial engineering, and its **domain reasoning is sound**. But it was written against an assumed stack that is not this codebase. Applying it literally would:

1. **Create duplicate tables for four subsystems that already exist and are already wired into the general ledger** (`organizations`, `organization_members`, `funding_programs`, `organization_disbursements` + `organization_ledger` + `organization_wallets`).
2. **Fork the architecture** by mandating `SECURITY DEFINER` RPC money movement, which is not how any of the ~14 existing money paths in this codebase work.
3. **Mismatch money precision** on every table (`numeric(14,2)` vs. the codebase's universal `numeric(15,2)`).
4. **Reintroduce a role (`field_officer`) that was explicitly investigated and dropped** as not-real in a prior audit cycle.
5. Reference `auth.users`, which **appears zero times** in this repo's 114 migrations.

**The genuine, valuable gap the spec identifies is real and is not yet built:** organization capital that flows to a group is currently **one-way and unrecoverable**. There is no repayment, no schedule, no interest, no recovery ledger, and — most importantly — **no attribution of member loans to a funding source**. That last item is the true keystone, and the spec is right that it is not optional.

Recommendation: **adopt the spec's semantics, reject its schema.** Build the capital layer as an *extension of* the existing organization-finance domain, not a parallel `cap_*` domain beside it. §6 below gives the realigned table plan.

### What already exists vs. what the spec proposes

| Spec proposes | Reality in this codebase | Verdict |
|---|---|---|
| `organizations` (new) | **Exists.** Different shape entirely — no `org_code`, no `legal_name`/`display_name` split, `is_active boolean` not `status`, `email`/`phone` not `contact_*` | Extend, don't create |
| `organization_members` (new, `user_id → auth.users`) | **Exists** (migration 101). Uses `member_id → members`, `org_role ∈ {lead, staff}` | Extend enum, don't create |
| `cap_financial_products` | **`funding_programs` exists** — `budget`, `disbursed_total`, `eligibility_criteria jsonb`, `geographic_coverage`, `program_type` (10 values incl. `seed_capital`, `revolving_fund`), `status ∈ {draft,active,paused,closed}` | Extend, don't create |
| `cap_allocations` | **`organization_disbursements` exists** — already has maker-checker CHECK, status machine, `group_journal_entry_id`, `ledger_entry_id` | Extend for repayability |
| `cap_capital_movements` | **`organization_ledger` exists** — `entry_type`, `direction`, `amount`, `balance_after`, `funding_program_id`, `group_id`, `disbursement_id` | Extend `entry_type` vocabulary |
| `cap_product_balances` (view) | **`organization_wallets` exists** — mutable counters: `available_balance`, `committed_balance`, `total_deposited`, `total_disbursed`, `total_returned` | Reconcile (see D-A) |
| `group_funding_sources` | **Does not exist** | ✅ Genuinely new |
| `loan_funding_splits` | **Does not exist** | ✅ Genuinely new — the keystone |
| `repayment_splits` | **Does not exist** | ✅ Genuinely new |
| Allocation repayment/recovery | **Does not exist** — `settleOrgDisbursement` is terminal | ✅ Genuinely new |
| `idempotency_key` on money RPCs | **`idempotency_keys` table exists** (migration 057, payment spine) | Reuse, don't reinvent |
| Suspense account for unattributable receipts | **`mpesa_unrouted` + `mpesa-unrouted.service.ts` exist** | Reuse, don't reinvent |

---

## 1. Blocking decisions D1–D5, answered from code

### D4 — Currency and precision → **ANSWERED BY CODE. The spec is wrong; correct it.**

The spec mandates `numeric(14,2)`. **Every money column in this database is `numeric(15,2)`.** Verified across `loans.principal_amount`, `loans.outstanding_balance`, `loans.total_repayable`, `loan_repayments.*` (all six money columns), `organization_wallets.*` (all five), `organization_ledger.amount`/`balance_after`, `organization_accounts.balance`, `organization_journal_lines.debit`/`credit`, `funding_programs.budget`/`disbursed_total`, `organization_disbursements.amount`.

**Ruling: all new money columns are `numeric(15,2)`.** Not negotiable in the other direction — mixing precisions across a join boundary is exactly the class of defect the spec's own §3 D4 is trying to prevent.

Second, subtler precision finding the spec did not anticipate:

- Spec: `interest_rate_annual numeric(5,4)` — a **ratio** (0.1250 = 12.5%)
- Codebase: `loans.interest_rate numeric(5,2)` with `CHECK (interest_rate >= 0)` — a **percentage** (12.50 = 12.5%)

These are different representations of the same concept and would silently differ by 100×. **Ruling: use `numeric(5,2)` as a percentage**, matching `loans`. Note that `numeric(5,4)` also cannot represent a rate ≥ 10.0000, which would be an absurd constraint for a percentage-based column.

### D3 — Interest accrual method → **ANSWERED BY CODE. Spec vocabulary is wrong.**

Spec proposes `('flat','declining_balance','none')`.

Actual, from `loans_interest_method_check`:
```
CHECK (interest_method IN ('flat', 'reducing_balance'))
```
Confirmed in TypeScript at [lib/services/loan-policy.service.ts:93](../../lib/services/loan-policy.service.ts#L93) (`export type InterestMethod = 'flat' | 'reducing_balance'`) and [lib/validators/loan.schema.ts:66](../../lib/validators/loan.schema.ts#L66).

**Ruling: use `flat | reducing_balance`.** The term is `reducing_balance`, not `declining_balance` — introducing a second spelling for the same concept is precisely the "second, inconsistent accrual method" the spec's own D3 forbids.

`'none'` has no equivalent in the member-loan engine. For non-repayable products (grants), the correct modelling is `is_repayable = false` gating the column to NULL, **not** a third enum value — otherwise `'none'` becomes a second way to express what `is_repayable` already expresses, and the two can disagree.

### D1 — Liability vs pass-through → **CODE DOES NOT SETTLE THIS. Recommendation stands; needs sign-off.**

No existing org→group flow models a repayable obligation, so there is no precedent to cite either way. However, one piece of existing code points strongly toward **liability**:

`settleOrgDisbursement` ([lib/services/organization-finance.service.ts:673-730](../../lib/services/organization-finance.service.ts#L673)) already posts a **dual-ledger transfer** — the organization side debits `5001 Program Disbursements` / credits `1001 Cash` on its own chart of accounts, while the group side receives its own journal entry. The org side is already expensing the outflow, i.e. the existing books already treat disbursed capital as **leaving** the organization.

Under pass-through, that posting would be wrong (the capital would remain an organization asset). Under liability, it is nearly right — it needs only to change from an *expense* to a *receivable* when the product is repayable.

**Recommendation: implement `capital_model = 'liability'`**, reserve `'pass_through'` in the CHECK constraint, and implement only the liability path in Phases 1–4, exactly as the spec says. **This is a founder decision to confirm, not a code fact.**

### D2 — Loss allocation on default → **CODE DOES NOT SETTLE THIS. Follow spec default.**

`loss_bearer ∈ ('group','organization','shared')` with `shared_loss_ratio`, implementing `'group'` only. No conflict with existing code — the member-loan write-off path ([lib/services/loans.service.ts](../../lib/services/loans.service.ts) `writeOff()`, migration 084's maker-checker constraint) already posts write-offs entirely within the group's books, which *is* `loss_bearer = 'group'` behaviour. Consistent.

### D5 — Data protection scope (Kenya DPA) → **CODE DOES NOT SETTLE THIS. Genuine product/legal decision — must be answered before Phase 2.**

Relevant existing machinery the spec did not know about:

- `applyMemberMask` in [lib/services/members.service.ts](../../lib/services/members.service.ts) already masks PII (phone, email, national_id, dob, address) on a per-viewer basis.
- `stripSecrets()` + `SafeMember = Omit<Member,'password_hash'>` already exist as a hard boundary (added after a real production leak — see the 2026-07-26 incident).
- `organization_group_access` already scopes which groups an organization may see at all, with `access_level` (a USER-DEFINED enum) and `is_active`/`revoked_at`.

**The spec's `member_visibility ∈ ('aggregate','identified')` should compose with `applyMemberMask`, not bypass it.** Recommendation: default `'aggregate'`; `'identified'` still routes through the existing mask unless a separate, explicit consent flag is set. Enforce in the reporting views **and** the service layer — note that enforcing "in RLS" alone is currently insufficient (see §4).

---

## 2. New blocking decisions the spec did not anticipate

These are architectural conflicts, not preferences. Each needs an answer before Phase 1.

### D-A — "Single atomic Postgres RPC" contradicts every existing money path

Spec non-negotiable: *"Every money-moving operation is a single atomic Postgres RPC. No multi-statement money movement from the application layer."*

**This codebase does the opposite, deliberately and consistently.** All money movement runs as multi-statement transactions in the service layer via `withAdminDb` / `withTransaction` over raw `pg`:

- `settleOrgDisbursement` — `SELECT ... FOR UPDATE` → `UPDATE organization_wallets` → `INSERT organization_ledger` → `UPDATE organization_disbursements`, all inside one `withAdminDb` transaction ([organization-finance.service.ts:673-730](../../lib/services/organization-finance.service.ts#L673))
- `deposit()` — same shape, plus `UPDATE funding_programs SET disbursed_total = ...` and `INSERT INTO journal_entries` ([organization-finance.service.ts:134-180](../../lib/services/organization-finance.service.ts#L134))
- The entire M-Pesa spine, contributions, loans disbursement/repayment, shares, dividends, welfare — same pattern throughout `lib/services/`.

The 27 migrations containing `SECURITY DEFINER` use it for a **narrow and different purpose**: RLS-privilege escalation for specific operations (`register_group()`, `link_member_to_group()`, `private.update_account_balance()`, `lock_group_cash_account()`), not as the money-movement API.

Atomicity is *already guaranteed* — a `withAdminDb` transaction is as atomic as an RPC body. The spec's stated goal is satisfied; only its stated mechanism is foreign.

**Recommendation: keep the service-layer transaction pattern.** Adopting RPC-per-money-operation for this subsystem alone would create two incompatible money-movement idioms in one codebase — a worse outcome than either choice consistently applied. **Needs explicit sign-off, because it overrides a stated non-negotiable.**

### D-B — "Never store a balance in a mutable counter" contradicts the existing ledger design

Spec non-negotiable: *"Every balance is derived from an append-only ledger, never stored in a mutable counter column."*

Existing mutable counters, all load-bearing:
- `organization_wallets.available_balance`, `.committed_balance`, `.total_deposited`, `.total_disbursed`, `.total_returned`
- `funding_programs.disbursed_total` (with `CHECK (disbursed_total <= budget)` — a real invariant enforced on the counter)
- `loans.outstanding_balance`, `loans.total_repayable`
- `accounts.balance`, `organization_accounts.balance` — trigger-maintained by `private.update_account_balance()`
- `organization_ledger.balance_after` — a running balance stored per row

The spec does permit *"trigger-maintained snapshot tables that can be rebuilt from the ledger"*, which is close to what already exists. The gap is that today there is **no rebuild-and-assert function** for the organization wallet.

**Recommendation: accept the existing counters, and satisfy the spec's actual intent** by shipping `cap_rebuild_organization_balances(organization_id)` + the nightly reconciliation job + drift alerts (spec §12 Phase 6). That delivers the guarantee the non-negotiable is protecting (ledger is truth, counters are derived and provably equal) without rewriting four working subsystems. **Needs sign-off.**

### D-C — Organization role vocabulary conflict, including a previously-rejected role

Spec: `org_admin | portfolio_manager | field_officer | finance | auditor`.
Reality: `CHECK (org_role IN ('lead','staff'))` on `organization_members` (migration 101).

Two problems:
1. Straight vocabulary mismatch requiring a CHECK-constraint migration and a backfill of the existing rows.
2. **`field_officer` was explicitly investigated and rejected** during the multi-staff-organizations work: it exists nowhere in any enum or table, and was found named only once, as a *future* roadmap item in `B2B_ENTERPRISE_AUDIT.md`. It was consciously dropped as "not real." Reintroducing it here is a reversal of a recorded product decision, not a new build.

Additionally, the platform-role axis is separate and fixed: `platform_role ∈ (super_admin, support, organization_coordinator, member, regulator)`. Note `regulator` already exists and is arguably the spec's read-only `auditor`.

**Needs a decision:** extend `org_role` to the spec's five values (and reverse the `field_officer` decision), or map the spec's intent onto `lead`/`staff` + the existing `permissions text[]` RBAC system (activated 2026-08-03, migrations 110/112/113), which is the mechanism this codebase now uses for exactly this kind of granularity. **Strong recommendation: the latter** — permission strings like `capital.allocation.approve` fit the live RBAC model and avoid a role-enum fork.

### D-D — RLS is currently decorative for application traffic

The spec's §9 is a substantial RLS design, and its denial tests are worth writing. But: **the application's database role (`postgres`) has `rolbypassrls = true` in production, verified live.** Tenant isolation is currently enforced by hand-written `WHERE group_id` clauses in service code, not by RLS. The least-privilege `app_tenant` role exists and is provisioned but **is not yet in use** (`TENANT_DATABASE_URL` unset).

**Consequence:** every RLS policy written for this subsystem is defense-in-depth for a future cutover, **not** the live enforcement boundary. The spec's D5 instruction to *"enforce this in RLS and in the reporting views, not in the UI"* must be read as **"enforce in the service layer and the reporting views, and additionally write the RLS policies for the post-cutover world."*

This is not a reason to skip the RLS work — the `app_tenant` CI job has repeatedly caught real bugs invisible under BYPASSRLS. It *is* a reason not to rely on RLS as the only control for DPA-sensitive member data.

### D-E — `auth.users` does not exist here

Spec: `organization_members.user_id uuid fk auth.users`.

`auth.users` is referenced **zero times** across all 114 migrations. Authentication is custom JWT issued by this app (`proxy.ts` middleware, `members.password_hash`, `refresh_tokens`), not Supabase Auth. `lib/supabase/client.ts` and `server.ts` exist but are not the auth path.

**Ruling: all actor references are `members(id)`,** matching `organization_members.member_id`, `loans.approved_by`, `organization_disbursements.created_by`, etc. Mechanical correction, no decision needed.

### D-F — `organization_type` vocabulary mismatch

Spec: `ngo | mfi | county_government | donor | corporate_csr | sacco_union | federation | private`.
Actual enum: `bank | sacco | foundation | ngo | government | cooperative | faith_based | other`.

Overlap is partial (`ngo`; `government`≈`county_government`; `foundation`≈`donor`). Missing: `mfi`, `corporate_csr`, `sacco_union`, `federation`, `private`.

**Needs a decision:** extend the enum (Postgres `ADD VALUE` is non-transactional and irreversible — needs care), or accept the existing vocabulary. Low stakes, but it must be settled before Phase 1 because it is a create-time field.

---

## 3. Existing tables that gain columns or foreign keys

| Table | Change | Risk |
|---|---|---|
| `funding_programs` | + `is_repayable`, `capital_model`, `loss_bearer`, `shared_loss_ratio`, `interest_method`, `interest_rate_annual`, `repayment_frequency`, `grace_period_days`, `tenor_months`, `revenue_owner`, `revenue_share_ratio`, `repayment_waterfall jsonb`, `member_visibility`, `product_code` | Low — 0 rows in production |
| `organization_disbursements` | + `is_repayable`, snapshot terms (`interest_rate_annual`, `repayment_frequency`, `tenor_months`), `first_repayment_date`, `maturity_date`, `allocation_code`, `proposed_by`; extend `status` CHECK with `active`/`overdue`/`fully_repaid`/`written_off` | Low — 0 rows |
| `organization_ledger` | extend `entry_type` vocabulary: `recovery_principal`, `revenue_interest`, `revenue_penalty`, `write_off`, `recovery_reversal` | Low |
| `organizations` | + `org_code` (7-digit `ORG` prefix, mirroring the existing `KY` group-code convention), + `kra_pin`, + `country_code` | Low — 1 row |
| `organization_members` | `org_role` CHECK change **or** permission-string approach (see D-C) | Medium — 1+ live rows, auth-adjacent |
| `loans` | **No column change.** Attribution lives in the new `loan_funding_splits` join table | — |

## 4. Existing RPCs / services whose behaviour changes

| Component | Change | Notes |
|---|---|---|
| `loansService.disburse()` | Must accept a funding plan and write `loan_funding_splits` | **Must not break** when a group has only internal savings — default to it |
| `loansService.recordRepayment()` | Must write `repayment_splits`; propagate to allocation + org ledger in the same transaction | Highest-risk change in the subsystem |
| `postLoanDisbursementJournal` / `postLoanRepaymentJournal` | ([lib/services/posting-templates.service.ts](../../lib/services/posting-templates.service.ts)) — capital-funded loans need a liability-side posting the current templates don't emit | Templates are per-tenant configurable; the *structure* is locked by design (overrides may only remap account codes), so a **new template event** is required, not an override |
| `settleOrgDisbursement` | Repayable allocations post to a receivable, not an expense | See D1 |
| `mpesa-callbacks.service.ts` / `mpesa-spine.service.ts` | Must carry attribution through to `repayment_splits` | Reuse `idempotency_keys` (migration 057) — **do not add a second idempotency mechanism** |
| `mpesa-unrouted.service.ts` | Is already the suspense mechanism the spec asks for | Reuse; add capital-layer alert rows |
| Chart of accounts | New accounts required both sides (group-side liability to organization; org-side loan receivable) | Follows migration 082/085 seeding precedent |

## 5. Migration & backfill (spec §8) — **materially smaller than the spec assumes**

Live production counts, queried directly:

| Entity | Rows |
|---|---|
| `groups` | 5 |
| `organizations` | 1 |
| `funding_programs` | **0** |
| `organization_disbursements` | **0** |
| `loans` | **0** |
| `loan_repayments` | **0** |

**There are no member loans in production to backfill.** The spec's §8 requirement — *"a list of every currently-open member loan and how it will be backfilled"* — the answer is: **the list is empty.**

This substantially de-risks Phase 3. The backfill migration must still be written and tested (other environments, CI fixtures, and future-proofing), and the balance-diff assertion must still be shipped exactly as specified — but the production blast radius today is zero. **This is the single best argument for doing this work now rather than later.**

Every existing group still needs its `internal_savings` funding source created (5 rows), plus creation-time wiring so new groups get one automatically.

## 6. Recommended realigned architecture

Drop the `cap_` prefix. It would create a second organization-finance domain sitting beside the real one, and the boundary the prefix is meant to make legible is already drawn by the `organization_*` prefix.

**Extend:**
- `funding_programs` → becomes the "financial product" (it already is one)
- `organization_disbursements` → becomes the "allocation" (it already has maker-checker + status machine + GL links)
- `organization_ledger` → becomes the "capital movements" ledger (already append-only in practice)

**Create (genuinely new):**
- `group_funding_sources` — the group-side attribution anchor
- `loan_funding_splits` — the keystone; deferred constraint trigger asserting `sum = loans.principal_amount`
- `allocation_schedule` — expected repayment schedule
- `allocation_events` — append-only status/audit trail
- `repayment_splits` — waterfall output
- `capital_reconciliation_alerts` — drift + unattributed receipts

**Reuse (do not rebuild):**
- `idempotency_keys` (migration 057)
- `mpesa_unrouted` + its service (suspense)
- `audit_logs` (note: migration 114's INSERT-policy fix was applied to production 2026-08-05)
- `posting-templates.service.ts` for all GL postings
- The `permissions text[]` RBAC system for authorization

---

## 7. Open questions requiring a decision before Phase 1

1. **D1** — confirm `liability` capital model.
2. **D5** — member-level visibility to organizations under Kenya DPA; how `member_visibility` composes with `applyMemberMask`.
3. **D-A** — service-layer transactions (recommended) vs. the spec's mandated RPC pattern.
4. **D-B** — accept existing counters + rebuild/assert job (recommended) vs. pure-derived balances.
5. **D-C** — org role model: extend `org_role` enum (reversing the `field_officer` decision) vs. permission strings on the live RBAC system (recommended).
6. **D-F** — extend `organization_type` enum, or accept existing vocabulary.

Mechanical corrections already ruled and needing no decision: `numeric(15,2)` (D4), `flat|reducing_balance` (D3), `members(id)` not `auth.users` (D-E), interest rate as `numeric(5,2)` percentage.

---

**Phase 0 ends here, per the spec's own instruction to stop for review. No migration has been written and no schema has been altered.**
