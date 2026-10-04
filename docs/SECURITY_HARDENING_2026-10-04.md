# Security hardening - 2026-10-04

First pass. Sources: Supabase security advisors (production), `npm audit`, the
built-in security review, and a clean replay of every migration against a
local Postgres.

## Fixed in this change

### 1. register_organization() and register_campaign() were callable by anyone (migration 210)

Both are `SECURITY DEFINER` (they run as the owner and bypass RLS) and were
executable by `anon` and `authenticated`, so anyone with the public Supabase
key could call them at `/rest/v1/rpc/<name>` and skip the app's validation and
review flow. `register_group()` was already locked; these two were added later.

**Root cause.** Migrations 206 and 208 ended with `REVOKE ... FROM PUBLIC;
GRANT ... TO postgres;`. On Supabase that is not enough: default privileges
also grant EXECUTE on every new function to `anon`, `authenticated` and
`service_role` by name, and `REVOKE FROM PUBLIC` does not remove a direct
grant. Migration 107 closed the same gap for three earlier functions.

**Why production looked fine for the older functions.** `register_group()`, the
verification RPCs and `recompute_par_buckets()` are only locked in production
because a blanket revoke was run by hand when they existed. A database rebuilt
from the migrations (a preview branch, staging, local) left them open: a
replay with Supabase-style default grants exposed six definer functions, not
two.

**Fix (`20261004000000_210_lock_down_security_definer_rpcs.sql`, idempotent):**

1. Revoke the two known exposures from PUBLIC, anon and authenticated.
2. Sweep every `SECURITY DEFINER` function in `public` the same way. In
   production this changes only the two functions above.
3. `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM anon,
authenticated`, so new functions are no longer auto-granted to those roles.
   Postgres's built-in PUBLIC grant remains, so a migration still has to revoke
   it; the test below enforces that.

`service_role` and `app_tenant` keep their access. The app reaches these
functions over its own pg pool, never through PostgREST.

**Regression test** (`__tests__/integration/security-definer-exposure.test.ts`):
fails CI if any `SECURITY DEFINER` function in `public` is executable by `anon`
or `authenticated`. Checked to fail when a function is reopened and when a new
definer function skips the revoke.

**Verified locally** against a Postgres 16 replay of all 229 migrations:
nothing exposed afterwards (with and without Supabase-style default grants);
re-applying is a no-op; `app_tenant` can still execute all 20 definer
functions; the full integration suite (79 suites, 523 tests) passes both as
the superuser and under `app_tenant`.

## Reviewed and deliberately not changed

| Finding                                                                                                                                              | Decision                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `function_search_path_mutable` on `app_current_role`, `app_current_organization_id`, `app_current_group_id`, `app_current_user_id`, `is_super_admin` | Left as is. All five are `LANGUAGE sql STABLE`, not `SECURITY DEFINER`, and only call `current_setting()` and each other by qualified name. Setting `search_path` on a SQL function stops Postgres inlining it, and these run inside every RLS policy, so the cost is real and the security gain is nil.                                                         |
| `rls_enabled_no_policy` on `sms_provider_costs`                                                                                                      | Left as is. RLS with no policy is deny-all for everyone but the owner and BYPASSRLS roles, which is the intended posture for an internal cost table (INFO level).                                                                                                                                                                                                |
| `npm audit`: 5 high in production dependencies (`braces`, `micromatch`, `fast-glob`, `chokidar`, all via `tailwindcss` 3)                            | Not changed. GHSA-vfj7-8cjw-p6xm affects `braces` up to and including 3.0.3, which is the latest release, so there is no patched version to override to. The only fix npm offers is Tailwind 3 to 4, a major upgrade. Exposure is build-time only: Tailwind globs this repo's own source files and never sees user input. Revisit with the Tailwind 4 migration. |

## Not done / still open

- Migration 210 is not yet applied to the production database (see the PR).
- Production migration ledger: applied versions use the timestamp of when they
  ran, not the file's timestamp, so the Supabase preview check reports "Remote
  migration versions not found in local migrations directory" (failing before
  this change too). Fixing it means repairing the ledger; not attempted.
- Not reviewed yet: auth and session handling, API route authorization,
  webhook signature checks, rate limiting, security headers/CSP, secrets
  handling. Next candidates.
