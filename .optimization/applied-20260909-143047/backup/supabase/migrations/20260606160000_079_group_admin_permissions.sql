-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260606160000  name: 079_group_admin_permissions
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

UPDATE public.roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY[
    'dividends.approve','shares.reverse','payments.disburse',
    'data.rollback','admin.recompute','group.manage','messaging.manage'
  ]) AS p
)
WHERE group_id IS NULL AND code = 'chairperson';
