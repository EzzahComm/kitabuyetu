-- =============================================================================
-- create-app-tenant-role.sql
--
-- ONE-TIME, MANUAL provisioning script — NOT a numbered supabase/migrations
-- file. Role/credential creation isn't schema history; this follows the same
-- pattern already used for production DDL in this project (raw execute_sql /
-- `supabase db query` via the Supabase MCP or dashboard SQL editor, per
-- .agents/skills/supabase/SKILL.md — the same mechanism migrations 081+ were
-- actually applied through).
--
-- Context: OPTIMIZATION_CLEANUP_AUDIT.md Critical #2 / the BYPASSRLS decision.
-- The app's single Postgres role (`postgres`) has BYPASSRLS, so every RLS
-- policy in this schema is decorative for the app's own traffic. Rather than
-- stripping BYPASSRLS from `postgres` directly (which ~259 withAdminDb call
-- sites across 79 files — logins, registration, webhooks, cron/job workers,
-- super_admin dashboards — all currently and correctly rely on), this creates
-- a SEPARATE least-privileged role, `app_tenant`, used only by
-- withDb()/withTransaction() (lib/db/index.ts) — i.e. only the request paths
-- that already thread a real per-tenant context through. `postgres` keeps
-- BYPASSRLS and keeps serving withAdminDb() exactly as today; nothing about
-- that path changes.
--
-- BEFORE RUNNING THIS:
--   1. Confirm in the Supabase dashboard (Database → Roles, or Database →
--      Connection Pooling) that a newly created custom LOGIN role will
--      actually be reachable through the same Supavisor session-mode pooler
--      production already uses for DATABASE_URL — some Supabase project
--      configurations restrict which roles Supavisor will proxy for. Do not
--      assume; check.
--   2. Generate a strong random password and keep it out of shell history /
--      logs (e.g. `openssl rand -base64 32`).
--   3. Run this against PRODUCTION only after Phase 0's migrations (096, 097)
--      are applied — this script assumes their policies/FORCE flags exist.
--
-- Design: grants are broad at the table/function level (SELECT/INSERT/UPDATE/
-- DELETE on every table in `public`, EXECUTE on every function in `public`/
-- `private`) and rely on RLS as the actual enforcement boundary — this
-- mirrors the schema's own existing pattern for Supabase's built-in `anon`/
-- `authenticated` roles (see migration 058's comment: "RLS ... exists solely
-- to fence off the PostgREST roles ... which hold default table grants").
-- Tables with RLS enabled but zero policies (job_queue, mpesa_transactions,
-- email_logs, etc. — all on the withAdminDb-only path, not touched by
-- app_tenant today) become fully deny-all to this role, which is correct:
-- deny-by-default for anything outside the currently-verified tenant-path
-- table set is the safe direction for an accidental future withDb() call
-- against one of them, not a gap.
-- =============================================================================

-- 1. Create the role. Replace the password before running.
DO $$ BEGIN
  CREATE ROLE app_tenant LOGIN PASSWORD 'REPLACE_ME_BEFORE_RUNNING'
    NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Role app_tenant already exists — skipping CREATE ROLE, re-applying grants only.';
END $$;

-- 2. Connect + schema usage.
GRANT CONNECT ON DATABASE postgres TO app_tenant;
GRANT USAGE ON SCHEMA public, private TO app_tenant;

-- 3. Table-level DML. RLS (policies verified/fixed in migrations 096 + 097)
--    is what actually restricts rows per tenant, not this grant.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_tenant;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_tenant;

-- 4. Functions — includes the RLS helper functions policies call
--    (app_current_group_id(), is_super_admin(), etc.) and SECURITY DEFINER
--    RPCs genuinely reachable from a real tenant context (e.g.
--    debit_organization_sms_credits(), called from sms.service.ts's send()
--    path under withTransaction). SECURITY DEFINER functions run with their
--    owner's table privileges regardless of the caller's own grants — this
--    only grants permission to invoke them, not to bypass their internal logic.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public  TO app_tenant;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO app_tenant;

-- 5. Default privileges so future migrations' new tables/functions are
--    automatically visible to app_tenant without re-running this script —
--    matches how `authenticated`/`service_role` already get theirs.
--    NB: this only applies to objects created by whichever role runs this
--    ALTER DEFAULT PRIVILEGES statement (i.e. the role migrations run as,
--    `postgres`) — confirm that's still true if the migration-running
--    identity ever changes.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_tenant;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_tenant;
ALTER DEFAULT PRIVILEGES IN SCHEMA private
  GRANT EXECUTE ON FUNCTIONS TO app_tenant;

-- 6. Sanity check — should return a single row, rolbypassrls = false.
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_tenant';
