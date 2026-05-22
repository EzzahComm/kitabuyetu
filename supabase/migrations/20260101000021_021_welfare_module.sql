-- ─────────────────────────────────────────────────────────────────────────────
-- 021: Welfare module — requests, pool contributions, RLS
-- ─────────────────────────────────────────────────────────────────────────────

-- Enums
CREATE TYPE public.welfare_request_type AS ENUM (
  'funeral','hospital','emergency','education',
  'maternity','bereavement','disability','other'
);

CREATE TYPE public.welfare_request_status AS ENUM (
  'pending','under_review','approved','disbursed','rejected','cancelled'
);

CREATE TYPE public.welfare_priority AS ENUM ('low','normal','high','urgent');

-- ── Welfare requests ──────────────────────────────────────────────────────────
CREATE TABLE public.welfare_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id             uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  member_id            uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  request_type         public.welfare_request_type NOT NULL,
  title                varchar(255) NOT NULL,
  description          text,
  amount_requested     numeric NOT NULL CHECK (amount_requested > 0),
  amount_approved      numeric CHECK (amount_approved >= 0),
  amount_disbursed     numeric CHECK (amount_disbursed >= 0),
  status               public.welfare_request_status NOT NULL DEFAULT 'pending',
  priority             public.welfare_priority NOT NULL DEFAULT 'normal',
  supporting_documents jsonb NOT NULL DEFAULT '[]',
  reviewed_by          uuid REFERENCES public.members(id),
  reviewed_at          timestamptz,
  approved_by          uuid REFERENCES public.members(id),
  approved_at          timestamptz,
  disbursed_by         uuid REFERENCES public.members(id),
  disbursed_at         timestamptz,
  rejected_by          uuid REFERENCES public.members(id),
  rejected_at          timestamptz,
  rejection_reason     text,
  payment_method       varchar(30),
  mpesa_receipt_number varchar(50),
  journal_entry_id     uuid,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX welfare_requests_group_id_idx    ON public.welfare_requests(group_id);
CREATE INDEX welfare_requests_member_id_idx   ON public.welfare_requests(member_id);
CREATE INDEX welfare_requests_status_idx      ON public.welfare_requests(status);
CREATE INDEX welfare_requests_created_at_idx  ON public.welfare_requests(created_at DESC);

CREATE TRIGGER trg_welfare_requests_updated_at
  BEFORE UPDATE ON public.welfare_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Welfare pool contributions ────────────────────────────────────────────────
CREATE TABLE public.welfare_pool_contributions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id             uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  member_id            uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  amount               numeric NOT NULL CHECK (amount > 0),
  contribution_type    varchar(30) NOT NULL DEFAULT 'regular',
  payment_method       varchar(30),
  mpesa_receipt_number varchar(50),
  period_month         smallint CHECK (period_month BETWEEN 1 AND 12),
  period_year          smallint,
  recorded_by          uuid NOT NULL REFERENCES public.members(id),
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX welfare_pool_contributions_group_id_idx ON public.welfare_pool_contributions(group_id);
CREATE INDEX welfare_pool_contributions_member_id_idx ON public.welfare_pool_contributions(member_id);

CREATE TRIGGER trg_welfare_pool_contributions_updated_at
  BEFORE UPDATE ON public.welfare_pool_contributions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.welfare_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.welfare_pool_contributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY welfare_requests_group_isolation ON public.welfare_requests
  USING (group_id = current_setting('app.current_group_id', true)::uuid);

CREATE POLICY welfare_pool_contributions_group_isolation ON public.welfare_pool_contributions
  USING (group_id = current_setting('app.current_group_id', true)::uuid);
