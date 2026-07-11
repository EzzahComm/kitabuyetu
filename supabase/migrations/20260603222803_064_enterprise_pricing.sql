-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260603222803  name: 064_enterprise_pricing
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

ALTER TABLE public.ngos
  ADD COLUMN IF NOT EXISTS enterprise_per_member_fee numeric(10,2),
  ADD COLUMN IF NOT EXISTS enterprise_sms_free       integer,
  ADD COLUMN IF NOT EXISTS enterprise_sms_rate       numeric(6,4);

COMMENT ON COLUMN public.ngos.enterprise_per_member_fee IS
  'Negotiated Enterprise per-member monthly fee (KES). When set, active linked groups bill at the Enterprise tier instead of by member count. From KES 8.';
COMMENT ON COLUMN public.ngos.enterprise_sms_free IS
  'Optional Enterprise monthly free-SMS allowance for linked groups. NULL = use Scale tier (100).';
COMMENT ON COLUMN public.ngos.enterprise_sms_rate IS
  'Optional Enterprise per-SMS overage rate (KES). NULL = use Scale tier (0.50).';

ALTER TABLE public.ngos
  ADD CONSTRAINT ngos_enterprise_fee_nonneg
    CHECK (enterprise_per_member_fee IS NULL OR enterprise_per_member_fee >= 0),
  ADD CONSTRAINT ngos_enterprise_sms_free_nonneg
    CHECK (enterprise_sms_free IS NULL OR enterprise_sms_free >= 0),
  ADD CONSTRAINT ngos_enterprise_sms_rate_nonneg
    CHECK (enterprise_sms_rate IS NULL OR enterprise_sms_rate >= 0);
