-- ─────────────────────────────────────────────────────────────────────────────
-- 112: fines.manage permission string
--
-- Found while migrating Billing/Fines (SIMPLIFICATION_AND_RBAC_AUDIT.md
-- Workstream 4, batch 6) onto withPermission(). Billing's 3 chairperson-tier
-- routes map cleanly onto the existing `billing.manage` string (seeded
-- migration 077). Fines has no equivalent — reusing billing.manage for it
-- would conflate platform subscription/payment billing with group finance
-- policy, two unrelated concerns. Adds a dedicated chairperson-only string,
-- additive and monotonic (chairperson's set only, matching PUT /fines/policy's
-- existing chairperson-only gate — no behavior change).
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY['fines.manage']) AS p
)
WHERE group_id IS NULL AND code = 'chairperson';
