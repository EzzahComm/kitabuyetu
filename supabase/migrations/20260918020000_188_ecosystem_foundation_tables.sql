-- 188: Ecosystem Foundation Tables (Phase 7)
-- Donor profiles, programs, and public supporter tracking
--
-- CORRECTED + RENUMBERED from 186 (originally committed 99db22b, as
-- 20260918000000_186_ecosystem_tables.sql): that version referenced
-- auth.users/auth.uid() throughout — Supabase Auth primitives this app does
-- not use (it runs its own JWT + Postgres pool with
-- app.current_user_id/role/organization_id GUCs, set by withDb() in
-- lib/db/index.ts and read back via app_current_role() etc., migration
-- 010_rls_policies.sql). auth.users/auth.uid() don't exist in a fresh/CI
-- Postgres replay at all (CI has no Supabase Auth schema), which is why this
-- migration failed CI's Tenant Isolation job outright ("schema auth does not
-- exist"), and would have evaluated to NULL/false against this app's real
-- pool connections even where it happened to run. Rewritten to the
-- established app_current_*()/is_super_admin() pattern used throughout the
-- rest of this codebase (e.g. migration 182_campaigns.sql).
--
-- Renumbered 186 -> 188 (after 187, not before) because partner_integrations
-- below has a real FK dependency on public.ecosystem_partners, which 187
-- creates — at 186's original position a fresh replay (CI, a clean local db)
-- would hit "relation ecosystem_partners does not exist" the moment the auth
-- error was fixed. Safe to renumber: this migration has never successfully
-- applied anywhere (confirmed against production's migration ledger, which
-- stops at 184), so there is no environment that recorded "186" as applied.
--
-- Also drops this file's own ecosystem_partners table: migration
-- 187_ecosystem_partners_opportunities.sql (Phase 8) already owns that name
-- with the schema Phase 8's marketplace actually uses (donor/lender/insurer/
-- trainer/service_provider/investor types, no organization_id — a
-- platform-wide registry). Both files defining the same table with different
-- columns is a genuine conflict, not just a naming collision:
-- CREATE TABLE IF NOT EXISTS would have silently kept whichever ran first and
-- discarded the other's shape. partner_integrations below now references
-- 187's ecosystem_partners.
--
-- No anon/authenticated grant on any table here (unlike the original, which
-- had none REVOKEd and two `WITH CHECK (true)` public-insert policies on
-- donors/donations): nothing in the app currently reads or writes these
-- tables (verified — no `.from('donors')` etc. anywhere in the codebase), so
-- there is no public-facing feature this needs to serve yet. Locking them to
-- the admin/tenant paths only avoids repeating the exact PostgREST-exposure
-- mistake migration 126 exists to warn against; opening a public read (for
-- the pre-existing /ecosystem/programs and /ecosystem/donors pages, which
-- currently query these tables via the Supabase anon client and have been
-- silently returning empty results since these tables never existed) is a
-- deliberate, separate decision for whoever picks that page back up, not an
-- incidental side effect of unblocking CI.

-- ============================================================================
-- PROGRAMS TABLE - Organizational funding initiatives
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.programs (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID          NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name                  TEXT          NOT NULL,
  slug                  TEXT          NOT NULL,
  description           TEXT,
  target_amount         NUMERIC(15,2),
  current_amount        NUMERIC(15,2) DEFAULT 0,
  status                TEXT          CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  start_date            TIMESTAMPTZ,
  end_date              TIMESTAMPTZ,
  cover_image_url       TEXT,
  impact_metric_name    TEXT, -- e.g., "Students Reached", "Houses Built"
  impact_metric_target  NUMERIC,
  impact_metric_current NUMERIC       DEFAULT 0,
  -- No FK: the creating actor is a backoffice/organization-coordinator user,
  -- not a row in any table this schema can reach.
  created_by            UUID          NOT NULL,
  created_at            TIMESTAMPTZ   DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   DEFAULT NOW(),
  UNIQUE (organization_id, slug)
);

-- ============================================================================
-- DONORS TABLE - Individual/organization donors (public)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.donors (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID          NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name                   TEXT          NOT NULL,
  email                  TEXT,
  phone                  TEXT,
  is_anonymous           BOOLEAN       DEFAULT false,
  total_donated          NUMERIC(15,2) DEFAULT 0,
  donation_count         INTEGER       DEFAULT 0,
  last_donation_at       TIMESTAMPTZ,
  country                TEXT,
  bio                    TEXT,
  profile_image_url      TEXT,
  is_verified            BOOLEAN       DEFAULT false,
  preferred_impact_areas TEXT[],
  created_at             TIMESTAMPTZ   DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   DEFAULT NOW(),
  UNIQUE (organization_id, email)
);

-- ============================================================================
-- DONATIONS TABLE - Enhanced donation tracking (extends campaign_donations)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.donations (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID          NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  donor_id          UUID          REFERENCES public.donors (id) ON DELETE SET NULL,
  campaign_id       UUID          REFERENCES public.campaigns (id) ON DELETE CASCADE,
  program_id        UUID          REFERENCES public.programs (id) ON DELETE SET NULL,
  amount            NUMERIC(15,2) NOT NULL,
  currency          TEXT          DEFAULT 'KES',
  payment_method    TEXT,
  status            TEXT          CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  mpesa_receipt_number TEXT       UNIQUE,
  donor_name        TEXT,
  donor_email       TEXT,
  donor_message     TEXT,
  is_public         BOOLEAN       DEFAULT true,
  impact_units      NUMERIC,
  created_at        TIMESTAMPTZ   DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   DEFAULT NOW(),
  CONSTRAINT donation_source CHECK (campaign_id IS NOT NULL OR program_id IS NOT NULL)
);

-- ============================================================================
-- FUNDING_SOURCES TABLE - External funding (grants, corporate, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.funding_sources (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID          NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name                  TEXT          NOT NULL,
  type                  TEXT          CHECK (type IN ('grant', 'corporate', 'foundation', 'government', 'individual', 'other')),
  amount                NUMERIC(15,2),
  status                TEXT          CHECK (status IN ('pledged', 'received', 'deployed')),
  source_contact_name   TEXT,
  source_contact_email  TEXT,
  source_contact_phone  TEXT,
  received_date         TIMESTAMPTZ,
  deployed_date         TIMESTAMPTZ,
  notes                 TEXT,
  created_at            TIMESTAMPTZ   DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   DEFAULT NOW()
);

-- ============================================================================
-- PARTNER_INTEGRATIONS TABLE - Link organizations to Phase 8 marketplace
-- partners (public.ecosystem_partners, owned by migration 187)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.partner_integrations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  partner_id        UUID        NOT NULL REFERENCES public.ecosystem_partners (id) ON DELETE CASCADE,
  integration_status TEXT       CHECK (integration_status IN ('active', 'paused', 'completed')),
  referral_code     TEXT        UNIQUE,
  referral_count    INTEGER     DEFAULT 0,
  referral_revenue  NUMERIC(15,2) DEFAULT 0,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organization_id, partner_id)
);

-- ============================================================================
-- IMPACT_METRICS TABLE - Track ecosystem-level impact
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.impact_metrics (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID       NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  metric_name    TEXT        NOT NULL,
  metric_type    TEXT        CHECK (metric_type IN ('count', 'currency', 'custom')),
  target_value   NUMERIC,
  current_value  NUMERIC     DEFAULT 0,
  unit_name      TEXT,
  verified       BOOLEAN     DEFAULT false,
  verified_by    UUID,
  verified_at    TIMESTAMPTZ,
  period_start   DATE,
  period_end     DATE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- DONOR_SEGMENTS TABLE - User-defined donor groupings
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.donor_segments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  description     TEXT,
  criteria        JSONB,
  donor_count     INTEGER     DEFAULT 0,
  total_donated   NUMERIC(15,2) DEFAULT 0,
  created_by      UUID        NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

-- ============================================================================
-- RLS POLICIES — organization-scoped via app_current_organization_id(),
-- writes gated to is_super_admin() OR the organization_coordinator role
-- (lib/auth/middleware.ts's withOrganizationAccess), matching every other
-- organization-axis table in this codebase.
-- ============================================================================

ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programs FORCE  ROW LEVEL SECURITY;

CREATE POLICY programs_select ON public.programs
  FOR SELECT USING (
    is_super_admin() OR organization_id = app_current_organization_id()
  );

CREATE POLICY programs_write ON public.programs
  FOR ALL USING (
    is_super_admin()
    OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
  ) WITH CHECK (
    is_super_admin()
    OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
  );

ALTER TABLE public.donors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donors FORCE  ROW LEVEL SECURITY;

CREATE POLICY donors_select ON public.donors
  FOR SELECT USING (
    is_super_admin() OR organization_id = app_current_organization_id()
  );

CREATE POLICY donors_write ON public.donors
  FOR ALL USING (
    is_super_admin()
    OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
  ) WITH CHECK (
    is_super_admin()
    OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
  );

ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donations FORCE  ROW LEVEL SECURITY;

CREATE POLICY donations_select ON public.donations
  FOR SELECT USING (
    is_super_admin() OR organization_id = app_current_organization_id()
  );

ALTER TABLE public.funding_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_sources FORCE  ROW LEVEL SECURITY;

CREATE POLICY funding_sources_select ON public.funding_sources
  FOR SELECT USING (
    is_super_admin() OR organization_id = app_current_organization_id()
  );

CREATE POLICY funding_sources_write ON public.funding_sources
  FOR ALL USING (
    is_super_admin()
    OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
  ) WITH CHECK (
    is_super_admin()
    OR (organization_id = app_current_organization_id() AND app_current_role() = 'organization_coordinator')
  );

ALTER TABLE public.partner_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_integrations FORCE  ROW LEVEL SECURITY;

CREATE POLICY partner_integrations_select ON public.partner_integrations
  FOR SELECT USING (
    is_super_admin() OR organization_id = app_current_organization_id()
  );

ALTER TABLE public.impact_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impact_metrics FORCE  ROW LEVEL SECURITY;

CREATE POLICY impact_metrics_all ON public.impact_metrics
  FOR ALL USING (
    is_super_admin() OR organization_id = app_current_organization_id()
  ) WITH CHECK (
    is_super_admin() OR organization_id = app_current_organization_id()
  );

ALTER TABLE public.donor_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donor_segments FORCE  ROW LEVEL SECURITY;

CREATE POLICY donor_segments_all ON public.donor_segments
  FOR ALL USING (
    is_super_admin() OR organization_id = app_current_organization_id()
  ) WITH CHECK (
    is_super_admin() OR organization_id = app_current_organization_id()
  );

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_programs_organization ON public.programs (organization_id);
CREATE INDEX IF NOT EXISTS idx_programs_status        ON public.programs (status);
CREATE INDEX IF NOT EXISTS idx_programs_slug          ON public.programs (slug);

CREATE INDEX IF NOT EXISTS idx_donors_organization  ON public.donors (organization_id);
CREATE INDEX IF NOT EXISTS idx_donors_email         ON public.donors (email);
CREATE INDEX IF NOT EXISTS idx_donors_is_anonymous  ON public.donors (is_anonymous);

CREATE INDEX IF NOT EXISTS idx_donations_organization ON public.donations (organization_id);
CREATE INDEX IF NOT EXISTS idx_donations_donor        ON public.donations (donor_id);
CREATE INDEX IF NOT EXISTS idx_donations_campaign     ON public.donations (campaign_id);
CREATE INDEX IF NOT EXISTS idx_donations_program      ON public.donations (program_id);
CREATE INDEX IF NOT EXISTS idx_donations_status       ON public.donations (status);
CREATE INDEX IF NOT EXISTS idx_donations_created_at   ON public.donations (created_at);

CREATE INDEX IF NOT EXISTS idx_funding_sources_organization ON public.funding_sources (organization_id);
CREATE INDEX IF NOT EXISTS idx_funding_sources_status       ON public.funding_sources (status);

CREATE INDEX IF NOT EXISTS idx_partner_integrations_organization ON public.partner_integrations (organization_id);
CREATE INDEX IF NOT EXISTS idx_partner_integrations_partner      ON public.partner_integrations (partner_id);

CREATE INDEX IF NOT EXISTS idx_impact_metrics_organization ON public.impact_metrics (organization_id);
CREATE INDEX IF NOT EXISTS idx_impact_metrics_verified     ON public.impact_metrics (verified);

CREATE INDEX IF NOT EXISTS idx_donor_segments_organization ON public.donor_segments (organization_id);

-- ============================================================================
-- GRANTS — no anon/authenticated grant anywhere (see header). app_tenant only,
-- guarded the same way every migration since ADR-001 guards it (the role
-- doesn't exist in a fresh/CI Postgres replay).
-- ============================================================================

REVOKE ALL ON public.programs             FROM anon, authenticated;
REVOKE ALL ON public.donors               FROM anon, authenticated;
REVOKE ALL ON public.donations            FROM anon, authenticated;
REVOKE ALL ON public.funding_sources      FROM anon, authenticated;
REVOKE ALL ON public.partner_integrations FROM anon, authenticated;
REVOKE ALL ON public.impact_metrics       FROM anon, authenticated;
REVOKE ALL ON public.donor_segments       FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.programs             TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.donors               TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.donations            TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.funding_sources      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_integrations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.impact_metrics       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.donor_segments       TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.programs             TO app_tenant';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.donors               TO app_tenant';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.donations            TO app_tenant';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.funding_sources      TO app_tenant';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.partner_integrations TO app_tenant';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.impact_metrics       TO app_tenant';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.donor_segments       TO app_tenant';
  END IF;
END $$;
