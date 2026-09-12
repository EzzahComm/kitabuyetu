---
title: Pass 2 — Orphan Tables (H4) and Full RLS Predicate Read
status: draft
owner: audit
last_reviewed: 2026-08-09
---

# Pass 2 — Orphan Tables (H4) and Full RLS Predicate Read

**Mode: AUDIT.** Continues from `01-HYPOTHESIS-VERIFICATION.md`'s "What Pass 1 did not do": H4 (orphan-table tracing, explicitly deferred here by Pass 0) and a full read of every RLS `USING`/`WITH CHECK` predicate across all 135 `public` tables (Pass 0/1 only counted policies and spot-checked 3-6 tables). Same label convention as prior passes: **[PROVEN-PROD]** (live query against production, same project `qztcgryhoanennsizcll`), **[VERIFIED]** (read directly by the author of this document), **[REPORTED]** (relayed from a sub-agent's research, checked at summary level, individual citations not independently re-walked). Delivered via direct live-Postgres analysis (RLS predicates — every policy's `qual`/`with_check` pulled and cross-referenced against every migration file) plus one Explore agent (H4 — orphan verification, given the volume of individual per-table checks needed).

---

## Part 1 — H4: Orphan table tracing

### Method

A mechanical sweep (word-boundary match of each of the 135 table names against every `.ts`/`.tsx` file under `lib/` and `app/`) found **24 tables with zero direct references in application code**. Per this audit series' own repeated lesson (grep-only "orphan" claims have been wrong before — `group_constitutions`, the governance tables, and others turned out to be either genuinely dead or accessed indirectly through a function/trigger the grep couldn't see), each of the 24 was individually verified: checked for a `SECURITY DEFINER` function or trigger touching it, checked whether that function/trigger has a real caller, checked the creating migration's own stated intent, and cross-referenced against prior audit docs. **[REPORTED]**, one Explore agent, 107 tool calls.

### False positives — indirect access via a function/trigger (5 tables)

Not orphans. Each is written/read exclusively through a database routine the app calls by name, invisible to a literal-string grep:

| Table | Accessed via | Real caller |
|---|---|---|
| `invoice_sequences` | `next_invoice_number()` (SECURITY DEFINER, `009_functions_triggers.sql:267-289`) | `lib/services/billing.service.ts:225-228` |
| `share_certificate_counters` | `allocate_share_certificate_serial()` (SECURITY DEFINER, `036_shares.sql:94-121`) | `lib/services/shares.service.ts:724-728` → `app/api/v1/shares/transactions/[id]/certificate/route.ts` |
| `membership_no_counters` | `trg_group_members_allocate_no` trigger → `allocate_membership_no()` (`056_membership_payment_accounts.sql:222-260`) | fires on every real `group_members` INSERT |
| `mpesa_b2c_charge_tiers` | `mpesa_charge_for_amount()` (`047_daraja_completion.sql:97-114`) | `lib/services/mpesa-charges.service.ts:20` |
| `registrant_verifications` | `start_registrant_verification`/`complete_registrant_verification`/`complete_email_verification` (`046_register_group_verification.sql:240-450`) | `lib/services/group-verification.service.ts:66,100,109` |

`invoice_sequences`'s separate RLS-disabled status (already covered in `01-HYPOTHESIS-VERIFICATION.md`) is unrelated to this orphan question.

### Already documented elsewhere — not new findings

- **`member_invitations`** — its own superseding migration says outright: *"member_invitations has zero application-code references anywhere in this repo (grep-verified)"* (`102_organization_invitations.sql:9-14`). Re-confirmed still true.
- **`notification_rules`** — flagged as a dead service file in `OPTIMIZATION_CLEANUP_AUDIT.md:64` and actually deleted (commit `4fd4248`). The table itself has no writer beyond a generic `updated_at` trigger — genuinely orphaned, consistent with that prior finding.

### Confirmed orphans (17 tables)

Schema (and in most cases RLS policies) exist in production; nothing in the current codebase ever reads or writes them:

`contact_submissions`, `cycles`, `email_delivery_reports`, `email_failures`, `email_suppressions`, `group_bank_accounts`, `idempotency_keys`, `invoice_line_items`, `newsletter_subscribers`, `organization_sms_credits`, `platform_billing`, `platform_notifications`, `platform_revenue`, `settlement_approvals`, `settlement_requests`, `vendor_payments`, `welfare_votes`.

Individually verified reasons (not just "0 hits") — a sample, full detail in the agent's own findings:
- **`contact_submissions`** / **`newsletter_subscribers`**: schema built for a contact form / newsletter signup that doesn't exist — `app/contact/page.tsx` is a static mailto page, no `app/api/**/contact*` or `**/newsletter*` route exists.
- **`email_delivery_reports`** / **`email_failures`** / **`email_suppressions`**: built for provider-webhook tracking, retry logging, and bounce/complaint suppression respectively — the real webhook handler (`app/api/v1/email/webhooks/resend/route.ts` → `delivery-tracking.service.ts`) writes to `email_logs` columns directly and never touches any of these three; no suppression check exists anywhere in the send path.
- **`idempotency_keys`**: the table's own migration comment says *"Redis is primary; this is the durable fallback"* (`030_group_workflow_foundation.sql:372-373`) — `lib/utils/idempotency.ts` is Redis-only and documents fail-**open** (not fail-to-this-table) on Redis loss. The fallback was designed but never built.
- **`invoice_line_items`**: a duplicate of the real, actively-used `invoice_items` table — two parallel line-item schemas from different migrations, only one ever wired in.
- **`organization_sms_credits`**: a "top-up ledger, mirroring `sms_credits` for groups" (`051_organization_billing.sql:33-46`) — neither the old debit path nor the newer credit-reservation model (migration 123) ever inserts a ledger row here; both mutate `organization_billing_accounts` balance columns directly instead.
- **`platform_billing`**: its own migration header admits it was *"created directly against production (dashboard/ad-hoc SQL)"* as a *"backfill"* (`066b_platform_billing_table.sql:1-17`); the companion migration is literally named `067_weekly_billing.sql`, but no weekly-billing job exists anywhere in `lib/jobs/`.
- **`welfare_votes`**: designed for a per-member committee vote (`voter_id`/`vote` columns) but the real welfare flow (`welfare.service.ts:149-165`) is a single officer decision — the voting feature this table implies was never built. Also a "recovered snapshot... created directly against production" migration (`072b`), same gap class as `platform_billing`.

### New sub-finding, more severe than plain "orphan": 5 tables have no `CREATE TABLE` anywhere in current migration history at all

`group_bank_accounts`, `settlement_approvals`, `settlement_requests`, `vendor_payments`, and `platform_revenue` are live in production today — schema **and RLS policies** — with **zero corresponding `CREATE TABLE` anywhere in `supabase/migrations/`**, not even a "recovered snapshot" migration like the ones written after-the-fact for `platform_billing` (066b) or `welfare_votes` (072b). `git log -S<table> -- supabase/migrations` traces each to a full feature commit (schema + service + API routes + UI, per the commit's own message) that was applied directly to production and then **never merged into the current linear git history** — confirmed via `git merge-base --is-ancestor <commit> HEAD` returning false for each. Their original migration numbers (058, 060, 062) are now silently reused by unrelated later migrations (e.g. `20260714150000_060_db_integrity.sql`), meaning the excision was clean enough to leave no numbering gap as a clue.

This is a different, more severe failure mode than the ordinary "built but never wired" orphan pattern this series keeps finding (`group_constitutions`, `member_invitations`): those were designed, migrated, and simply never connected to a caller. These five were **fully built — schema, service layer, API routes, UI, per the abandoned commits' own descriptions** (`4b95b1e`: dual-control B2B bank settlements; `0e5e6dc`: vendor payments via B2C/B2B with dual approval; `01bb3be`: a monetization dashboard with a B2C-equivalent transaction fee) **and then the application code was completely removed from git history while the database objects stayed live in production.** A fresh clone + fresh migration replay today would never create these 5 tables at all — meaning production's actual schema has permanently diverged from what this repository can reproduce, in a way no `docs/audits/*.md` file has previously flagged.

**[PROVEN-PROD]** — row counts checked against production for all 17 confirmed orphans plus the 2 already-documented tables: **15 of the 17 hold zero rows** (dead schema, no live-data risk). Two do not:
- **`platform_revenue` — 2 rows.** Despite having no `CREATE TABLE` anywhere in current migration history (see above), real revenue data exists in this completely unreproducible, unmanaged table. Worth a direct look at what those 2 rows actually contain before deciding whether to formally re-adopt, migrate elsewhere, or archive-and-drop this table.
- **`member_invitations` — 9 rows.** Real invitation records sitting in a table two separate migrations (`102_organization_invitations.sql`'s own comment, this pass's confirmation) already agree has zero application-code path to ever read or act on them again — these are stale leftovers from before the switch to `organization_invitations`, not actively growing, but worth a one-time check that nothing important (an unactioned pending invite) is stuck there before any cleanup.

All other confirmed orphans (`contact_submissions`, `cycles`, `email_delivery_reports`, `email_failures`, `email_suppressions`, `group_bank_accounts`, `idempotency_keys`, `invoice_line_items`, `newsletter_subscribers`, `organization_sms_credits`, `platform_billing`, `settlement_approvals`, `settlement_requests`, `vendor_payments`, `welfare_votes`, `notification_rules`) are confirmed empty — genuinely zero-risk dead schema today, safe to leave as-is or clean up at leisure.

---

## Part 2 — Full RLS predicate read (all 135 tables)

**[PROVEN-PROD]**, direct query: every `pg_policies.qual`/`with_check` for every table, cross-referenced against every file under `supabase/migrations/`.

### Confirmed correct, no action needed

- **Geographic/reference tables** (`counties`, `sub_counties`, `wards`) and **global config catalogs** (`governance_metrics`, `governance_risk_weights`, `mpesa_b2c_charge_tiers`, `feature_flags`'s read side) all carry a `USING (true)` SELECT policy — verified via `information_schema.columns` that **none of these tables has a `group_id` or `organization_id` column at all**, so there is nothing to scope by; public-read is correct by design, not a gap.
- The 3 single-policy financial tables from Pass 1 (`payments`, `invoices`, `bill_manager_invoices`) now all carry the `is_super_admin() OR group_id = ...` shape consistently, following the fix shipped for Checkpoint 1.
- `mpesa_b2c_transactions`/`mpesa_b2b_transactions`/`mpesa_b2c_charge_tiers`'s dynamic-`DO $$`-created policies (Pass 1's re-verification) still hold.
- **3 tables are correctly locked down with a deny-all policy**: `job_logs_no_postgrest`, `job_queue_no_postgrest`, `member_mfa_secrets_no_postgrest` all read `USING (false)` — nobody except a BYPASSRLS role can touch these via any RLS-respecting connection. Good hardening, confirmed live.

### New finding: 3 tables' deny-all hardening exists in production but in no migration file

The three `*_no_postgrest` policies above (`job_logs`, `job_queue`, `member_mfa_secrets`) do not appear, by name, in any file under `supabase/migrations/`. The protection is real and live, but a fresh build/CI replay would not reproduce it — these tables would come up with **no RLS policy at all** on a freshly-provisioned database (all three have `relrowsecurity = true` but would default to allow-nothing-matches only because no policy exists to allow anything, which happens to be equivalent to `false` for a PERMISSIVE-policy table with zero policies — so the *practical* effect is accidentally the same, but this is fragile: adding any future permissive policy to these tables, even for an unrelated purpose, would not compose safely with an *absent* deny-all the way it would with an *explicit* one). Recommend capturing these three as a real migration so CI's fresh-build tests actually exercise this protection, not just production.

### New finding: 3 tables' hand-patched `group_admin`→`chairperson` fix was never captured in a migration

Migration `050_rename_organization_and_chairperson.sql` explicitly recreated ~20 policies to replace the literal string `'group_admin'` with `'chairperson'` after the enum rename (its own header explains why: `ALTER TYPE ... RENAME VALUE` doesn't touch string literals baked into policy bodies). **Three policies were missed by that migration's own list, but are already correctly fixed live in production today** — meaning someone hand-patched them directly against production at some point, and that fix was never captured in any subsequent migration either:

| Table | Policy | Migration file's original (stale) text | Live production text |
|---|---|---|---|
| `mpesa_callbacks` | `rls_mpesa_callbacks_admin` | `IN ('super_admin','group_admin')` (`012_mpesa_dedicated_tables.sql:366`) | `= ANY (ARRAY['super_admin','chairperson'])` |
| `sms_provider_balances` | `rls_sms_balances_admin` | `IN ('super_admin','group_admin','treasurer')` (`013_sms_advanced_tables.sql:292`) | `= ANY (ARRAY['super_admin','chairperson','treasurer'])` |
| `contact_submissions` | `rls_contact_subs` | `IN ('super_admin','group_admin')` (`014_email_billing_tables.sql:237`) | `= ANY (ARRAY['super_admin','chairperson'])` |

Production itself is correct and not at risk today. The gap is reproducibility: `'group_admin'` no longer exists as a `member_role` enum value anywhere after migration 050's `ALTER TYPE ... RENAME VALUE` — so on a **freshly-built database** (a new CI run, a disaster-recovery restore from migration replay, a new contributor's local setup), these three policies would check membership against a role literal that can now never match anything, silently locking every chairperson out of all three tables (leaving only `super_admin`, and for `sms_provider_balances`, `treasurer`, able to pass) — with zero error, just silent, permanent denial. A live, direct confirmation was not done for whether `contact_submissions`'s own orphan status (Part 1, above) makes this moot in practice — worth checking together with that finding, since a table nothing reads can't be locked out of in any way that matters. `mpesa_callbacks` and `sms_provider_balances` are both actively used (per Part 1's sweep, not in the orphan list), so this is real for those two.

### Existing finding re-confirmed, still open: `feature_flags` duplicate policy, 3 more tables with the same drift class

`DB_PERFORMANCE_ADVISOR_AUDIT_2026-08.md`'s F1 Phase 2 (deliberately deferred, not silently dropped) already found `feature_flags`, `platform_notifications`, `meeting_attendance`, `meeting_resolutions` carrying live RLS policies that don't match any migration's naming (renamed/duplicated outside the migration pipeline). **Re-verified today, still true, unchanged**: `feature_flags` still carries 2 redundant, byte-identical `SELECT true` policies (`feature_flags_read`, `feature_flags_tenant_read`); `meeting_attendance`/`meeting_resolutions` still carry their duplicate read/write pairs; `platform_notifications`'s 2 policies are still present. Not re-litigated further here — status unchanged from the prior audit's own write-up.

### Residual, low-priority: `event_outbox`/`membership_no_counters` still `USING (true)` at the policy layer

Migration 126 (2026-08-08) revoked `anon`/`authenticated`'s table GRANTs on both tables, closing the real exposure. **The RLS policy itself was left untouched** — both still read `FOR ALL USING (true) WITH CHECK (true)` (`event_outbox_all`, `membership_no_counters_all`). Today this is inert: the only two roles the app connects as (`postgres`, BYPASSRLS; `app_tenant`, granted nothing extra) can't be affected by it either way. But it's a landmine with no upside — if a future migration ever re-grants table access to `anon`/`authenticated` on either table (the exact mistake migration 126 itself was written to fix once already), the RLS layer provides zero backstop, unlike every other table in the schema. Worth tightening to a real predicate as defense-in-depth, independent of whether it's exploitable today.

### Forward-compatibility note, not an active bug: `feature_flags_write`/`platform_notifications_write`'s predicate may not survive an `app_tenant` migration

Both policies gate mutation on `current_setting('app.current_role') = 'super_admin'`. Traced the actual write path: `app/api/admin/feature-flags/route.ts`'s PATCH handler calls `admin.service.ts`'s `toggleFeatureFlag()`, which uses `withAdminDb` (the `postgres` role, BYPASSRLS) — so this predicate is never actually evaluated for real traffic today. `'super_admin'` is a `platformRole`, not a `member_role`; there is no established convention anywhere in this codebase for setting the tenant-pool GUC `app.current_role` to that value. If ADR-001's Phase 3 (migrating `withAdminDb` call sites off the bypass-everything role) ever reaches this route, the predicate as written would need rework — flagged for whenever that migration path is actually attempted, not urgent now.

---

## Checkpoint 2 summary

| Area | Verdict |
|---|---|
| H4 (orphan tables) | 24 zero-app-reference candidates verified individually. 5 false positives (indirect function/trigger access), 2 already-documented, **17 confirmed orphans**. Of those 17, **5 have no `CREATE TABLE` in current migration history at all** — a more severe, previously-undocumented class: fully-built features (schema+service+routes+UI per their own abandoned commit messages) whose application code was excised from git history while the database objects stayed live in production. |
| RLS predicates | All 135 tables' predicates read. 3 genuinely public-by-design tables confirmed correct. 3 tables' deny-all hardening (`job_logs`/`job_queue`/`member_mfa_secrets`) is real but un-migrated. **3 tables' `group_admin`→`chairperson` fix is live-correct but un-migrated** (new finding) — a fresh build would silently lock out every chairperson on `mpesa_callbacks` and `sms_provider_balances` (both actively used). `feature_flags`'s duplicate-policy drift (already known) confirmed still open. `event_outbox`/`membership_no_counters` still carry an inert but unnecessary `USING(true)` policy. |

### What Pass 2 did not do
- Did not check whether the 5 no-migration-history tables (`group_bank_accounts`, `settlement_approvals`, `settlement_requests`, `vendor_payments`, `platform_revenue`) hold real production data — a row-count check, deliberately out of this pass's code/schema scope.
- Did not attempt to reconstruct or re-migrate the abandoned settlement/vendor-payment/revenue features — a product decision (rebuild, formally deprecate, or drop), not an audit action.
- Did not fix anything in this document, per AUDIT-mode scope — findings only, consistent with Pass 0/1.
