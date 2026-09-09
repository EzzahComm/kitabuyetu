-- =============================================================================
-- 096_fix_stale_group_admin_role_literals.sql
--
-- Migration 050 renamed the member_role 'group_admin' -> 'chairperson' and
-- manually recreated ~20 policies that embedded the old string literal
-- (Postgres compares app_current_role()/current_setting('app.current_role')
-- as plain TEXT against a hardcoded literal — renaming the enum label itself
-- does not touch policies written before the rename). That pass missed
-- policies added in *other* migrations (shares, dividends, credit_scores,
-- whatsapp, cycles/shareouts, member_invitations, fiscal_periods,
-- group_officers, next_of_kin, import_jobs, plus 3 direct-current_setting
-- policies on sms_provider_balances/contact_submissions/mpesa_callbacks).
--
-- Net effect until this migration: every one of these policies has been
-- silently denying chairpersons (checking for a role value the app has not
-- issued since migration 050) rather than erroring, which is why it went
-- unnoticed — the app's Postgres role has BYPASSRLS (058), so none of these
-- policies have actually been enforced against the app's own traffic yet.
-- This is a real, independent correctness bug that must be fixed regardless
-- of the app's own bypass status; found while auditing every RLS policy in
-- preparation for a future non-BYPASSRLS tenant role (see 058's own comment
-- about "a future non-BYPASSRLS tenant role").
--
-- Fix: drop and recreate each affected policy with 'chairperson' in place of
-- 'group_admin'. No other logic changes.
-- =============================================================================

-- ─── shares (036) ────────────────────────────────────────────────────────────
DROP POLICY share_classes_modify ON share_classes;
DROP POLICY share_txn_modify ON share_transactions;
DROP POLICY share_holdings_modify ON share_holdings;
DROP POLICY share_counters_modify ON share_certificate_counters;

CREATE POLICY share_classes_modify ON share_classes
  FOR ALL USING (is_super_admin() OR (group_id = app_current_group_id() AND app_current_role() IN ('chairperson', 'treasurer')));
CREATE POLICY share_txn_modify ON share_transactions
  FOR ALL USING (is_super_admin() OR (group_id = app_current_group_id() AND app_current_role() IN ('chairperson', 'treasurer')));
CREATE POLICY share_holdings_modify ON share_holdings
  FOR ALL USING (is_super_admin() OR (group_id = app_current_group_id() AND app_current_role() IN ('chairperson', 'treasurer')));
CREATE POLICY share_counters_modify ON share_certificate_counters
  FOR ALL USING (is_super_admin() OR (group_id = app_current_group_id() AND app_current_role() IN ('chairperson', 'treasurer')));

-- ─── dividends (037) ─────────────────────────────────────────────────────────
DROP POLICY dividend_decl_modify ON dividend_declarations;
DROP POLICY dividend_alloc_modify ON dividend_allocations;

CREATE POLICY dividend_decl_modify ON dividend_declarations
  FOR ALL USING (is_super_admin() OR (group_id = app_current_group_id() AND app_current_role() IN ('chairperson', 'treasurer')));
CREATE POLICY dividend_alloc_modify ON dividend_allocations
  FOR ALL USING (is_super_admin() OR (group_id = app_current_group_id() AND app_current_role() IN ('chairperson', 'treasurer')));

-- ─── credit_scores (038) ─────────────────────────────────────────────────────
DROP POLICY credit_scores_modify ON credit_scores;

CREATE POLICY credit_scores_modify ON credit_scores
  FOR ALL USING (is_super_admin() OR (group_id = app_current_group_id() AND app_current_role() IN ('chairperson', 'treasurer')));

-- ─── whatsapp_messages (039) ─────────────────────────────────────────────────
DROP POLICY whatsapp_messages_modify ON whatsapp_messages;

CREATE POLICY whatsapp_messages_modify ON whatsapp_messages
  FOR ALL USING (is_super_admin() OR (group_id = app_current_group_id() AND app_current_role() IN ('chairperson', 'treasurer', 'secretary')));

-- ─── cycles / cycle_shareouts (053) ──────────────────────────────────────────
DROP POLICY cycles_modify ON cycles;
DROP POLICY shareouts_modify ON cycle_shareouts;

CREATE POLICY cycles_modify ON cycles
  FOR ALL USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() IN ('chairperson','treasurer'))
  );
CREATE POLICY shareouts_modify ON cycle_shareouts
  FOR ALL USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() IN ('chairperson','treasurer'))
  );

-- ─── member_invitations (056) ────────────────────────────────────────────────
DROP POLICY member_invitations_modify ON member_invitations;

CREATE POLICY member_invitations_modify ON member_invitations
  FOR ALL USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() IN ('chairperson','treasurer','secretary'))
  );

-- ─── fiscal_periods (083) ────────────────────────────────────────────────────
DROP POLICY fiscal_periods_insert ON fiscal_periods;
DROP POLICY fiscal_periods_update ON fiscal_periods;

CREATE POLICY fiscal_periods_insert ON fiscal_periods
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson','treasurer'))
  );
CREATE POLICY fiscal_periods_update ON fiscal_periods
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson','treasurer'))
  );

-- ─── group_officers (030) ────────────────────────────────────────────────────
DROP POLICY group_officers_modify ON group_officers;

CREATE POLICY group_officers_modify ON group_officers
  FOR ALL USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() = 'chairperson')
  );

-- ─── next_of_kin (033) ───────────────────────────────────────────────────────
DROP POLICY next_of_kin_modify ON next_of_kin;

-- Only chairperson / secretary can modify next-of-kin records. Treasurers and
-- regular members can read (for emergency-contact lookups) but not write.
CREATE POLICY next_of_kin_modify ON next_of_kin
  FOR ALL USING (
    is_super_admin()
    OR (
      group_id = app_current_group_id()
      AND app_current_role() IN ('chairperson', 'secretary')
    )
  );

-- ─── import_jobs (035) ───────────────────────────────────────────────────────
DROP POLICY import_jobs_modify ON import_jobs;

CREATE POLICY import_jobs_modify ON import_jobs
  FOR ALL USING (
    is_super_admin()
    OR (
      group_id = app_current_group_id()
      AND app_current_role() IN ('chairperson', 'secretary', 'treasurer')
    )
  );

-- ─── sms_provider_balances (013) ─────────────────────────────────────────────
DROP POLICY rls_sms_balances_admin ON sms_provider_balances;

-- Balance: admin-only
CREATE POLICY rls_sms_balances_admin ON sms_provider_balances
  FOR ALL USING (
    current_setting('app.current_role', TRUE) IN ('super_admin','chairperson','treasurer')
  );

-- ─── contact_submissions (014) ───────────────────────────────────────────────
DROP POLICY rls_contact_subs ON contact_submissions;

-- contact_submissions: admin-only
CREATE POLICY rls_contact_subs ON contact_submissions
  FOR ALL USING (
    current_setting('app.current_role', TRUE) IN ('super_admin','chairperson')
  );

-- ─── mpesa_callbacks (012) ───────────────────────────────────────────────────
DROP POLICY rls_mpesa_callbacks_admin ON mpesa_callbacks;

-- Callbacks: admin-only (no group_id column), managed by system
CREATE POLICY rls_mpesa_callbacks_admin ON mpesa_callbacks
  FOR ALL USING (current_setting('app.current_role', TRUE) IN ('super_admin','chairperson'));
