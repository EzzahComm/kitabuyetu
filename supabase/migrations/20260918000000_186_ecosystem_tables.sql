-- Phase 7: Ecosystem Foundation Tables
-- Donor profiles, programs, and public supporter tracking

BEGIN;

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- PROGRAMS TABLE - Organizational funding initiatives
-- ============================================================================
CREATE TABLE IF NOT EXISTS programs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  target_amount numeric(15,2),
  current_amount numeric(15,2) DEFAULT 0,
  status text CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  start_date timestamp with time zone,
  end_date timestamp with time zone,
  cover_image_url text,
  impact_metric_name text, -- e.g., "Students Reached", "Houses Built"
  impact_metric_target numeric,
  impact_metric_current numeric DEFAULT 0,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(organization_id, slug)
);

-- ============================================================================
-- DONORS TABLE - Individual/organization donors (public)
-- ============================================================================
CREATE TABLE IF NOT EXISTS donors (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  is_anonymous boolean DEFAULT false,
  total_donated numeric(15,2) DEFAULT 0,
  donation_count integer DEFAULT 0,
  last_donation_at timestamp with time zone,
  country text,
  bio text,
  profile_image_url text,
  is_verified boolean DEFAULT false,
  preferred_impact_areas text[], -- Array of interest areas
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(organization_id, email) -- Email unique per org
);

-- ============================================================================
-- DONATIONS TABLE - Enhanced donation tracking (extends campaign_donations)
-- ============================================================================
CREATE TABLE IF NOT EXISTS donations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  donor_id uuid REFERENCES donors(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  program_id uuid REFERENCES programs(id) ON DELETE SET NULL,
  amount numeric(15,2) NOT NULL,
  currency text DEFAULT 'KES',
  payment_method text, -- 'mpesa', 'bank_transfer', 'card'
  status text CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  mpesa_receipt_number text UNIQUE,
  donor_name text, -- Stored for anonymity
  donor_email text,
  donor_message text,
  is_public boolean DEFAULT true,
  impact_units numeric, -- e.g., 2 (for "2 students reached")
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT donation_source CHECK (campaign_id IS NOT NULL OR program_id IS NOT NULL)
);

-- ============================================================================
-- FUNDING_SOURCES TABLE - External funding (grants, corporate, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS funding_sources (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text CHECK (type IN ('grant', 'corporate', 'foundation', 'government', 'individual', 'other')),
  amount numeric(15,2),
  status text CHECK (status IN ('pledged', 'received', 'deployed')),
  source_contact_name text,
  source_contact_email text,
  source_contact_phone text,
  received_date timestamp with time zone,
  deployed_date timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- ============================================================================
-- ECOSYSTEM_PARTNERS TABLE - NGO/marketplace partners
-- ============================================================================
CREATE TABLE IF NOT EXISTS ecosystem_partners (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  type text CHECK (type IN ('ngo', 'vendor', 'investor', 'platform', 'other')),
  description text,
  website_url text,
  logo_url text,
  contact_email text,
  contact_phone text,
  country text,
  services_offered text[], -- Array of service types
  is_active boolean DEFAULT true,
  total_referrals integer DEFAULT 0,
  total_impact numeric DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(name)
);

-- ============================================================================
-- PARTNER_INTEGRATIONS TABLE - Link organizations to partners
-- ============================================================================
CREATE TABLE IF NOT EXISTS partner_integrations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES ecosystem_partners(id) ON DELETE CASCADE,
  integration_status text CHECK (integration_status IN ('active', 'paused', 'completed')),
  referral_code text UNIQUE,
  referral_count integer DEFAULT 0,
  referral_revenue numeric(15,2) DEFAULT 0,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(organization_id, partner_id)
);

-- ============================================================================
-- IMPACT_METRICS TABLE - Track ecosystem-level impact
-- ============================================================================
CREATE TABLE IF NOT EXISTS impact_metrics (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric_name text NOT NULL, -- e.g., "Children Educated", "Families Supported"
  metric_type text CHECK (metric_type IN ('count', 'currency', 'custom')),
  target_value numeric,
  current_value numeric DEFAULT 0,
  unit_name text, -- e.g., "children", "families"
  verified boolean DEFAULT false,
  verified_by uuid REFERENCES auth.users(id),
  verified_at timestamp with time zone,
  period_start date,
  period_end date,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- ============================================================================
-- DONOR_SEGMENTS TABLE - User-defined donor groupings
-- ============================================================================
CREATE TABLE IF NOT EXISTS donor_segments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  criteria jsonb, -- JSON filtering criteria
  donor_count integer DEFAULT 0,
  total_donated numeric(15,2) DEFAULT 0,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(organization_id, name)
);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Programs: Organizations can manage their own; public can read active
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "programs_org_select" ON programs
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM auth.users WHERE id = auth.uid())
    OR status = 'active'
  );

CREATE POLICY "programs_org_insert" ON programs
  FOR INSERT WITH CHECK (
    organization_id = (SELECT organization_id FROM auth.users WHERE id = auth.uid())
    AND (SELECT role FROM auth.users WHERE id = auth.uid()) IN ('admin', 'owner')
  );

CREATE POLICY "programs_org_update" ON programs
  FOR UPDATE USING (
    organization_id = (SELECT organization_id FROM auth.users WHERE id = auth.uid())
    AND (SELECT role FROM auth.users WHERE id = auth.uid()) IN ('admin', 'owner')
  );

-- Donors: Public can create (anonymous); organizations can view their own
ALTER TABLE donors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "donors_create_public" ON donors
  FOR INSERT WITH CHECK (true);

CREATE POLICY "donors_select_public" ON donors
  FOR SELECT USING (
    is_anonymous = false
    OR organization_id = (SELECT organization_id FROM auth.users WHERE id = auth.uid())
  );

CREATE POLICY "donors_select_own_org" ON donors
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM auth.users WHERE id = auth.uid())
  );

-- Donations: Public can donate; organizations can view their own
ALTER TABLE donations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "donations_create_public" ON donations
  FOR INSERT WITH CHECK (true);

CREATE POLICY "donations_select_public" ON donations
  FOR SELECT USING (
    is_public = true
    OR organization_id = (SELECT organization_id FROM auth.users WHERE id = auth.uid())
  );

-- Funding Sources: Organizations only
ALTER TABLE funding_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "funding_sources_org_only" ON funding_sources
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM auth.users WHERE id = auth.uid())
  );

CREATE POLICY "funding_sources_org_insert" ON funding_sources
  FOR INSERT WITH CHECK (
    organization_id = (SELECT organization_id FROM auth.users WHERE id = auth.uid())
    AND (SELECT role FROM auth.users WHERE id = auth.uid()) IN ('admin', 'owner')
  );

-- Ecosystem Partners: Public read, admin manage
ALTER TABLE ecosystem_partners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ecosystem_partners_select" ON ecosystem_partners
  FOR SELECT USING (is_active = true);

-- Partner Integrations: Org only
ALTER TABLE partner_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partner_integrations_org_only" ON partner_integrations
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM auth.users WHERE id = auth.uid())
  );

-- Impact Metrics: Org only
ALTER TABLE impact_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "impact_metrics_org_only" ON impact_metrics
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM auth.users WHERE id = auth.uid())
  );

-- Donor Segments: Org only
ALTER TABLE donor_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "donor_segments_org_only" ON donor_segments
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM auth.users WHERE id = auth.uid())
  );

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_programs_organization ON programs(organization_id);
CREATE INDEX idx_programs_status ON programs(status);
CREATE INDEX idx_programs_slug ON programs(slug);

CREATE INDEX idx_donors_organization ON donors(organization_id);
CREATE INDEX idx_donors_email ON donors(email);
CREATE INDEX idx_donors_is_anonymous ON donors(is_anonymous);

CREATE INDEX idx_donations_organization ON donations(organization_id);
CREATE INDEX idx_donations_donor ON donations(donor_id);
CREATE INDEX idx_donations_campaign ON donations(campaign_id);
CREATE INDEX idx_donations_program ON donations(program_id);
CREATE INDEX idx_donations_status ON donations(status);
CREATE INDEX idx_donations_created_at ON donations(created_at);

CREATE INDEX idx_funding_sources_organization ON funding_sources(organization_id);
CREATE INDEX idx_funding_sources_status ON funding_sources(status);

CREATE INDEX idx_ecosystem_partners_type ON ecosystem_partners(type);
CREATE INDEX idx_ecosystem_partners_active ON ecosystem_partners(is_active);

CREATE INDEX idx_partner_integrations_organization ON partner_integrations(organization_id);
CREATE INDEX idx_partner_integrations_partner ON partner_integrations(partner_id);

CREATE INDEX idx_impact_metrics_organization ON impact_metrics(organization_id);
CREATE INDEX idx_impact_metrics_verified ON impact_metrics(verified);

CREATE INDEX idx_donor_segments_organization ON donor_segments(organization_id);

-- ============================================================================
-- GRANTS
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON programs TO app_tenant;
GRANT SELECT, INSERT, UPDATE ON donors TO app_tenant;
GRANT SELECT, INSERT, UPDATE ON donations TO app_tenant;
GRANT SELECT, INSERT, UPDATE ON funding_sources TO app_tenant;
GRANT SELECT ON ecosystem_partners TO app_tenant;
GRANT SELECT, INSERT, UPDATE ON partner_integrations TO app_tenant;
GRANT SELECT, INSERT, UPDATE ON impact_metrics TO app_tenant;
GRANT SELECT, INSERT, UPDATE ON donor_segments TO app_tenant;

COMMIT;
