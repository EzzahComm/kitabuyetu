-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260606140000  name: 077_role_permissions
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS permissions text[] NOT NULL DEFAULT '{}';

UPDATE public.roles SET permissions = ARRAY[
  'dashboard.view','meetings.view'
] WHERE group_id IS NULL AND code = 'member';

UPDATE public.roles SET permissions = ARRAY[
  'dashboard.view','meetings.view',
  'members.view','members.manage','analytics.view','meetings.manage',
  'messaging.send','data.import'
] WHERE group_id IS NULL AND code = 'secretary';

UPDATE public.roles SET permissions = ARRAY[
  'dashboard.view','meetings.view',
  'members.view','members.manage','analytics.view','meetings.manage',
  'messaging.send','data.import',
  'contributions.view','contributions.record','loans.view','loans.approve',
  'mpesa.view','payments.request','payments.approve','expenses.approve',
  'cashbook.view','accounting.manage','reports.view','governance.view',
  'welfare.manage','shares.manage','cycles.manage','dividends.manage',
  'treasury.manage','payouts.manage'
] WHERE group_id IS NULL AND code = 'treasurer';

UPDATE public.roles SET permissions = ARRAY[
  'dashboard.view','meetings.view',
  'members.view','members.manage','analytics.view','meetings.manage',
  'messaging.send','data.import',
  'contributions.view','contributions.record','loans.view','loans.approve',
  'mpesa.view','payments.request','payments.approve','expenses.approve',
  'cashbook.view','accounting.manage','reports.view','governance.view',
  'welfare.manage','shares.manage','cycles.manage','dividends.manage',
  'treasury.manage','payouts.manage',
  'billing.manage','roles.manage'
] WHERE group_id IS NULL AND code = 'chairperson';
