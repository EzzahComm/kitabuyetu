-- ─────────────────────────────────────────────────────────────────────────────
-- 110: permission catalog reconciliation
--
-- Part of SIMPLIFICATION_AND_RBAC_AUDIT.md Workstream 4 (RBAC permission
-- activation). roles.permissions (migrations 077/079) was seeded once and
-- never reconciled against real route-level role tiers. This migration closes
-- three confirmed gaps ahead of any route migrating onto withPermission():
--
--   1. `data.import` was one coarse string for a route surface that actually
--      has a 4-way role split (start=treasurer, preview/commit/cancel=
--      secretary, rollback=chairperson). Split into import.start/preview/
--      commit/cancel/rollback; data.import itself is left in place (additive,
--      not a rename).
--   2. SMS templates/schedules gate reads at secretary and writes at
--      chairperson; the equivalent email-templates route has no gate at all
--      today. New messaging.templates.view/manage + messaging.schedules.
--      view/manage close this consistently (existing messaging.send/
--      messaging.manage are untouched — different capability).
--   3. Meetings/Welfare/Investments have zero role check anywhere today
--      (route or service layer). meetings.view/manage already exist and fit
--      as-is; welfare.request (member-reachable self-service help request),
--      welfare.view, investments.view, and investments.manage are new.
--
-- Additive only (array_agg(DISTINCT ...) over existing || new, mirroring
-- migration 079's own idempotent style) and monotonic by rank — every string
-- added to a lower role is also added to every higher role, preserving the
-- chairperson ⊇ treasurer ⊇ secretary ⊇ member invariant the seed data
-- already has, verified by role-permission-catalog.test.ts.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY[
    'welfare.request','welfare.view','investments.view'
  ]) AS p
)
WHERE group_id IS NULL AND code = 'member';

UPDATE public.roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY[
    'welfare.request','welfare.view','investments.view',
    'import.preview','import.commit','import.cancel',
    'messaging.templates.view','messaging.schedules.view'
  ]) AS p
)
WHERE group_id IS NULL AND code = 'secretary';

UPDATE public.roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY[
    'welfare.request','welfare.view','investments.view',
    'import.preview','import.commit','import.cancel',
    'messaging.templates.view','messaging.schedules.view',
    'import.start','investments.manage'
  ]) AS p
)
WHERE group_id IS NULL AND code = 'treasurer';

UPDATE public.roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY[
    'welfare.request','welfare.view','investments.view',
    'import.preview','import.commit','import.cancel',
    'messaging.templates.view','messaging.schedules.view',
    'import.start','investments.manage',
    'import.rollback','messaging.templates.manage','messaging.schedules.manage'
  ]) AS p
)
WHERE group_id IS NULL AND code = 'chairperson';
