-- =============================================================================
-- 193: Phase 9.2 — audiences + marketing campaign core, SMS channel
--
-- marketing_campaigns is the new, unambiguous name for cross-channel
-- marketing sends — deliberately NOT "campaigns" (Changi$ha fundraising,
-- migration 182: public unauthenticated donors, entirely different concept)
-- and NOT "sms_campaigns" (migration 013: still the table smsService.
-- sendBulkCampaign syncs completion against for THAT table's own callers —
-- untouched here, marketing_campaigns has its own status machine and its own
-- completion sync, see lib/jobs/handlers.ts's handleMarketingCampaignSmsSend).
--
-- Scope for this increment: SMS channel only, group-scoped only (matches
-- smsService.sendBulkCampaign's own mandatory groupId). Email channel
-- activation is 9.3. Org-level campaigns are a later increment once an
-- org-scoped send path exists — sendBulkCampaign has none today.
--
-- Audience source is intentionally narrow for v1: 'all_members'/
-- 'active_members' (reusing resolveSmsRecipients' exact existing group-
-- membership resolution) or 'crm_contacts_opted_in' (only contacts with
-- marketing_opt_in = true, migration 192 — the consent gate is enforced by
-- construction, not by a runtime check the audience resolver could forget).
-- A full arbitrary-criteria dynamic-segment DSL (generalizing lib/sms/
-- conditions.ts's evaluateCondition) is deferred; `criteria JSONB` exists so
-- that generalization doesn't require a schema change when it lands.
--
-- Approval is mandatory for every campaign regardless of audience (explicit
-- product decision) — maker-checker: the approver must not be the campaign's
-- own creator, mirroring the pattern already established for B2C
-- disbursements (disbursements.service.ts).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketing_audiences (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID        NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  source      TEXT        NOT NULL CHECK (source IN ('all_members', 'active_members', 'crm_contacts_opted_in')),
  criteria    JSONB,
  created_by  UUID        NOT NULL REFERENCES public.members (id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_audiences_group ON public.marketing_audiences (group_id);

ALTER TABLE public.marketing_audiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_audiences FORCE  ROW LEVEL SECURITY;

CREATE POLICY marketing_audiences_all ON public.marketing_audiences
  FOR ALL USING (is_super_admin() OR group_id = app_current_group_id())
  WITH CHECK (is_super_admin() OR group_id = app_current_group_id());

-- ── marketing_campaigns ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID        NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  title            TEXT        NOT NULL,
  channel          TEXT        NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms')),
  message          TEXT        NOT NULL,
  audience_id      UUID        NOT NULL REFERENCES public.marketing_audiences (id) ON DELETE RESTRICT,
  status           TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
                     'draft', 'pending_review', 'approved', 'rejected', 'sending', 'completed', 'cancelled'
                   )),
  rejection_reason TEXT,
  recipient_count  INT         NOT NULL DEFAULT 0,
  sent_count       INT         NOT NULL DEFAULT 0,
  failed_count     INT         NOT NULL DEFAULT 0,
  created_by       UUID        NOT NULL REFERENCES public.members (id) ON DELETE RESTRICT,
  reviewed_by      UUID        REFERENCES public.members (id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT marketing_campaigns_rejection_reason_consistent CHECK (
    (status = 'rejected' AND rejection_reason IS NOT NULL) OR (status <> 'rejected')
  ),
  -- Maker-checker: the row that reviewed/approved a campaign must not be its
  -- own creator. Enforced here too (not only in application code) so a
  -- direct write can't silently self-approve.
  CONSTRAINT marketing_campaigns_reviewer_not_creator CHECK (
    reviewed_by IS NULL OR reviewed_by <> created_by
  )
);

CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_group  ON public.marketing_campaigns (group_id);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON public.marketing_campaigns (status);

ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaigns FORCE  ROW LEVEL SECURITY;

CREATE POLICY marketing_campaigns_all ON public.marketing_campaigns
  FOR ALL USING (is_super_admin() OR group_id = app_current_group_id())
  WITH CHECK (is_super_admin() OR group_id = app_current_group_id());

-- ── marketing_audience_members ───────────────────────────────────────────────
-- Frozen snapshot, resolved once per campaign at approval time — NOT a live
-- view of the audience. A campaign's recipient list must not silently drift
-- between "approved" and "sent", and analytics need a fixed denominator.
-- Both audience_id (which definition) and campaign_id (which resolution) are
-- kept for traceability.
CREATE TABLE IF NOT EXISTS public.marketing_audience_members (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID        NOT NULL REFERENCES public.marketing_campaigns (id) ON DELETE CASCADE,
  audience_id  UUID        NOT NULL REFERENCES public.marketing_audiences (id) ON DELETE RESTRICT,
  target_type  TEXT        NOT NULL CHECK (target_type IN ('member', 'crm_contact')),
  target_id    UUID        NOT NULL,
  phone        TEXT        NOT NULL,
  resolved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_audience_members_campaign ON public.marketing_audience_members (campaign_id);

ALTER TABLE public.marketing_audience_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_audience_members FORCE  ROW LEVEL SECURITY;

CREATE POLICY marketing_audience_members_select ON public.marketing_audience_members
  FOR SELECT USING (
    is_super_admin()
    OR campaign_id IN (SELECT id FROM public.marketing_campaigns WHERE group_id = app_current_group_id())
  );

-- No tenant INSERT policy: rows are only ever written by approveCampaign()
-- via withAdminDb (the resolution step, matching the campaigns.service.ts /
-- Changi$ha precedent for admin-actioned state transitions) — service_role
-- below is what that path uses.

-- ── Grants ───────────────────────────────────────────────────────────────────
REVOKE ALL ON public.marketing_audiences        FROM anon, authenticated;
REVOKE ALL ON public.marketing_campaigns        FROM anon, authenticated;
REVOKE ALL ON public.marketing_audience_members FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_audiences        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_campaigns        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_audience_members TO service_role;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.marketing_audiences        TO app_tenant';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.marketing_campaigns        TO app_tenant';
    EXECUTE 'GRANT SELECT                 ON public.marketing_audience_members TO app_tenant';
  END IF;
END
$grant$;

-- ── Permission catalog ───────────────────────────────────────────────────────
-- crm.manage/crm.view already exist (migration 192) for chairperson/
-- treasurer/secretary — reused for creating/viewing campaigns. Approval is a
-- stricter, chairperson-only gate enforced in application code (maker-
-- checker), not a separate permission string: the DB CHECK above
-- (reviewed_by <> created_by) is the real backstop.
