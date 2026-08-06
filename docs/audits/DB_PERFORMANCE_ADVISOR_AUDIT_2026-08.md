# Kitabu Yetu — Database Performance Advisor Audit (2026-08-06)

**Trigger:** while closing out unrelated CI failures on PR #28, ran Supabase's built-in advisors against the live production project (`qztcgryhoanennsizcll`) as a general health check, per the Supabase MCP server's own guidance to run these regularly. Security advisor: **zero findings**. Performance advisor: **538 lints**. This report is that findings-only pass, written up as its own audit rather than fixed inline, given the scale of surface area (RLS policies on 25 tables, indexes across 100+ tables).

**Method:** `get_advisors(type=performance)` against the real production database, then grouped the raw lint output by category/table/role to find the actual patterns rather than treating 538 as 538 independent problems. No fixes applied in this pass — findings and a prioritized roadmap only.

---

## 1. Summary

**Score: 62/100.** No security issues, no correctness bugs, nothing here is causing an incident. But real, avoidable query-cost debt exists in two well-defined, fixable patterns, plus a third data-quality issue in the advisor output itself that would have caused wrong action if taken at face value.

| Category | Count | Level | Verdict |
|---|---|---|---|
| Multiple permissive RLS policies | 175 (25 tables × up to 7 roles) | WARN | **Real, structural** — every one of these tables evaluates 2-3 separate policies per row on every query, for every role including `anon` |
| Unindexed foreign keys | 60 (29 tables) | INFO | **Real, mechanical** — joins/cascades on these columns are sequential scans today |
| `auth_rls_initplan` (per-row re-evaluation) | 6 (6 tables) | WARN | **Real, trivial fix** — textbook Supabase footgun, one-line-per-policy correction |
| Unused indexes | 296 (107 tables) | INFO | **Not actionable as reported** — see §2.4, the list is contaminated by indexes on tables that are days old |
| Table bloat | 1 | INFO | **Not our schema** — `net._http_response`, a `pg_net` extension internal table, not application code |

**What this is not:** no finding here implies data is wrong, isolation is broken, or anything is user-facing broken. This is entirely "the database is doing more work per query than it needs to" — invisible today at Kitabu Yetu's current transaction volume (see [[project-kitabu-yetu-real-capital-state]] — a single real org, KES 1.5M), and worth fixing before it isn't.

---

## 2. Findings

### F1. 175 duplicate-permissive-policy warnings — a consistent two-policy-per-table pattern, not 175 separate problems

Grouping by table shows this isn't scattered — it's the exact same shape repeated across 25 tables: a narrow "modify" (or role-gated) policy and a broader "select" (or "all") policy, both declared `PERMISSIVE`, both applying to the same role/action. Postgres must evaluate and `OR` every permissive policy that matches a query — so every `SELECT` against these 25 tables pays for two policy evaluations where one would do, for every one of the ~7 roles the linter checked (`anon`, `authenticated`, `authenticator`, `app_tenant`, `cli_login_postgres`, `postgres`, `service_role`).

Affected tables (7 role-hits each, i.e. every one of the 25): `counties`, `sub_counties`, `wards`, `sms_usage_logs`, `share_transactions`, `share_holdings`, `share_classes`, `share_certificate_counters`, `platform_notifications`, `organization_disbursements`, `next_of_kin`, `mpesa_b2c_charge_tiers`, `member_invitations`, `meeting_attendance`, `meeting_resolutions`, `import_jobs`, `idempotency_keys`, `group_officers`, `feature_flags`, `dividend_declarations`, `dividend_allocations`, `cycles`, `cycle_shareouts`, `credit_scores`, `whatsapp_messages`.

The exact policy-name pairs (e.g. `share_classes_modify` + `share_classes_select`, `feature_flags_read` + `feature_flags_tenant_read` + `feature_flags_write`) confirm the pattern: these were written as separate, individually-readable policies per operation — a reasonable authoring choice, but each additional permissive policy on the same role+action is pure overhead once RLS evaluates the query, not additional safety (a `DENY`/restrictive policy would be different; these are all `PERMISSIVE`, meaning Postgres already just needs one to pass).

**Fix shape** (not applied this pass): for each of the 25 tables, collapse same-role-same-action permissive policies into one, `OR`-ing the original `USING`/`WITH CHECK` expressions. This is a real schema change per table — needs the `app_tenant` RLS-enforcement test suite (`__tests__/integration/permissions/`, `rls-enforcement.test.ts`) run against each rewritten policy before it ships, exactly the gate that caught 3 genuine pre-cutover RLS breaks during the ADR-001 work. Not mechanical enough to batch blindly.

### F2. 60 foreign keys with no covering index, concentrated in money/audit-trail tables

29 tables have at least one FK column with no index. The worst single table is `payment_reallocations` — **10** unindexed FK columns (`approved_by`, `from_group_membership_id`, `from_member_id`, `initiated_by`, `new_journal_entry_id`, `rejected_by`, `reversal_journal_entry_id`, `to_group_id`, `to_group_membership_id`, `to_member_id`). Next worst: `disbursement_requests` (5), `organization_disbursements` (5), `loans` (4), `payment_requests` (3), `organization_sms_credits` (3), `organization_ledger` (3), `organization_journal_entries` (3).

This matters concretely for two operations every one of these tables does regularly: **joins** (e.g. "show me this member's reallocations" filters on `from_member_id`/`to_member_id` with no index to use) and **`ON DELETE` cascade/restrict checks** (every delete or update to a referenced row triggers a full sequential scan of the referencing table to check for dependents, unless the FK column is indexed). `loans`, `payment_reallocations`, and `organization_disbursements` are exactly the tables real money moves through.

Full list of the 60 in the raw advisor output (table.fk_name); highest-value targets to index first:

- `payment_reallocations` — all 10 FK columns
- `organization_disbursements` — `approved_by`, `created_by`, `ledger_entry_id`, `rejected_by`, `wallet_id`
- `disbursement_requests` — `approved_by`, `cash_account_id`, `initiated_by`, `rejected_by`, `fk_disb_b2c_transaction`
- `loans` — `fk_loans_guarantor_membership`, `fk_loans_membership`, `defaulted_by`, `written_off_by`
- `payment_requests` — `fk_payment_requests_membership`, `created_by`, `member_id`
- `organization_ledger` — `created_by`, `organization_ledger_disbursement_fk`, `wallet_id`
- `organization_journal_entries` — `created_by`, `posted_by`, `voided_by`

**Fix shape**: a single additive migration, `CREATE INDEX IF NOT EXISTS` per column — no RLS/behavior risk, purely additive, can be batched and applied in one pass unlike F1.

### F3. 6 RLS policies re-evaluate `auth.<fn>()`/`current_setting()` per row instead of once per query

`sms_trigger_rules`, `sms_trigger_executions`, `sms_provider_balances`, `contact_submissions`, `mpesa_callbacks`, `reminder_dispatch_log` each have one policy calling `current_setting()`/`auth.<fn>()` directly in `USING`/`WITH CHECK` instead of wrapped in a sub-select — Postgres's planner can't hoist an unwrapped call out of the per-row evaluation, so it re-runs once per row scanned instead of once per query. Textbook Supabase-documented fix: replace `auth.<fn>()` with `(select auth.<fn>())` — same result, planner caches it once. Six one-line changes, well inside the pattern already used correctly by the rest of this project's RLS policies (spot-checked: most policies here already write it the fast way — these 6 are the exceptions, not the norm).

### F4. The 296 "unused index" findings are not trustworthy as reported — verified contaminated by brand-new tables

Before treating this as a 296-item drop-list: checked whether any flagged indexes belong to tables created in the last few days. They do. `group_funding_sources`, `loan_funding_splits` (both from migrations 115/118, merged 2026-08-05/06 — see [[project-kitabu-yetu-audits]]'s capital-layer entries) already show up as "unused," for the obvious reason that they're less than 48 hours old at the time this advisor ran, not because their indexes are dead weight. Supabase's unused-index lint is `pg_stat_user_indexes.idx_scan = 0` since the last stats reset — it cannot distinguish "genuinely never useful" from "hasn't had a chance to be used yet," and this project ships new tables/indexes multiple times a week.

**This is worth writing up on its own** (mirrors this project's `07-remediation-backlog.md` RLS-grep correction — a tool's raw output needs verification against what it's actually measuring before it becomes a finding): none of the 296 should be dropped from this pass. `groups`, `welfare_requests`, `meetings`, `journal_entries`, `investments`, `group_members`, `share_transactions` top the per-table count (7-8 unused indexes each) and are old, established tables — genuinely worth a second look — but only after confirming against the app's actual query patterns (`grep` for the indexed columns in `WHERE`/`ORDER BY`/`JOIN` across `lib/services/`), not from the stats snapshot alone. Recommend re-running this specific advisor after a real production traffic window (30+ days, and excluding any table younger than that window) before acting on it at all.

### F5. Table bloat on `net._http_response` — not application schema, no action

The one `table_bloat` finding is on `net._http_response`, an internal table owned by the `pg_net` Postgres extension (used by Supabase's async HTTP/webhook machinery), not a Kitabu Yetu table. No migration or service code references it. If this recurs or grows, it's a Supabase infrastructure/extension-config question, not something this codebase can fix — flagged here only so it isn't silently missed, not queued as a project action item.

---

## 3. Roadmap

Ordered by risk-adjusted leverage, not raw finding count:

1. **F3 (6 `auth_rls_initplan` fixes)** — lowest risk, mechanical, well inside precedent. Good first PR. **Shipped**: PR #31, migration 120, validated against production inside `BEGIN...ROLLBACK` before opening.
2. **F2 (60 unindexed FKs)** — additive-only migration, no RLS/behavior surface, highest real-world payoff given the tables involved (`payment_reallocations`, `loans`, `organization_disbursements` are all in the hot path for real money). Second PR. **Shipped**: PR #30, migration 121, same `BEGIN...ROLLBACK` validation.
3. **F1 (25 tables' duplicate permissive policies)** — real fix, but touches live RLS on tables spanning geography reference data, shares, dividends, meetings, and org disbursements. Needs the `app_tenant` RLS test suite run per rewritten table, not a batch sweep. **Phase 1 shipped**: PR #32, migration 122 — 21 of 25 tables. Went through `EnterPlanMode` given the live-RLS/zero-prior-test-coverage risk; research found Postgres's `CREATE POLICY FOR` clause only takes one command (confirmed via a live syntax probe), so each table's `FOR ALL` policy was split into `FOR INSERT`/`FOR UPDATE`/`FOR DELETE`, each carrying the original condition — behaviour-preserving, since the sibling `FOR SELECT` policy never applied to those three commands anyway. Two tables (`organization_disbursements`, `sms_usage_logs`) needed their two SELECT-worthy conditions merged into one policy first, since they cover genuinely different access axes (org-coordinator vs. group-member), not a broad/narrow pair of the same axis. Added `__tests__/integration/app-tenant/rls-policy-consolidation.test.ts` — zero prior RLS-enforcement coverage existed for any of these 25 tables. **Phase 2, not yet started — see §5 below**: the remaining 4 tables have a second, more serious problem than the multiple-permissive-policy finding itself.

4. **F1 Phase 2 — undocumented RLS-policy drift on 4 tables (`feature_flags`, `platform_notifications`, `meeting_attendance`, `meeting_resolutions`)** — discovered during Phase 1's research, deliberately excluded from PR #32. A live `pg_policies` query against production found these tables' actual policies don't match what any migration ever created:
   - `meeting_attendance` and `meeting_resolutions` each have **two** live policies (`attendance_read`/`attendance_write`, `resolutions_read`/`resolutions_write`) with **byte-for-byte identical conditions** — the advisor's "multiple permissive policies" finding here is real, but a fresh build (migration `023`) only ever creates **one** policy per table. Someone added a redundant duplicate directly to production, outside the migration pipeline, at an unknown point.
   - `feature_flags` has **three** live policies (`feature_flags_read`, `feature_flags_tenant_read` — also identical conditions, same redundant-duplicate pattern — plus `feature_flags_write`) against **two** in migration history (`super_admin_feature_flags`, `feature_flags_tenant_read` from migration `097`). `feature_flags_write` is a live rename of `super_admin_feature_flags` that was never captured in a migration.
   - `platform_notifications`'s two live policies (`platform_notifications_read`/`platform_notifications_write`) are renamed versions of migration `025`'s `read_active_notifications`/`super_admin_notifications` — genuinely two different conditions here (not a duplicate), just renamed.

   **This is a different, worse class of drift than the schema-column drift this project already has a pattern for** (migration `068`'s `created_by`/`updated_by` conditional-index precedent, migration `119`'s `feature_flags.name` column from earlier this same day) — those are columns added outside migrations; this is **RLS policy objects** added/renamed/duplicated outside migrations, meaning a fresh build's actual security posture for these 4 tables doesn't match production's. Fixing it needs a migration that checks which name variant exists (`DO $$ ... IF EXISTS ... $$`, matching migration `068`'s style) before touching either state, since the same file must work against both a fresh build (1-2 migration-history-named policies) and production (2-3 differently-named policies). Not attempted in this pass — flagged here rather than silently dropped from scope.

5. **F4 (unused indexes)** — do not act on the current list. Re-run the performance advisor after a genuine 30+ day production window, filter out any table newer than that window, and cross-reference survivors against real query code before dropping anything. Premature action here risks removing an index a slow-growing feature (e.g. `investments`, `meetings`) needs the moment real usage picks up.
6. **F5 (`net._http_response` bloat)** — no code action; monitor only.

---

## 4. Caveats

- **Findings-only pass, nothing fixed in this session** — matches the user's explicit choice (open as an audit rather than start editing live RLS/indexes unprompted) over the alternative of just fixing the 6 mechanical `auth_rls_initplan` items immediately.
- Every number in §1/§2 is from one live `get_advisors` call against production (`qztcgryhoanennsizcll`) on 2026-08-06; not sampled, not extrapolated.
- Current production traffic is low (single real org actively transacting — see [[project-kitabu-yetu-real-capital-state]]), so none of F1-F3's cost is visible in practice yet. That's the point of writing this up now rather than waiting for it to become a symptom.
