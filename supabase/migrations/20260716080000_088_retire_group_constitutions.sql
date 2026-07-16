-- Retire group_constitutions (ACCOUNTING_ARCHITECTURE_AUDIT.md §33.1 — the
-- audit's explicit instruction was to decide: wire it in, or drop it. The
-- decision, confirmed with the product owner: migrate its genuinely
-- policy-shaped fields into the Configuration Service (migration 086) and
-- drop the table, ending its hazardous orphaned state — a fully-built,
-- RLS-isolated policy table that no code path has ever read, which §22
-- flagged as dangerous precisely because it *looks* authoritative).
--
-- What migrates:
--   loan_interest_rate / loan_interest_method / max_loan_term_months /
--   loan_multiplier  -> policies (domain 'loan', key 'terms')   — advisory
--                       defaults for the loan-application form; officers can
--                       still override per loan (confirmed: advisory, not
--                       hard enforcement, so zero new rejections).
--   fine_schedule    -> policies (domain 'fine', key 'schedule') — advisory
--                       reference amounts; 'fine' already exists as a
--                       payment-request category (migration 059).
--
-- What deliberately does NOT migrate (superseded or per-instance):
--   share_value/max_shares_per_week — superseded by share_classes.unit_price,
--     the real, enforced share pricing mechanism shares.service.ts locks
--     FOR SHARE on every purchase.
--   welfare_amount — welfare requests carry their own per-request amounts.
--   quorum_percentage/signatory_requirements/cycle_duration_weeks —
--     meetings take quorum_required per meeting; no code reads the rest.
--
-- Verified on production before writing this migration: 3 groups, 3
-- constitution rows, every one sitting at the seeded defaults (0 rows differ
-- on any migrated field) — so the group-override INSERTs below are no-ops on
-- production today and exist only for correctness on any environment where
-- a constitution was actually edited.

-- ─── Platform-wide defaults (the constitution table's own column defaults) ──

INSERT INTO policies (domain, policy_key, value, version)
VALUES
  ('loan', 'terms',
   '{"interestRate": 10, "interestMethod": "flat", "maxTermMonths": 12, "loanMultiplier": 3}'::jsonb,
   1),
  ('fine', 'schedule',
   '{"late_attendance": 50, "absence": 100, "misconduct": 200}'::jsonb,
   1);

-- ─── Group overrides, only where the active constitution differs ────────────

INSERT INTO policies (domain, policy_key, group_id, value, version)
SELECT 'loan', 'terms', gc.group_id,
       jsonb_build_object(
         'interestRate',   gc.loan_interest_rate,
         'interestMethod', gc.loan_interest_method,
         'maxTermMonths',  gc.max_loan_term_months,
         'loanMultiplier', gc.loan_multiplier
       ),
       1
FROM group_constitutions gc
WHERE gc.is_active
  AND (gc.loan_interest_rate   <> 10
    OR gc.loan_interest_method <> 'flat'
    OR gc.max_loan_term_months <> 12
    OR gc.loan_multiplier      <> 3);

INSERT INTO policies (domain, policy_key, group_id, value, version)
SELECT 'fine', 'schedule', gc.group_id, gc.fine_schedule, 1
FROM group_constitutions gc
WHERE gc.is_active
  AND gc.fine_schedule <> '{"late_attendance": 50, "absence": 100, "misconduct": 200}'::jsonb;

-- ─── Drop the orphaned table and its seeding machinery ──────────────────────

DROP TRIGGER  IF EXISTS trg_groups_seed_constitution ON groups;
DROP FUNCTION IF EXISTS private.seed_default_constitution();
DROP TABLE    IF EXISTS group_constitutions;
