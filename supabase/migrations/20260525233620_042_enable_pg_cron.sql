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

CREATE EXTENSION IF NOT EXISTS pg_cron;
