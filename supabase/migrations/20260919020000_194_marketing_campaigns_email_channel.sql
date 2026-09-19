-- =============================================================================
-- 194: Phase 9.3 — email channel activation
--
-- Extends, does not replace: email_campaigns/email_campaign_recipients
-- (migration 012) already have a complete, working drain mechanism
-- (drainCampaignRecipients, FOR UPDATE SKIP LOCKED, the same idiom job_queue
-- itself uses) — it has simply never carried production traffic. This
-- migration adds what's needed to route 9.2's marketing_campaigns
-- orchestration into it, and to support organization-level sends (per
-- product decision) — it does not touch the drain logic itself.
--
-- marketing_audiences/marketing_campaigns become dual-scope (group XOR
-- organization), matching the same CHECK idiom as crm_contacts (192) and
-- sms_trigger_rules (052). SMS remains group-only in practice — smsService.
-- sendBulkCampaign has no org-level send path — enforced in application code,
-- not the schema, since the schema is genuinely shared with email now.
--
-- New audience source: org_group_officers — "all of a federation's chama
-- officers" is the org-level use case named explicitly in the roadmap brief.
-- Resolved against organization_group_access (which groups an org can reach)
-- joined to group_officers, at approval time, same frozen-snapshot discipline
-- as every other audience source.
-- =============================================================================

-- ── marketing_audiences: dual-scope + new source ────────────────────────────
ALTER TABLE public.marketing_audiences
  ALTER COLUMN group_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations (id) ON DELETE CASCADE;

ALTER TABLE public.marketing_audiences DROP CONSTRAINT IF EXISTS marketing_audiences_single_scope;
ALTER TABLE public.marketing_audiences
  ADD CONSTRAINT marketing_audiences_single_scope CHECK ((group_id IS NOT NULL) <> (organization_id IS NOT NULL));

ALTER TABLE public.marketing_audiences DROP CONSTRAINT IF EXISTS marketing_audiences_source_check;
ALTER TABLE public.marketing_audiences
  ADD CONSTRAINT marketing_audiences_source_check CHECK (source IN (
    'all_members', 'active_members', 'crm_contacts_opted_in', 'org_group_officers'
  ));

CREATE INDEX IF NOT EXISTS idx_marketing_audiences_organization ON public.marketing_audiences (organization_id);

DROP POLICY IF EXISTS marketing_audiences_all ON public.marketing_audiences;
CREATE POLICY marketing_audiences_all ON public.marketing_audiences
  FOR ALL USING (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
  ) WITH CHECK (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
  );

-- ── marketing_campaigns: dual-scope + email channel ─────────────────────────
ALTER TABLE public.marketing_campaigns
  ALTER COLUMN group_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations (id) ON DELETE CASCADE;

ALTER TABLE public.marketing_campaigns DROP CONSTRAINT IF EXISTS marketing_campaigns_single_scope;
ALTER TABLE public.marketing_campaigns
  ADD CONSTRAINT marketing_campaigns_single_scope CHECK ((group_id IS NOT NULL) <> (organization_id IS NOT NULL));

ALTER TABLE public.marketing_campaigns DROP CONSTRAINT IF EXISTS marketing_campaigns_channel_check;
ALTER TABLE public.marketing_campaigns
  ADD CONSTRAINT marketing_campaigns_channel_check CHECK (channel IN ('sms', 'email'));

-- subject is only meaningful for the email channel; nullable so existing SMS
-- rows and future SMS inserts are unaffected.
ALTER TABLE public.marketing_campaigns ADD COLUMN IF NOT EXISTS subject TEXT;

CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_organization ON public.marketing_campaigns (organization_id);

DROP POLICY IF EXISTS marketing_campaigns_all ON public.marketing_campaigns;
CREATE POLICY marketing_campaigns_all ON public.marketing_campaigns
  FOR ALL USING (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
  ) WITH CHECK (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
  );

-- ── email_campaigns / email_campaign_recipients: dual-scope + linkage ───────
ALTER TABLE public.email_campaigns
  ALTER COLUMN group_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS audience_id UUID REFERENCES public.marketing_audiences (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS marketing_campaign_id UUID REFERENCES public.marketing_campaigns (id) ON DELETE SET NULL;

ALTER TABLE public.email_campaigns DROP CONSTRAINT IF EXISTS email_campaigns_single_scope;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_single_scope CHECK ((group_id IS NOT NULL) <> (organization_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_email_campaigns_organization ON public.email_campaigns (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_marketing_campaign ON public.email_campaigns (marketing_campaign_id);

ALTER TABLE public.email_campaign_recipients
  ALTER COLUMN group_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations (id) ON DELETE CASCADE;

ALTER TABLE public.email_campaign_recipients DROP CONSTRAINT IF EXISTS email_campaign_recipients_single_scope;
ALTER TABLE public.email_campaign_recipients
  ADD CONSTRAINT email_campaign_recipients_single_scope CHECK ((group_id IS NOT NULL) <> (organization_id IS NOT NULL));

-- email_campaigns/email_campaign_recipients already had group-scoped RLS
-- from migration 012 (rls_email_campaigns_group / rls_email_campaign_
-- recipients_group, USING group_id = current_group_id with no super-admin
-- bypass and no org-coordinator branch). Widened to the same shape used
-- everywhere else in this migration — not touching anon/authenticated
-- grants, a separate pre-existing concern out of scope for this increment.
DROP POLICY IF EXISTS rls_email_campaigns_group ON public.email_campaigns;
CREATE POLICY rls_email_campaigns_group ON public.email_campaigns
  FOR ALL USING (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
  ) WITH CHECK (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
  );

DROP POLICY IF EXISTS rls_email_campaign_recipients_group ON public.email_campaign_recipients;
CREATE POLICY rls_email_campaign_recipients_group ON public.email_campaign_recipients
  FOR ALL USING (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
  ) WITH CHECK (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
  );

-- ── Grants ───────────────────────────────────────────────────────────────────
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.marketing_audiences TO app_tenant';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.marketing_campaigns TO app_tenant';
  END IF;
END
$grant$;
