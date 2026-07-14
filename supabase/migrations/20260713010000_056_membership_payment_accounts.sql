-- =============================================================================
-- 056_membership_payment_accounts.sql
-- Phase 1 of the payment architecture redesign (PAYMENT_ARCHITECTURE_REDESIGN.md):
--
--   1. Damm check-digit functions (damm_interim / damm_check_digit / damm_valid)
--   2. groups.payment_prefix — immutable 2-letter routing prefix (branch code)
--   3. membership_no_counters — platform-wide sequence per prefix
--   4. group_members.membership_no — the Membership Number, fixed 8 chars
--      PP DDDDD C (prefix + 5-digit seq + Damm check digit). The ONLY public
--      payment identifier. Allocated by trigger on INSERT; immutable after.
--   5. group_members.display_alias — cosmetic label, never routable
--   6. DROP group_members.mpesa_ref — dead column, replaced by membership_no
--   7. payment_accounts — single routing registry (membership numbers, legacy
--      member codes, invoice numbers; future kinds: bank_va, qr, api_alias)
--   8. mpesa_unrouted.reason gains 'membership_inactive' and 'bad_account'
--
-- Trigger functions are SECURITY INVOKER per repo policy (migration 029).
-- register_group() is SECURITY DEFINER, so its inserts fire these triggers
-- with owner rights; tenant-context inserts rely on the RLS policies below.
-- =============================================================================

-- ─── 1. Damm check digit ─────────────────────────────────────────────────────
-- The Damm quasigroup detects ALL single-digit errors and ALL adjacent
-- transpositions. Prefix letters participate mapped A=0…Z=25, each mod 10,
-- so a prefix typo (BG → BF) also breaks the check digit.
-- Mirror implementation: lib/utils/membership-no.ts — keep them identical.

CREATE OR REPLACE FUNCTION public.damm_interim(p_digits TEXT)
RETURNS INT LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  t CONSTANT INT[][] := ARRAY[
    ARRAY[0,3,1,7,5,9,8,6,4,2],
    ARRAY[7,0,9,2,1,5,4,8,6,3],
    ARRAY[4,2,0,6,8,7,1,3,5,9],
    ARRAY[1,7,5,0,9,8,3,4,2,6],
    ARRAY[6,1,2,3,0,4,5,9,7,8],
    ARRAY[3,6,7,4,2,0,9,5,8,1],
    ARRAY[5,8,6,9,7,2,0,1,3,4],
    ARRAY[8,9,4,5,3,6,2,0,1,7],
    ARRAY[9,4,3,8,6,1,7,2,0,5],
    ARRAY[2,5,8,1,4,3,6,7,9,0]
  ];
  interim INT := 0;
  i INT;
  d INT;
BEGIN
  IF p_digits !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'damm_interim: non-digit input %', p_digits;
  END IF;
  FOR i IN 1..length(p_digits) LOOP
    d := ascii(substr(p_digits, i, 1)) - 48;
    interim := t[interim + 1][d + 1];
  END LOOP;
  RETURN interim;
END $$;

-- Maps the 7-char base (2 letters + 5 digits) to its Damm digit string:
-- 'BG10253' → '16' || '10253'  (B=1, G=6 after A=0…Z=25 mod 10)
CREATE OR REPLACE FUNCTION public.membership_no_digit_string(p_base TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ((ascii(substr(upper(p_base), 1, 1)) - 65) % 10)::text
      || ((ascii(substr(upper(p_base), 2, 1)) - 65) % 10)::text
      || substr(p_base, 3);
$$;

CREATE OR REPLACE FUNCTION public.damm_check_digit(p_base TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT damm_interim(membership_no_digit_string(p_base))::text;
$$;

CREATE OR REPLACE FUNCTION public.damm_valid(p_no TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_no ~ '^[A-Z]{2}[0-9]{6}$'
     AND damm_interim(membership_no_digit_string(substr(p_no, 1, 7)) || substr(p_no, 8, 1)) = 0;
$$;

-- ─── 2. groups.payment_prefix ────────────────────────────────────────────────

ALTER TABLE groups ADD COLUMN payment_prefix CHAR(2)
  CHECK (payment_prefix ~ '^[A-Z]{2}$');

COMMENT ON COLUMN groups.payment_prefix IS
  'Immutable 2-letter payment routing prefix (like a bank branch code). Seeded '
  'from the group name at creation but carries NO semantic guarantee — renames '
  'and mergers never change it. Reserved pairs: KY (legacy code collision), '
  'ZZ (sandbox/test). Multiple groups may share a prefix; uniqueness lives on '
  'the full membership number.';

-- Derives a prefix suggestion from a group name. Reserved pairs are shifted
-- to the next letter. Purely a naming nicety — never load-bearing.
CREATE OR REPLACE FUNCTION public.derive_payment_prefix(p_name TEXT)
RETURNS CHAR(2) LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  words TEXT[];
  a CHAR; b CHAR;
  pfx TEXT;
BEGIN
  words := regexp_split_to_array(upper(coalesce(p_name, '')), '[^A-Z]+');
  words := array_remove(words, '');
  IF coalesce(array_length(words, 1), 0) >= 2 THEN
    a := substr(words[1], 1, 1);
    b := substr(words[2], 1, 1);
  ELSIF coalesce(array_length(words, 1), 0) = 1 AND length(words[1]) >= 2 THEN
    a := substr(words[1], 1, 1);
    b := substr(words[1], 2, 1);
  ELSE
    a := 'X'; b := 'X';
  END IF;
  pfx := a || b;
  -- Reserved pairs: shift the second letter until clear (Z wraps to A).
  WHILE pfx IN ('KY', 'ZZ') LOOP
    b := chr(CASE WHEN ascii(b) >= 90 THEN 65 ELSE ascii(b) + 1 END);
    pfx := a || b;
  END LOOP;
  RETURN pfx;
END $$;

-- Assign a prefix to new groups that don't bring one.
CREATE OR REPLACE FUNCTION public.assign_payment_prefix()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.payment_prefix IS NULL THEN
    NEW.payment_prefix := derive_payment_prefix(NEW.name);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_groups_payment_prefix
  BEFORE INSERT ON groups
  FOR EACH ROW EXECUTE FUNCTION assign_payment_prefix();

-- Backfill existing groups.
UPDATE groups SET payment_prefix = derive_payment_prefix(name)
WHERE payment_prefix IS NULL;

ALTER TABLE groups ALTER COLUMN payment_prefix SET NOT NULL;

-- Immutability: once any membership exists, the prefix is frozen forever
-- (issued numbers embed it).
CREATE OR REPLACE FUNCTION public.protect_payment_prefix()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.payment_prefix IS DISTINCT FROM OLD.payment_prefix
     AND EXISTS (SELECT 1 FROM group_members WHERE group_id = OLD.id) THEN
    RAISE EXCEPTION 'payment_prefix is immutable once the group has memberships (group %)', OLD.id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_groups_protect_prefix
  BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION protect_payment_prefix();

-- ─── 3. membership_no_counters ───────────────────────────────────────────────

CREATE TABLE membership_no_counters (
  prefix    CHAR(2) PRIMARY KEY CHECK (prefix ~ '^[A-Z]{2}$'),
  last_seq  INTEGER NOT NULL DEFAULT 0 CHECK (last_seq BETWEEN 0 AND 99999)
);

ALTER TABLE membership_no_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_no_counters FORCE  ROW LEVEL SECURITY;

-- Counters carry no tenant data (a prefix and an integer). They are written
-- by the SECURITY INVOKER allocation trigger, which fires inside tenant
-- transactions — so the policy must admit those writes.
CREATE POLICY membership_no_counters_all ON membership_no_counters
  FOR ALL USING (true) WITH CHECK (true);

-- ─── 4/5. group_members.membership_no + display_alias ───────────────────────

ALTER TABLE group_members
  ADD COLUMN membership_no CHAR(8),
  ADD COLUMN display_alias VARCHAR(30);

COMMENT ON COLUMN group_members.membership_no IS
  'The Membership Number — fixed 8 chars: 2-letter prefix + 5-digit sequence '
  '+ Damm check digit. The ONLY public payment identifier (PayBill account '
  'number, STK AccountReference, receipts, statements, QR). Allocated by '
  'trigger at INSERT; immutable; never recycled.';

COMMENT ON COLUMN group_members.display_alias IS
  'Optional cosmetic label (e.g. ''Lucas-25''). NEVER routable — it must never '
  'appear in payment_accounts or be accepted as a payment reference.';

CREATE UNIQUE INDEX uq_group_members_display_alias
  ON group_members (group_id, display_alias) WHERE display_alias IS NOT NULL;

-- Backfill: deterministic ordering (earliest membership gets the lowest
-- number), partitioned by PREFIX — several groups can share one prefix and
-- draw from the same sequence space.
WITH ordered AS (
  SELECT gm.id,
         g.payment_prefix AS pfx,
         ROW_NUMBER() OVER (PARTITION BY g.payment_prefix ORDER BY gm.created_at, gm.id) AS seq
  FROM group_members gm
  JOIN groups g ON g.id = gm.group_id
  WHERE gm.membership_no IS NULL
)
UPDATE group_members gm
SET    membership_no = o.pfx || lpad(o.seq::text, 5, '0')
                     || damm_check_digit(o.pfx || lpad(o.seq::text, 5, '0'))
FROM   ordered o
WHERE  gm.id = o.id;

-- Seed counters to the highest sequence just issued.
INSERT INTO membership_no_counters (prefix, last_seq)
SELECT substr(membership_no, 1, 2), MAX(substr(membership_no, 3, 5)::int)
FROM   group_members
WHERE  membership_no IS NOT NULL
GROUP  BY substr(membership_no, 1, 2)
ON CONFLICT (prefix) DO UPDATE SET last_seq = GREATEST(membership_no_counters.last_seq, EXCLUDED.last_seq);

-- Constraints — after backfill so legacy rows pass.
ALTER TABLE group_members
  ALTER COLUMN membership_no SET NOT NULL,
  ADD CONSTRAINT chk_membership_no_format CHECK (damm_valid(membership_no));

CREATE UNIQUE INDEX uq_group_members_membership_no ON group_members (membership_no);

-- Allocation trigger: the ONLY generation path (governance §1.8). Locks the
-- counter row; the unique index is the final arbiter under concurrency.
CREATE OR REPLACE FUNCTION public.allocate_membership_no()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  pfx  CHAR(2);
  seq  INT;
  base TEXT;
BEGIN
  IF NEW.membership_no IS NOT NULL THEN
    -- Imports must not supply their own numbers; the allocator is the issuer.
    RAISE EXCEPTION 'membership_no is allocated by the platform and cannot be supplied';
  END IF;

  SELECT payment_prefix INTO pfx FROM groups WHERE id = NEW.group_id;
  IF pfx IS NULL THEN
    RAISE EXCEPTION 'group % has no payment_prefix', NEW.group_id;
  END IF;

  INSERT INTO membership_no_counters (prefix, last_seq) VALUES (pfx, 0)
  ON CONFLICT (prefix) DO NOTHING;

  UPDATE membership_no_counters SET last_seq = last_seq + 1
  WHERE prefix = pfx RETURNING last_seq INTO seq;

  IF seq > 99999 THEN
    -- Governance §1.8: exhaustion moves the GROUP to a variant prefix for new
    -- memberships. That reassignment is an operator action (a new prefix on
    -- the group would break the immutability guarantee if automated blindly),
    -- so fail loudly here; monitoring alerts at 80% saturation long before.
    RAISE EXCEPTION 'membership number space exhausted for prefix % — assign the group a variant prefix', pfx;
  END IF;

  base := pfx || lpad(seq::text, 5, '0');
  NEW.membership_no := base || damm_check_digit(base);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_group_members_allocate_no
  BEFORE INSERT ON group_members
  FOR EACH ROW EXECUTE FUNCTION allocate_membership_no();

-- Immutability: numbers never change and are never recycled.
CREATE OR REPLACE FUNCTION public.protect_membership_no()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.membership_no IS DISTINCT FROM OLD.membership_no THEN
    RAISE EXCEPTION 'membership_no is immutable (group_members %)', OLD.id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_group_members_protect_no
  BEFORE UPDATE ON group_members
  FOR EACH ROW EXECUTE FUNCTION protect_membership_no();

-- ─── 6. Drop the dead mpesa_ref column ───────────────────────────────────────
-- Built in migration 030 as the deterministic payment routing key but never
-- referenced by any application code (audit H-2). membership_no replaces its
-- intent; no duplicate routing mechanism may exist (ADR §5).

ALTER TABLE group_members DROP COLUMN mpesa_ref;

-- ─── 7. payment_accounts — the single routing registry ──────────────────────

CREATE TABLE payment_accounts (
  identifier     TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN
                   ('membership_no','legacy_code','invoice','bank_va','qr','api_alias')),
  membership_id  UUID REFERENCES group_members (id) ON DELETE CASCADE,
  invoice_id     UUID REFERENCES invoices (id)      ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT payment_accounts_target CHECK (
    (kind =  'invoice' AND invoice_id IS NOT NULL AND membership_id IS NULL) OR
    (kind <> 'invoice' AND membership_id IS NOT NULL AND invoice_id IS NULL)
  )
);

COMMENT ON TABLE payment_accounts IS
  'Single routing index for ALL inbound payment identifiers. Routing is: '
  'normalise → one lookup here → membership/invoice. Display aliases are '
  'deliberately absent — their absence IS the "aliases never route" guarantee.';

CREATE INDEX idx_payment_accounts_membership ON payment_accounts (membership_id)
  WHERE membership_id IS NOT NULL;
CREATE INDEX idx_payment_accounts_invoice    ON payment_accounts (invoice_id)
  WHERE invoice_id IS NOT NULL;

ALTER TABLE payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_accounts FORCE  ROW LEVEL SECURITY;

-- SELECT: a tenant session sees its own group's rows (and invoice rows for
-- its group via the invoice FK); sessions without a group context are the
-- admin/callback paths (withAdminDb) that perform routing.
CREATE POLICY payment_accounts_select ON payment_accounts
  FOR SELECT USING (
    is_super_admin()
    OR (SELECT app_current_group_id()) IS NULL
    OR membership_id IN (SELECT id FROM group_members
                         WHERE group_id = (SELECT app_current_group_id()))
    OR invoice_id IN (SELECT id FROM invoices
                      WHERE group_id = (SELECT app_current_group_id()))
  );

-- INSERT: fired by the registry trigger inside member-creation transactions
-- (tenant context → membership must belong to the current group) and by
-- admin/backfill paths (no group context).
CREATE POLICY payment_accounts_insert ON payment_accounts
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (SELECT app_current_group_id()) IS NULL
    OR membership_id IN (SELECT id FROM group_members
                         WHERE group_id = (SELECT app_current_group_id()))
    OR invoice_id IN (SELECT id FROM invoices
                      WHERE group_id = (SELECT app_current_group_id()))
  );

-- UPDATE (status suspension) is an admin-only operation.
CREATE POLICY payment_accounts_update ON payment_accounts
  FOR UPDATE USING (is_super_admin() OR (SELECT app_current_group_id()) IS NULL);

-- Registry rows for every new membership: the membership number plus the
-- legacy member_code as an alias (old printed materials keep routing).
CREATE OR REPLACE FUNCTION public.register_payment_accounts()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  INSERT INTO payment_accounts (identifier, kind, membership_id)
  VALUES (NEW.membership_no, 'membership_no', NEW.id),
         (NEW.member_code,   'legacy_code',   NEW.id)
  ON CONFLICT (identifier) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_group_members_register_accounts
  AFTER INSERT ON group_members
  FOR EACH ROW EXECUTE FUNCTION register_payment_accounts();

-- Backfill: memberships (numbers + legacy codes) and invoices.
INSERT INTO payment_accounts (identifier, kind, membership_id)
SELECT membership_no, 'membership_no', id FROM group_members
ON CONFLICT (identifier) DO NOTHING;

INSERT INTO payment_accounts (identifier, kind, membership_id)
SELECT member_code, 'legacy_code', id FROM group_members
ON CONFLICT (identifier) DO NOTHING;

INSERT INTO payment_accounts (identifier, kind, invoice_id)
SELECT upper(invoice_number), 'invoice', id FROM invoices
ON CONFLICT (identifier) DO NOTHING;

-- Keep the registry in step with new invoices.
CREATE OR REPLACE FUNCTION public.register_invoice_account()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  INSERT INTO payment_accounts (identifier, kind, invoice_id)
  VALUES (upper(NEW.invoice_number), 'invoice', NEW.id)
  ON CONFLICT (identifier) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_invoices_register_account
  AFTER INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION register_invoice_account();

-- ─── 8. New unrouted reasons ─────────────────────────────────────────────────

ALTER TABLE mpesa_unrouted DROP CONSTRAINT mpesa_unrouted_reason_check;
ALTER TABLE mpesa_unrouted ADD CONSTRAINT mpesa_unrouted_reason_check
  CHECK (reason IN (
    'unknown_prefix','unknown_group','unknown_member',
    'ambiguous_member','no_account_ref','amount_mismatch',
    'membership_inactive','bad_account',
    'other'
  ));
