# Production Schema Drift Audit

**Date:** 2026-07-30
**Scope:** Repository migrations (`supabase/migrations/*.sql`, 126 files) vs. the *actual live state* of the production Supabase project `kitabuyetu` (`qztcgryhoanennsizcll`, eu-central-1, Postgres 17.6).
**Method:** Direct SQL introspection of the production catalog (`pg_class`, `pg_proc`, `pg_trigger`, `pg_policies`, `pg_indexes`, `information_schema.columns`, `pg_enum`, `pg_roles`, `cron.job`, `job_queue`) via the Supabase MCP connection, diffed against every object each migration claims to create. Supabase's own security and performance advisors were run against the same live database.

**Score: 52/100.**

> **Why this audit is different from the eleven before it.** Every prior audit in `docs/audits/` reasoned about production from the repository alone — no session had a live database connection. This one queried production directly. That distinction matters: the repo's DDL turns out to be almost perfectly in sync with production, while the things the repo *cannot* show you — grants, and whether the application's SQL actually matches the columns that exist — are where the real damage is. Two scheduled jobs have been failing in production continuously for weeks, and neither is visible from any file in this repository.

---

## Executive summary

Production schema **object** fidelity is excellent. Of the 38 migrations numbered 069–106, every table, column, function, trigger, index, and enum value is live in production except migrations 094/095, which were deliberately deferred and never applied. There is no accidental DDL drift.

The findings are concentrated in three areas the repository cannot self-verify:

1. **Privilege drift (Critical).** Three `SECURITY DEFINER` functions added by migrations 098 and 100 are executable by the `anon` and `authenticated` PostgREST roles because neither migration issued the `REVOKE EXECUTE ... FROM PUBLIC` that this repository's own established pattern (migration 032) applies everywhere else. One of them, `link_member_to_group`, performs an unauthenticated, RLS-bypassing insert into `group_members` with a caller-supplied role.

2. **Code↔schema drift (High).** `members` has no `full_name` column — it has `first_name`/`last_name`. Six SQL call sites across four services select `m.full_name`. This is not theoretical: `email_birthday` has failed **96 consecutive times** in production with `column m.full_name does not exist`, and `email_weekly_summary` has failed 15 times with a second, unrelated column error (`loan_repayments.amount`, which is actually `amount_paid`). Email campaigns are also affected — `getCampaignRecipients` cannot resolve a single recipient.

3. **A dated, imminent failure (Medium).** Three monthly jobs have *never run* since being written. All three fire on **2026-08-01**, two days from this audit. At least two will fail: `journal_lines_partition_maintenance` (09:00 UTC) issues `CREATE TABLE ... PARTITION OF journal_lines` against a table that is not partitioned, and `email_member_statements` (10:00 UTC) selects the nonexistent `m.full_name`.

A necessary caveat on severity throughout: production currently holds **5 groups, 23 members, 9 contributions, 0 loans, 0 loan repayments, and 19 journal lines**. This is a pilot/pre-launch database. Nothing below has destroyed real money, because there is almost no real money in the system yet. That makes this the cheapest possible moment to fix all of it — and it also means the 299 "unused index" performance advisories are statistical noise, not findings.

---

## Scoring breakdown

| Dimension | Score | Basis |
|---|---|---|
| Schema object parity (tables/columns/functions/triggers/indexes/enums) | 95/100 | Everything live except the deliberately-deferred 094/095 |
| Grant & privilege parity | 25/100 | 3 `SECURITY DEFINER` functions reachable by `anon` |
| Seed/reference-data parity | 70/100 | Migrations 092 and 093 policy rows never seeded (harmless today — code falls back) |
| Code↔schema agreement | 30/100 | 6 broken call sites; 2 jobs failing continuously in production |
| Migration tracking & process | 30/100 | `schema_migrations` ledger stops at 068; 38 migrations applied by hand with no record |
| Operational observability | 20/100 | 96 daily failures of one job went unnoticed; nothing alerts on `job_queue.status='failed'` |
| **Overall** | **52/100** | |

---

## Findings

### C1 — `SECURITY DEFINER` functions callable by `anon` via PostgREST — **Critical**

**Evidence (live production):**

```
proname                        | prosecdef | anon_exec | auth_exec
-------------------------------+-----------+-----------+-----------
adjust_account_reserved_amount | t         | t         | t
link_member_to_group           | t         | t         | t
lock_group_cash_account        | t         | t         | t
register_group                 | t         | f         | f      <- correct
complete_registrant_verification | t       | f         | f      <- correct
debit_organization_sms_credits | t         | f         | f      <- correct
... (all 10 others: f / f)
```

Every other `SECURITY DEFINER` function in the database has `anon`/`authenticated` execute revoked. Only these three do not. Supabase's own linter independently flags all three (`anon_security_definer_function_executable`, `authenticated_security_definer_function_executable`).

**Root cause.** Postgres grants `EXECUTE` to `PUBLIC` by default on every new function. This repo's established idiom, from [migration 032](../../supabase/migrations/20260101000032_032_register_group_rpc.sql#L234-L235):

```sql
REVOKE EXECUTE ON FUNCTION public.register_group(JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.register_group(JSONB) TO postgres;
```

Migrations [098](../../supabase/migrations/20260727000000_098_link_member_to_group_function.sql) and [100](../../supabase/migrations/20260727020000_100_account_reservation_functions.sql) contain **zero** `REVOKE` statements. Migration 098 even reasons explicitly about grants — "No new GRANT needed: `create-app-tenant-role.sql`'s blanket `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public`..." — but considered only what needed *adding*, never the default `PUBLIC` grant that needed *removing*. Migration 105 closed exactly this class of finding for `debit_organization_sms_credits` eight days later without noticing the three neighbours.

`supabase/config.toml` exposes `schemas = ["public", "graphql_public"]`, so all three are reachable at `POST /rest/v1/rpc/<name>`.

**Impact, per function.** None of the three performs any internal authorization check; each was written on the assumption that only the application's own database roles could reach it. All run as the owner (`postgres`, `rolbypassrls = true`), so no RLS policy applies.

- **`link_member_to_group(p_member_id, p_group_id, p_role, ...)`** — inserts an `active` `group_members` row with a caller-supplied `member_role` (`chairperson` | `treasurer` | `secretary` | `member`). A caller who knows a group UUID and a member UUID can grant that member officer-level membership of a group they have no relationship to. This is cross-tenant privilege escalation.
- **`adjust_account_reserved_amount(p_account_id, p_delta)`** — applies an arbitrary signed delta to `accounts.reserved_amount`. A negative delta releases the budget earmarks that gate disbursement approval; a positive delta freezes a group's ability to disburse. The `reserved_amount >= 0` CHECK constrains the floor but does not prevent releasing legitimate reservations.
- **`lock_group_cash_account(p_group_id, p_account_code)`** — returns `balance` and `reserved_amount` for any group's account (information disclosure) and holds a `FOR UPDATE` row lock for the transaction's duration.

**Mitigating factor, stated honestly.** Reaching PostgREST requires the project's publishable/anon key. That key is *provisioned* in Vercel Production as `NEXT_PUBLIC_SUPABASE_ANON_KEY` (added ~20h before this audit), but `lib/supabase/client.ts` and `lib/supabase/server.ts` — the only files that read it — have **zero importers**, so Next.js does not currently inline it into the client bundle. The key is therefore not published *today*. It is nonetheless a value designed to be distributable, it sits in a `NEXT_PUBLIC_`-prefixed variable that will ship the moment anyone imports that dead client, and Supabase anon keys are routinely scraped from deployed bundles. Rated Critical on the strength of the exposure being one import away and the fix being three lines.

**Fix:** migration 107 (shipped with this audit) — `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` on all three, matching migration 032's pattern.

---

### H1 — `members.full_name` does not exist; six call sites select it — **High**

**Evidence (live production).** `full_name` exists on exactly two tables:

```
table_name   | column_name
-------------+-------------
next_of_kin  | full_name
person       | full_name
```

`members` has `first_name` (NOT NULL), `middle_name` (nullable), `last_name` (NOT NULL). There is no `full_name`, and no migration has ever added one.

**Proven in production**, not inferred — `job_queue` shows `email_birthday` at **96 rows with `status='failed'`** plus 1 currently `pending`, every one carrying:

```
column m.full_name does not exist
```

Last failure 2026-07-29 07:00 UTC; the job runs daily at 07:00 and has been failing every day.

**All six broken call sites**, each `FROM members m`:

| File | Line | Function | Reached by |
|---|---|---|---|
| [member-email.service.ts](../../lib/services/member-email.service.ts#L74) | 74 | `sendBirthdayEmails` | job `email_birthday`, daily 07:00 — **failing now** |
| [member-email.service.ts](../../lib/services/member-email.service.ts#L103-L113) | 103, 113 | `sendMonthlyStatements` | |
| [report-email.service.ts](../../lib/services/report-email.service.ts#L57) | 57 | `sendGroupReport` | |
| [report-email.service.ts](../../lib/services/report-email.service.ts#L138) | 138 | `sendWeeklySummaries` | job `email_weekly_summary` — **failing now** (on H2 first) |
| [statement-email.service.ts](../../lib/services/statement-email.service.ts#L33) | 33 | `sendMemberStatements` | job `email_member_statements`, 1st of month 10:00 — **first run 2026-08-01** |
| [campaign.service.ts](../../lib/services/campaign.service.ts#L53) | 53 | `getCampaignRecipients` | `launchCampaign` — **every email campaign** |

The last row is the widest-reaching: `getCampaignRecipients` is the sole recipient-resolution path for email campaigns, so no campaign has ever been able to resolve a recipient.

[billing-email.service.ts:54](../../lib/services/billing-email.service.ts#L54) does it correctly — `m.first_name || ' ' || m.last_name AS full_name` — which is the fix for all six.

**Why no test caught this.** [`__tests__/unit/services/statement-email.test.ts:38`](../../__tests__/unit/services/statement-email.test.ts#L38) mocks the database and returns `{ full_name: 'Amina Hassan', ... }`. The test asserts against a fabricated row shape that production cannot produce. This is the same failure mode `project-kitabu-yetu-production-incidents` recorded for `types/api.types.ts`'s `MemberPublic`: an invented shape that suppresses exactly the class of error it appears to guard.

---

### H2 — `loan_repayments.amount` does not exist — **High**

**Evidence.** `email_weekly_summary`: 15 production failures, last 2026-07-27 08:00 UTC:

```
column "amount" does not exist
```

`loan_repayments` columns (live): `... opening_balance, principal_component, interest_component, penalty_amount, total_due, closing_balance, amount_paid, payment_date, ...`. There is no `amount`; the column is `amount_paid`.

[report-email.service.ts:113](../../lib/services/report-email.service.ts#L113):

```sql
SELECT COALESCE(SUM(amount),0) AS total FROM loan_repayments
WHERE group_id=$1 AND status='completed'
  AND created_at >= NOW() - INTERVAL '7 days'
```

Postgres resolves column names at parse time, so this throws regardless of whether any rows exist (there are currently 0). The sibling queries at lines 97 (`contributions.amount`) and 105 (`loans.principal_amount`) are both correct.

Note also that the filter uses `created_at` where `payment_date` is the semantically correct column for "repayments received this week". Flagged, not changed — that is a reporting-semantics decision, not a drift fix.

---

### M1 — Three monthly jobs fire 2026-08-01 having never run; at least two will fail — **Medium**

`job_queue` contains **zero rows** for `journal_lines_partition_maintenance`, `email_member_statements`, and `governance_compute_metrics`. All three are gated on `date === 1` in [lib/jobs/index.ts](../../lib/jobs/index.ts#L225-L245), and all three were written after 2026-07-01. The next 1st of the month is **2026-08-01**.

- **09:00 UTC — `journal_lines_partition_maintenance` will fail.** [journal-lines-partitions.service.ts](../../lib/services/journal-lines-partitions.service.ts) runs `CREATE TABLE IF NOT EXISTS <name> PARTITION OF journal_lines ...`. In production `journal_lines` has `relkind = 'r'` (ordinary table), not `'p'` — migrations 094/095 were never applied. `PARTITION OF` against a non-partitioned table is an error. The function then queries `journal_lines_default`, which also does not exist.
- **10:00 UTC — `email_member_statements` will fail** on H1's `m.full_name`.
- **11:00 UTC — `governance_compute_metrics`** has never executed against production. Not predicted to fail; simply never exercised outside CI.

---

### M2 — Migrations 094/095 unapplied, and the code carries a false verification claim — **Medium**

`journal_lines` is a plain table in production; `journal_lines_partitioned`, `journal_lines_default`, and `journal_lines_legacy` do not exist. This deferral was deliberate and is recorded as such — the SQL was never executed against any real Postgres because Docker was unreachable in the session that wrote it.

The problem is that [journal-lines-partitions.service.ts:7-15](../../lib/services/journal-lines-partitions.service.ts#L7-L15) states the opposite:

> "confirmed against a scratch Postgres 17 container matching production's configured version (`supabase/config.toml` major_version = 17), **not just documentation**."

That verification never happened. A future session reading this comment would reasonably conclude 094/095 are safe to apply. The comment must be corrected regardless of what is decided about partitioning itself.

**Separately worth questioning:** partitioning was recommended for a table that currently holds **19 rows**. The recommendation came from a capacity-planning section of `ACCOUNTING_ARCHITECTURE_AUDIT.md`; at present it is a substantial, unverified, live-money-path migration with no measurable benefit. See "Decisions needed" below.

---

### M3 — `event_outbox` and `membership_no_counters`: RLS enabled, zero policies — **Medium (latent)**

Supabase's linter flags both (`rls_enabled_no_policy`), confirmed against `pg_policies` (0 rows for each). Under the current connection role this is invisible — `postgres` has `rolbypassrls = true`. Under the `app_tenant` cutover it becomes deny-all on both tables, breaking the outbox dispatcher and membership-number allocation.

**Relevant status change since ADR-001 was written:** the `app_tenant` role **now exists in production** (`rolcanlogin = true`, `rolbypassrls = false`) — the provisioning script has been run. But `TENANT_DATABASE_URL` is absent from `vercel env ls production`, so no traffic uses it and RLS remains decorative. The system is half-cut-over: the role is provisioned but unused. These two tables are exactly the class of gap the ADR-001 CI gate was built to catch, and they should be closed before the environment variable is ever set.

---

### L1 — Migrations 092 and 093 never seeded their policy rows — **Low**

Live `policies` contents show 8 `posting_template.*` keys (from migration 090) but **not** `posting_template.loan_disbursement` or `posting_template.loan_repayment` (migration 093), and no `savings` domain row at all (migration 092).

**No behavioural impact.** [configuration.service.ts:70](../../lib/services/configuration.service.ts#L70) — `if (rows.length === 0) return { value: fallback, source: 'platform' }` — and both callers pass in-code defaults (`DEFAULT_TEMPLATES[event]`, `DEFAULT_SAVINGS_LIMITS`) that are identical to what the seeds would have written. Postings and savings limits behave correctly.

The cost is that a platform administrator cannot see or override those three policies as real rows, and the Policies UI reports provenance `platform` from a fallback rather than from a stored default. Worth seeding for consistency; not urgent.

---

### L2 — Two functions with mutable `search_path`, missed by migration 105 — **Low**

```
proname                        | proconfig
-------------------------------+-----------
derive_journal_line_entry_date | (none)
sync_journal_lines_entry_date  | (none)
```

Every other function in `public` and `private` pins `search_path`. Both of these come from migration 091 — which, per commit `bb2fc68`, was applied to production out of order, *after* migration 105's hardening sweep had already enumerated its eight targets. Neither is `SECURITY DEFINER`, so exposure is low, but they are the last two open `function_search_path_mutable` warnings on the project.

---

### L3 — The migration ledger has been unused for 38 migrations — **Low (process)**

`supabase_migrations.schema_migrations` stops at `20260715000330 / 068_loan_disbursed_notice`. Migrations 069–106 are all live in production but none is recorded. Production schema state is currently knowable only by introspection — which is precisely why the 094/095 gap and the 092/093 seed gap were invisible until this audit.

This is a direct contributor to the incident in commit `bb2fc68` ("migration 091 never applied to prod"): with no ledger, "has this been applied?" has no cheap answer.

---

### I1 — Performance advisors: 540 findings, almost all noise at current scale

299 `unused_index` (INFO), 175 `multiple_permissive_policies` (WARN), 60 `unindexed_foreign_keys` (INFO), 6 `auth_rls_initplan` (WARN).

With 5 groups and 19 journal lines, "index has not been used" carries no information — nothing has been queried enough to use any index. The 175 permissive-policy warnings are mostly the deliberate `<table>_select_public` + `<table>_modify_super_only` pairs on reference tables (`counties`, `sub_counties`, `wards`), which is a correct design, not a defect. **Recommendation: do not act on the performance advisors until production carries realistic load.** Re-run them after launch.

---

## Shipped with this audit

Fixes applied on branch `fix/production-schema-drift`:

1. **Migration 107** — `REVOKE EXECUTE` from `PUBLIC`/`anon`/`authenticated` on `link_member_to_group`, `adjust_account_reserved_amount`, `lock_group_cash_account` (C1); pins `search_path` on `derive_journal_line_entry_date` and `sync_journal_lines_entry_date` (L2).
2. **`m.full_name` → `m.first_name || ' ' || m.last_name AS full_name`** at all six call sites (H1). Both source columns are `NOT NULL`, so no `COALESCE` is required; `campaign.service.ts` keeps its `COALESCE(..., m.email)` fallback via `NULLIF(TRIM(...), '')`.
3. **`loan_repayments.amount` → `amount_paid`** in `report-email.service.ts` (H2).
4. **Partition-maintenance job made self-checking** (M1) — `ensureJournalLinesPartitions` now verifies `journal_lines` is actually partitioned (`pg_class.relkind = 'p'`) and returns a logged no-op instead of throwing when it is not. This stops the 2026-08-01 failure without forcing a decision on 094/095.
5. **Corrected the false verification comment** in `journal-lines-partitions.service.ts` (M2).
6. **Regression tests** asserting the generated SQL selects `first_name`/`last_name` and `amount_paid`, replacing mocks that fabricated a `full_name` column.

## Decisions needed (not made unilaterally)

1. **Migrations 094/095 — apply, or retire?** `journal_lines` holds 19 rows. Applying is a live-money-path table swap that has never been executed against any real Postgres. Retiring means deleting both migrations and the maintenance job. Recommendation: **retire for now**, re-derive from measured load later.
2. **`app_tenant` cutover.** The role is provisioned in production but unused. Closing M3 (`event_outbox`, `membership_no_counters` policies) should precede setting `TENANT_DATABASE_URL`.
3. **Seed migrations 092/093 into production?** Cosmetic today; makes the Policies UI honest.
4. **Failure alerting.** Nothing watches `job_queue.status='failed'`. A job failing 96 times over three months with no signal is the reason two of this audit's findings existed at all.
5. **Re-run migrations 069–106 through the ledger** so `schema_migrations` reflects reality.
