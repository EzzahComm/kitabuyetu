-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260605121331  name: 067_weekly_billing
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

ALTER TABLE public.platform_billing
  ADD COLUMN IF NOT EXISTS period_type text NOT NULL DEFAULT 'monthly';

ALTER TABLE public.platform_billing
  ADD CONSTRAINT platform_billing_period_type_chk CHECK (period_type IN ('monthly','weekly'));

ALTER TABLE public.platform_billing DROP CONSTRAINT IF EXISTS platform_billing_unique;
ALTER TABLE public.platform_billing
  ADD CONSTRAINT platform_billing_unique UNIQUE (group_id, period, period_type);

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS billing_interval text NOT NULL DEFAULT 'monthly';

ALTER TABLE public.groups
  ADD CONSTRAINT groups_billing_interval_chk CHECK (billing_interval IN ('monthly','weekly'));

COMMENT ON COLUMN public.platform_billing.period_type IS
  'Billing cadence for this row: monthly | weekly. Part of the uniqueness key.';
COMMENT ON COLUMN public.groups.billing_interval IS
  'How this group is billed: monthly (default) | weekly. Drives which billing cron run charges it.';
