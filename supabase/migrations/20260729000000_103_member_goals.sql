-- ─────────────────────────────────────────────────────────────────────────────
-- 103: member_goals — personal savings-goal tracker for the (member) portal
--
-- Context: app/(member)/ (mobile self-service portal) has run entirely on
-- hardcoded mock data since it was built, with zero auth guard — flagged as
-- the single most serious gap across two consecutive UX audits
-- (docs/audits/UX_SURFACE_AUDIT_2026-07.md). This migration is one piece of
-- gating the portal behind real auth and wiring real data throughout.
--
-- member_goals is deliberately a PERSONAL TRACKING TOOL, not tied to real
-- money movement: a member manually logs progress toward a self-set target.
-- No GL posting, no financial risk, no officer visibility — self-only RLS,
-- mirroring the GUC-based self-referential pattern already used repeatedly
-- (e.g. organization_members, migration 101). Do not wire this into
-- postTemplatedJournal or any real ledger — it's intentionally just intent
-- tracking, like a savings jar, not an accounting instrument.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.member_goals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  member_id      UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  emoji          TEXT NOT NULL DEFAULT '🎯',
  target_amount  NUMERIC(15, 2) NOT NULL CHECK (target_amount > 0),
  saved_amount   NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (saved_amount >= 0),
  deadline       DATE,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'archived')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_member_goals_member         ON public.member_goals (member_id, group_id);
CREATE INDEX idx_member_goals_member_active  ON public.member_goals (member_id)
  WHERE status = 'active';

CREATE TRIGGER trg_member_goals_updated_at
  BEFORE UPDATE ON public.member_goals
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

COMMENT ON TABLE public.member_goals IS
  'Personal savings-goal tracker for the (member) self-service portal. Self-only, not linked to real contributions/GL — see lib/services/member-goals.service.ts.';

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Self-only — no officer/group visibility. This is a personal tool, not a
-- group feature. Mirrors the GUC-based pattern used throughout this codebase.

ALTER TABLE public.member_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_goals FORCE  ROW LEVEL SECURITY;

CREATE POLICY member_goals_select ON public.member_goals
  FOR SELECT USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND member_id = app_current_user_id())
  );

CREATE POLICY member_goals_insert ON public.member_goals
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id() AND member_id = app_current_user_id())
  );

CREATE POLICY member_goals_update ON public.member_goals
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND member_id = app_current_user_id())
  );

CREATE POLICY member_goals_delete ON public.member_goals
  FOR DELETE USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND member_id = app_current_user_id())
  );

-- ─── notifications RLS hardening ───────────────────────────────────────────
-- Pre-existing gap found while researching this feature area (not introduced
-- by it): notifications_all (20260101000009_010_rls_policies.sql:373-376) is
-- `FOR ALL USING (is_super_admin() OR group_id = app_current_group_id())` —
-- no member_id check at all, so any group member can UPDATE/DELETE any OTHER
-- member's notification row via RLS alone. Split into a group-wide INSERT
-- policy (still needed — officer-triggered writes, e.g.
-- member-roles.service.ts, come from a caller who isn't the notification's
-- own member_id) and self-only UPDATE/DELETE policies.

DROP POLICY IF EXISTS notifications_all ON public.notifications;

CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR group_id = app_current_group_id()
  );

CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND member_id = app_current_user_id())
  );

CREATE POLICY notifications_delete ON public.notifications
  FOR DELETE USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND member_id = app_current_user_id())
  );
