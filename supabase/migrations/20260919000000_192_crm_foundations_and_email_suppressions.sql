-- =============================================================================
-- 192: Phase 9.1 — CRM foundations + email consent gate
--
-- CRM entities (crm_contacts/crm_opportunities/crm_activities) are external
-- relationship records — donors, lenders, insurers, trainers, professionals,
-- partner reps, leads — distinct from:
--   - `organizations`/`groups`: core multi-tenancy, never redefined here.
--   - `ecosystem_partners`/`ecosystem_opportunities`/`ecosystem_opportunity_
--     applications` (187): the PLATFORM marketplace. crm_opportunities is a
--     tenant's own private pipeline, never the platform's.
--   - `donors`/`programs`/`donor_segments` (188): financial-supporter
--     tracking (Bookkeeper-adjacent — donors there have no relationship
--     history, only donation totals). crm_contacts bridges to `donors` by FK
--     rather than duplicating it.
--
-- Consent-first, per product decision: marketing_opt_in defaults false and
-- must be explicitly set — a contact is not targetable by any future
-- marketing send until someone deliberately opts them in. This is enforced
-- at the application layer once Phase 9.2's audience resolver exists; this
-- migration only carries the flag and its audit trail (opted_in_at/by).
--
-- email_suppressions is modeled on sms_opt_outs' proven shape (162): scoped,
-- a `source` enum, actor/reason where applicable, reactivation is a DELETE
-- not a flag flip. NOT a resurrection of the old email_suppressions table
-- dropped in migration 177 (that one had no source/actor_id and was
-- correctly deleted as dead weight with zero rows and zero references) —
-- this is a fresh design that closes a real, currently-open gap: nothing in
-- the codebase today stops a future email send to a bounced/complained/
-- unsubscribed address.
-- =============================================================================

-- ── crm_contacts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_contacts (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          UUID          REFERENCES public.groups (id) ON DELETE CASCADE,
  organization_id   UUID          REFERENCES public.organizations (id) ON DELETE CASCADE,
  contact_type      TEXT          NOT NULL CHECK (contact_type IN (
                      'donor', 'lender', 'insurer', 'trainer', 'service_provider',
                      'professional', 'partner_rep', 'lead', 'media', 'government', 'other'
                    )),
  name              TEXT          NOT NULL,
  email             TEXT,
  phone             TEXT,
  notes             TEXT,
  -- Bridges, not duplicates: financial totals/partner metadata stay on the
  -- tables that own them (donors, ecosystem_partners). Never denormalized here.
  donor_id            UUID        REFERENCES public.donors (id) ON DELETE SET NULL,
  ecosystem_partner_id UUID       REFERENCES public.ecosystem_partners (id) ON DELETE SET NULL,
  marketing_opt_in  BOOLEAN       NOT NULL DEFAULT false,
  opted_in_at       TIMESTAMPTZ,
  opted_in_by       UUID          REFERENCES public.members (id) ON DELETE SET NULL,
  created_by        UUID          NOT NULL REFERENCES public.members (id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT crm_contacts_single_scope CHECK ((group_id IS NOT NULL) <> (organization_id IS NOT NULL)),
  CONSTRAINT crm_contacts_opt_in_consistent CHECK (
    (marketing_opt_in = true AND opted_in_at IS NOT NULL) OR (marketing_opt_in = false)
  )
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_group        ON public.crm_contacts (group_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_organization ON public.crm_contacts (organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_type         ON public.crm_contacts (contact_type);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_opt_in       ON public.crm_contacts (marketing_opt_in) WHERE marketing_opt_in = true;

ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contacts FORCE  ROW LEVEL SECURITY;

CREATE POLICY crm_contacts_all ON public.crm_contacts
  FOR ALL USING (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
  ) WITH CHECK (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
  );

-- ── crm_opportunities ────────────────────────────────────────────────────────
-- A tenant's own pipeline. Explicitly NOT the platform marketplace
-- (ecosystem_opportunities, 187) — scoping follows the owning contact's scope.
CREATE TABLE IF NOT EXISTS public.crm_opportunities (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  UUID        NOT NULL REFERENCES public.crm_contacts (id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  stage       TEXT        NOT NULL DEFAULT 'draft' CHECK (stage IN ('draft', 'qualified', 'proposal', 'won', 'lost')),
  amount      NUMERIC(15,2),
  notes       TEXT,
  created_by  UUID        NOT NULL REFERENCES public.members (id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_opportunities_contact ON public.crm_opportunities (contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_stage   ON public.crm_opportunities (stage);

ALTER TABLE public.crm_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_opportunities FORCE  ROW LEVEL SECURITY;

CREATE POLICY crm_opportunities_all ON public.crm_opportunities
  FOR ALL USING (
    is_super_admin()
    OR contact_id IN (
      SELECT id FROM public.crm_contacts
      WHERE group_id = app_current_group_id()
         OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
    )
  ) WITH CHECK (
    is_super_admin()
    OR contact_id IN (
      SELECT id FROM public.crm_contacts
      WHERE group_id = app_current_group_id()
         OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
    )
  );

-- ── crm_activities ───────────────────────────────────────────────────────────
-- Unified relationship timeline: calls, emails, SMS, meetings, notes, tasks.
CREATE TABLE IF NOT EXISTS public.crm_activities (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID        REFERENCES public.crm_contacts (id) ON DELETE CASCADE,
  opportunity_id  UUID        REFERENCES public.crm_opportunities (id) ON DELETE CASCADE,
  activity_type   TEXT        NOT NULL CHECK (activity_type IN ('call', 'email', 'sms', 'meeting', 'note', 'task')),
  body            TEXT,
  actor_id        UUID        NOT NULL REFERENCES public.members (id) ON DELETE RESTRICT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT crm_activities_needs_a_subject CHECK (contact_id IS NOT NULL OR opportunity_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_crm_activities_contact     ON public.crm_activities (contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_opportunity ON public.crm_activities (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_occurred    ON public.crm_activities (occurred_at DESC);

ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities FORCE  ROW LEVEL SECURITY;

CREATE POLICY crm_activities_all ON public.crm_activities
  FOR ALL USING (
    is_super_admin()
    OR contact_id IN (
      SELECT id FROM public.crm_contacts
      WHERE group_id = app_current_group_id()
         OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
    )
    OR opportunity_id IN (
      SELECT o.id FROM public.crm_opportunities o
      JOIN public.crm_contacts c ON c.id = o.contact_id
      WHERE c.group_id = app_current_group_id()
         OR (c.organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
    )
  ) WITH CHECK (
    is_super_admin()
    OR contact_id IN (
      SELECT id FROM public.crm_contacts
      WHERE group_id = app_current_group_id()
         OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
    )
    OR opportunity_id IN (
      SELECT o.id FROM public.crm_opportunities o
      JOIN public.crm_contacts c ON c.id = o.contact_id
      WHERE c.group_id = app_current_group_id()
         OR (c.organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
    )
  );

-- ── email_suppressions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_suppressions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID        REFERENCES public.groups (id) ON DELETE CASCADE,
  organization_id UUID        REFERENCES public.organizations (id) ON DELETE CASCADE,
  email           TEXT        NOT NULL,
  source          TEXT        NOT NULL CHECK (source IN ('bounce', 'complaint', 'unsubscribe', 'manual')),
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT email_suppressions_single_scope CHECK ((group_id IS NOT NULL) <> (organization_id IS NOT NULL))
);

-- One live suppression per (scope, email) — same "absence of a row is the
-- consent state" idiom as sms_opt_outs. Two partial unique indexes since a
-- plain UNIQUE(group_id, organization_id, email) would let two NULLs compare
-- as distinct and never actually enforce uniqueness within a scope.
CREATE UNIQUE INDEX IF NOT EXISTS email_suppressions_group_email_unique
  ON public.email_suppressions (group_id, email) WHERE group_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS email_suppressions_org_email_unique
  ON public.email_suppressions (organization_id, email) WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_suppressions_email ON public.email_suppressions (email);

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_suppressions FORCE  ROW LEVEL SECURITY;

CREATE POLICY email_suppressions_select ON public.email_suppressions
  FOR SELECT USING (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
  );

CREATE POLICY email_suppressions_insert ON public.email_suppressions
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
  );

-- No UPDATE policy, deliberately (same reasoning as sms_opt_outs): a
-- suppression's source/reason should never be silently rewritten. Reactivating
-- consent is a DELETE (a real service-role/admin action, not a tenant one —
-- see the note on the grants below), producing a fresh row if suppressed again.

COMMENT ON TABLE public.email_suppressions IS
  'Live email suppressions (bounce/complaint/unsubscribe/manual), one row per '
  '(scope, email). Absence of a row is the consent state, matching sms_opt_outs (162).';

-- ── Grants ───────────────────────────────────────────────────────────────────
REVOKE ALL ON public.crm_contacts       FROM anon, authenticated;
REVOKE ALL ON public.crm_opportunities  FROM anon, authenticated;
REVOKE ALL ON public.crm_activities     FROM anon, authenticated;
REVOKE ALL ON public.email_suppressions FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_contacts       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_opportunities  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_activities     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_suppressions TO service_role;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.crm_contacts      TO app_tenant';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.crm_opportunities TO app_tenant';
    EXECUTE 'GRANT SELECT, INSERT        ON public.crm_activities     TO app_tenant';
    -- SELECT + INSERT only, not UPDATE/DELETE: consent state is opt-out-by-
    -- INSERT, opt-in-by-DELETE (service_role only — see comment above), same
    -- hygiene as sms_opt_outs' explicit UPDATE revoke.
    EXECUTE 'GRANT SELECT, INSERT        ON public.email_suppressions TO app_tenant';
  END IF;
END
$grant$;

-- ── Permission catalog ───────────────────────────────────────────────────────
-- Same additive, monotonic-by-rank pattern as 110_permission_catalog_
-- reconciliation.sql and 183_campaigns_permissions.sql: crm.manage goes to the
-- same officer tier already trusted with campaigns/loans/contributions.
UPDATE public.roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY['crm.view','crm.manage']) AS p
)
WHERE group_id IS NULL AND code IN ('secretary', 'treasurer', 'chairperson');
