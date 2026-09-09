-- =============================================================================
-- 072b_welfare_votes_and_investment_shares.sql
--
-- Backfills CREATE TABLE for public.welfare_votes and
-- public.member_investment_shares, neither of which exist anywhere in this
-- migration history despite both being created directly against production
-- (same "recovered snapshot" gap as platform_billing, migration 066b) and
-- both being referenced by scripts/clear-tenant-data.sql — a fresh apply of
-- this migration history has therefore never actually reached a working
-- state for either welfare voting or investment-share tracking.
--
-- Schema reverse-engineered directly from the live production database via
-- the Supabase MCP `execute_sql` tool.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.welfare_votes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.welfare_requests (id) ON DELETE CASCADE,
  group_id   uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  voter_id   uuid NOT NULL REFERENCES public.members (id),
  vote       varchar NOT NULL CHECK (vote IN ('approve', 'reject', 'abstain')),
  reason     text,
  voted_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT welfare_votes_request_id_voter_id_key UNIQUE (request_id, voter_id)
);

CREATE TABLE IF NOT EXISTS public.member_investment_shares (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id       uuid NOT NULL REFERENCES public.investments (id) ON DELETE CASCADE,
  group_id            uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  member_id           uuid NOT NULL REFERENCES public.members (id),
  shares              integer NOT NULL DEFAULT 1 CHECK (shares > 0),
  amount_contributed  numeric NOT NULL CHECK (amount_contributed > 0),
  contributed_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT member_investment_shares_investment_id_member_id_key UNIQUE (investment_id, member_id)
);
