-- =============================================================================
-- 015_jurisdiction_tables.sql
-- Phase B of the group registration workflow spec.
--
-- Adds the Kenya administrative jurisdiction chain (county → sub_county → ward)
-- as reference tables. Counties are fully seeded (47 — canonical, stable since
-- 2010 constitution). Sub-counties and wards tables are created empty and
-- expected to be seeded from an authoritative IEBC/KNBS CSV in a separate run.
--
-- groups gains FK columns to all three levels with the county_id denormalised
-- onto the row per §1 of the spec (fast reporting filter without a 3-table join).
-- Existing groups.county text values are best-effort backfilled by name match.
-- =============================================================================

-- ─── Counties ────────────────────────────────────────────────────────────────

CREATE TABLE counties (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  code       CHAR(3)      NOT NULL UNIQUE,   -- official 001..047
  name       VARCHAR(60)  NOT NULL UNIQUE,
  capital    VARCHAR(80),
  region     VARCHAR(40),                    -- Coast, Rift Valley, Nyanza, etc.
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_counties_region ON counties (region);

COMMENT ON TABLE counties IS
  'Kenya counties (47, per the 2010 constitution). Reference table — readable to all authenticated users, modifiable only by super_admin.';

-- ─── Sub-counties ────────────────────────────────────────────────────────────

CREATE TABLE sub_counties (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  county_id  UUID         NOT NULL REFERENCES counties (id) ON DELETE RESTRICT,
  name       VARCHAR(80)  NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sub_county_per_county UNIQUE (county_id, name)
);

CREATE INDEX idx_sub_counties_county_id ON sub_counties (county_id);

COMMENT ON TABLE sub_counties IS
  'Sub-counties / districts within each county. Seed from authoritative IEBC/KNBS data in a separate migration — not seeded here because boundary changes happen and a stale dev seed is worse than empty.';

-- ─── Wards ───────────────────────────────────────────────────────────────────

CREATE TABLE wards (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_county_id UUID         NOT NULL REFERENCES sub_counties (id) ON DELETE RESTRICT,
  name          VARCHAR(100) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ward_per_sub_county UNIQUE (sub_county_id, name)
);

CREATE INDEX idx_wards_sub_county_id ON wards (sub_county_id);

COMMENT ON TABLE wards IS
  'Wards within each sub-county (~1,450 total per IEBC). Seed from authoritative IEBC/KNBS data in a separate migration — not seeded here for the same reason as sub_counties.';

-- ─── Seed: 47 Kenya counties ─────────────────────────────────────────────────
-- Source: 2010 Constitution of Kenya, First Schedule. Codes 001-047 are
-- the official ordinal codes used by IEBC, KNBS, and the National Treasury.

INSERT INTO counties (code, name, capital, region) VALUES
  ('001', 'Mombasa',          'Mombasa',         'Coast'),
  ('002', 'Kwale',             'Kwale',           'Coast'),
  ('003', 'Kilifi',            'Kilifi',          'Coast'),
  ('004', 'Tana River',        'Hola',            'Coast'),
  ('005', 'Lamu',              'Lamu',            'Coast'),
  ('006', 'Taita-Taveta',      'Voi',             'Coast'),
  ('007', 'Garissa',           'Garissa',         'North Eastern'),
  ('008', 'Wajir',             'Wajir',           'North Eastern'),
  ('009', 'Mandera',           'Mandera',         'North Eastern'),
  ('010', 'Marsabit',          'Marsabit',        'Eastern'),
  ('011', 'Isiolo',            'Isiolo',          'Eastern'),
  ('012', 'Meru',              'Meru',            'Eastern'),
  ('013', 'Tharaka-Nithi',     'Chuka',           'Eastern'),
  ('014', 'Embu',              'Embu',            'Eastern'),
  ('015', 'Kitui',             'Kitui',           'Eastern'),
  ('016', 'Machakos',          'Machakos',        'Eastern'),
  ('017', 'Makueni',           'Wote',            'Eastern'),
  ('018', 'Nyandarua',         'Ol Kalou',        'Central'),
  ('019', 'Nyeri',             'Nyeri',           'Central'),
  ('020', 'Kirinyaga',         'Kerugoya/Kutus',  'Central'),
  ('021', 'Murang''a',         'Murang''a',       'Central'),
  ('022', 'Kiambu',            'Kiambu',          'Central'),
  ('023', 'Turkana',           'Lodwar',          'Rift Valley'),
  ('024', 'West Pokot',        'Kapenguria',      'Rift Valley'),
  ('025', 'Samburu',           'Maralal',         'Rift Valley'),
  ('026', 'Trans Nzoia',       'Kitale',          'Rift Valley'),
  ('027', 'Uasin Gishu',       'Eldoret',         'Rift Valley'),
  ('028', 'Elgeyo-Marakwet',   'Iten',            'Rift Valley'),
  ('029', 'Nandi',             'Kapsabet',        'Rift Valley'),
  ('030', 'Baringo',           'Kabarnet',        'Rift Valley'),
  ('031', 'Laikipia',          'Nanyuki',         'Rift Valley'),
  ('032', 'Nakuru',            'Nakuru',          'Rift Valley'),
  ('033', 'Narok',             'Narok',           'Rift Valley'),
  ('034', 'Kajiado',           'Kajiado',         'Rift Valley'),
  ('035', 'Kericho',           'Kericho',         'Rift Valley'),
  ('036', 'Bomet',             'Bomet',           'Rift Valley'),
  ('037', 'Kakamega',          'Kakamega',        'Western'),
  ('038', 'Vihiga',            'Vihiga',          'Western'),
  ('039', 'Bungoma',           'Bungoma',         'Western'),
  ('040', 'Busia',             'Busia',           'Western'),
  ('041', 'Siaya',             'Siaya',           'Nyanza'),
  ('042', 'Kisumu',            'Kisumu',          'Nyanza'),
  ('043', 'Homa Bay',          'Homa Bay',        'Nyanza'),
  ('044', 'Migori',            'Migori',          'Nyanza'),
  ('045', 'Kisii',             'Kisii',           'Nyanza'),
  ('046', 'Nyamira',           'Nyamira',         'Nyanza'),
  ('047', 'Nairobi',           'Nairobi',         'Nairobi');

-- ─── Wire jurisdiction into groups ───────────────────────────────────────────
-- Adds three FK columns. county_id is the denormalised reporting filter (§1);
-- sub_county_id and ward_id provide the full hierarchical chain.
-- The original groups.county VARCHAR(100) is kept for backwards compatibility
-- during the transition; Phase D's register_group RPC writes both columns.

ALTER TABLE groups
  ADD COLUMN county_id     UUID REFERENCES counties     (id) ON DELETE RESTRICT,
  ADD COLUMN sub_county_id UUID REFERENCES sub_counties (id) ON DELETE RESTRICT,
  ADD COLUMN ward_id       UUID REFERENCES wards        (id) ON DELETE RESTRICT;

-- Best-effort backfill: match existing groups.county text against the canonical
-- counties.name. Case- and whitespace-insensitive. Rows that don't match (e.g.
-- typos, blank values, free-form addresses) stay NULL and require manual fix-up.
UPDATE groups g
SET county_id = c.id
FROM counties c
WHERE g.county_id IS NULL
  AND g.county IS NOT NULL
  AND lower(trim(g.county)) = lower(c.name);

CREATE INDEX idx_groups_county_id      ON groups (county_id);
CREATE INDEX idx_groups_sub_county_id  ON groups (sub_county_id);
CREATE INDEX idx_groups_ward_id        ON groups (ward_id);

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Jurisdiction tables are PUBLIC reference data — every authenticated user
-- can SELECT (dropdown lists, validation). Only super_admin can modify.

ALTER TABLE counties      ENABLE ROW LEVEL SECURITY;
ALTER TABLE counties      FORCE  ROW LEVEL SECURITY;
ALTER TABLE sub_counties  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_counties  FORCE  ROW LEVEL SECURITY;
ALTER TABLE wards         ENABLE ROW LEVEL SECURITY;
ALTER TABLE wards         FORCE  ROW LEVEL SECURITY;

CREATE POLICY counties_select_public ON counties
  FOR SELECT USING (true);
CREATE POLICY counties_modify_super_only ON counties
  FOR ALL USING (is_super_admin());

CREATE POLICY sub_counties_select_public ON sub_counties
  FOR SELECT USING (true);
CREATE POLICY sub_counties_modify_super_only ON sub_counties
  FOR ALL USING (is_super_admin());

CREATE POLICY wards_select_public ON wards
  FOR SELECT USING (true);
CREATE POLICY wards_modify_super_only ON wards
  FOR ALL USING (is_super_admin());
