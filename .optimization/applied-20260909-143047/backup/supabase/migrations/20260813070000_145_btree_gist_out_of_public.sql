-- =============================================================================
-- 145: Move btree_gist out of the public schema
--
-- Migration 143 ran a bare `CREATE EXTENSION IF NOT EXISTS btree_gist`, which
-- defaults to the current schema — public. That is inconsistent with this
-- project's own convention (uuid-ossp and pgcrypto both live in `extensions`)
-- and Supabase's advisor flags it: `public` is the schema PostgREST exposes,
-- so nothing belongs there that does not have to be.
--
-- Caught by running get_advisors immediately after applying 143, which is the
-- standing rule on this project after any DDL and has now paid for itself
-- three times (migrations 142, 144's dropped functions, and this).
--
-- SAFE DESPITE THE DEPENDENCY. sms_pricing_tiers' exclusion constraint
-- sms_tier_no_overlap uses this extension's GiST operator classes. Postgres
-- tracks those by OID rather than by name, so relocating the extension moves
-- them without invalidating the constraint. Verified against a real database
-- before shipping: after the move, an overlapping active tier is still
-- rejected by that exact constraint.
-- =============================================================================

-- The schema exists on Supabase, but a from-scratch replay (CI's own base run)
-- has no such schema until something creates it.
CREATE SCHEMA IF NOT EXISTS extensions;

ALTER EXTENSION btree_gist SET SCHEMA extensions;
