-- =============================================================================
-- 183: Changi$ha permission catalog
--
-- New route-level gate for the campaigns feature added in migration 182.
-- Same additive, monotonic-by-rank pattern as 110_permission_catalog_
-- reconciliation.sql: campaigns.view goes to every officer role that can see
-- a group's own money activity; campaigns.manage (create/submit-for-review)
-- goes to the same officer tier already trusted with loans/contributions
-- (chairperson/treasurer/secretary) — matching campaigns_insert/_update's
-- role list in migration 182's RLS policies exactly, so the app-layer
-- permission and the database-layer RLS check never disagree about who can
-- write a campaign.
--
-- Plain members are NOT granted campaigns.view here — there is no
-- member-facing "my group's campaigns" screen in v1 (they see the same
-- public campaign page as everyone else once it's live), so nothing to gate.
-- =============================================================================

UPDATE public.roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY['campaigns.view','campaigns.manage']) AS p
)
WHERE group_id IS NULL AND code = 'secretary';

UPDATE public.roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY['campaigns.view','campaigns.manage']) AS p
)
WHERE group_id IS NULL AND code = 'treasurer';

UPDATE public.roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY['campaigns.view','campaigns.manage']) AS p
)
WHERE group_id IS NULL AND code = 'chairperson';
