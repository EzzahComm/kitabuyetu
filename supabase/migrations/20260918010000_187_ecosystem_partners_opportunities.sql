-- =============================================================================
-- 187: Ecosystem Growth Opportunities — partner registry + marketplace
--
-- Backs the "Marketplace" pillar on /ecosystem/marketplace, which has been a
-- static "coming soon" page. Kitabu Yetu platform staff curate a registry of
-- external partners (donors, lenders, insurers, trainers, service providers,
-- investors) and the individual opportunities each one offers (grants, loans,
-- insurance, training, services). Groups browse published opportunities and
-- apply; staff review applications.
--
-- WHY ecosystem_partners HAS NO organization_id
-- Unlike programs (organization-scoped, one funder's own programme run across
-- their groups), a marketplace partner is a platform-wide offering visible to
-- every group regardless of which multi-group organization (if any) they sit
-- under — the same lender or insurer is relevant whether a group is
-- independent or under an NGO umbrella. The registry is managed exclusively
-- by platform staff (super_admin), not by tenant organizations.
--
-- WHY THERE IS NO app_tenant / anon / authenticated GRANT ON PARTNERS OR
-- OPPORTUNITIES
-- Same reasoning as campaigns (migration 182) and the 2026-08-08 PostgREST
-- exposure incident (migration 126) it was written to avoid: this app never
-- talks to Postgres through PostgREST or a Supabase client, always through
-- its own pg pool. Every write here goes through withAdminDb() (platform
-- staff only, lib/services/ecosystem.service.ts). Every public read — the
-- marketplace listing and detail pages, and the public opportunities API —
-- also goes through withAdminDb() with an explicit `WHERE status =
-- 'published'` filter baked into the query in application code, exactly like
-- campaigns' public read path. RLS on these two tables therefore only ever
-- needs to gate the one path that DOES matter: is_super_admin() for the admin
-- pool. Nothing in app_tenant's grant list needs these tables at all.
--
-- WHY ecosystem_opportunity_applications IS DIFFERENT
-- Unlike partners/opportunities, applications are written by an authenticated
-- group member through the ordinary tenant pool (withAuth on
-- POST /api/v1/ecosystem/opportunities/[id]/apply) — genuinely tenant-scoped
-- traffic, so it gets a real app_tenant grant and group-scoped RLS, matching
-- every other group-writable table in this codebase.
-- =============================================================================

-- ── ecosystem_partners ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ecosystem_partners (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  type          TEXT        NOT NULL CHECK (type IN ('donor', 'lender', 'insurer', 'trainer', 'service_provider', 'investor')),
  description   TEXT,
  logo_url      TEXT,
  website_url   TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  -- No FK: the verifying actor is a backoffice user, not a row in any table
  -- this schema can reach (see lib/auth/middleware.ts's BackofficeContext).
  verified_by_admin_user_id UUID,
  verified_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ecosystem_partners_name_unique UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS idx_ecosystem_partners_type      ON public.ecosystem_partners (type);
CREATE INDEX IF NOT EXISTS idx_ecosystem_partners_is_active ON public.ecosystem_partners (is_active);

ALTER TABLE public.ecosystem_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecosystem_partners FORCE  ROW LEVEL SECURITY;

CREATE POLICY ecosystem_partners_admin_only ON public.ecosystem_partners
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ── ecosystem_opportunities ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ecosystem_opportunities (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id        UUID          NOT NULL REFERENCES public.ecosystem_partners (id) ON DELETE CASCADE,
  title             TEXT          NOT NULL,
  description       TEXT          NOT NULL,
  opportunity_type  TEXT          NOT NULL CHECK (opportunity_type IN ('grant', 'loan', 'insurance', 'training', 'service')),
  category          TEXT,
  amount_min        NUMERIC(15,2),
  amount_max        NUMERIC(15,2),
  currency          TEXT          NOT NULL DEFAULT 'KES',
  terms_summary     TEXT,
  eligibility_rules JSONB         NOT NULL DEFAULT '{"rules": []}',
  application_url   TEXT,
  featured          BOOLEAN       NOT NULL DEFAULT false,
  status            TEXT          NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed', 'archived')),
  published_at      TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ecosystem_opportunities_partner_id ON public.ecosystem_opportunities (partner_id);
CREATE INDEX IF NOT EXISTS idx_ecosystem_opportunities_status    ON public.ecosystem_opportunities (status);
CREATE INDEX IF NOT EXISTS idx_ecosystem_opportunities_type      ON public.ecosystem_opportunities (opportunity_type);
CREATE INDEX IF NOT EXISTS idx_ecosystem_opportunities_category  ON public.ecosystem_opportunities (category);
CREATE INDEX IF NOT EXISTS idx_ecosystem_opportunities_featured  ON public.ecosystem_opportunities (featured) WHERE status = 'published';

ALTER TABLE public.ecosystem_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecosystem_opportunities FORCE  ROW LEVEL SECURITY;

CREATE POLICY ecosystem_opportunities_admin_only ON public.ecosystem_opportunities
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ── ecosystem_opportunity_applications ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ecosystem_opportunity_applications (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id             UUID        NOT NULL REFERENCES public.ecosystem_opportunities (id) ON DELETE CASCADE,
  group_id                   UUID        NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  group_name                 TEXT        NOT NULL, -- denormalized for admin search
  group_member_count         INT,                  -- denormalized snapshot
  group_registration_number  TEXT,
  contact_member_name        TEXT        NOT NULL,
  contact_member_phone       TEXT        NOT NULL,
  contact_member_email       TEXT,
  message                    TEXT,
  application_status         TEXT        NOT NULL DEFAULT 'submitted' CHECK (application_status IN ('submitted', 'shortlisted', 'accepted', 'rejected', 'withdrawn')),
  responded_at                TIMESTAMPTZ,
  response_message           TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ecosystem_applications_opportunity ON public.ecosystem_opportunity_applications (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_ecosystem_applications_group       ON public.ecosystem_opportunity_applications (group_id);
CREATE INDEX IF NOT EXISTS idx_ecosystem_applications_status      ON public.ecosystem_opportunity_applications (application_status);
CREATE INDEX IF NOT EXISTS idx_ecosystem_applications_created     ON public.ecosystem_opportunity_applications (created_at DESC);

ALTER TABLE public.ecosystem_opportunity_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecosystem_opportunity_applications FORCE  ROW LEVEL SECURITY;

CREATE POLICY ecosystem_applications_select ON public.ecosystem_opportunity_applications
  FOR SELECT USING (
    is_super_admin() OR group_id = app_current_group_id()
  );

-- Any authenticated group member may apply on behalf of their group — this
-- deliberately does not restrict to officer roles, matching the withAuth (not
-- withPermission) gate on the apply route.
CREATE POLICY ecosystem_applications_insert ON public.ecosystem_opportunity_applications
  FOR INSERT WITH CHECK (
    is_super_admin() OR group_id = app_current_group_id()
  );

-- ── ecosystem_opportunity_eligibility_checks ────────────────────────────────
-- Cache for eligibility evaluations; not yet wired into any route (eligibility
-- matching runs inline via evaluateEligibility() for now) — created ahead of
-- that Phase 8.3 work so the shape is settled.
CREATE TABLE IF NOT EXISTS public.ecosystem_opportunity_eligibility_checks (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID        NOT NULL REFERENCES public.ecosystem_opportunities (id) ON DELETE CASCADE,
  group_id       UUID        NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  matches        BOOLEAN     NOT NULL,
  failed_rules   JSONB       NOT NULL DEFAULT '[]',
  checked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ecosystem_eligibility_check_unique UNIQUE (opportunity_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_eligibility_checks_opportunity ON public.ecosystem_opportunity_eligibility_checks (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_eligibility_checks_group       ON public.ecosystem_opportunity_eligibility_checks (group_id);

ALTER TABLE public.ecosystem_opportunity_eligibility_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecosystem_opportunity_eligibility_checks FORCE  ROW LEVEL SECURITY;

CREATE POLICY ecosystem_eligibility_checks_select ON public.ecosystem_opportunity_eligibility_checks
  FOR SELECT USING (
    is_super_admin() OR group_id = app_current_group_id()
  );

-- ── ecosystem_featured_categories ───────────────────────────────────────────
-- Not yet wired into any route — created ahead of the category-browse UI.
CREATE TABLE IF NOT EXISTS public.ecosystem_featured_categories (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL UNIQUE,
  slug        TEXT        NOT NULL UNIQUE,
  description TEXT,
  icon_name   TEXT, -- Tabler icon slug (e.g., 'heartbreak', 'trending-up')
  sort_order  INT         NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ecosystem_categories_active ON public.ecosystem_featured_categories (is_active);
CREATE INDEX IF NOT EXISTS idx_ecosystem_categories_sort   ON public.ecosystem_featured_categories (sort_order);

ALTER TABLE public.ecosystem_featured_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecosystem_featured_categories FORCE  ROW LEVEL SECURITY;

CREATE POLICY ecosystem_categories_admin_only ON public.ecosystem_featured_categories
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Same hygiene as every migration since the 2026-08-08 PostgREST exposure
-- incident: default privileges hand new public tables full anon/authenticated
-- rights, which must be revoked explicitly.
REVOKE ALL ON public.ecosystem_partners                     FROM anon, authenticated;
REVOKE ALL ON public.ecosystem_opportunities                FROM anon, authenticated;
REVOKE ALL ON public.ecosystem_opportunity_applications      FROM anon, authenticated;
REVOKE ALL ON public.ecosystem_opportunity_eligibility_checks FROM anon, authenticated;
REVOKE ALL ON public.ecosystem_featured_categories           FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ecosystem_partners                     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ecosystem_opportunities                TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ecosystem_opportunity_applications      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ecosystem_opportunity_eligibility_checks TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ecosystem_featured_categories           TO service_role;

-- app_tenant is provisioned out-of-band in production (ADR-001) and does not
-- exist in a fresh/CI Postgres replay — a plain GRANT would abort the run.
-- Only ecosystem_opportunity_applications is genuinely tenant-writable (see
-- header); partners/opportunities/eligibility/categories never go through
-- the tenant pool at all.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT SELECT, INSERT ON public.ecosystem_opportunity_applications TO app_tenant';
  END IF;
END $$;
