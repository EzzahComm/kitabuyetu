-- =============================================================================
-- 00-bootstrap-roles.sql
--
-- Several supabase/migrations/*.sql files GRANT/REVOKE against Supabase's
-- built-in `anon` / `authenticated` / `service_role` / `postgres` roles (RLS
-- policy targets, plus `postgres` itself — real Supabase's default
-- superuser is literally named `postgres`; this stack's superuser is named
-- by POSTGRES_USER instead, e.g. `kitabuyetu`, so `postgres` needs to exist
-- as a plain role purely as a GRANT target). A real Supabase project
-- provisions these automatically; a plain postgres:17-alpine image (this
-- local docker-compose stack) does not — so without this file, applying the
-- migrations here fails on the first one that references them
-- (20260101000007_008_audit_notifications.sql).
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

DO $$ BEGIN
  CREATE ROLE postgres NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
