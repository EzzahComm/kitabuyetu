-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260605172449  name: 070_member_channel_prefs
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS notify_whatsapp boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_sms      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_email    boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.members.notify_whatsapp IS 'Member allows WhatsApp notifications.';
COMMENT ON COLUMN public.members.notify_sms IS 'Member allows SMS notifications.';
COMMENT ON COLUMN public.members.notify_email IS 'Member allows email notifications.';
