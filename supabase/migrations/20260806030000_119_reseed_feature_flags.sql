-- ─────────────────────────────────────────────────────────────────────────────
-- 119: re-seed feature_flags — the table is EMPTY in production
--
-- Found while auditing RLS reachability ahead of the app_tenant cutover
-- (ADR-001): `SELECT count(*) FROM feature_flags` returns 0 in production, even
-- as a BYPASSRLS admin.
--
-- WHY IT MATTERS
-- isFeatureEnabled() fails open on zero rows by design:
--     if (rows.length === 0) return true;  // unknown key — fail open
-- With the table empty, EVERY lookup takes that branch, so gating is inert
-- platform-wide and the admin portal's toggles (admin.service.ts:999/1007)
-- operate on an empty list — they cannot mean anything.
--
-- ⚠ WHY MIGRATION 025'S SEED CANNOT SIMPLY BE RE-RUN — READ BEFORE EDITING
-- Two things about the live schema break it, and the second is dangerous:
--
--   1. `name` is NOT NULL here but absent from 025's INSERT column list, so
--      that statement now fails outright with 23502.
--
--      `name` itself is undocumented drift: added to production directly,
--      never through a migration (same pattern migration 068 already works
--      around for feature_flags.created_by/updated_by). A schema built fresh
--      from migrations alone — CI's Tenant Isolation job, Supabase preview
--      branches — has no such column, so this file adds it defensively
--      below. Against production the ADD COLUMN is a no-op.
--
--   2. `rollout_pct smallint NOT NULL DEFAULT 0`, and isFeatureEnabled ends:
--          if (flag.rollout_pct >= 100) return true;
--          if (flag.rollout_pct <= 0)   return false;   ← line 93
--      A flag seeded enabled=true, applies_to='all' but with the DEFAULT
--      rollout_pct of 0 therefore resolves to FALSE — assertEnabled throws
--      ForbiddenError and the module is switched off. Seeding 025's rows
--      verbatim would have DISABLED welfare, investments and meetings for
--      every group: strictly worse than the empty table it was fixing.
--
-- So the three gated flags are seeded rollout_pct = 100, which takes the
-- `>= 100 return true` branch and reproduces today's fail-open outcome exactly.
--
-- ZERO BEHAVIOUR CHANGE, verified by call-site inventory: isFeatureEnabled has
-- exactly one caller (featureFlagsService.assertEnabled), and only three keys
-- are ever asserted — welfare_module, investment_module, meeting_management.
-- All three resolve to "allowed" before and after. The remaining eight rows are
-- admin-portal toggles for unbuilt features, gated by nothing.
-- ─────────────────────────────────────────────────────────────────────────────

-- Table is empty at this point on every path (fresh build, and production
-- per the count(*) = 0 finding above), so adding NOT NULL with no default
-- cannot violate any existing row.
ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS name character varying NOT NULL;

INSERT INTO public.feature_flags (key, name, description, enabled, rollout_pct, applies_to, conditions) VALUES
  -- Gated by assertEnabled today. rollout_pct = 100 is load-bearing (see above).
  ('welfare_module',          'Welfare Module',          'Welfare fund management module',                        true,  100, 'all',  '{}'),
  ('investment_module',       'Investment Module',       'Investment portfolio tracking module',                  true,  100, 'all',  '{}'),
  ('meeting_management',      'Meeting Management',      'Digital meeting management and resolutions',            true,  100, 'all',  '{}'),
  -- Admin-portal toggles for features that are not built or not gated. Left
  -- disabled exactly as migration 025 intended.
  ('new_dashboard',           'New Dashboard',           'New enterprise dashboard with enhanced analytics',      false, 0,   'all',  '{}'),
  ('ai_loan_recommendations', 'AI Loan Recommendations', 'AI-powered loan approval recommendations',              false, 0,   'plan', '{"min_plan": "growth"}'),
  ('mpesa_automation',        'M-Pesa Automation',       'Automated M-Pesa contribution reconciliation',          false, 0,   'plan', '{"min_plan": "growth"}'),
  ('bulk_sms',                'Bulk SMS',                'Bulk SMS notifications for group announcements',        false, 0,   'plan', '{"min_plan": "growth"}'),
  ('advanced_analytics',      'Advanced Analytics',      'Advanced analytics dashboard with export capabilities', false, 0,   'plan', '{"min_plan": "enterprise"}'),
  ('multi_currency',          'Multi-Currency',          'Multi-currency support for international groups',       false, 0,   'plan', '{"min_plan": "enterprise"}'),
  ('api_access',              'API Access',              'REST API access for third-party integrations',          false, 0,   'plan', '{"min_plan": "enterprise"}'),
  ('white_label',             'White Label',             'White-label branding for enterprise deployments',       false, 0,   'plan', '{"min_plan": "enterprise"}')
ON CONFLICT (key) DO NOTHING;

-- Assert the three gated flags resolve to ALLOWED, mirroring isFeatureEnabled's
-- own logic. Without the rollout_pct clause this migration would ship an outage.
DO $$
DECLARE
  broken INTEGER;
BEGIN
  SELECT count(*) INTO broken
  FROM (VALUES ('welfare_module'), ('investment_module'), ('meeting_management')) AS required(key)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.feature_flags f
    WHERE f.key = required.key
      AND f.enabled
      AND f.applies_to = 'all'
      AND f.rollout_pct >= 100
  );

  IF broken > 0 THEN
    RAISE EXCEPTION
      'feature_flags reseed would disable % gated module(s): each must be enabled, applies_to=all, rollout_pct>=100', broken;
  END IF;
END;
$$;
