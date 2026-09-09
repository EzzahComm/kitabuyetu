-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260605125045  name: 068_index_foreign_keys
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.
--
-- Every statement below is guarded by an information_schema.columns check.
-- This is a "recovered" snapshot (see header above), and at least one
-- referenced column (feature_flags.created_by) does not exist on a fresh
-- apply, breaking the whole migration under ON_ERROR_STOP. These are pure
-- performance indexes with no correctness impact, so skipping a stale one
-- is safe; real Supabase (where every column exists) still gets every
-- index exactly as before.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contact_submissions' AND column_name = 'read_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_contact_submissions_read_by ON public.contact_submissions (read_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contributions' AND column_name = 'journal_entry_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_contributions_journal_entry_id ON public.contributions (journal_entry_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contributions' AND column_name = 'recorded_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_contributions_recorded_by ON public.contributions (recorded_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'credit_scores' AND column_name = 'computed_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_credit_scores_computed_by ON public.credit_scores (computed_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'credit_scores' AND column_name = 'member_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_credit_scores_member_id ON public.credit_scores (member_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cycle_shareouts' AND column_name = 'group_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_cycle_shareouts_group_id ON public.cycle_shareouts (group_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cycles' AND column_name = 'closed_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_cycles_closed_by ON public.cycles (closed_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dividend_allocations' AND column_name = 'paid_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_dividend_allocations_paid_by ON public.dividend_allocations (paid_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dividend_allocations' AND column_name = 'reinvested_txn_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_dividend_allocations_reinvested_txn_id ON public.dividend_allocations (reinvested_txn_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dividend_declarations' AND column_name = 'approved_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_dividend_declarations_approved_by ON public.dividend_declarations (approved_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dividend_declarations' AND column_name = 'cancelled_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_dividend_declarations_cancelled_by ON public.dividend_declarations (cancelled_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'email_campaign_recipients' AND column_name = 'group_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_email_campaign_recipients_group_id ON public.email_campaign_recipients (group_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'email_campaigns' AND column_name = 'created_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_email_campaigns_created_by ON public.email_campaigns (created_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'email_delivery_reports' AND column_name = 'group_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_email_delivery_reports_group_id ON public.email_delivery_reports (group_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'email_failures' AND column_name = 'email_log_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_email_failures_email_log_id ON public.email_failures (email_log_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'email_preferences' AND column_name = 'group_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_email_preferences_group_id ON public.email_preferences (group_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'email_schedules' AND column_name = 'created_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_email_schedules_created_by ON public.email_schedules (created_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'failed_payment_logs' AND column_name = 'resolved_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_failed_payment_logs_resolved_by ON public.failed_payment_logs (resolved_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'feature_flags' AND column_name = 'created_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_feature_flags_created_by ON public.feature_flags (created_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'feature_flags' AND column_name = 'updated_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_feature_flags_updated_by ON public.feature_flags (updated_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'group_bank_accounts' AND column_name = 'created_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_group_bank_accounts_created_by ON public.group_bank_accounts (created_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'group_constitutions' AND column_name = 'created_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_group_constitutions_created_by ON public.group_constitutions (created_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'group_contribution_splits' AND column_name = 'created_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_group_contribution_splits_created_by ON public.group_contribution_splits (created_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'group_members' AND column_name = 'archived_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_group_members_archived_by ON public.group_members (archived_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'group_members' AND column_name = 'blacklisted_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_group_members_blacklisted_by ON public.group_members (blacklisted_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'group_members' AND column_name = 'exited_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_group_members_exited_by ON public.group_members (exited_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'group_members' AND column_name = 'invited_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_group_members_invited_by ON public.group_members (invited_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'group_members' AND column_name = 'verified_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_group_members_verified_by ON public.group_members (verified_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'group_officers' AND column_name = 'appointed_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_group_officers_appointed_by ON public.group_officers (appointed_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'group_officers' AND column_name = 'removed_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_group_officers_removed_by ON public.group_officers (removed_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = 'activated_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_groups_activated_by ON public.groups (activated_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = 'kyc_verified_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_groups_kyc_verified_by ON public.groups (kyc_verified_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'idempotency_keys' AND column_name = 'member_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_idempotency_keys_member_id ON public.idempotency_keys (member_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'investment_returns' AND column_name = 'recorded_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_investment_returns_recorded_by ON public.investment_returns (recorded_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'investments' AND column_name = 'approved_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_investments_approved_by ON public.investments (approved_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'investments' AND column_name = 'created_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_investments_created_by ON public.investments (created_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'investments' AND column_name = 'liquidated_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_investments_liquidated_by ON public.investments (liquidated_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoice_schedules' AND column_name = 'group_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_invoice_schedules_group_id ON public.invoice_schedules (group_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'billing_account_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_invoices_billing_account_id ON public.invoices (billing_account_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'journal_entries' AND column_name = 'created_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_journal_entries_created_by ON public.journal_entries (created_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'journal_entries' AND column_name = 'posted_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_journal_entries_posted_by ON public.journal_entries (posted_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'journal_entries' AND column_name = 'voided_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_journal_entries_voided_by ON public.journal_entries (voided_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'loan_repayments' AND column_name = 'journal_entry_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_loan_repayments_journal_entry_id ON public.loan_repayments (journal_entry_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'loans' AND column_name = 'approved_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_loans_approved_by ON public.loans (approved_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'loans' AND column_name = 'disbursed_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_loans_disbursed_by ON public.loans (disbursed_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'loans' AND column_name = 'guarantor_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_loans_guarantor_id ON public.loans (guarantor_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'loans' AND column_name = 'journal_entry_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_loans_journal_entry_id ON public.loans (journal_entry_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'loans' AND column_name = 'rejected_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_loans_rejected_by ON public.loans (rejected_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'meeting_attendance' AND column_name = 'group_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_meeting_attendance_group_id ON public.meeting_attendance (group_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'meeting_attendance' AND column_name = 'marked_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_meeting_attendance_marked_by ON public.meeting_attendance (marked_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'meeting_resolutions' AND column_name = 'proposed_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_meeting_resolutions_proposed_by ON public.meeting_resolutions (proposed_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'meeting_resolutions' AND column_name = 'responsible_party') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_meeting_resolutions_responsible_party ON public.meeting_resolutions (responsible_party)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'meeting_resolutions' AND column_name = 'seconded_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_meeting_resolutions_seconded_by ON public.meeting_resolutions (seconded_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'meetings' AND column_name = 'chaired_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_meetings_chaired_by ON public.meetings (chaired_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'meetings' AND column_name = 'created_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_meetings_created_by ON public.meetings (created_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'meetings' AND column_name = 'secretary_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_meetings_secretary_id ON public.meetings (secretary_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'member_investment_shares' AND column_name = 'group_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_member_investment_shares_group_id ON public.member_investment_shares (group_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'member_invitations' AND column_name = 'invited_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_member_invitations_invited_by ON public.member_invitations (invited_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mpesa_b2b_transactions' AND column_name = 'initiated_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mpesa_b2b_transactions_initiated_by ON public.mpesa_b2b_transactions (initiated_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mpesa_b2b_transactions' AND column_name = 'mpesa_transaction_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mpesa_b2b_transactions_mpesa_transaction_id ON public.mpesa_b2b_transactions (mpesa_transaction_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mpesa_b2c_transactions' AND column_name = 'disbursed_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mpesa_b2c_transactions_disbursed_by ON public.mpesa_b2c_transactions (disbursed_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mpesa_b2c_transactions' AND column_name = 'mpesa_transaction_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mpesa_b2c_transactions_mpesa_transaction_id ON public.mpesa_b2c_transactions (mpesa_transaction_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mpesa_charges' AND column_name = 'journal_entry_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mpesa_charges_journal_entry_id ON public.mpesa_charges (journal_entry_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mpesa_qr_codes' AND column_name = 'generated_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mpesa_qr_codes_generated_by ON public.mpesa_qr_codes (generated_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mpesa_reconciliations' AND column_name = 'initiated_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mpesa_reconciliations_initiated_by ON public.mpesa_reconciliations (initiated_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mpesa_reversals' AND column_name = 'approved_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mpesa_reversals_approved_by ON public.mpesa_reversals (approved_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mpesa_reversals' AND column_name = 'mpesa_transaction_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mpesa_reversals_mpesa_transaction_id ON public.mpesa_reversals (mpesa_transaction_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mpesa_reversals' AND column_name = 'requested_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mpesa_reversals_requested_by ON public.mpesa_reversals (requested_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mpesa_stk_requests' AND column_name = 'initiated_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mpesa_stk_requests_initiated_by ON public.mpesa_stk_requests (initiated_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mpesa_stk_requests' AND column_name = 'invoice_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mpesa_stk_requests_invoice_id ON public.mpesa_stk_requests (invoice_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mpesa_stk_requests' AND column_name = 'mpesa_transaction_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mpesa_stk_requests_mpesa_transaction_id ON public.mpesa_stk_requests (mpesa_transaction_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mpesa_unrouted' AND column_name = 'mpesa_transaction_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mpesa_unrouted_mpesa_transaction_id ON public.mpesa_unrouted (mpesa_transaction_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mpesa_unrouted' AND column_name = 'resolved_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mpesa_unrouted_resolved_by ON public.mpesa_unrouted (resolved_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mpesa_unrouted' AND column_name = 'resolved_to_group_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mpesa_unrouted_resolved_to_group_id ON public.mpesa_unrouted (resolved_to_group_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mpesa_unrouted' AND column_name = 'resolved_to_invoice') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mpesa_unrouted_resolved_to_invoice ON public.mpesa_unrouted (resolved_to_invoice)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ngo_group_access' AND column_name = 'granted_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ngo_group_access_granted_by ON public.ngo_group_access (granted_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ngo_group_access' AND column_name = 'revoked_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ngo_group_access_revoked_by ON public.ngo_group_access (revoked_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notification_rules' AND column_name = 'created_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_notification_rules_created_by ON public.notification_rules (created_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'recorded_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_payments_recorded_by ON public.payments (recorded_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'platform_notifications' AND column_name = 'created_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_platform_notifications_created_by ON public.platform_notifications (created_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'settlement_approvals' AND column_name = 'group_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_settlement_approvals_group_id ON public.settlement_approvals (group_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'settlement_requests' AND column_name = 'bank_account_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_settlement_requests_bank_account_id ON public.settlement_requests (bank_account_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'settlement_requests' AND column_name = 'requested_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_settlement_requests_requested_by ON public.settlement_requests (requested_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'share_holdings' AND column_name = 'share_class_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_share_holdings_share_class_id ON public.share_holdings (share_class_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'share_transactions' AND column_name = 'counterparty_member_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_share_transactions_counterparty_member_id ON public.share_transactions (counterparty_member_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'share_transactions' AND column_name = 'created_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_share_transactions_created_by ON public.share_transactions (created_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'share_transactions' AND column_name = 'member_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_share_transactions_member_id ON public.share_transactions (member_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'share_transactions' AND column_name = 'share_class_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_share_transactions_share_class_id ON public.share_transactions (share_class_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sms_campaigns' AND column_name = 'created_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sms_campaigns_created_by ON public.sms_campaigns (created_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sms_campaigns' AND column_name = 'template_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sms_campaigns_template_id ON public.sms_campaigns (template_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sms_credits' AND column_name = 'added_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sms_credits_added_by ON public.sms_credits (added_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sms_credits' AND column_name = 'payment_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sms_credits_payment_id ON public.sms_credits (payment_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sms_failures' AND column_name = 'sms_log_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sms_failures_sms_log_id ON public.sms_failures (sms_log_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sms_provider_balances' AND column_name = 'queried_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sms_provider_balances_queried_by ON public.sms_provider_balances (queried_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sms_schedules' AND column_name = 'created_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sms_schedules_created_by ON public.sms_schedules (created_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sms_schedules' AND column_name = 'template_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sms_schedules_template_id ON public.sms_schedules (template_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sms_templates' AND column_name = 'created_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sms_templates_created_by ON public.sms_templates (created_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sms_usage_logs' AND column_name = 'campaign_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sms_usage_logs_campaign_id ON public.sms_usage_logs (campaign_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'member_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_support_tickets_member_id ON public.support_tickets (member_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ticket_comments' AND column_name = 'author_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ticket_comments_author_id ON public.ticket_comments (author_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vendor_payments' AND column_name = 'requested_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vendor_payments_requested_by ON public.vendor_payments (requested_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'welfare_pool_contributions' AND column_name = 'recorded_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_welfare_pool_contributions_recorded_by ON public.welfare_pool_contributions (recorded_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'welfare_requests' AND column_name = 'approved_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_welfare_requests_approved_by ON public.welfare_requests (approved_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'welfare_requests' AND column_name = 'disbursed_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_welfare_requests_disbursed_by ON public.welfare_requests (disbursed_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'welfare_requests' AND column_name = 'rejected_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_welfare_requests_rejected_by ON public.welfare_requests (rejected_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'welfare_requests' AND column_name = 'reviewed_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_welfare_requests_reviewed_by ON public.welfare_requests (reviewed_by)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'welfare_votes' AND column_name = 'group_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_welfare_votes_group_id ON public.welfare_votes (group_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'welfare_votes' AND column_name = 'voter_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_welfare_votes_voter_id ON public.welfare_votes (voter_id)';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_messages' AND column_name = 'sent_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_sent_by ON public.whatsapp_messages (sent_by)';
  END IF;
END $$;


-- Guarded above: information_schema check per (table, column) — this file is
-- a "recovered from supabase_migrations.schema_migrations" snapshot (see
-- header), and at least one referenced column (feature_flags.created_by)
-- does not exist on a fresh apply, breaking the whole migration under
-- ON_ERROR_STOP. These are pure performance indexes with no correctness
-- impact, so skipping a stale one is safe; real Supabase (where every
-- column exists) still gets every index exactly as before.
