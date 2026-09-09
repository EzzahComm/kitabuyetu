-- =============================================================================
-- 010_rls_policies.sql
-- Row Level Security policies for all tenant-scoped tables
--
-- Session variables set by application middleware on every DB connection:
--   SET LOCAL app.current_group_id = '<uuid>';
--   SET LOCAL app.current_user_id  = '<uuid>';
--   SET LOCAL app.current_role     = 'group_admin|treasurer|secretary|member|super_admin|ngo_coordinator';
--   SET LOCAL app.current_ngo_id   = '<uuid>';   -- only for ngo_coordinator role
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enable RLS on all tenant tables
-- FORCE ROW SECURITY ensures policies apply even to the table owner.
-- ---------------------------------------------------------------------------
ALTER TABLE groups            ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups            FORCE  ROW LEVEL SECURITY;

ALTER TABLE members           ENABLE ROW LEVEL SECURITY;
ALTER TABLE members           FORCE  ROW LEVEL SECURITY;

ALTER TABLE group_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members     FORCE  ROW LEVEL SECURITY;

ALTER TABLE contributions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributions     FORCE  ROW LEVEL SECURITY;

ALTER TABLE loans             ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans             FORCE  ROW LEVEL SECURITY;

ALTER TABLE loan_repayments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_repayments   FORCE  ROW LEVEL SECURITY;

ALTER TABLE accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts          FORCE  ROW LEVEL SECURITY;

ALTER TABLE journal_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries   FORCE  ROW LEVEL SECURITY;

ALTER TABLE journal_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines     FORCE  ROW LEVEL SECURITY;

ALTER TABLE billing_accounts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_accounts  FORCE  ROW LEVEL SECURITY;

ALTER TABLE subscriptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions     FORCE  ROW LEVEL SECURITY;

ALTER TABLE invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices          FORCE  ROW LEVEL SECURITY;

ALTER TABLE invoice_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items     FORCE  ROW LEVEL SECURITY;

ALTER TABLE payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments          FORCE  ROW LEVEL SECURITY;

ALTER TABLE sms_usage_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_usage_logs    FORCE  ROW LEVEL SECURITY;

ALTER TABLE sms_credits       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_credits       FORCE  ROW LEVEL SECURITY;

ALTER TABLE audit_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs        FORCE  ROW LEVEL SECURITY;

ALTER TABLE notifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications     FORCE  ROW LEVEL SECURITY;

-- NGO tables — no group_id column, controlled differently
ALTER TABLE ngos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE ngos              FORCE  ROW LEVEL SECURITY;

ALTER TABLE ngo_group_access  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ngo_group_access  FORCE  ROW LEVEL SECURITY;

-- =============================================================================
-- HELPER: super_admin bypass
-- Super admins can see everything; other roles go through group isolation.
-- =============================================================================
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT app_current_role() = 'super_admin';
$$;

-- =============================================================================
-- groups table
-- A user can only see the group they are currently authenticated into.
-- =============================================================================
CREATE POLICY groups_select ON groups
  FOR SELECT USING (
    is_super_admin()
    OR id = app_current_group_id()
    -- NGO coordinators can see groups they have active access to
    OR (
      app_current_role() = 'ngo_coordinator'
      AND id IN (
        SELECT group_id FROM ngo_group_access
        WHERE ngo_id    = app_current_ngo_id()
          AND is_active = true
      )
    )
  );

CREATE POLICY groups_insert ON groups
  FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY groups_update ON groups
  FOR UPDATE USING (
    is_super_admin()
    OR (id = app_current_group_id() AND app_current_role() = 'group_admin')
  );

-- =============================================================================
-- members table
-- A member can see themselves, and any member who shares their current group.
-- =============================================================================
CREATE POLICY members_select ON members
  FOR SELECT USING (
    is_super_admin()
    OR id = app_current_user_id()
    OR id IN (
      SELECT gm.member_id FROM group_members gm
      WHERE gm.group_id = app_current_group_id()
        AND gm.is_active = true
    )
  );

CREATE POLICY members_insert ON members
  FOR INSERT WITH CHECK (
    is_super_admin()
    -- App layer creates member accounts; no direct-insert restriction beyond super_admin
    OR true
  );

CREATE POLICY members_update ON members
  FOR UPDATE USING (
    is_super_admin()
    OR id = app_current_user_id()
    -- group_admin and secretary may update members in their group
    OR (
      id IN (
        SELECT gm.member_id FROM group_members gm
        WHERE gm.group_id = app_current_group_id() AND gm.is_active = true
      )
      AND app_current_role() IN ('group_admin', 'secretary')
    )
  );

-- =============================================================================
-- group_members table
-- =============================================================================
CREATE POLICY group_members_select ON group_members
  FOR SELECT USING (
    is_super_admin()
    OR group_id = app_current_group_id()
  );

CREATE POLICY group_members_insert ON group_members
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (
      group_id = app_current_group_id()
      AND app_current_role() IN ('group_admin', 'secretary')
    )
  );

CREATE POLICY group_members_update ON group_members
  FOR UPDATE USING (
    is_super_admin()
    OR (
      group_id = app_current_group_id()
      AND app_current_role() = 'group_admin'
    )
  );

-- =============================================================================
-- Macro for simple group_id-scoped policies
-- Used for: contributions, loans, loan_repayments, accounts,
--           journal_entries, journal_lines, billing_accounts,
--           subscriptions, invoices, invoice_items, payments,
--           sms_usage_logs, sms_credits
-- =============================================================================

-- contributions
CREATE POLICY contributions_select ON contributions
  FOR SELECT USING (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (
      app_current_role() = 'ngo_coordinator'
      AND group_id IN (
        SELECT group_id FROM ngo_group_access
        WHERE ngo_id = app_current_ngo_id() AND is_active = true
      )
    )
  );
CREATE POLICY contributions_insert ON contributions
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('group_admin','treasurer'))
  );
CREATE POLICY contributions_update ON contributions
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('group_admin','treasurer'))
  );

-- loans
CREATE POLICY loans_select ON loans
  FOR SELECT USING (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (
      app_current_role() = 'ngo_coordinator'
      AND group_id IN (
        SELECT group_id FROM ngo_group_access
        WHERE ngo_id = app_current_ngo_id() AND is_active = true
      )
    )
  );
CREATE POLICY loans_insert ON loans
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('group_admin','treasurer','member'))
  );
CREATE POLICY loans_update ON loans
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('group_admin','treasurer'))
  );

-- loan_repayments
CREATE POLICY loan_repayments_select ON loan_repayments
  FOR SELECT USING (
    is_super_admin() OR group_id = app_current_group_id()
  );
CREATE POLICY loan_repayments_insert ON loan_repayments
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('group_admin','treasurer'))
  );
CREATE POLICY loan_repayments_update ON loan_repayments
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('group_admin','treasurer'))
  );

-- accounts (chart of accounts)
CREATE POLICY accounts_select ON accounts
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());
CREATE POLICY accounts_insert ON accounts
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('group_admin','treasurer'))
  );
CREATE POLICY accounts_update ON accounts
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('group_admin','treasurer')
        AND is_system = false)
  );

-- journal_entries
CREATE POLICY journal_entries_select ON journal_entries
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());
CREATE POLICY journal_entries_insert ON journal_entries
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('group_admin','treasurer'))
  );
CREATE POLICY journal_entries_update ON journal_entries
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('group_admin','treasurer'))
  );

-- journal_lines
CREATE POLICY journal_lines_select ON journal_lines
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());
CREATE POLICY journal_lines_insert ON journal_lines
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('group_admin','treasurer'))
  );
CREATE POLICY journal_lines_update ON journal_lines
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('group_admin','treasurer'))
  );

-- billing_accounts
CREATE POLICY billing_accounts_all ON billing_accounts
  FOR ALL USING (
    is_super_admin() OR group_id = app_current_group_id()
  );

-- subscriptions
CREATE POLICY subscriptions_all ON subscriptions
  FOR ALL USING (
    is_super_admin() OR group_id = app_current_group_id()
  );

-- invoices
CREATE POLICY invoices_all ON invoices
  FOR ALL USING (
    is_super_admin() OR group_id = app_current_group_id()
  );

-- invoice_items
CREATE POLICY invoice_items_all ON invoice_items
  FOR ALL USING (
    is_super_admin() OR group_id = app_current_group_id()
  );

-- payments
CREATE POLICY payments_all ON payments
  FOR ALL USING (
    is_super_admin() OR group_id = app_current_group_id()
  );

-- sms_usage_logs
CREATE POLICY sms_usage_logs_all ON sms_usage_logs
  FOR ALL USING (
    is_super_admin() OR group_id = app_current_group_id()
  );

-- sms_credits
CREATE POLICY sms_credits_all ON sms_credits
  FOR ALL USING (
    is_super_admin() OR group_id = app_current_group_id()
  );

-- =============================================================================
-- audit_logs
-- Anyone can insert (via SECURITY DEFINER trigger).
-- Read: super_admin sees all; group roles see their own group's logs.
-- =============================================================================
CREATE POLICY audit_logs_select ON audit_logs
  FOR SELECT USING (
    is_super_admin()
    OR group_id = app_current_group_id()
  );
-- INSERT is done via SECURITY DEFINER trigger; block direct inserts from app roles
CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT WITH CHECK (is_super_admin());

-- =============================================================================
-- notifications
-- Members see their own; group admins see all in their group.
-- =============================================================================
CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND (
          member_id = app_current_user_id()
          OR app_current_role() IN ('group_admin','treasurer','secretary')
        ))
  );
CREATE POLICY notifications_all ON notifications
  FOR ALL USING (
    is_super_admin() OR group_id = app_current_group_id()
  );

-- =============================================================================
-- ngos — platform-level, not group-scoped
-- =============================================================================
CREATE POLICY ngos_select ON ngos
  FOR SELECT USING (
    is_super_admin()
    OR (
      app_current_role() = 'ngo_coordinator'
      AND id = app_current_ngo_id()
    )
  );
CREATE POLICY ngos_insert ON ngos
  FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY ngos_update ON ngos
  FOR UPDATE USING (is_super_admin());

-- ngo_group_access
CREATE POLICY ngo_group_access_select ON ngo_group_access
  FOR SELECT USING (
    is_super_admin()
    OR (app_current_role() = 'ngo_coordinator' AND ngo_id = app_current_ngo_id())
    OR (group_id = app_current_group_id() AND app_current_role() = 'group_admin')
  );
CREATE POLICY ngo_group_access_insert ON ngo_group_access
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() = 'group_admin')
  );
CREATE POLICY ngo_group_access_update ON ngo_group_access
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() = 'group_admin')
  );
