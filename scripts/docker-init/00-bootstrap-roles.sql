-- =============================================================================
-- 00-bootstrap-roles.sql
--
-- Several supabase/migrations/*.sql files GRANT/REVOKE against Supabase's
-- built-in `anon` / `authenticated` / `service_role` roles (RLS policy
-- targets). A real Supabase project provisions these automatically; a plain
-- postgres:17-alpine image (this local docker-compose stack) does not — so
-- without this file, applying the migrations here fails on the first one
-- that references them (20260101000007_008_audit_notifications.sql).
--
-- Mounted into /docker-entrypoint-initdb.d/ alongside (and sorting before)
-- supabase/migrations/ — see docker-compose.yml.
-- =============================================================================

DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
