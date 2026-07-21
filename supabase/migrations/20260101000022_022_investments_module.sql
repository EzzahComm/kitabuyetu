-- ─────────────────────────────────────────────────────────────────────────────
-- 022: Investments module — investments, returns, RLS
--
-- Amended 2026-05-26: actor FKs changed from public.users(id) to
-- public.members(id). The original file referenced a non-existent public.users
-- table; the live DB was hand-fixed at deploy time. This rewrite makes the
-- repo file match what's actually on Supabase, so fresh deploys produce the
-- same schema. No data migration needed.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enums
CREATE TYPE public.investment_type AS ENUM (
  'real_estate','shares','bonds','fixed_deposit',
  'business','land','treasury_bills','money_market','other'
);

CREATE TYPE public.investment_status AS ENUM (
  'pending_approval','active','matured','liquidated','cancelled'
);

CREATE TYPE public.return_type AS ENUM (
  'dividend','interest','capital_gain','rental_income','other'
);

-- ── Investments ───────────────────────────────────────────────────────────────
CREATE TABLE public.investments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id             uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  name                 varchar(255) NOT NULL,
  description          text,
  investment_type      public.investment_type NOT NULL,
  status               public.investment_status NOT NULL DEFAULT 'pending_approval',
  principal_amount     numeric NOT NULL CHECK (principal_amount > 0),
  current_value        numeric CHECK (current_value >= 0),
  expected_return_rate numeric CHECK (expected_return_rate >= 0),
  start_date           date NOT NULL,
  maturity_date        date,
  custodian            varchar(255),
  registration_number  varchar(100),
  location             text,
  documents            jsonb NOT NULL DEFAULT '[]',
  approved_by          uuid REFERENCES public.members(id),
  approved_at          timestamptz,
  liquidated_by        uuid REFERENCES public.members(id),
  liquidated_at        timestamptz,
  liquidation_value    numeric,
  notes                text,
  created_by           uuid NOT NULL REFERENCES public.members(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX investments_group_id_idx   ON public.investments(group_id);
CREATE INDEX investments_status_idx     ON public.investments(status);
CREATE INDEX investments_type_idx       ON public.investments(investment_type);
CREATE INDEX investments_created_at_idx ON public.investments(created_at DESC);

CREATE TRIGGER trg_investments_updated_at
  BEFORE UPDATE ON public.investments
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- ── Investment returns ────────────────────────────────────────────────────────
CREATE TABLE public.investment_returns (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id  uuid NOT NULL REFERENCES public.investments(id) ON DELETE CASCADE,
  group_id       uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  return_type    public.return_type NOT NULL,
  amount         numeric NOT NULL CHECK (amount > 0),
  return_date    date NOT NULL,
  receipt_number varchar(100),
  notes          text,
  recorded_by    uuid NOT NULL REFERENCES public.members(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX investment_returns_investment_id_idx ON public.investment_returns(investment_id);
CREATE INDEX investment_returns_group_id_idx      ON public.investment_returns(group_id);
CREATE INDEX investment_returns_return_date_idx   ON public.investment_returns(return_date DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investment_returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY investments_group_isolation ON public.investments
  USING (group_id = current_setting('app.current_group_id', true)::uuid);

CREATE POLICY investment_returns_group_isolation ON public.investment_returns
  USING (group_id = current_setting('app.current_group_id', true)::uuid);
