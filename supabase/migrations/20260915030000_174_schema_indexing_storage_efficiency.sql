-- =============================================================================
-- 174_schema_indexing_storage_efficiency.sql
-- Bounded fixes from the 2026-09 optimization audit's postgres-schema-
-- indexing-and-storage-eff dimension (docs/audits/optimization-2026-09/
-- verified/postgres-schema-indexing-and-storage-eff.json). Every number
-- below was re-verified live against prod (qztcgryhoanennsizcll) before
-- writing this file, not just taken from the audit's citations.
--
-- 3 of the audit's 10 findings are ALREADY RESOLVED by earlier migrations
-- this session, confirmed live before writing this file:
--   - job_queue's missing tick-query index: migration 172's
--     idx_job_queue_claim (type, priority DESC, run_at) WHERE status=
--     'pending' is exactly the fix this finding proposed. Live re-measure:
--     the cited 0.3-1.7s query now runs in 0.27ms.
--   - email_logs.provider_message_id's missing index: migration 173 added
--     it (non-unique; the audit's WHERE NOT NULL UNIQUE variant would be a
--     marginal improvement, not worth a second migration for).
--   - job_logs' missing retention: migration 172's cleanup_old_jobs handler
--     already calls pruneOldJobLogs(7) monthly (lib/jobs/handlers.ts).
--
-- NOT included here (live one-off maintenance operations, not schema DDL —
-- cannot run inside a migration transaction, and this codebase's own
-- established convention, migration 042's header comment, is that anything
-- touching the `cron`/`net` schemas is a runtime step, not a migration,
-- since CI's plain Postgres has neither extension installed):
--   - VACUUM FULL net._http_response (critical, table-bloat) — needs an
--     owner/superuser-equivalent session; attempted live separately.
--   - cron.job_run_details: DELETE rows older than 7 days, VACUUM FULL,
--     and a new nightly cron.schedule(...) job to keep it pruned — done
--     live separately, documented in DEPLOY.md alongside the existing
--     cron.schedule(...) entries, matching migration 042's convention.
--
-- Deliberately NOT included (needs a product decision, not a mechanical
-- fix, or is itself a "don't chase this metric" finding with no action):
--   - Dropping the 4 confirmed-dead tables (contact_submissions,
--     newsletter_subscribers, platform_billing, platform_notifications) —
--     platform_notifications in particular has the undocumented-drift
--     history documented in migration 173's header; dropping a table
--     outright is a one-way door that deserves its own pass, not a line
--     item here.
--   - "481 unused indexes" headline (low, metric-reframing) — the finding's
--     own conclusion is that this isn't a real target; the two real
--     droppable sets it identifies (migration 121's dead FK indexes, the
--     12 duplicate pairs) are exactly items 2-3 below.
-- =============================================================================

-- ── 1. email_logs has no (status, created_at) index ────────────────────────
-- Confirmed live: real production query (status='failed', 7-day window) is
-- forced onto idx_email_logs_group_id with a Filter + top-N heapsort.
-- pg_stat_statements: 28,125+ calls, ~38ms mean, ~18 cumulative minutes and
-- rising. Backs the email_retry_failed job's scan (lib/services/
-- scheduler.service.ts).
CREATE INDEX IF NOT EXISTS idx_email_logs_status_created_at
  ON public.email_logs (status, created_at);

-- ── 2. 56 of migration 121's 60 unindexed-FK indexes have never been
--        scanned — pure write-amplification (56 B-trees maintained on every
--        write to their table for zero read benefit) ────────────────────────
-- Re-verified live immediately before writing this file: exactly 56 of the
-- 60 have idx_scan=0, 4 are genuinely used (idx_loans_guarantor_group=598,
-- idx_contributions_group_membership=153,
-- idx_reminder_dispatch_log_job_execution_id=61, idx_loans_group_membership=
-- 10) — those 4 are NOT touched here. IF EXISTS: defensive per this
-- session's own migration-173 lesson (fresh-build/live drift), though grep
-- confirms all 56 are created by migration 121 alone, never touched by any
-- other migration file.
DROP INDEX IF EXISTS public.idx_disbursement_requests_approved_by;
DROP INDEX IF EXISTS public.idx_disbursement_requests_b2c_transaction;
DROP INDEX IF EXISTS public.idx_disbursement_requests_cash_account_id;
DROP INDEX IF EXISTS public.idx_disbursement_requests_initiated_by;
DROP INDEX IF EXISTS public.idx_disbursement_requests_rejected_by;
DROP INDEX IF EXISTS public.idx_dividend_allocations_group_membership;
DROP INDEX IF EXISTS public.idx_fiscal_periods_closed_by;
DROP INDEX IF EXISTS public.idx_fiscal_periods_reopened_by;
DROP INDEX IF EXISTS public.idx_funding_programs_created_by;
DROP INDEX IF EXISTS public.idx_journal_entries_group_membership_id;
DROP INDEX IF EXISTS public.idx_journal_entries_member_id;
DROP INDEX IF EXISTS public.idx_loan_repayments_group_membership;
DROP INDEX IF EXISTS public.idx_loans_defaulted_by;
DROP INDEX IF EXISTS public.idx_loans_written_off_by;
DROP INDEX IF EXISTS public.idx_member_goals_group_id;
DROP INDEX IF EXISTS public.idx_org_disbursements_approved_by;
DROP INDEX IF EXISTS public.idx_org_disbursements_created_by;
DROP INDEX IF EXISTS public.idx_org_disbursements_ledger_entry_id;
DROP INDEX IF EXISTS public.idx_org_disbursements_rejected_by;
DROP INDEX IF EXISTS public.idx_org_disbursements_wallet_id;
DROP INDEX IF EXISTS public.idx_org_journal_entries_created_by;
DROP INDEX IF EXISTS public.idx_org_journal_entries_posted_by;
DROP INDEX IF EXISTS public.idx_org_journal_entries_voided_by;
DROP INDEX IF EXISTS public.idx_org_sms_credits_added_by;
DROP INDEX IF EXISTS public.idx_org_sms_credits_billing_account_id;
DROP INDEX IF EXISTS public.idx_org_sms_credits_payment_id;
DROP INDEX IF EXISTS public.idx_organization_accounts_parent_id;
DROP INDEX IF EXISTS public.idx_organization_invitations_invited_by;
DROP INDEX IF EXISTS public.idx_organization_ledger_created_by;
DROP INDEX IF EXISTS public.idx_organization_ledger_disbursement;
DROP INDEX IF EXISTS public.idx_organization_ledger_wallet_id;
DROP INDEX IF EXISTS public.idx_organization_members_archived_by;
DROP INDEX IF EXISTS public.idx_organization_members_invited_by;
DROP INDEX IF EXISTS public.idx_payment_events_actor;
DROP INDEX IF EXISTS public.idx_payment_realloc_approved_by;
DROP INDEX IF EXISTS public.idx_payment_realloc_from_group_membership_id;
DROP INDEX IF EXISTS public.idx_payment_realloc_from_member_id;
DROP INDEX IF EXISTS public.idx_payment_realloc_initiated_by;
DROP INDEX IF EXISTS public.idx_payment_realloc_new_journal_entry_id;
DROP INDEX IF EXISTS public.idx_payment_realloc_rejected_by;
DROP INDEX IF EXISTS public.idx_payment_realloc_reversal_journal_entry_id;
DROP INDEX IF EXISTS public.idx_payment_realloc_to_group_id;
DROP INDEX IF EXISTS public.idx_payment_realloc_to_group_membership_id;
DROP INDEX IF EXISTS public.idx_payment_realloc_to_member_id;
DROP INDEX IF EXISTS public.idx_payment_requests_created_by;
DROP INDEX IF EXISTS public.idx_payment_requests_group_membership;
DROP INDEX IF EXISTS public.idx_payment_requests_member_id;
DROP INDEX IF EXISTS public.idx_payments_initiated_by;
DROP INDEX IF EXISTS public.idx_policies_created_by;
DROP INDEX IF EXISTS public.idx_refresh_tokens_membership_id;
DROP INDEX IF EXISTS public.idx_share_holdings_group_membership;
DROP INDEX IF EXISTS public.idx_share_transactions_group_membership;
DROP INDEX IF EXISTS public.idx_sms_campaigns_payer_organization_id;
DROP INDEX IF EXISTS public.idx_sms_trigger_rules_created_by;
DROP INDEX IF EXISTS public.idx_welfare_pool_contrib_group_membership;
DROP INDEX IF EXISTS public.idx_welfare_requests_group_membership;

-- ── 3. 12 pairs of exact-duplicate indexes (identical column list, same
--        partial-index predicate) maintained redundantly on every write ────
-- Re-derived live via a self-join on pg_index(indrelid, indkey, indpred),
-- independent of the audit's own list, and got the same 12 pairs. Keeping
-- the UNIQUE/PK twin in every pair (it enforces a real constraint AND
-- serves every query the plain twin could — identical column list by
-- construction); dropping the redundant plain twin. One of the 12 pairs
-- (organization_sms_credits: idx_org_sms_credits_payment_id vs
-- organization_sms_credits_payment_id_key) is already covered by item 2
-- above, so only 11 statements here.
DROP INDEX IF EXISTS public.idx_members_email;
DROP INDEX IF EXISTS public.idx_members_phone;
DROP INDEX IF EXISTS public.idx_billing_accounts_group_id;
DROP INDEX IF EXISTS public.idx_sms_credits_payment_id;
DROP INDEX IF EXISTS public.idx_sms_group_settings_group;
DROP INDEX IF EXISTS public.idx_dlr_msg_id;
DROP INDEX IF EXISTS public.idx_stk_checkout_req;
DROP INDEX IF EXISTS public.idx_b2c_originator;
DROP INDEX IF EXISTS public.idx_b2b_originator;
DROP INDEX IF EXISTS public.idx_mfa_secrets_member;
DROP INDEX IF EXISTS public.idx_cycles_group;

-- ── 4. Default autovacuum thresholds leave small hot tables permanently
--        under-vacuumed and analyze-blind ──────────────────────────────────
-- Cluster defaults (autovacuum_vacuum_scale_factor=0.2, threshold=50) mean
-- a 9-row table (groups) needs ~51.8 dead tuples before autovacuum ever
-- fires — never happens in practice, confirmed live: groups' reltuples
-- estimate is stale at 3 against 9 actual rows, autoanalyze has NEVER run,
-- and it sits on the hot path of 70k+ sequential scans. Lower, count-based
-- thresholds fix this for the tables carrying real production traffic
-- relative to their tiny size (top 20 by live seq_scan among tables with
-- 1-500 rows, confirmed live immediately before writing this migration).
--
-- relkind='r' guard: journal_lines is a PLAIN table in live prod (confirmed:
-- pg_class.relkind='r'), but migrations 094+095 make it a PARTITIONED table
-- in a fresh build (094 creates journal_lines_partitioned, 095 renames it to
-- journal_lines) — another prod/fresh-build drift case, same class as
-- migration 173's. Storage parameters can only be set on a partitioned
-- table's leaf partitions, never the partitioned table itself, so this
-- excludes relkind<>'r' rather than guessing at partition names; correct
-- regardless of which shape journal_lines has in a given environment, since
-- a partitioned table holds zero rows of its own to tune anyway.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'reminder_dispatch_log','groups','mpesa_callbacks','mpesa_stk_requests',
    'members','group_members','event_outbox','sms_failures','contributions',
    'subscriptions','billing_accounts','journal_lines',
    'group_contribution_splits','accounts','welfare_requests',
    'payment_requests','loans','journal_entries','payments',
    'welfare_pool_contributions'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relnamespace = 'public'::regnamespace AND relkind = 'r') THEN
      EXECUTE format(
        'ALTER TABLE public.%I SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 25, autovacuum_analyze_scale_factor = 0.01, autovacuum_analyze_threshold = 10)',
        t
      );
    END IF;
  END LOOP;
END $$;

-- One-off ANALYZE so the planner isn't left with stale/never-computed
-- reltuples until the new thresholds' first natural trigger. Plain ANALYZE
-- (unlike VACUUM) runs fine inside a migration.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'reminder_dispatch_log','groups','mpesa_callbacks','mpesa_stk_requests',
    'members','group_members','event_outbox','sms_failures','contributions',
    'subscriptions','billing_accounts','journal_lines',
    'group_contribution_splits','accounts','welfare_requests',
    'payment_requests','loans','journal_entries','payments',
    'welfare_pool_contributions'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relnamespace = 'public'::regnamespace) THEN
      EXECUTE format('ANALYZE public.%I', t);
    END IF;
  END LOOP;
END $$;
