-- =============================================================================
-- 066b_platform_billing_table.sql
--
-- Backfills the CREATE TABLE for public.platform_billing, which does not
-- exist anywhere in this migration history — it was created directly
-- against production (dashboard/ad-hoc SQL) before migration 067
-- (20260605121331_067_weekly_billing.sql, itself a post-hoc "recovered from
-- supabase_migrations.schema_migrations" snapshot, not an original
-- hand-authored migration) started ALTERing it. That ALTER assumes the
-- table already exists, so a truly fresh apply of this migration history
-- has never actually been possible until now — this file closes that gap.
--
-- Schema (columns, constraints, indexes) reverse-engineered directly from
-- the live production database via the Supabase MCP `execute_sql` tool,
-- reflecting platform_billing's state immediately BEFORE migration 067's
-- changes (period_type, the 3-column unique constraint) are applied on top.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.platform_billing (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  period          date NOT NULL,
  member_count    integer NOT NULL DEFAULT 0,
  tier            text NOT NULL DEFAULT 'starter',
  membership_fee  numeric NOT NULL DEFAULT 0,
  sms_fee         numeric NOT NULL DEFAULT 0,
  transaction_fee numeric NOT NULL DEFAULT 0,
  total           numeric NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'pending',
  charged_at      timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT platform_billing_status_chk CHECK (status IN ('pending','charged','partial','failed','waived')),
  CONSTRAINT platform_billing_unique UNIQUE (group_id, period)
);

CREATE INDEX IF NOT EXISTS idx_platform_billing_period ON public.platform_billing (period, status);
