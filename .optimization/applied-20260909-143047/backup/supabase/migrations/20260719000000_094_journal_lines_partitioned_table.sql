-- journal_lines partitioning, step 1 of 2 (ACCOUNTING_ARCHITECTURE_AUDIT.md
-- §17/§19 — Phase 2 of the recommendation migration 091 started). Creates a
-- partitioned twin table alongside the live journal_lines; nothing here
-- touches the live table. Migration 095 backfills and does the atomic
-- rename-swap.
--
-- Two confirmed facts shape this migration (verified against a scratch
-- Postgres 17 container — matching production's supabase/config.toml
-- major_version = 17 — not just documentation):
--
--  1. Ordinary row-level triggers created on a partitioned table are
--     automatically cloned to every existing AND future partition
--     (documented Postgres behavior since PG11/13). This covers
--     trg_journal_lines_updated_at, trg_journal_lines_update_balance, and
--     trg_journal_lines_derive_entry_date with zero extra work below.
--
--  2. CONSTRAINT TRIGGERs do NOT get that treatment — Postgres requires them
--     on plain tables, and in practice they must be created on each
--     partition individually. trg_assert_posted_balance_deferred (migration
--     027) is the one journal_lines trigger this applies to, so it's
--     created explicitly on every partition below, and the ongoing
--     maintenance job (lib/jobs) does the same for every partition it
--     creates going forward.
--
-- Only the primary key and the 3 non-FK/CHECK indexes need temporary
-- "_partitioned"-suffixed names below (index — and PK-backing-index — names
-- share one per-schema namespace, so they'd collide with the live table's
-- until migration 095's rename-swap frees the originals). FK and CHECK
-- constraint names are scoped per-table, so those are given their final
-- canonical names directly, with no rename needed later.

CREATE TABLE journal_lines_partitioned (
  id               UUID          NOT NULL DEFAULT gen_random_uuid(),
  group_id         UUID          NOT NULL,
  journal_entry_id UUID          NOT NULL,
  account_id       UUID          NOT NULL,
  debit            NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit           NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description      TEXT,
  entry_date       DATE          NOT NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT journal_lines_partitioned_pkey PRIMARY KEY (id, entry_date),
  CONSTRAINT journal_lines_group_id_fkey         FOREIGN KEY (group_id)         REFERENCES groups (id)          ON DELETE RESTRICT,
  CONSTRAINT journal_lines_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES journal_entries (id) ON DELETE CASCADE,
  CONSTRAINT journal_lines_account_id_fkey       FOREIGN KEY (account_id)       REFERENCES accounts (id)        ON DELETE RESTRICT,
  CONSTRAINT journal_lines_debit_xor_credit CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  )
) PARTITION BY RANGE (entry_date);

CREATE INDEX idx_journal_lines_partitioned_group_id ON journal_lines_partitioned (group_id);
CREATE INDEX idx_journal_lines_partitioned_entry_id  ON journal_lines_partitioned (journal_entry_id);
CREATE INDEX idx_journal_lines_partitioned_account_entry_date
  ON journal_lines_partitioned (account_id, entry_date)
  INCLUDE (journal_entry_id, debit, credit);

ALTER TABLE journal_lines_partitioned ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines_partitioned FORCE  ROW LEVEL SECURITY;

CREATE POLICY journal_lines_select ON journal_lines_partitioned
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());
CREATE POLICY journal_lines_insert ON journal_lines_partitioned
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson','treasurer'))
  );
CREATE POLICY journal_lines_update ON journal_lines_partitioned
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson','treasurer'))
  );

CREATE TRIGGER trg_journal_lines_updated_at
  BEFORE UPDATE ON journal_lines_partitioned
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER trg_journal_lines_update_balance
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines_partitioned
  FOR EACH ROW EXECUTE FUNCTION private.update_account_balance();

CREATE TRIGGER trg_journal_lines_derive_entry_date
  BEFORE INSERT ON journal_lines_partitioned
  FOR EACH ROW EXECUTE FUNCTION derive_journal_line_entry_date();

-- Monthly partitions from the earliest entry_date currently in journal_entries
-- through 3 months past today, each with its own copy of the deferred
-- balance-check constraint trigger (see note 2 above). Plus a DEFAULT
-- partition catching any date outside that range rather than failing an
-- insert outright — a real possibility, not just theoretical: the audit
-- (§13) found manual journals can be dated arbitrarily in the past or
-- future today. lib/jobs' new journal_lines_partition_maintenance job
-- checks this partition for rows and warns if it's ever non-empty, since
-- that means partition creation fell behind, not something to leave silent.
DO $$
DECLARE
  v_start   DATE;
  v_cursor  DATE;
  v_end     DATE;
  v_name    TEXT;
BEGIN
  SELECT date_trunc('month', COALESCE(MIN(entry_date), CURRENT_DATE))::DATE INTO v_start
  FROM journal_entries;

  v_cursor := v_start;
  v_end    := date_trunc('month', CURRENT_DATE)::DATE + INTERVAL '3 months';

  WHILE v_cursor < v_end LOOP
    v_name := 'journal_lines_y' || to_char(v_cursor, 'YYYY') || 'm' || to_char(v_cursor, 'MM');

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF journal_lines_partitioned FOR VALUES FROM (%L) TO (%L)',
      v_name, v_cursor, v_cursor + INTERVAL '1 month'
    );
    -- Schema-qualified to match migration 027's own original wording exactly
    -- (public.journal_lines / public.assert_posted_entry_balance()) for this
    -- specific trigger.
    EXECUTE format(
      'CREATE CONSTRAINT TRIGGER trg_assert_posted_balance_deferred
         AFTER INSERT ON public.%I
         DEFERRABLE INITIALLY DEFERRED
         FOR EACH ROW EXECUTE FUNCTION public.assert_posted_entry_balance()',
      v_name
    );

    v_cursor := v_cursor + INTERVAL '1 month';
  END LOOP;

  EXECUTE 'CREATE TABLE IF NOT EXISTS journal_lines_default PARTITION OF journal_lines_partitioned DEFAULT';
  EXECUTE
    'CREATE CONSTRAINT TRIGGER trg_assert_posted_balance_deferred
       AFTER INSERT ON public.journal_lines_default
       DEFERRABLE INITIALLY DEFERRED
       FOR EACH ROW EXECUTE FUNCTION public.assert_posted_entry_balance()';
END $$;
