-- =============================================================================
-- 042_enable_pg_cron.sql
-- Applied via mcp apply_migration on 2026-05-26 during the Phase 2 cron wiring.
-- This file mirrors that change so a fresh deploy (e.g. local with
-- `supabase db reset`) ends up in the same state.
--
-- pg_net is already installed by Supabase. pg_cron is opt-in and lives in
-- the `cron` schema. Scheduling the actual job (cron.schedule(...)) is
-- a runtime config step documented in DEPLOY.md, not a migration — the
-- schedule embeds the production URL and a Vault secret that aren't
-- environment-portable.
-- =============================================================================

-- Guarded: pg_cron ships with Supabase's Postgres image but isn't available
-- on a plain postgres:*-alpine image (local docker-compose / CI's
-- db-integration job) — nothing else in this migration history actually
-- depends on the `cron` schema existing (the only other `cron.schedule(...)`
-- reference, in migration 041, is documentation inside a comment, never
-- executed), so skipping it there is a true no-op rather than papering over
-- a real dependency.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  END IF;
END $$;
