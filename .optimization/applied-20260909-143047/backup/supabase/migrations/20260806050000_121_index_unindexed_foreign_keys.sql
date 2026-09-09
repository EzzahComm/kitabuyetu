-- ─────────────────────────────────────────────────────────────────────────────
-- 121: cover the 60 unindexed foreign keys found by DB_PERFORMANCE_ADVISOR_AUDIT_2026-08.md (F2)
--
-- Every FK constraint below has no index starting with its own column(s), so
-- every referencing-row lookup (joins on the FK column, and the referential-
-- integrity check Postgres runs on the parent row's UPDATE/DELETE) is a
-- sequential scan of the child table. Purely additive — CREATE INDEX IF NOT
-- EXISTS, no RLS/behaviour change, matches this migration file's own naming
-- precedent (migration 068's idx_<table>_<column> pattern).
--
-- Composite FKs (the "membership" family — contributions, dividend_allocations,
-- loan_repayments, loans' fk_loans_membership, payment_requests, share_holdings,
-- share_transactions, welfare_pool_contributions, welfare_requests) all share
-- the identical 3-column shape (group_membership_id, group_id, member_id) in
-- that order — one composite index per table, matching the FK's own column
-- order, covers the whole constraint. `loans`' guarantor FK is a separate
-- 2-column composite (group_id, guarantor_id). Everything else here is a
-- single-column FK.
-- ─────────────────────────────────────────────────────────────────────────────

-- disbursement_requests (5)
CREATE INDEX IF NOT EXISTS idx_disbursement_requests_approved_by     ON public.disbursement_requests (approved_by);
CREATE INDEX IF NOT EXISTS idx_disbursement_requests_cash_account_id ON public.disbursement_requests (cash_account_id);
CREATE INDEX IF NOT EXISTS idx_disbursement_requests_initiated_by    ON public.disbursement_requests (initiated_by);
CREATE INDEX IF NOT EXISTS idx_disbursement_requests_rejected_by     ON public.disbursement_requests (rejected_by);
CREATE INDEX IF NOT EXISTS idx_disbursement_requests_b2c_transaction ON public.disbursement_requests (b2c_transaction_id);

-- dividend_allocations (1, composite)
CREATE INDEX IF NOT EXISTS idx_dividend_allocations_group_membership ON public.dividend_allocations (group_membership_id, group_id, member_id);

-- fiscal_periods (2)
CREATE INDEX IF NOT EXISTS idx_fiscal_periods_closed_by   ON public.fiscal_periods (closed_by);
CREATE INDEX IF NOT EXISTS idx_fiscal_periods_reopened_by ON public.fiscal_periods (reopened_by);

-- funding_programs (1)
CREATE INDEX IF NOT EXISTS idx_funding_programs_created_by ON public.funding_programs (created_by);

-- journal_entries (2)
CREATE INDEX IF NOT EXISTS idx_journal_entries_group_membership_id ON public.journal_entries (group_membership_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_member_id           ON public.journal_entries (member_id);

-- loan_repayments (1, composite)
CREATE INDEX IF NOT EXISTS idx_loan_repayments_group_membership ON public.loan_repayments (group_membership_id, group_id, member_id);

-- loans (4: 2 composite + 2 single-column)
CREATE INDEX IF NOT EXISTS idx_loans_guarantor_group        ON public.loans (group_id, guarantor_id);
CREATE INDEX IF NOT EXISTS idx_loans_group_membership       ON public.loans (group_membership_id, group_id, member_id);
CREATE INDEX IF NOT EXISTS idx_loans_defaulted_by            ON public.loans (defaulted_by);
CREATE INDEX IF NOT EXISTS idx_loans_written_off_by          ON public.loans (written_off_by);

-- member_goals (1)
CREATE INDEX IF NOT EXISTS idx_member_goals_group_id ON public.member_goals (group_id);

-- organization_accounts (1)
CREATE INDEX IF NOT EXISTS idx_organization_accounts_parent_id ON public.organization_accounts (parent_id);

-- organization_disbursements (5)
CREATE INDEX IF NOT EXISTS idx_org_disbursements_approved_by     ON public.organization_disbursements (approved_by);
CREATE INDEX IF NOT EXISTS idx_org_disbursements_created_by      ON public.organization_disbursements (created_by);
CREATE INDEX IF NOT EXISTS idx_org_disbursements_ledger_entry_id ON public.organization_disbursements (ledger_entry_id);
CREATE INDEX IF NOT EXISTS idx_org_disbursements_rejected_by     ON public.organization_disbursements (rejected_by);
CREATE INDEX IF NOT EXISTS idx_org_disbursements_wallet_id       ON public.organization_disbursements (wallet_id);

-- organization_invitations (1)
CREATE INDEX IF NOT EXISTS idx_organization_invitations_invited_by ON public.organization_invitations (invited_by);

-- organization_journal_entries (3)
CREATE INDEX IF NOT EXISTS idx_org_journal_entries_created_by ON public.organization_journal_entries (created_by);
CREATE INDEX IF NOT EXISTS idx_org_journal_entries_posted_by  ON public.organization_journal_entries (posted_by);
CREATE INDEX IF NOT EXISTS idx_org_journal_entries_voided_by  ON public.organization_journal_entries (voided_by);

-- organization_ledger (3)
CREATE INDEX IF NOT EXISTS idx_organization_ledger_created_by     ON public.organization_ledger (created_by);
CREATE INDEX IF NOT EXISTS idx_organization_ledger_disbursement   ON public.organization_ledger (disbursement_id);
CREATE INDEX IF NOT EXISTS idx_organization_ledger_wallet_id      ON public.organization_ledger (wallet_id);

-- organization_members (2)
CREATE INDEX IF NOT EXISTS idx_organization_members_archived_by ON public.organization_members (archived_by);
CREATE INDEX IF NOT EXISTS idx_organization_members_invited_by  ON public.organization_members (invited_by);

-- organization_sms_credits (3)
CREATE INDEX IF NOT EXISTS idx_org_sms_credits_added_by           ON public.organization_sms_credits (added_by);
CREATE INDEX IF NOT EXISTS idx_org_sms_credits_billing_account_id ON public.organization_sms_credits (billing_account_id);
CREATE INDEX IF NOT EXISTS idx_org_sms_credits_payment_id         ON public.organization_sms_credits (payment_id);

-- payment_events (1)
CREATE INDEX IF NOT EXISTS idx_payment_events_actor ON public.payment_events (actor);

-- payment_reallocations (10 — the worst offender, every FK column unindexed)
CREATE INDEX IF NOT EXISTS idx_payment_realloc_approved_by               ON public.payment_reallocations (approved_by);
CREATE INDEX IF NOT EXISTS idx_payment_realloc_from_group_membership_id  ON public.payment_reallocations (from_group_membership_id);
CREATE INDEX IF NOT EXISTS idx_payment_realloc_from_member_id            ON public.payment_reallocations (from_member_id);
CREATE INDEX IF NOT EXISTS idx_payment_realloc_initiated_by              ON public.payment_reallocations (initiated_by);
CREATE INDEX IF NOT EXISTS idx_payment_realloc_new_journal_entry_id      ON public.payment_reallocations (new_journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_payment_realloc_rejected_by               ON public.payment_reallocations (rejected_by);
CREATE INDEX IF NOT EXISTS idx_payment_realloc_reversal_journal_entry_id ON public.payment_reallocations (reversal_journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_payment_realloc_to_group_id               ON public.payment_reallocations (to_group_id);
CREATE INDEX IF NOT EXISTS idx_payment_realloc_to_group_membership_id    ON public.payment_reallocations (to_group_membership_id);
CREATE INDEX IF NOT EXISTS idx_payment_realloc_to_member_id              ON public.payment_reallocations (to_member_id);

-- payment_requests (3: 1 composite + created_by + member_id — member_id also
-- has its own single-column FK constraint separate from the composite one,
-- so it needs its own index; the composite's member_id is a non-leading
-- column and doesn't cover it)
CREATE INDEX IF NOT EXISTS idx_payment_requests_group_membership ON public.payment_requests (group_membership_id, group_id, member_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_created_by       ON public.payment_requests (created_by);
CREATE INDEX IF NOT EXISTS idx_payment_requests_member_id        ON public.payment_requests (member_id);

-- payments (1)
CREATE INDEX IF NOT EXISTS idx_payments_initiated_by ON public.payments (initiated_by);

-- policies (1)
CREATE INDEX IF NOT EXISTS idx_policies_created_by ON public.policies (created_by);

-- refresh_tokens (1)
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_membership_id ON public.refresh_tokens (membership_id);

-- reminder_dispatch_log (1)
CREATE INDEX IF NOT EXISTS idx_reminder_dispatch_log_job_execution_id ON public.reminder_dispatch_log (job_execution_id);

-- share_holdings (1, composite)
CREATE INDEX IF NOT EXISTS idx_share_holdings_group_membership ON public.share_holdings (group_membership_id, group_id, member_id);

-- share_transactions (1, composite)
CREATE INDEX IF NOT EXISTS idx_share_transactions_group_membership ON public.share_transactions (group_membership_id, group_id, member_id);

-- sms_campaigns (1)
CREATE INDEX IF NOT EXISTS idx_sms_campaigns_payer_organization_id ON public.sms_campaigns (payer_organization_id);

-- sms_trigger_rules (1)
CREATE INDEX IF NOT EXISTS idx_sms_trigger_rules_created_by ON public.sms_trigger_rules (created_by);

-- welfare_pool_contributions (1, composite)
CREATE INDEX IF NOT EXISTS idx_welfare_pool_contrib_group_membership ON public.welfare_pool_contributions (group_membership_id, group_id, member_id);

-- welfare_requests (1, composite)
CREATE INDEX IF NOT EXISTS idx_welfare_requests_group_membership ON public.welfare_requests (group_membership_id, group_id, member_id);

-- contributions (1, composite)
CREATE INDEX IF NOT EXISTS idx_contributions_group_membership ON public.contributions (group_membership_id, group_id, member_id);
