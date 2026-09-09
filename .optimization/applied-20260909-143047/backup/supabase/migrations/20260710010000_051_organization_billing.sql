-- ============================================================================
-- 051 — Organization-funded SMS
--
-- Until now every SMS was billed to billing_accounts.group_id. Because a group
-- may be overseen by more than one organization (organization_group_access is
-- many-to-many), an organization-initiated send had no unambiguous payer — the
-- group always paid, even for a campaign it did not ask for.
--
-- This migration gives organizations their own credit balance and makes the
-- payer explicit on every message, so SMS spend can be attributed and reported
-- per organization rather than inferred through a join.
-- ============================================================================

-- ─── Organization credit balance ────────────────────────────────────────────

CREATE TABLE organization_billing_accounts (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID          NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  sms_credits           NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (sms_credits >= 0),
  -- Organizations negotiate their own per-SMS rate; groups inherit theirs from
  -- subscriptions.sms_rate, which an organization has no row in.
  sms_rate              NUMERIC(8,4)  NOT NULL DEFAULT 0.90 CHECK (sms_rate >= 0),
  low_balance_threshold NUMERIC(15,2) NOT NULL DEFAULT 100,
  is_active             BOOLEAN       NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT organization_billing_accounts_org_unique UNIQUE (organization_id)
);

CREATE INDEX idx_org_billing_low_balance ON organization_billing_accounts (organization_id)
  WHERE sms_credits <= low_balance_threshold;

-- Top-up ledger, mirroring sms_credits for groups.
CREATE TABLE organization_sms_credits (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID          NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  billing_account_id UUID          NOT NULL REFERENCES organization_billing_accounts (id) ON DELETE RESTRICT,
  amount_paid        NUMERIC(15,2) NOT NULL CHECK (amount_paid > 0),
  credits_added      NUMERIC(15,2) NOT NULL CHECK (credits_added > 0),
  rate_applied       NUMERIC(8,4)  NOT NULL,
  payment_id         UUID          REFERENCES payments (id) ON DELETE SET NULL,
  added_by           UUID          REFERENCES members  (id) ON DELETE SET NULL,
  notes              TEXT,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_org_sms_credits_org ON organization_sms_credits (organization_id, created_at DESC);

-- ─── Explicit payer on every message ────────────────────────────────────────

ALTER TABLE sms_usage_logs
  ADD COLUMN payer_type            TEXT NOT NULL DEFAULT 'group',
  ADD COLUMN payer_organization_id UUID REFERENCES organizations (id) ON DELETE SET NULL;

ALTER TABLE sms_usage_logs
  ADD CONSTRAINT sms_usage_payer_type_valid CHECK (payer_type IN ('group','organization'));

-- A group-funded message must not name an organization payer, and an
-- organization-funded one must. Without this, cost reports would double-count.
ALTER TABLE sms_usage_logs
  ADD CONSTRAINT sms_usage_payer_consistent CHECK (
    (payer_type = 'group'        AND payer_organization_id IS NULL)
    OR
    (payer_type = 'organization' AND payer_organization_id IS NOT NULL)
  );

CREATE INDEX idx_sms_usage_payer_org ON sms_usage_logs (payer_organization_id, created_at DESC)
  WHERE payer_organization_id IS NOT NULL;

-- Campaigns record who is footing the bill, so the confirmation screen can show
-- the right balance before dispatch.
ALTER TABLE sms_campaigns
  ADD COLUMN payer_type            TEXT NOT NULL DEFAULT 'group',
  ADD COLUMN payer_organization_id UUID REFERENCES organizations (id) ON DELETE SET NULL;

ALTER TABLE sms_campaigns
  ADD CONSTRAINT sms_campaigns_payer_consistent CHECK (
    (payer_type = 'group'        AND payer_organization_id IS NULL)
    OR
    (payer_type = 'organization' AND payer_organization_id IS NOT NULL)
  );

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE organization_billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_sms_credits      ENABLE ROW LEVEL SECURITY;

CREATE POLICY organization_billing_accounts_all ON organization_billing_accounts
  FOR ALL USING (
    is_super_admin()
    OR (app_current_role() = 'organization_coordinator'
        AND organization_id = app_current_organization_id())
  );

CREATE POLICY organization_sms_credits_all ON organization_sms_credits
  FOR ALL USING (
    is_super_admin()
    OR (app_current_role() = 'organization_coordinator'
        AND organization_id = app_current_organization_id())
  );

-- An organization coordinator may read the messages their organization funded,
-- even though those rows belong to a member group.
CREATE POLICY sms_usage_logs_org_payer_select ON sms_usage_logs
  FOR SELECT USING (
    app_current_role() = 'organization_coordinator'
    AND payer_organization_id = app_current_organization_id()
  );

-- ─── Debit path ─────────────────────────────────────────────────────────────
--
-- smsService.send() bills inside the caller's RLS transaction, where the actor
-- is a group officer (chairperson/treasurer) — a role the policies above
-- deliberately do not grant on an organization's balance. Widening the policy
-- to let any member group UPDATE the organization's credits would be far too
-- broad, so the debit goes through a SECURITY DEFINER function that authorizes
-- the caller explicitly: the group must hold active access under that
-- organization. Running it in the caller's transaction keeps the existing
-- invariant that credits are never debited without the matching log rows.
--
-- Returns the rate applied so the caller can stamp credits_deducted per row.

CREATE OR REPLACE FUNCTION debit_organization_sms_credits(
  p_organization_id UUID,
  p_group_id        UUID,
  p_message_count   INTEGER
)
RETURNS TABLE (rate NUMERIC, total NUMERIC, remaining NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_rate    NUMERIC;
  v_credits NUMERIC;
  v_total   NUMERIC;
BEGIN
  IF p_message_count <= 0 THEN
    RAISE EXCEPTION 'message count must be positive' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organization_group_access
    WHERE organization_id = p_organization_id
      AND group_id        = p_group_id
      AND is_active
  ) THEN
    RAISE EXCEPTION 'group % has no active access under organization %',
      p_group_id, p_organization_id USING ERRCODE = '42501';
  END IF;

  SELECT oba.sms_rate, oba.sms_credits
    INTO v_rate, v_credits
  FROM organization_billing_accounts oba
  WHERE oba.organization_id = p_organization_id AND oba.is_active
  FOR UPDATE;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'organization % has no active billing account', p_organization_id
      USING ERRCODE = '22023';
  END IF;

  v_total := v_rate * p_message_count;

  IF v_credits < v_total THEN
    RAISE EXCEPTION 'insufficient organization SMS credits' USING ERRCODE = '22003';
  END IF;

  UPDATE organization_billing_accounts
  SET sms_credits = sms_credits - v_total, updated_at = NOW()
  WHERE organization_id = p_organization_id;

  RETURN QUERY SELECT v_rate, v_total, v_credits - v_total;
END;
$fn$;

-- SECURITY DEFINER: never callable by anon. The owner (the role the app pool
-- connects as) retains EXECUTE implicitly.
REVOKE ALL ON FUNCTION debit_organization_sms_credits(UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION debit_organization_sms_credits(UUID, UUID, INTEGER) TO authenticated;

-- Every organization starts with a zero-balance account so the funding path
-- exists before the first top-up.
INSERT INTO organization_billing_accounts (organization_id)
SELECT id FROM organizations
ON CONFLICT (organization_id) DO NOTHING;
