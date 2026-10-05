-- Captured after the fact: this was applied directly against production on
-- 2026-09-15 to patch the migration history ledger (supabase_migrations.
-- schema_migrations), not the application schema. It backfilled ledger rows
-- for migrations 109-166 that existed in the migrations directory and were
-- genuinely applied at the time but whose ledger entries never got created,
-- and renamed one misnamed entry (fix_audit_logs_insert_policy ->
-- 114_fix_audit_logs_insert_policy). Re-added here on 2026-10-05 so the
-- local migrations directory matches production's migration history; the
-- inserts are guarded with ON CONFLICT DO NOTHING since a fresh `db reset`
-- replay already creates these same ledger rows naturally when each of the
-- 109-166 migration files runs in sequence.

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20260802000000', '109_organization_branding'),
  ('20260803000000', '110_permission_catalog_reconciliation'),
  ('20260803010000', '111_fix_refresh_tokens_updated_at_trigger'),
  ('20260803020000', '112_fines_manage_permission'),
  ('20260803030000', '113_final_batch_permissions'),
  ('20260805000000', '115_group_funding_sources'),
  ('20260806000000', '116_financial_products'),
  ('20260806010000', '117_allocation_terms'),
  ('20260806020000', '118_loan_funding_splits'),
  ('20260806070000', '123_sms_credit_reservation_and_attribution'),
  ('20260807000000', '124_sms_bundled_allowance'),
  ('20260808000000', '125_processing_fee'),
  ('20260808010000', '126_close_sms_and_outbox_postgrest_exposure'),
  ('20260809000000', '127_subscription_product'),
  ('20260809030000', '129_recover_settlement_vendor_payment_tables'),
  ('20260809040000', '130_recover_deny_all_postgrest_policies'),
  ('20260809050000', '131_recover_chairperson_rename_on_missed_policies'),
  ('20260809060000', '132_consolidate_feature_flags_policies'),
  ('20260809070000', '133_scope_outbox_policies_to_app_tenant'),
  ('20260810000000', '134_bank_accounts_settlements_service_layer'),
  ('20260815000000', '147_create_additional_group'),
  ('20260816000000', '148_loan_interest_rate_is_monthly'),
  ('20260816010000', '149_loan_repayment_frequency'),
  ('20260816020000', '150_disbursement_payment_method'),
  ('20260816030000', '151_allowance_resets_on_subscription_anniversary'),
  ('20260831000000', '159_sms_ledger_grant_hygiene'),
  ('20260901000000', '160_sms_segment_billing'),
  ('20260901010000', '161_dlr_poll_fairness'),
  ('20260901020000', '162_sms_opt_outs'),
  ('20260902000000', '163_sms_provider_health'),
  ('20260902010000', '164_org_topup_exactly_once'),
  ('20260902020000', '165_staff_alert_state'),
  ('20260902030000', '166_dlr_terminally_unknown')
ON CONFLICT (version) DO NOTHING;

UPDATE supabase_migrations.schema_migrations
SET name = '114_fix_audit_logs_insert_policy'
WHERE name = 'fix_audit_logs_insert_policy';
