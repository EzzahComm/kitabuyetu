-- =============================================================================
-- 058_registry_rls_hardening.sql
-- Tightens the RLS policies created in 056/057.
--
-- Migrations 056/057 added permissive branches — `USING (true)` on
-- membership_no_counters / event_outbox / payment_events INSERT, and
-- `app_current_group_id() IS NULL → allow` branches on payment_accounts /
-- payment_reallocations — under the assumption the app's admin paths needed
-- them. They don't: the application pool role (`postgres`) has BYPASSRLS, and
-- register_group() is SECURITY DEFINER (owner = postgres). RLS on these tables
-- exists solely to fence off the PostgREST roles (`anon`/`authenticated`),
-- which hold default table grants — so a NULL-context-allows branch is exactly
-- backwards: PostgREST sessions ARE the NULL-context sessions.
--
-- After this migration the non-bypass posture is:
--   membership_no_counters  — no policies (deny all): pure allocator plumbing
--   event_outbox            — no policies (deny all): pure dispatcher plumbing
--   payment_events          — SELECT scoped to the tenant's group; no writes
--   payment_accounts        — SELECT/INSERT scoped to the tenant's group;
--                             UPDATE super_admin only
--   payment_reallocations   — SELECT/INSERT scoped to the tenant's group
--
-- (Scoped tenant branches are kept for a future non-BYPASSRLS tenant role;
-- they are inert for PostgREST sessions, which have no group context.)
-- =============================================================================

-- ─── membership_no_counters: deny-all for non-bypass roles ───────────────────
DROP POLICY membership_no_counters_all ON membership_no_counters;

-- ─── event_outbox: deny-all for non-bypass roles ─────────────────────────────
DROP POLICY event_outbox_all ON event_outbox;

-- ─── payment_events: read-only, group-scoped; no non-bypass writes ───────────
DROP POLICY payment_events_insert ON payment_events;
DROP POLICY payment_events_select ON payment_events;

CREATE POLICY payment_events_select ON payment_events
  FOR SELECT USING (
    is_super_admin()
    OR payment_id IN (SELECT id FROM payments
                      WHERE group_id = (SELECT app_current_group_id()))
  );

-- ─── payment_accounts: drop the NULL-context branches ────────────────────────
DROP POLICY payment_accounts_select ON payment_accounts;
DROP POLICY payment_accounts_insert ON payment_accounts;
DROP POLICY payment_accounts_update ON payment_accounts;

CREATE POLICY payment_accounts_select ON payment_accounts
  FOR SELECT USING (
    is_super_admin()
    OR membership_id IN (SELECT id FROM group_members
                         WHERE group_id = (SELECT app_current_group_id()))
    OR invoice_id IN (SELECT id FROM invoices
                      WHERE group_id = (SELECT app_current_group_id()))
  );

CREATE POLICY payment_accounts_insert ON payment_accounts
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR membership_id IN (SELECT id FROM group_members
                         WHERE group_id = (SELECT app_current_group_id()))
    OR invoice_id IN (SELECT id FROM invoices
                      WHERE group_id = (SELECT app_current_group_id()))
  );

CREATE POLICY payment_accounts_update ON payment_accounts
  FOR UPDATE USING (is_super_admin());

-- ─── payment_reallocations: drop the NULL-context branches ───────────────────
DROP POLICY payment_reallocs_select ON payment_reallocations;
DROP POLICY payment_reallocs_insert ON payment_reallocations;

CREATE POLICY payment_reallocs_select ON payment_reallocations
  FOR SELECT USING (
    is_super_admin()
    OR from_group_id = (SELECT app_current_group_id())
    OR to_group_id   = (SELECT app_current_group_id())
  );

CREATE POLICY payment_reallocs_insert ON payment_reallocations
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR from_group_id = (SELECT app_current_group_id())
  );
