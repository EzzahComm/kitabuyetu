-- =============================================================================
-- 020_shares.sql
-- Phase E4 (Part 1) — Share capital management.
--
-- Concepts:
--   • share_classes      — per-group configuration (par value, limits, voting
--                          weight, lock period). Multiple classes allowed.
--   • share_transactions — append-only ledger of all share-count changes.
--                          Quantity is signed: + for inflows (purchase,
--                          allocation, transfer_in), − for outflows.
--   • share_holdings     — materialised per-(member,class) balance, kept in
--                          sync by an AFTER INSERT trigger on transactions.
--   • Certificate serial — gapless per-group counter consumed by inflow
--                          transactions. Format: KY-{groupCode}-{classCode}-{seq}.
--
-- All monetary fields use NUMERIC(15,2) per the platform-wide convention.
-- =============================================================================

-- ─── Enums ────────────────────────────────────────────────────────────────

CREATE TYPE share_txn_type AS ENUM (
  'allocation',   -- group grants shares (e.g. founder allotment); typically no payment
  'purchase',     -- member buys shares for cash
  'transfer_in',  -- member receives shares from another member
  'transfer_out', -- member sends shares to another member
  'redemption',   -- member returns shares for cash
  'adjustment'    -- admin correction (positive or negative quantity)
);

CREATE TYPE share_txn_status AS ENUM ('posted', 'reversed');

-- ─── share_classes ────────────────────────────────────────────────────────

CREATE TABLE share_classes (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id           UUID          NOT NULL REFERENCES groups (id) ON DELETE CASCADE,

  name               VARCHAR(80)   NOT NULL,    -- e.g. 'Ordinary Shares'
  code               VARCHAR(20)   NOT NULL,    -- e.g. 'ORD' — appears in cert serials
  description        TEXT,

  -- Money
  par_value          NUMERIC(15,2) NOT NULL,    -- canonical price per share
  current_value      NUMERIC(15,2),             -- last manually-set market value; NULL → use par

  -- Limits per member. NULL = unlimited.
  min_per_member     INTEGER,
  max_per_member     INTEGER,

  -- Governance
  voting_weight      NUMERIC(10,4) NOT NULL DEFAULT 1.0,
  transfer_allowed   BOOLEAN       NOT NULL DEFAULT TRUE,
  lock_period_days   INTEGER       NOT NULL DEFAULT 0,
                                   -- can't redeem/transfer within N days of last acquisition

  is_active          BOOLEAN       NOT NULL DEFAULT TRUE,

  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_share_class_code      UNIQUE (group_id, code),
  CONSTRAINT chk_par_value_positive   CHECK (par_value > 0),
  CONSTRAINT chk_current_value_nonneg CHECK (current_value IS NULL OR current_value >= 0),
  CONSTRAINT chk_min_per_member       CHECK (min_per_member  IS NULL OR min_per_member  >= 0),
  CONSTRAINT chk_max_per_member       CHECK (max_per_member  IS NULL OR max_per_member  > 0),
  CONSTRAINT chk_min_le_max           CHECK (min_per_member  IS NULL OR max_per_member  IS NULL OR min_per_member <= max_per_member),
  CONSTRAINT chk_lock_period_nonneg   CHECK (lock_period_days >= 0),
  CONSTRAINT chk_voting_weight_nonneg CHECK (voting_weight    >= 0)
);

CREATE INDEX idx_share_classes_group  ON share_classes (group_id) WHERE is_active = TRUE;

COMMENT ON TABLE share_classes IS
  'Per-group share-class configuration. Multiple classes allowed (e.g. Ordinary + Preference). Drives pricing, limits, voting weight, lock period.';

-- ─── share_transactions (append-only ledger) ──────────────────────────────

CREATE TABLE share_transactions (
  id                       UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                 UUID             NOT NULL REFERENCES groups          (id) ON DELETE RESTRICT,
  member_id                UUID             NOT NULL REFERENCES members         (id) ON DELETE RESTRICT,
  share_class_id           UUID             NOT NULL REFERENCES share_classes   (id) ON DELETE RESTRICT,

  type                     share_txn_type   NOT NULL,
  status                   share_txn_status NOT NULL DEFAULT 'posted',

  -- Signed delta to the member's holding. Sign rules enforced via CHECK.
  quantity                 INTEGER          NOT NULL,

  -- Money. unit_price is always >= 0 (per-share price snapshot).
  -- total_amount is the absolute cash value of the txn (sign implied by type).
  unit_price               NUMERIC(15,2)    NOT NULL,
  total_amount             NUMERIC(15,2)    NOT NULL,

  -- Transfers reference the counterparty so the paired txn is discoverable.
  counterparty_member_id   UUID             REFERENCES members (id),

  -- Cash leg (only meaningful for purchase / redemption).
  payment_method           VARCHAR(40),     -- 'mpesa' | 'cash' | 'bank_transfer' | 'cheque'
  payment_reference        VARCHAR(80),     -- M-Pesa receipt, bank ref, etc.

  -- Certificate consumed by inflow transactions.
  certificate_serial       VARCHAR(60),

  -- Reversal pairing: when an admin reverses a posted txn we INSERT an
  -- offsetting row and set this column on BOTH rows to reference each other.
  reverses_transaction_id  UUID             REFERENCES share_transactions (id),

  notes                    TEXT,

  created_by               UUID             NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  created_at               TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  posted_at                TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_quantity_nonzero    CHECK (quantity <> 0),
  CONSTRAINT chk_unit_price_nonneg   CHECK (unit_price >= 0),
  CONSTRAINT chk_total_amount_nonneg CHECK (total_amount >= 0),

  -- Sign rules per type.
  CONSTRAINT chk_qty_sign_by_type CHECK (
    (type IN ('purchase', 'allocation', 'transfer_in') AND quantity > 0)
    OR (type IN ('redemption', 'transfer_out') AND quantity < 0)
    OR type = 'adjustment'
  ),

  -- Transfers require a counterparty; non-transfers must not have one.
  CONSTRAINT chk_counterparty_present CHECK (
    (type IN ('transfer_in', 'transfer_out') AND counterparty_member_id IS NOT NULL)
    OR (type NOT IN ('transfer_in', 'transfer_out') AND counterparty_member_id IS NULL)
  )
);

CREATE INDEX idx_share_txn_group_member ON share_transactions (group_id, member_id, posted_at DESC);
CREATE INDEX idx_share_txn_group_class  ON share_transactions (group_id, share_class_id, posted_at DESC);
CREATE INDEX idx_share_txn_group_date   ON share_transactions (group_id, posted_at DESC);
CREATE INDEX idx_share_txn_type         ON share_transactions (group_id, type);
CREATE INDEX idx_share_txn_serial       ON share_transactions (certificate_serial) WHERE certificate_serial IS NOT NULL;
CREATE INDEX idx_share_txn_reverses     ON share_transactions (reverses_transaction_id) WHERE reverses_transaction_id IS NOT NULL;

COMMENT ON TABLE share_transactions IS
  'Append-only ledger of share-count changes. Posted rows are immutable; reversals create paired offsetting rows. Quantity signed: + inflow, − outflow.';

-- ─── share_holdings (materialised balance) ────────────────────────────────

CREATE TABLE share_holdings (
  group_id             UUID          NOT NULL REFERENCES groups        (id) ON DELETE CASCADE,
  member_id            UUID          NOT NULL REFERENCES members       (id) ON DELETE CASCADE,
  share_class_id       UUID          NOT NULL REFERENCES share_classes (id) ON DELETE CASCADE,

  quantity             INTEGER       NOT NULL DEFAULT 0,
  total_invested       NUMERIC(15,2) NOT NULL DEFAULT 0,  -- cumulative cash paid in (purchases) − cash paid out (redemptions)

  first_acquired_at    TIMESTAMPTZ,
  last_transaction_at  TIMESTAMPTZ,

  PRIMARY KEY (group_id, member_id, share_class_id),

  CONSTRAINT chk_holding_qty_nonneg      CHECK (quantity >= 0),
  CONSTRAINT chk_holding_invested_nonneg CHECK (total_invested >= 0)
);

CREATE INDEX idx_holdings_group_class ON share_holdings (group_id, share_class_id);
CREATE INDEX idx_holdings_member      ON share_holdings (member_id);

COMMENT ON TABLE share_holdings IS
  'Materialised per-(member,class) balance. Maintained by trg_apply_share_txn — never write to this table directly from application code.';

-- ─── Certificate serial counters (gapless per-group) ──────────────────────

CREATE TABLE share_certificate_counters (
  group_id UUID    PRIMARY KEY REFERENCES groups (id) ON DELETE CASCADE,
  last_seq INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT chk_last_seq_nonneg CHECK (last_seq >= 0)
);

CREATE OR REPLACE FUNCTION allocate_share_certificate_serial(
  p_group_id   UUID,
  p_class_code TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seq         INTEGER;
  v_group_code  TEXT;
BEGIN
  -- Atomic increment via UPSERT; ON CONFLICT branch grabs an exclusive row
  -- lock for the duration of the transaction so concurrent allocations
  -- can't issue the same serial.
  INSERT INTO share_certificate_counters (group_id, last_seq)
       VALUES (p_group_id, 1)
  ON CONFLICT (group_id) DO UPDATE
          SET last_seq = share_certificate_counters.last_seq + 1
    RETURNING last_seq INTO v_seq;

  SELECT group_code INTO v_group_code FROM groups WHERE id = p_group_id;

  RETURN 'KY-'
      || COALESCE(v_group_code, substring(p_group_id::text, 1, 6))
      || '-' || p_class_code
      || '-' || lpad(v_seq::text, 6, '0');
END;
$$;

REVOKE ALL    ON FUNCTION allocate_share_certificate_serial(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION allocate_share_certificate_serial(UUID, TEXT) TO authenticated, service_role;

-- ─── Trigger: apply posted share_transactions to share_holdings ───────────

CREATE OR REPLACE FUNCTION trg_apply_share_txn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cash_delta NUMERIC(15,2);
BEGIN
  -- total_invested only reflects cash that actually moved between member and
  -- group: purchases add, redemptions subtract. Allocations are free, and
  -- transfers reshuffle ownership between members (cash, if any, is handled
  -- off-platform), so neither moves the invested figure.
  v_cash_delta := CASE
    WHEN NEW.type = 'purchase'   THEN  NEW.total_amount
    WHEN NEW.type = 'redemption' THEN -NEW.total_amount
    ELSE 0
  END;

  INSERT INTO share_holdings (
    group_id, member_id, share_class_id, quantity, total_invested,
    first_acquired_at, last_transaction_at
  ) VALUES (
    NEW.group_id, NEW.member_id, NEW.share_class_id, NEW.quantity, v_cash_delta,
    NEW.posted_at, NEW.posted_at
  )
  ON CONFLICT (group_id, member_id, share_class_id) DO UPDATE SET
    quantity            = share_holdings.quantity        + NEW.quantity,
    total_invested      = GREATEST(share_holdings.total_invested + v_cash_delta, 0),
    -- first_acquired_at preserved; only updated if previously NULL.
    first_acquired_at   = COALESCE(share_holdings.first_acquired_at, NEW.posted_at),
    last_transaction_at = NEW.posted_at;

  -- Defense in depth: the table CHECK already prevents negative quantity, but
  -- raising here gives a clearer error message and avoids the cryptic
  -- "chk_holding_qty_nonneg" violation surfacing to the user.
  IF (SELECT quantity FROM share_holdings
        WHERE group_id = NEW.group_id
          AND member_id = NEW.member_id
          AND share_class_id = NEW.share_class_id) < 0
  THEN
    RAISE EXCEPTION 'Transaction would create a negative share holding for this member/class'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_share_txn_apply
  AFTER INSERT ON share_transactions
  FOR EACH ROW
  WHEN (NEW.status = 'posted')
  EXECUTE FUNCTION trg_apply_share_txn();

-- ─── Immutability: posted share_transactions can't be modified ────────────

CREATE OR REPLACE FUNCTION trg_share_txn_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'posted' AND TG_OP = 'UPDATE' THEN
    -- Only the status flip to 'reversed' (when an admin pairs it with an
    -- offsetting row) is allowed. Everything else stays put.
    IF NEW.status <> 'reversed' OR (
      NEW.group_id, NEW.member_id, NEW.share_class_id, NEW.type, NEW.quantity, NEW.unit_price, NEW.total_amount
    ) IS DISTINCT FROM (
      OLD.group_id, OLD.member_id, OLD.share_class_id, OLD.type, OLD.quantity, OLD.unit_price, OLD.total_amount
    ) THEN
      RAISE EXCEPTION 'Posted share_transactions are immutable; create a reversal entry instead';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' AND OLD.status = 'posted' THEN
    RAISE EXCEPTION 'Posted share_transactions cannot be deleted';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_share_txn_immutable
  BEFORE UPDATE OR DELETE ON share_transactions
  FOR EACH ROW EXECUTE FUNCTION trg_share_txn_immutable();

-- ─── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE share_classes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_classes               FORCE  ROW LEVEL SECURITY;
ALTER TABLE share_transactions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_transactions          FORCE  ROW LEVEL SECURITY;
ALTER TABLE share_holdings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_holdings              FORCE  ROW LEVEL SECURITY;
ALTER TABLE share_certificate_counters  ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_certificate_counters  FORCE  ROW LEVEL SECURITY;

-- Everyone in the group can read share data (transparency on capital).
CREATE POLICY share_classes_select ON share_classes
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());

CREATE POLICY share_txn_select ON share_transactions
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());

CREATE POLICY share_holdings_select ON share_holdings
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());

CREATE POLICY share_counters_select ON share_certificate_counters
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());

-- Only treasurer / group_admin can manage share classes and post transactions.
-- (Holdings table writes are trigger-driven; the counter table is written by
-- the SECURITY DEFINER function — so the modify policy gates direct writes
-- only and that's fine.)
CREATE POLICY share_classes_modify ON share_classes
  FOR ALL USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() IN ('group_admin', 'treasurer'))
  );

CREATE POLICY share_txn_modify ON share_transactions
  FOR ALL USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() IN ('group_admin', 'treasurer'))
  );

CREATE POLICY share_holdings_modify ON share_holdings
  FOR ALL USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() IN ('group_admin', 'treasurer'))
  );

CREATE POLICY share_counters_modify ON share_certificate_counters
  FOR ALL USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() IN ('group_admin', 'treasurer'))
  );
