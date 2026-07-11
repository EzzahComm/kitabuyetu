-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260605240000  name: 074_group_registration_status
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS is_registered                 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS registration_number           text,
  ADD COLUMN IF NOT EXISTS registration_certificate_url  text,
  ADD COLUMN IF NOT EXISTS registration_date             date,
  ADD COLUMN IF NOT EXISTS formation_date                date;

INSERT INTO storage.buckets (id, name, public)
VALUES ('group-documents', 'group-documents', false)
ON CONFLICT (id) DO NOTHING;
