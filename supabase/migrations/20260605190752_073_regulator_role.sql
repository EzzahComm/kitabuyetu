-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260605190752  name: 073_regulator_role
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

ALTER TYPE public.platform_role ADD VALUE IF NOT EXISTS 'regulator';
