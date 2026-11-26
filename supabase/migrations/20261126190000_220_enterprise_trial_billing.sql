-- Coverage belongs to the organization so a plan reassignment cannot restart a trial.
CREATE TABLE enterprise_coverage (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id),
  trial_ends_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  paid_until timestamptz
);
CREATE TABLE enterprise_invoices (
  reference text PRIMARY KEY DEFAULT ('EN' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  organization_id uuid NOT NULL REFERENCES enterprise_coverage,
  due_at timestamptz NOT NULL,
  plan_type text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  received numeric(14,2) NOT NULL DEFAULT 0,
  email_sent_at timestamptz,
  last_email_attempt timestamptz,
  settled_at timestamptz,
  UNIQUE(organization_id,due_at)
);
CREATE TABLE enterprise_mpesa_receipts (
  receipt text PRIMARY KEY,
  reference text NOT NULL REFERENCES enterprise_invoices,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  channel text NOT NULL CHECK (channel IN ('stk','paybill')),
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE enterprise_stk_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_id text UNIQUE,
  merchant_id text,
  reference text NOT NULL REFERENCES enterprise_invoices,
  amount numeric(14,2) NOT NULL CHECK (amount > 0)
);
ALTER TABLE enterprise_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_mpesa_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_stk_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON enterprise_coverage,enterprise_invoices,enterprise_mpesa_receipts,enterprise_stk_attempts FROM public, anon, authenticated;

CREATE FUNCTION public.start_enterprise_trial() RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO enterprise_coverage(organization_id) VALUES (NEW.id)
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER start_enterprise_trial AFTER INSERT ON organizations
FOR EACH ROW EXECUTE FUNCTION public.start_enterprise_trial();

INSERT INTO enterprise_coverage(organization_id)
SELECT id FROM organizations ON CONFLICT DO NOTHING;

ALTER TABLE enterprise_invoices ADD COLUMN last_prompt_at timestamptz;
