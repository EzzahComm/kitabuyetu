-- =============================================================================
-- 182: Changi$ha — fundraising campaigns
--
-- THE GAP
-- Phase 6 on the roadmap ("Fundraise / Changi$ha") has been pure marketing
-- vapor: app/fundraise/page.tsx is a static "coming soon" page, and there is
-- zero schema anywhere for a campaign or a donation. This migration adds the
-- two tables that back the real v1: a group creates a campaign for a cause,
-- it goes through a lightweight admin approval step, and once approved the
-- public can view it and donate by M-Pesa STK push.
--
-- WHY ADMIN APPROVAL EXISTS
-- Every other money-in path on this platform (contributions, loan
-- repayments, subscription payments) requires the payer to already be an
-- authenticated group member. A Changi$ha campaign is the ONLY surface where
-- a member of the general public — nobody this platform has ever
-- authenticated — can push real money in. `status` therefore has a
-- 'pending_review' gate a normal contribution has no equivalent of:
-- draft -> pending_review -> active (public + donatable) -> completed /
-- cancelled, with a 'rejected' terminal state for admin-declined campaigns.
--
-- WHY amount_raised IS A COLUMN, NOT A LIVE SUM
-- Every other running total in this codebase that money actually depends on
-- (organization_wallets.available_balance, groups' account balances) is a
-- maintained column updated inside the same transaction as the event that
-- changes it, not a SUM() computed on read — same reasoning applies here:
-- applyCampaignDonationFromSTK() increments it atomically alongside the
-- ledger posting and the campaign_donations INSERT, in one transaction.
--
-- WHY campaign_donations HAS NO member_id
-- Donors are members of the public, not group members — there is nothing to
-- foreign-key to. This is genuinely new territory for the payment pipeline
-- (lib/services/mpesa-stk.service.ts's applyContributionFromSTK always
-- matches an existing group_members row); the new 'campaign_donation' STK
-- purpose and its fulfilment handler are added in application code, not here.
--
-- NO RLS POLICY GRANTS PUBLIC READ ACCESS
-- Unlike a first instinct, this migration does NOT add an RLS policy or a
-- grant admitting the `anon`/`authenticated` Postgres roles — that is
-- exactly the mistake that caused the 2026-08-08 PostgREST exposure incident
-- (migration 126). This app never talks to Postgres through PostgREST or the
-- Supabase client; it always goes through its own pg pool. The public
-- campaign page therefore reads through withAdminDb() with an explicit
-- `WHERE status = 'active'` filter baked into the query in application code
-- (lib/services/campaigns.service.ts's getPublicCampaignBySlug /
-- listActiveCampaigns) — the same shape app/status/page.tsx already uses for
-- an unauthenticated page reading live data directly. RLS below is for the
-- group-scoped tenant path only (dashboard reads/writes), exactly like every
-- other tenant table.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'campaign_status') THEN
    CREATE TYPE public.campaign_status AS ENUM (
      'draft', 'pending_review', 'active', 'completed', 'cancelled', 'rejected'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'campaign_donation_status') THEN
    CREATE TYPE public.campaign_donation_status AS ENUM ('pending', 'completed', 'failed');
  END IF;
END $$;

-- ── campaigns ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaigns (
  id               UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID                    NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  title            TEXT                    NOT NULL CHECK (btrim(title) <> ''),
  slug             TEXT                    NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  story            TEXT                    NOT NULL CHECK (btrim(story) <> ''),
  beneficiary_name TEXT,
  target_amount    NUMERIC(15,2)           NOT NULL CHECK (target_amount > 0),
  -- Maintained column, not SUM() — see header. Only ever written by
  -- applyCampaignDonationFromSTK() inside the same transaction as the
  -- donation INSERT and ledger posting; never client-writable.
  amount_raised    NUMERIC(15,2)           NOT NULL DEFAULT 0 CHECK (amount_raised >= 0),
  currency         TEXT                    NOT NULL DEFAULT 'KES',
  cover_image_url  TEXT,
  status           public.campaign_status  NOT NULL DEFAULT 'draft',
  rejection_reason TEXT,
  created_by       UUID                    NOT NULL REFERENCES public.members (id) ON DELETE RESTRICT,
  reviewed_by      UUID                    REFERENCES public.members (id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  ends_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ             NOT NULL DEFAULT NOW(),

  CONSTRAINT campaigns_rejection_reason_consistent CHECK (
    (status = 'rejected' AND rejection_reason IS NOT NULL)
    OR (status <> 'rejected')
  ),
  CONSTRAINT campaigns_reviewed_fields_consistent CHECK (
    (status IN ('active', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    OR (status NOT IN ('active', 'rejected'))
  )
);

COMMENT ON TABLE public.campaigns IS
  'Changi$ha fundraising campaigns (migration 182). draft -> pending_review -> '
  'active (public + donatable) -> completed/cancelled, or -> rejected. '
  'amount_raised is a maintained column, updated only by '
  'applyCampaignDonationFromSTK() in lib/services/mpesa-stk.service.ts.';

CREATE INDEX IF NOT EXISTS idx_campaigns_group_id ON public.campaigns (group_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status_active ON public.campaigns (status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_campaigns_status_pending ON public.campaigns (status) WHERE status = 'pending_review';

-- ── campaign_donations ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_donations (
  id                    UUID                          PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           UUID                          NOT NULL REFERENCES public.campaigns (id) ON DELETE CASCADE,
  -- No member_id / group_id FK — the donor is a member of the public, not a
  -- group member. group_id is denormalized from the campaign purely so RLS
  -- below can scope SELECT to the owning group without a join.
  group_id              UUID                          NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  donor_name            TEXT,
  donor_phone           TEXT                          NOT NULL,
  amount                NUMERIC(15,2)                 NOT NULL CHECK (amount > 0),
  message               TEXT,
  -- Hides donor_name on the PUBLIC page only — the group can always see who
  -- gave, same as every other donor-management product; this is not
  -- anonymous to the platform, only to other visitors.
  is_anonymous          BOOLEAN                       NOT NULL DEFAULT false,
  mpesa_receipt_number  TEXT,
  status                public.campaign_donation_status NOT NULL DEFAULT 'pending',
  journal_entry_id      UUID                          REFERENCES public.journal_entries (id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ                   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.campaign_donations IS
  'One row per Changi$ha donation attempt (migration 182). Settled via the '
  'same M-Pesa STK pipeline as every other payment on the platform '
  '(mpesa-stk.service.ts, purpose=''campaign_donation''), just without a '
  'member match — the payer is not a group member.';

-- Idempotent settlement, same technique as every other STK-fed table
-- (mpesa_transactions, payments): a receipt can only settle once.
CREATE UNIQUE INDEX IF NOT EXISTS campaign_donations_receipt_unique
  ON public.campaign_donations (mpesa_receipt_number) WHERE mpesa_receipt_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_donations_campaign_id ON public.campaign_donations (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_donations_group_id    ON public.campaign_donations (group_id);
CREATE INDEX IF NOT EXISTS idx_campaign_donations_status      ON public.campaign_donations (campaign_id, status) WHERE status = 'completed';

-- ── RLS: campaigns ───────────────────────────────────────────────────────────
-- Group-scoped tenant path only — see header for why there is deliberately
-- no public/anon policy here. Shape matches loans/loan_charges (010/179):
-- broad group SELECT, writes restricted to officer roles.
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns FORCE  ROW LEVEL SECURITY;

CREATE POLICY campaigns_select ON public.campaigns
  FOR SELECT USING (
    is_super_admin() OR group_id = app_current_group_id()
  );

CREATE POLICY campaigns_insert ON public.campaigns
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson', 'treasurer', 'secretary'))
  );

CREATE POLICY campaigns_update ON public.campaigns
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson', 'treasurer', 'secretary'))
  );

-- ── RLS: campaign_donations ──────────────────────────────────────────────────
ALTER TABLE public.campaign_donations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_donations FORCE  ROW LEVEL SECURITY;

CREATE POLICY campaign_donations_select ON public.campaign_donations
  FOR SELECT USING (
    is_super_admin() OR group_id = app_current_group_id()
  );

-- No tenant-session INSERT/UPDATE policy: rows are only ever written by
-- applyCampaignDonationFromSTK() via withAdminDb (the STK callback runs with
-- no group session — it's a system webhook), exactly like every other
-- STK-settled table (mpesa_transactions, payments). service_role below is
-- what that write path uses.

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Same hygiene as every migration since the 2026-08-08 PostgREST exposure
-- incident: default privileges hand new public tables full anon/authenticated
-- rights, which must be revoked explicitly.
REVOKE ALL ON public.campaigns          FROM anon, authenticated;
REVOKE ALL ON public.campaign_donations FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_donations TO service_role;

-- app_tenant is provisioned out-of-band in production (ADR-001) and does not
-- exist in a fresh/CI Postgres replay — a plain GRANT would abort the run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.campaigns TO app_tenant';
    EXECUTE 'GRANT SELECT ON public.campaign_donations TO app_tenant';
  END IF;
END $$;
