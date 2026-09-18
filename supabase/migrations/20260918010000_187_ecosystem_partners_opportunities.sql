-- Phase 8: Ecosystem Growth Opportunities
-- Partner registry + opportunity database with eligibility matching

-- 1. ecosystem_partners — Organization managing partners (donors, lenders, insurers, trainers, service providers, investors)
CREATE TABLE IF NOT EXISTS ecosystem_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  type VARCHAR NOT NULL CHECK (type IN ('donor', 'lender', 'insurer', 'trainer', 'service_provider', 'investor')),
  description TEXT,
  logo_url VARCHAR,
  website_url VARCHAR,
  contact_email VARCHAR,
  contact_phone VARCHAR,
  is_active BOOLEAN NOT NULL DEFAULT true,
  verified_by_admin_user_id UUID REFERENCES auth.users(id),
  verified_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT partner_name_per_org_unique UNIQUE (organization_id, name)
);

CREATE INDEX idx_ecosystem_partners_org_id ON ecosystem_partners(organization_id);
CREATE INDEX idx_ecosystem_partners_type ON ecosystem_partners(type);
CREATE INDEX idx_ecosystem_partners_is_active ON ecosystem_partners(is_active);

-- RLS: Platform admin (Kitabu Yetu team) can create/edit. Organizations can see their own partners.
ALTER TABLE ecosystem_partners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_admin_full_access_partners" ON ecosystem_partners
  FOR ALL
  USING (is_platform_admin(auth.uid()))
  WITH CHECK (is_platform_admin(auth.uid()));

CREATE POLICY "org_can_read_own_partners" ON ecosystem_partners
  FOR SELECT
  USING (organization_id = get_organization_id(auth.uid()));

-- 2. ecosystem_opportunities — Individual opportunities (grants, loans, insurance, training, services)
CREATE TABLE IF NOT EXISTS ecosystem_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES ecosystem_partners(id) ON DELETE CASCADE,
  title VARCHAR NOT NULL,
  description TEXT NOT NULL,
  opportunity_type VARCHAR NOT NULL CHECK (opportunity_type IN ('grant', 'loan', 'insurance', 'training', 'service')),
  category VARCHAR,
  amount_min NUMERIC,
  amount_max NUMERIC,
  currency VARCHAR NOT NULL DEFAULT 'KES',
  terms_summary TEXT,
  eligibility_rules JSONB NOT NULL DEFAULT '{"rules": []}',
  application_url VARCHAR,
  featured BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed', 'archived')),
  published_at TIMESTAMP,
  closed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ecosystem_opportunities_partner_id ON ecosystem_opportunities(partner_id);
CREATE INDEX idx_ecosystem_opportunities_status ON ecosystem_opportunities(status);
CREATE INDEX idx_ecosystem_opportunities_type ON ecosystem_opportunities(opportunity_type);
CREATE INDEX idx_ecosystem_opportunities_category ON ecosystem_opportunities(category);
CREATE INDEX idx_ecosystem_opportunities_featured ON ecosystem_opportunities(featured) WHERE status = 'published';

-- RLS: Platform admin can create/publish/close. Groups see only published + eligible opportunities.
ALTER TABLE ecosystem_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_admin_full_access_opportunities" ON ecosystem_opportunities
  FOR ALL
  USING (is_platform_admin(auth.uid()))
  WITH CHECK (is_platform_admin(auth.uid()));

-- Groups can see published opportunities; eligibility check happens in application layer
CREATE POLICY "groups_read_published_opportunities" ON ecosystem_opportunities
  FOR SELECT
  USING (status = 'published');

-- 3. ecosystem_opportunity_applications — Group applications for opportunities
CREATE TABLE IF NOT EXISTS ecosystem_opportunity_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES ecosystem_opportunities(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  group_name VARCHAR NOT NULL, -- denormalized for admin search
  group_member_count INT, -- denormalized snapshot
  group_registration_number VARCHAR,
  contact_member_name VARCHAR NOT NULL,
  contact_member_phone VARCHAR NOT NULL,
  contact_member_email VARCHAR,
  message TEXT,
  application_status VARCHAR NOT NULL DEFAULT 'submitted' CHECK (application_status IN ('submitted', 'shortlisted', 'accepted', 'rejected', 'withdrawn')),
  responded_at TIMESTAMP,
  response_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ecosystem_applications_opportunity ON ecosystem_opportunity_applications(opportunity_id);
CREATE INDEX idx_ecosystem_applications_group ON ecosystem_opportunity_applications(group_id);
CREATE INDEX idx_ecosystem_applications_status ON ecosystem_opportunity_applications(application_status);
CREATE INDEX idx_ecosystem_applications_created ON ecosystem_opportunity_applications(created_at DESC);

-- RLS: Groups can only create/view applications for their own group. Admins can view all.
ALTER TABLE ecosystem_opportunity_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_admin_full_access_applications" ON ecosystem_opportunity_applications
  FOR ALL
  USING (is_platform_admin(auth.uid()))
  WITH CHECK (is_platform_admin(auth.uid()));

CREATE POLICY "groups_own_applications" ON ecosystem_opportunity_applications
  FOR ALL
  USING (group_id = get_group_id(auth.uid()))
  WITH CHECK (group_id = get_group_id(auth.uid()));

-- 4. ecosystem_opportunity_eligibility_checks — Cache for expensive eligibility evaluations
CREATE TABLE IF NOT EXISTS ecosystem_opportunity_eligibility_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES ecosystem_opportunities(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  matches BOOLEAN NOT NULL,
  failed_rules JSONB NOT NULL DEFAULT '[]',
  checked_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT eligibility_check_unique UNIQUE (opportunity_id, group_id)
);

CREATE INDEX idx_eligibility_checks_opportunity ON ecosystem_opportunity_eligibility_checks(opportunity_id);
CREATE INDEX idx_eligibility_checks_group ON ecosystem_opportunity_eligibility_checks(group_id);
CREATE INDEX idx_eligibility_checks_checked_at ON ecosystem_opportunity_eligibility_checks(checked_at);

-- RLS: Groups can only see their own eligibility. Admins can see all.
ALTER TABLE ecosystem_opportunity_eligibility_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_admin_full_access_eligibility" ON ecosystem_opportunity_eligibility_checks
  FOR ALL
  USING (is_platform_admin(auth.uid()))
  WITH CHECK (is_platform_admin(auth.uid()));

CREATE POLICY "groups_own_eligibility_checks" ON ecosystem_opportunity_eligibility_checks
  FOR SELECT
  USING (group_id = get_group_id(auth.uid()));

-- 5. ecosystem_featured_categories — Categories with content (used to surface meaningful categories only)
CREATE TABLE IF NOT EXISTS ecosystem_featured_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL UNIQUE,
  slug VARCHAR NOT NULL UNIQUE,
  description TEXT,
  icon_name VARCHAR, -- Tabler icon slug (e.g., 'heartbreak', 'trending-up')
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ecosystem_categories_active ON ecosystem_featured_categories(is_active);
CREATE INDEX idx_ecosystem_categories_sort ON ecosystem_featured_categories(sort_order);

-- RLS: Everyone can read. Admin only can write.
ALTER TABLE ecosystem_featured_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_active_categories" ON ecosystem_featured_categories
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "admin_manage_categories" ON ecosystem_featured_categories
  FOR ALL
  USING (is_platform_admin(auth.uid()))
  WITH CHECK (is_platform_admin(auth.uid()));

-- Grant permissions to app_tenant role (used by authenticated app)
GRANT SELECT ON ecosystem_partners TO app_tenant;
GRANT SELECT ON ecosystem_opportunities TO app_tenant;
GRANT SELECT, INSERT, UPDATE ON ecosystem_opportunity_applications TO app_tenant;
GRANT SELECT ON ecosystem_opportunity_eligibility_checks TO app_tenant;
GRANT SELECT ON ecosystem_featured_categories TO app_tenant;
