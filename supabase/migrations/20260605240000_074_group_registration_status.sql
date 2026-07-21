-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260605240000  name: 074_group_registration_status
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS is_registered                 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS registration_number           text,
  ADD COLUMN IF NOT EXISTS registration_certificate_url  text,
  ADD COLUMN IF NOT EXISTS registration_date             date,
  ADD COLUMN IF NOT EXISTS formation_date                date;

-- storage.buckets is part of Supabase's Storage extension, not available on
-- a plain Postgres image (local docker-compose / db-integration CI job).
-- Guarded the same way as the other Supabase-platform-only objects in this
-- history (pg_cron, rls_auto_enable) rather than assuming it exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'buckets'
  ) THEN
    EXECUTE $sql$
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('group-documents', 'group-documents', false)
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;
END $$;
