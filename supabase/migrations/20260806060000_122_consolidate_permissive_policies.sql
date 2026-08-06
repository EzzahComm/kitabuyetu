-- ─────────────────────────────────────────────────────────────────────────────
-- 122: consolidate multiple-permissive-RLS-policies on 21 tables
-- (DB_PERFORMANCE_ADVISOR_AUDIT_2026-08.md F1, Phase 1 of 2)
--
-- 25 tables were flagged by Supabase's performance advisor: each has a broad
-- `FOR SELECT` policy plus a narrower `FOR ALL` policy, both PERMISSIVE, for
-- the same role. Postgres OR-evaluates every permissive policy that applies
-- to a query, so every SELECT against these tables paid for two policy
-- evaluations where one would do.
--
-- FIX SHAPE: Postgres's CREATE POLICY `FOR` clause takes exactly one command
-- (confirmed live: `FOR INSERT, UPDATE, DELETE` is a syntax error) — so
-- "stop the FOR ALL policy from also applying to SELECT" requires splitting
-- it into three single-command policies (FOR INSERT/UPDATE/DELETE), each
-- carrying the exact same condition the FOR ALL policy had. This is
-- behaviour-preserving: the FOR SELECT sibling never applied to
-- INSERT/UPDATE/DELETE anyway, so those three commands are governed by
-- exactly the same logic as before — they just no longer also (redundantly)
-- apply to SELECT, which the broader sibling policy already governs alone.
-- Verified against real production inside BEGIN...ROLLBACK before shipping.
--
-- 4 of the 25 tables (feature_flags, platform_notifications,
-- meeting_attendance, meeting_resolutions) are DELIBERATELY EXCLUDED from
-- this migration: their live production policies don't match what any
-- migration ever created (undocumented RLS-policy drift — meeting_attendance
-- and meeting_resolutions each have a redundant duplicate policy live that a
-- fresh build never creates at all). See DB_PERFORMANCE_ADVISOR_AUDIT_2026-08.md
-- for the writeup; fixing those needs its own defensive migration checking
-- which name variant actually exists, not this one.
--
-- Every USING/WITH CHECK expression below wraps bare is_super_admin()/
-- app_current_role()/app_current_group_id()/app_current_organization_id()
-- calls in (SELECT ...), matching this codebase's established initplan-safe
-- convention (044, 080, 097, and this session's own migration 120).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ GROUP 1a — Shape A (group-scoped, role-gated write): 14 tables ═══════════
-- select policy untouched in every one of these; only the modify policy splits.

-- share_transactions
DROP POLICY share_txn_modify ON public.share_transactions;
CREATE POLICY share_txn_insert ON public.share_transactions FOR INSERT WITH CHECK (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);
CREATE POLICY share_txn_update ON public.share_transactions FOR UPDATE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);
CREATE POLICY share_txn_delete ON public.share_transactions FOR DELETE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);

-- share_holdings
DROP POLICY share_holdings_modify ON public.share_holdings;
CREATE POLICY share_holdings_insert ON public.share_holdings FOR INSERT WITH CHECK (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);
CREATE POLICY share_holdings_update ON public.share_holdings FOR UPDATE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);
CREATE POLICY share_holdings_delete ON public.share_holdings FOR DELETE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);

-- share_classes
DROP POLICY share_classes_modify ON public.share_classes;
CREATE POLICY share_classes_insert ON public.share_classes FOR INSERT WITH CHECK (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);
CREATE POLICY share_classes_update ON public.share_classes FOR UPDATE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);
CREATE POLICY share_classes_delete ON public.share_classes FOR DELETE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);

-- share_certificate_counters
DROP POLICY share_counters_modify ON public.share_certificate_counters;
CREATE POLICY share_counters_insert ON public.share_certificate_counters FOR INSERT WITH CHECK (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);
CREATE POLICY share_counters_update ON public.share_certificate_counters FOR UPDATE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);
CREATE POLICY share_counters_delete ON public.share_certificate_counters FOR DELETE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);

-- next_of_kin
DROP POLICY next_of_kin_modify ON public.next_of_kin;
CREATE POLICY next_of_kin_insert ON public.next_of_kin FOR INSERT WITH CHECK (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'secretary'))
);
CREATE POLICY next_of_kin_update ON public.next_of_kin FOR UPDATE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'secretary'))
);
CREATE POLICY next_of_kin_delete ON public.next_of_kin FOR DELETE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'secretary'))
);

-- member_invitations
DROP POLICY member_invitations_modify ON public.member_invitations;
CREATE POLICY member_invitations_insert ON public.member_invitations FOR INSERT WITH CHECK (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer', 'secretary'))
);
CREATE POLICY member_invitations_update ON public.member_invitations FOR UPDATE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer', 'secretary'))
);
CREATE POLICY member_invitations_delete ON public.member_invitations FOR DELETE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer', 'secretary'))
);

-- import_jobs
DROP POLICY import_jobs_modify ON public.import_jobs;
CREATE POLICY import_jobs_insert ON public.import_jobs FOR INSERT WITH CHECK (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'secretary', 'treasurer'))
);
CREATE POLICY import_jobs_update ON public.import_jobs FOR UPDATE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'secretary', 'treasurer'))
);
CREATE POLICY import_jobs_delete ON public.import_jobs FOR DELETE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'secretary', 'treasurer'))
);

-- group_officers (single-role check, not an IN list — unlike its siblings)
DROP POLICY group_officers_modify ON public.group_officers;
CREATE POLICY group_officers_insert ON public.group_officers FOR INSERT WITH CHECK (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) = 'chairperson')
);
CREATE POLICY group_officers_update ON public.group_officers FOR UPDATE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) = 'chairperson')
);
CREATE POLICY group_officers_delete ON public.group_officers FOR DELETE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) = 'chairperson')
);

-- dividend_declarations
DROP POLICY dividend_decl_modify ON public.dividend_declarations;
CREATE POLICY dividend_decl_insert ON public.dividend_declarations FOR INSERT WITH CHECK (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);
CREATE POLICY dividend_decl_update ON public.dividend_declarations FOR UPDATE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);
CREATE POLICY dividend_decl_delete ON public.dividend_declarations FOR DELETE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);

-- dividend_allocations
DROP POLICY dividend_alloc_modify ON public.dividend_allocations;
CREATE POLICY dividend_alloc_insert ON public.dividend_allocations FOR INSERT WITH CHECK (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);
CREATE POLICY dividend_alloc_update ON public.dividend_allocations FOR UPDATE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);
CREATE POLICY dividend_alloc_delete ON public.dividend_allocations FOR DELETE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);

-- cycles
DROP POLICY cycles_modify ON public.cycles;
CREATE POLICY cycles_insert ON public.cycles FOR INSERT WITH CHECK (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);
CREATE POLICY cycles_update ON public.cycles FOR UPDATE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);
CREATE POLICY cycles_delete ON public.cycles FOR DELETE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);

-- cycle_shareouts
DROP POLICY shareouts_modify ON public.cycle_shareouts;
CREATE POLICY shareouts_insert ON public.cycle_shareouts FOR INSERT WITH CHECK (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);
CREATE POLICY shareouts_update ON public.cycle_shareouts FOR UPDATE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);
CREATE POLICY shareouts_delete ON public.cycle_shareouts FOR DELETE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);

-- credit_scores
DROP POLICY credit_scores_modify ON public.credit_scores;
CREATE POLICY credit_scores_insert ON public.credit_scores FOR INSERT WITH CHECK (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);
CREATE POLICY credit_scores_update ON public.credit_scores FOR UPDATE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);
CREATE POLICY credit_scores_delete ON public.credit_scores FOR DELETE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
);

-- whatsapp_messages
DROP POLICY whatsapp_messages_modify ON public.whatsapp_messages;
CREATE POLICY whatsapp_messages_insert ON public.whatsapp_messages FOR INSERT WITH CHECK (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer', 'secretary'))
);
CREATE POLICY whatsapp_messages_update ON public.whatsapp_messages FOR UPDATE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer', 'secretary'))
);
CREATE POLICY whatsapp_messages_delete ON public.whatsapp_messages FOR DELETE USING (
  (SELECT is_super_admin()) OR (group_id = (SELECT app_current_group_id()) AND (SELECT app_current_role()) IN ('chairperson', 'treasurer', 'secretary'))
);

-- ═══ GROUP 1b — Shape C (global reference data, admin-only write): 4 tables ═══
-- select policy is unconditional `true` in every one of these, untouched.

-- counties
DROP POLICY counties_modify_super_only ON public.counties;
CREATE POLICY counties_insert ON public.counties FOR INSERT WITH CHECK ((SELECT is_super_admin()));
CREATE POLICY counties_update ON public.counties FOR UPDATE USING ((SELECT is_super_admin()));
CREATE POLICY counties_delete ON public.counties FOR DELETE USING ((SELECT is_super_admin()));

-- sub_counties
DROP POLICY sub_counties_modify_super_only ON public.sub_counties;
CREATE POLICY sub_counties_insert ON public.sub_counties FOR INSERT WITH CHECK ((SELECT is_super_admin()));
CREATE POLICY sub_counties_update ON public.sub_counties FOR UPDATE USING ((SELECT is_super_admin()));
CREATE POLICY sub_counties_delete ON public.sub_counties FOR DELETE USING ((SELECT is_super_admin()));

-- wards
DROP POLICY wards_modify_super_only ON public.wards;
CREATE POLICY wards_insert ON public.wards FOR INSERT WITH CHECK ((SELECT is_super_admin()));
CREATE POLICY wards_update ON public.wards FOR UPDATE USING ((SELECT is_super_admin()));
CREATE POLICY wards_delete ON public.wards FOR DELETE USING ((SELECT is_super_admin()));

-- mpesa_b2c_charge_tiers (write condition already initplan-wrapped by migration 080)
DROP POLICY rls_charge_tiers_write ON public.mpesa_b2c_charge_tiers;
CREATE POLICY rls_charge_tiers_insert ON public.mpesa_b2c_charge_tiers FOR INSERT WITH CHECK (
  (SELECT current_setting('app.current_role', TRUE)) = 'super_admin'
);
CREATE POLICY rls_charge_tiers_update ON public.mpesa_b2c_charge_tiers FOR UPDATE USING (
  (SELECT current_setting('app.current_role', TRUE)) = 'super_admin'
);
CREATE POLICY rls_charge_tiers_delete ON public.mpesa_b2c_charge_tiers FOR DELETE USING (
  (SELECT current_setting('app.current_role', TRUE)) = 'super_admin'
);

-- ═══ GROUP 2 — redundant duplicate policy: 1 table ═════════════════════════════
-- idempotency_keys_select (FOR SELECT) and idempotency_keys_modify (FOR ALL)
-- have the IDENTICAL condition (is_super_admin() OR member_id = app_current_user_id()).
-- The FOR ALL policy already covers SELECT identically — _select is pure dead
-- weight. Just drop it; idempotency_keys_modify is untouched.
DROP POLICY idempotency_keys_select ON public.idempotency_keys;

-- ═══ GROUP 3 — merge + split, two different SELECT-worthy access axes: 2 tables ═
-- These have two policies granting SELECT via genuinely different conditions
-- (not one broad + one narrow of the same axis), so the fix merges both into
-- one FOR SELECT policy (preserves the exact union of who could read before)
-- before splitting the write-only policy as in Groups 1a/1b.

-- organization_disbursements: org-coordinator (organization_id) axis +
-- group-member (group_id) axis, no role check on the group axis. Validated
-- end-to-end against production inside BEGIN...ROLLBACK during planning.
DROP POLICY organization_disbursements_all ON public.organization_disbursements;
DROP POLICY organization_disbursements_group_select ON public.organization_disbursements;

CREATE POLICY organization_disbursements_select ON public.organization_disbursements FOR SELECT USING (
  (SELECT is_super_admin())
  OR ((SELECT app_current_role()) = 'organization_coordinator' AND organization_id = (SELECT app_current_organization_id()))
  OR group_id = (SELECT app_current_group_id())
);
CREATE POLICY organization_disbursements_insert ON public.organization_disbursements FOR INSERT WITH CHECK (
  (SELECT is_super_admin())
  OR ((SELECT app_current_role()) = 'organization_coordinator' AND organization_id = (SELECT app_current_organization_id()))
);
CREATE POLICY organization_disbursements_update ON public.organization_disbursements FOR UPDATE USING (
  (SELECT is_super_admin())
  OR ((SELECT app_current_role()) = 'organization_coordinator' AND organization_id = (SELECT app_current_organization_id()))
);
CREATE POLICY organization_disbursements_delete ON public.organization_disbursements FOR DELETE USING (
  (SELECT is_super_admin())
  OR ((SELECT app_current_role()) = 'organization_coordinator' AND organization_id = (SELECT app_current_organization_id()))
);

-- sms_usage_logs: group-member axis (no role check, previously FOR ALL) +
-- org-payer axis (organization_coordinator whose org paid for the group's
-- SMS, previously SELECT-only — stays SELECT-only here too, an org
-- coordinator has no business writing another group's SMS usage rows).
DROP POLICY sms_usage_logs_all ON public.sms_usage_logs;
DROP POLICY sms_usage_logs_org_payer_select ON public.sms_usage_logs;

CREATE POLICY sms_usage_logs_select ON public.sms_usage_logs FOR SELECT USING (
  (SELECT is_super_admin())
  OR group_id = (SELECT app_current_group_id())
  OR ((SELECT app_current_role()) = 'organization_coordinator' AND payer_organization_id = (SELECT app_current_organization_id()))
);
CREATE POLICY sms_usage_logs_insert ON public.sms_usage_logs FOR INSERT WITH CHECK (
  (SELECT is_super_admin()) OR group_id = (SELECT app_current_group_id())
);
CREATE POLICY sms_usage_logs_update ON public.sms_usage_logs FOR UPDATE USING (
  (SELECT is_super_admin()) OR group_id = (SELECT app_current_group_id())
);
CREATE POLICY sms_usage_logs_delete ON public.sms_usage_logs FOR DELETE USING (
  (SELECT is_super_admin()) OR group_id = (SELECT app_current_group_id())
);
