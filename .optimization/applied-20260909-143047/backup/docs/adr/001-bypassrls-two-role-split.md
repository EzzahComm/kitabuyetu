# ADR 001: Stop relying on BYPASSRLS for tenant traffic via a two-role split

**Status:** Accepted. **Phases 0 and 1 COMPLETE and live in production as of
2026-08-05** — tenant traffic runs as `app_tenant` under real RLS enforcement.
Phase 3 deferred.
**Date:** 2026-07-22 (Phase 1 CI verification added 2026-07-27; production
cutover completed 2026-08-05)
**Related:** `docs/audits/OPTIMIZATION_CLEANUP_AUDIT.md` Critical #2, Medium-term
roadmap item "Write down the BYPASSRLS decision explicitly."

## Context

The application's Postgres connection role (`postgres`) has `BYPASSRLS`, documented
in `supabase/migrations/20260714020000_058_registry_rls_hardening.sql:9`. Every one
of the 188 `CREATE POLICY` statements across the schema is therefore decorative for
the app's own traffic — tenant isolation in production has always been enforced
*only* by hand-written `WHERE group_id = $1` clauses in service code, not by the
database. Code review had already confirmed those clauses are correctly applied
everywhere sampled, but that's a review guarantee, not a database one: a single
missed `WHERE` clause in a future change would leak data across tenants with
nothing in the database to stop it.

This was previously an implicit fact about the system, not a recorded decision. This
ADR makes it one.

## Decision

Introduce a second, least-privileged Postgres role, `app_tenant` (no `BYPASSRLS`),
used **only** by `lib/db/index.ts`'s `withDb()`/`withTransaction()` — the functions
that already thread a real per-request `TenantContext` (user, group, role) through as
Postgres session GUCs. The existing `postgres` role keeps `BYPASSRLS` and keeps
serving `withAdminDb()` exactly as today.

This was chosen over the alternative of stripping `BYPASSRLS` from `postgres`
directly, because `withAdminDb()` is called from **~259 call sites across 79
files** — not a handful of admin routes. A research pass grouped them:

- **Super_admin/backoffice dashboards** (~25 sites) — genuinely cross-tenant by design.
- **Cron/queue jobs with no human session** (~40+ sites) — reconciliation sweeps,
  the outbox dispatcher, scheduled email/SMS — genuinely need to scan across all
  groups in one pass (e.g. `runReconciliation(null, null)`).
- **Webhooks** (~35 sites) — M-Pesa callbacks and email delivery webhooks, which
  often must resolve the tenant via an admin-context lookup *before* a tenant
  context can even be constructed (keyed by external IDs, not `group_id`).
- **Pre-authentication** (~20 sites) — login, registration, token refresh. These
  **cannot** have a tenant context by construction: identity itself is what's being
  established.
- **Tenant-scoped data behind a weak/normal auth gate** (~130+ sites, the largest
  bucket) — plausible candidates to eventually run under `app_tenant` too, but
  reclassifying each one individually up front was judged too large a blast radius
  to gate this decision on (see Phase 3 below).

A single-role cutover would have required a correct answer for all 259 sites before
shipping anything. The two-role split instead makes zero behavior change for four of
those five buckets and lets the actual goal — real enforcement for ordinary tenant
requests — ship independently.

## Consequences

- **What's protected now (once Phase 1 is live in production):** every request that
  reads or writes tenant data through `withDb`/`withTransaction` — contributions,
  loans, shares, dividends, welfare, investments, meetings, credit scores, and more
  — is enforced by the database itself, not just code review.
- **What's still on the bypass role, deliberately:** admin dashboards, cron/job
  workers, webhooks, and pre-auth flows. This is an intentional trust boundary, not
  an oversight — see the bucket breakdown above. `withAdminDb()`'s own doc comment
  already said "used only by admin endpoints"; buckets B/C/D/F show that was
  aspirational, not actual, at the time BYPASSRLS was granted.
- **A real, independent bug was found and fixed as a prerequisite** (migration 096):
  19 RLS policies still checked the pre-rename `'group_admin'` string literal
  instead of `'chairperson'` (migration 050 renamed the role but missed policies
  added in later, unrelated migrations). This was invisible in production only
  because BYPASSRLS masked it; it would have silently denied chairperson writes to
  shares, dividends, credit scores, welfare, and more the moment any role stopped
  bypassing. Fixed and verified against a real Postgres 17 instance.
- **12 tables gained `FORCE ROW LEVEL SECURITY`** (migration 097). Note for future
  readers: `FORCE` only changes behavior for the table *owner* — since no migration
  ever runs `ALTER TABLE ... OWNER TO`, every table's owner is `postgres`, so `FORCE`
  is what makes RLS apply to a hypothetical future bypass-removal of `postgres`
  itself. It has no effect on `app_tenant`, which is never the owner and is
  therefore already fully subject to RLS the moment a table has it enabled,
  `FORCE` or not. Both were shipped: `FORCE` as defense-in-depth matching the
  schema's own stated future intent, correct policies as the part that actually
  gates `app_tenant`'s correctness.
- **Grants are broad, RLS does the restricting.** `scripts/ops/create-app-tenant-role.sql`
  grants `app_tenant` blanket `SELECT/INSERT/UPDATE/DELETE` on `public` and `EXECUTE`
  on all functions, relying on RLS as the actual boundary — mirroring how this schema
  already treats Supabase's built-in `anon`/`authenticated` roles (migration 058's own
  comment). A table with RLS enabled but zero policies becomes fully deny-all to
  `app_tenant`; that's the safe default for anything not yet verified as being on the
  real tenant path.
- **Rollout is a no-op until explicitly provisioned.** `TENANT_DATABASE_URL` is
  optional in `lib/env.ts` and `withDb`/`withTransaction` fall back to the existing
  pool/role when it's unset. Nothing changes in any environment until: (a) someone
  runs `scripts/ops/create-app-tenant-role.sql` against production, and (b) the env
  var is set. Unsetting it is the instant revert path.

## Alternatives considered

- **Strip `BYPASSRLS` from `postgres` directly.** Rejected — would require a correct
  answer for all 259 `withAdminDb` call sites (including login/registration) before
  shipping anything, an unacceptably large single change for a request-path-critical,
  every-tenant-affecting system.
- **Give `withAdminDb()` a `'system'` GUC and add an `OR current_setting('app.current_role') = 'system'` branch to every policy.** Rejected — touches all 188 policies
  individually, a larger and riskier blast radius than creating one new role.
- **Do nothing, document BYPASSRLS as accepted risk.** Considered and explicitly
  rejected by the user — see the question this ADR resolves. The database itself
  enforcing tenant isolation was judged worth the migration effort given the
  platform's trajectory toward more organizations, donors, and financial
  institutions sharing the same infrastructure.

## Phase 1 CI verification (2026-07-27)

Confirmed via authenticated `vercel env ls production`: `TENANT_DATABASE_URL` is
**not** set in either Production or Preview (only `DATABASE_URL` exists, one shared
value across both environments — there is no separate staging database). This
closes `audit/07-remediation-backlog.md` Critical #1's open *question*: RLS is
confirmed decorative in production today, the worst case this ADR describes.

The `db-integration` CI job (`.github/workflows/ci.yml`) now provisions `app_tenant`
in its disposable per-run Postgres 17 instance by piping the real
`scripts/ops/create-app-tenant-role.sql` through `sed` (only the database name and
password placeholder differ from what production will run), then runs two proofs on
every push: the existing `test:integration` suite re-run with `TENANT_DATABASE_URL`
pointed at `app_tenant` (functional parity — zero test changes needed, since
`lib/db/index.ts` already routes through it once set), and a new
`test:integration:app-tenant` suite
(`__tests__/integration/app-tenant/rls-enforcement.test.ts`) proving Postgres's own
RLS policy — not a service-layer `WHERE group_id` clause — filters cross-tenant rows
for an unfiltered query. This is a continuously-re-verified CI gate, not a one-time
check, and covers both halves of the "staging verification pass" this ADR calls for
below — before production is ever touched.

## Phase 1 completion — DONE (2026-08-05)

The production cutover is live. `TENANT_DATABASE_URL` is set in Vercel Production,
so `withDb()`/`withTransaction()` connect as `app_tenant` (`NOBYPASSRLS`,
`NOSUPERUSER`) while `withAdminDb()` continues on `postgres` exactly as before.

**The script's open question is answered: Supavisor DOES proxy a custom LOGIN role.**
Connection facts, recorded so nobody has to rediscover them:

- Pooler host `aws-1-eu-central-1.pooler.supabase.com:5432`, database `postgres`.
  Note `aws-1-`, not `aws-0-` — the wrong prefix returns Supavisor's misleading
  "tenant/user not found", which reads like the role is unsupported rather than
  the host being wrong.
- Supavisor username format is `<role>.<project_ref>`, i.e.
  `app_tenant.<ref>` — not a bare `app_tenant`.
- The direct host `db.<ref>.supabase.co` is IPv6-only and unreachable from
  ordinary networks and from Vercel, matching `lib/db/index.ts`'s comment.

**Verified before the switch** (against production, as `app_tenant` through the
pooler): with no tenant GUC set, `SELECT count(*) FROM groups` returns 0; with a
real group's GUCs set it returns exactly that group's rows; with a bogus group
UUID it returns 0. **Verified after**: 14 pooled `app_tenant` connections appeared
on the first real sign-in, alongside `postgres` connections for admin paths, with
no `42501`/RLS errors in the Postgres log.

`app_tenant`'s password was rotated during the cutover — this script ships a
`REPLACE_ME_BEFORE_RUNNING` placeholder and there was no way to confirm it had
been replaced. Note that Vercel environment variables are sensitive/write-only by
default: `vercel env pull` returns empty strings for user secrets, so the value
cannot be read back. Rotate rather than attempt to recover it.

**Rollback**: `vercel env rm TENANT_DATABASE_URL production` + redeploy (~2 min);
`lib/db` falls back to the admin pool. No schema change to undo.

**Known gap**: Preview currently has no `TENANT_DATABASE_URL` (its stale value was
removed during rotation, and `vercel env add ... preview` loops on a git-branch
prompt even with `--yes --non-interactive`). Preview therefore falls back to the
admin pool. CI's `app_tenant` job still exercises RLS on every PR, so coverage is
retained; restoring Preview is a convenience, not a correctness gap.

## Follow-up (not yet done)

- **Phase 3 (deferred, not blocking)**: incrementally migrate the ~130 "tenant data
  behind a weak gate" `withAdminDb` call sites (email/SMS/campaign services) onto
  `withDb(ctx, ...)` so they run under `app_tenant` too, service by service. Two
  structural gaps need their own design first: functions called from both a user
  route and a background job need a documented job-identity convention, and
  `switch-group`/`memberships` routes are legitimately "cross-group-for-self," which
  doesn't fit the single-`app.current_group_id` GUC model.
- If Phase 3 ever completes fully, revisit whether `postgres` itself should lose
  `BYPASSRLS` — at that point the remaining call sites would genuinely all be
  system/admin-only, closing the loop this ADR opens.
