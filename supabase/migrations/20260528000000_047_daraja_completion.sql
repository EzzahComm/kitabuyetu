-- =============================================================================
-- 047_daraja_completion.sql
-- Production-readiness storage layer for the Daraja (M-Pesa) integration.
-- Adds:
--   • mpesa_b2c_transactions.source_account     — which sub-account funded a B2C
--   • mpesa_charges                             — log of Safaricom fees per txn
--   • group_contribution_splits                 — per-group split allocation rules
--   • mpesa_qr_codes                            — audit of generated dynamic QRs
--   • mpesa_unrouted                            — receipts awaiting manual routing
--   • mpesa_b2c_charge_tiers                    — deterministic Safaricom fee table
--   • groups.mpesa_paybill_prefix               — per-group BillRef prefix
--   • is_test flag on mpesa_transactions + journal_entries (sandbox parity)
--   • index on mpesa_stk_requests (purpose, status) — recon hot path
-- Backfills failed_payment_logs.group_id from mpesa_transactions where possible.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Source sub-account tracking on B2C
-- ---------------------------------------------------------------------------
ALTER TABLE mpesa_b2c_transactions
  ADD COLUMN source_account VARCHAR(20);

COMMENT ON COLUMN mpesa_b2c_transactions.source_account IS
  'Safaricom sub-account shortcode that funded the disbursement (e.g. 500020109900232313 for Loan Disbursement Account). Recorded for reconciliation against the Daraja statement; the API call itself uses MPESA_SHORTCODE as PartyA.';

CREATE INDEX idx_b2c_source_account
  ON mpesa_b2c_transactions (source_account)
  WHERE source_account IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. mpesa_charges — Safaricom per-transaction fee audit
-- ---------------------------------------------------------------------------
-- One row per B2C / B2B / Reversal that incurred a Safaricom fee. The fee
-- amount is determined deterministically from mpesa_b2c_charge_tiers (see
-- below) at the time of posting. The nightly charges reconciliation cron
-- compares this against the actual debits on the Charges Paid Account.
CREATE TABLE mpesa_charges (
  id                   UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id             UUID           NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  mpesa_transaction_id UUID           NOT NULL REFERENCES mpesa_transactions (id) ON DELETE RESTRICT,
  charge_type          VARCHAR(20)    NOT NULL
                         CHECK (charge_type IN ('b2c', 'b2b', 'reversal', 'stk_push', 'other')),
  amount               NUMERIC(15,2)  NOT NULL CHECK (amount >= 0),
  source               VARCHAR(20)    NOT NULL DEFAULT 'tier_table'
                         CHECK (source IN ('tier_table', 'callback', 'manual')),
  journal_entry_id     UUID           REFERENCES journal_entries (id),
  raw_response         JSONB,
  created_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT mpesa_charges_txn_unique UNIQUE (mpesa_transaction_id)
);

CREATE INDEX idx_mpesa_charges_group     ON mpesa_charges (group_id);
CREATE INDEX idx_mpesa_charges_type      ON mpesa_charges (charge_type);
CREATE INDEX idx_mpesa_charges_created   ON mpesa_charges (created_at DESC);

CREATE TRIGGER trg_mpesa_charges_updated_at
  BEFORE UPDATE ON mpesa_charges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. mpesa_b2c_charge_tiers — deterministic Safaricom B2C fee schedule
-- ---------------------------------------------------------------------------
-- Operator-maintained. The (min_amount, max_amount] range is half-open: a
-- transaction of exactly `min_amount` falls into the LOWER tier, exactly
-- `max_amount` falls into THIS tier. Use the function below to look up the
-- charge for a given amount.
--
-- Seeded with Safaricom's published B2C fee schedule as of 2024-01. Operators
-- MUST verify against their current Safaricom merchant agreement and run an
-- UPDATE migration if rates have changed.
CREATE TABLE mpesa_b2c_charge_tiers (
  id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_type VARCHAR(20)    NOT NULL DEFAULT 'b2c'
                CHECK (charge_type IN ('b2c', 'b2b')),
  min_amount  NUMERIC(15,2)  NOT NULL CHECK (min_amount >= 0),
  max_amount  NUMERIC(15,2)  NOT NULL CHECK (max_amount > 0),
  charge      NUMERIC(15,2)  NOT NULL CHECK (charge >= 0),
  effective_from DATE        NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,
  notes       TEXT,
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CHECK (max_amount > min_amount),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX idx_charge_tiers_lookup
  ON mpesa_b2c_charge_tiers (charge_type, min_amount, max_amount)
  WHERE effective_to IS NULL;

COMMENT ON TABLE mpesa_b2c_charge_tiers IS
  'Safaricom B2C/B2B fee schedule. Lookup with mpesa_charge_for_amount(amount, type). Operator must keep current per their merchant agreement.';

-- Lookup helper — returns the charge for the active tier matching `p_amount`.
-- Returns NULL if no tier matches (caller decides whether to fail closed).
CREATE OR REPLACE FUNCTION mpesa_charge_for_amount(
  p_amount      NUMERIC,
  p_charge_type VARCHAR DEFAULT 'b2c'
) RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT charge
  FROM   mpesa_b2c_charge_tiers
  WHERE  charge_type = p_charge_type
    AND  p_amount >  min_amount
    AND  p_amount <= max_amount
    AND  effective_from <= CURRENT_DATE
    AND  (effective_to IS NULL OR effective_to >  CURRENT_DATE)
  ORDER  BY effective_from DESC
  LIMIT  1
$$;

-- Seed: Safaricom B2C standard fees (paid by the merchant, debited from the
-- Charges Paid Account). Last verified against Safaricom Daraja docs Jan 2024.
INSERT INTO mpesa_b2c_charge_tiers (charge_type, min_amount, max_amount, charge, notes) VALUES
  ('b2c',     0.00,      100.00,  0.00,  'Below KES 100 — no charge'),
  ('b2c',   100.00,    1000.00,  11.00,  'KES 101–1,000'),
  ('b2c',  1000.00,    1500.00,  22.00,  'KES 1,001–1,500'),
  ('b2c',  1500.00,    5000.00,  33.00,  'KES 1,501–5,000'),
  ('b2c',  5000.00,   20000.00,  44.00,  'KES 5,001–20,000'),
  ('b2c', 20000.00,   70000.00,  55.00,  'KES 20,001–70,000'),
  ('b2c', 70000.00,  150000.00, 110.00,  'KES 70,001–150,000 (B2C single-transaction cap)');

-- ---------------------------------------------------------------------------
-- 4. group_contribution_splits — per-group split allocation rules
-- ---------------------------------------------------------------------------
-- When a KYT-CONTR-<group> payment arrives, the allocation engine runs these
-- rules to split the amount across multiple ledger accounts. Either
-- `percentage` OR `fixed_amount` must be set (CHECK enforces). Fixed-amount
-- lines are applied first; the remainder is distributed by percentage using
-- the largest-remainder rounding algorithm.
--
-- Default: no rows = 100% to the group's savings income account. Treasurers
-- opt in to splitting via the /settings/contribution-splits UI (P10).
CREATE TABLE group_contribution_splits (
  id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID           NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  account_code VARCHAR(10)    NOT NULL,
  percentage   NUMERIC(5,2)   CHECK (percentage IS NULL OR (percentage > 0 AND percentage <= 100)),
  fixed_amount NUMERIC(15,2)  CHECK (fixed_amount IS NULL OR fixed_amount > 0),
  priority     INT            NOT NULL DEFAULT 100,
  is_active    BOOLEAN        NOT NULL DEFAULT true,
  created_by   UUID           REFERENCES members (id),
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CHECK ((percentage IS NOT NULL) <> (fixed_amount IS NOT NULL)),
  CONSTRAINT group_split_account_unique UNIQUE (group_id, account_code)
);

CREATE INDEX idx_group_splits_group   ON group_contribution_splits (group_id) WHERE is_active;
CREATE INDEX idx_group_splits_active  ON group_contribution_splits (group_id, priority) WHERE is_active;

CREATE TRIGGER trg_group_splits_updated_at
  BEFORE UPDATE ON group_contribution_splits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. mpesa_qr_codes — audit of generated dynamic QRs
-- ---------------------------------------------------------------------------
CREATE TABLE mpesa_qr_codes (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID         NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  merchant_name VARCHAR(22)  NOT NULL,
  ref_no        VARCHAR(80)  NOT NULL,
  amount        NUMERIC(15,2) NOT NULL CHECK (amount >= 0),
  trx_code      VARCHAR(2)   NOT NULL
                  CHECK (trx_code IN ('BG','PB','WA','SB','SM','SS')),
  cpi           VARCHAR(20)  NOT NULL,
  size_px       INT          NOT NULL DEFAULT 300 CHECK (size_px > 0 AND size_px <= 800),
  daraja_request_id VARCHAR(100),
  generated_by  UUID         REFERENCES members (id),
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_qr_codes_group     ON mpesa_qr_codes (group_id);
CREATE INDEX idx_qr_codes_created   ON mpesa_qr_codes (created_at DESC);
CREATE INDEX idx_qr_codes_ref_no    ON mpesa_qr_codes (group_id, ref_no);

-- ---------------------------------------------------------------------------
-- 6. mpesa_unrouted — receipts awaiting manual treasurer routing
-- ---------------------------------------------------------------------------
-- Receipts land here when the auto-router can't determine a target:
--   • C2B with BillRefNumber that doesn't match any known KY code or invoice
--   • STK callback where the phone matches no active member in the group
--   • Multi-group members paying without an account ref (per the locked
--     decision to reject + queue rather than auto-route)
CREATE TABLE mpesa_unrouted (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  mpesa_transaction_id     UUID         REFERENCES mpesa_transactions (id) ON DELETE RESTRICT,
  receipt                  VARCHAR(50)  NOT NULL UNIQUE,
  phone                    VARCHAR(20)  NOT NULL,
  amount                   NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  bill_ref                 VARCHAR(50),
  reason                   VARCHAR(40)  NOT NULL
                             CHECK (reason IN (
                               'unknown_prefix','unknown_group','unknown_member',
                               'ambiguous_member','no_account_ref','amount_mismatch',
                               'other'
                             )),
  raw_payload              JSONB        NOT NULL,
  candidate_group_id       UUID         REFERENCES groups (id) ON DELETE SET NULL,
  resolved                 BOOLEAN      NOT NULL DEFAULT false,
  resolved_to_group_id     UUID         REFERENCES groups (id) ON DELETE SET NULL,
  resolved_to_contribution UUID,
  resolved_to_invoice      UUID         REFERENCES invoices (id),
  resolved_by              UUID         REFERENCES members (id),
  resolved_at              TIMESTAMPTZ,
  resolution_notes         TEXT,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_unrouted_unresolved   ON mpesa_unrouted (created_at DESC) WHERE NOT resolved;
CREATE INDEX idx_unrouted_phone        ON mpesa_unrouted (phone);
CREATE INDEX idx_unrouted_candidate    ON mpesa_unrouted (candidate_group_id) WHERE candidate_group_id IS NOT NULL;

CREATE TRIGGER trg_unrouted_updated_at
  BEFORE UPDATE ON mpesa_unrouted
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. groups.mpesa_paybill_prefix — per-group BillRef prefix override
-- ---------------------------------------------------------------------------
-- Defaults to 'KYT-' (the platform-wide prefix). White-label deployments can
-- override per group (e.g. 'ACME-' for a co-branded SACCO). The parser tries
-- the group's prefix first, then falls back to platform default.
ALTER TABLE groups
  ADD COLUMN mpesa_paybill_prefix VARCHAR(10) NOT NULL DEFAULT 'KYT-';

COMMENT ON COLUMN groups.mpesa_paybill_prefix IS
  'BillRefNumber prefix that routes payments to this group. Default KYT- for the platform; customisable for white-label deployments.';

-- ---------------------------------------------------------------------------
-- 8. is_test sandbox parity flags
-- ---------------------------------------------------------------------------
-- When MPESA_ENV=sandbox, all auto-generated M-Pesa rows and the journal
-- entries they trigger are stamped is_test=true. A single query before
-- production cutover wipes the sandbox state:
--   DELETE FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE is_test);
--   DELETE FROM journal_entries WHERE is_test;
--   DELETE FROM contributions  WHERE id IN (SELECT created_member_ids ...);  -- by domain
--   ...
ALTER TABLE mpesa_transactions
  ADD COLUMN is_test BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE journal_entries
  ADD COLUMN is_test BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_mpesa_tx_is_test
  ON mpesa_transactions (created_at DESC) WHERE is_test;

CREATE INDEX idx_journal_entries_is_test
  ON journal_entries (group_id, created_at DESC) WHERE is_test;

-- ---------------------------------------------------------------------------
-- 9. STK reconciliation hot-path index
-- ---------------------------------------------------------------------------
-- The reconciliation engine scans pending STK requests by (purpose, status).
-- Existing indexes cover (status) and (initiated_at DESC) but no compound.
CREATE INDEX idx_stk_purpose_status
  ON mpesa_stk_requests (purpose, status)
  WHERE status IN ('pending', 'initiated');

-- ---------------------------------------------------------------------------
-- 10. Backfill failed_payment_logs.group_id
-- ---------------------------------------------------------------------------
-- The column exists but every insert path has historically left it NULL,
-- defeating the (group_id) index. Backfill from mpesa_transactions where
-- the reference_id matches a known conversation/checkout id.
UPDATE failed_payment_logs f
SET    group_id = t.group_id
FROM   mpesa_transactions t
WHERE  f.group_id IS NULL
  AND  (
        t.originator_conversation_id = f.reference_id
     OR t.conversation_id            = f.reference_id
  );

-- Also backfill from mpesa_stk_requests for stk_push failures
UPDATE failed_payment_logs f
SET    group_id = s.group_id
FROM   mpesa_stk_requests s
WHERE  f.group_id IS NULL
  AND  f.transaction_type = 'stk_push'
  AND  s.checkout_request_id = f.reference_id;

-- ---------------------------------------------------------------------------
-- 11. Row Level Security on new tables
-- ---------------------------------------------------------------------------
ALTER TABLE mpesa_charges               ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_b2c_charge_tiers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_contribution_splits   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_qr_codes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_unrouted              ENABLE ROW LEVEL SECURITY;

-- Group-scoped tables: isolate by group_id session variable
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'mpesa_charges', 'group_contribution_splits', 'mpesa_qr_codes'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (group_id::TEXT = current_setting(''app.current_group_id'', TRUE))',
      'rls_' || tbl || '_group', tbl
    );
  END LOOP;
END;
$$;

-- mpesa_unrouted is read by treasurers in their own group OR by super_admin
-- platform-wide. The resolved_to_group_id may differ from candidate_group_id,
-- so we allow visibility on EITHER candidate or resolved match.
CREATE POLICY rls_mpesa_unrouted_group ON mpesa_unrouted
  FOR ALL USING (
    candidate_group_id::TEXT   = current_setting('app.current_group_id', TRUE)
    OR resolved_to_group_id::TEXT = current_setting('app.current_group_id', TRUE)
    OR current_setting('app.current_role', TRUE) IN ('super_admin','support')
  );

-- Charge tiers are global reference data; everyone reads, only super_admin writes.
CREATE POLICY rls_charge_tiers_read ON mpesa_b2c_charge_tiers
  FOR SELECT USING (true);
CREATE POLICY rls_charge_tiers_write ON mpesa_b2c_charge_tiers
  FOR ALL USING (current_setting('app.current_role', TRUE) = 'super_admin');

-- ---------------------------------------------------------------------------
-- 12. Comments for the next developer
-- ---------------------------------------------------------------------------
COMMENT ON TABLE mpesa_unrouted IS
  'Receipts the auto-router could not bind to a contribution/invoice. Treasurer-resolved via /mpesa/unrouted. Resolution writes back to the target table and stamps resolved=true here.';

COMMENT ON TABLE group_contribution_splits IS
  'Per-group split allocation rules for KYT-CONTR-* payments. Empty set = 100% to savings (default). Fixed-amount lines applied first; remainder split by percentage using largest-remainder rounding.';

COMMENT ON TABLE mpesa_charges IS
  'Per-transaction Safaricom fee audit. One row per B2C/B2B/Reversal/STK that incurred a fee. Reconciled nightly against the Charges Paid sub-account debit feed.';
