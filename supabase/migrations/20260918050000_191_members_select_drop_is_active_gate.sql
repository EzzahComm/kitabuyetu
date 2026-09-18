-- 191: members_select was gated on group_members.is_active, silently
-- defeating "Send to All Members"
--
-- members_select's group-membership branch required gm.is_active = true to
-- see a member's row at all (including their phone number). But
-- resolveSmsRecipients()'s all_members query (lib/services/sms.service.ts)
-- correctly omits any is_active filter — "all_members" is supposed to mean
-- everyone, active or not. Under real RLS enforcement, the joined members
-- row was invisible anyway for a deactivated member, so the INNER JOIN
-- silently dropped them: all_members collapsed to exactly the same result
-- as active_members, no matter what the application SQL asked for.
--
-- Decided (product call, not an oversight fix like migrations 190/189): a
-- group can see/contact anyone who has ever been on its roster, regardless
-- of is_active or the richer group_members.status enum (active/suspended/
-- inactive/exited/blacklisted/archived/etc.) — drop the gate entirely rather
-- than narrow it to a status allowlist.
--
-- Surfaced by CI's "Test (tenant isolation, real Postgres, under app_tenant)"
-- phase, which only started actually exercising real RLS this session, once
-- the preceding fixes (187/188/189/190) got CI past everything before it for
-- the first time ever.
DROP POLICY IF EXISTS members_select ON members;

CREATE POLICY members_select ON members
  FOR SELECT USING (
    is_super_admin()
    OR id = app_current_user_id()
    OR id IN (
      SELECT gm.member_id FROM group_members gm
      WHERE gm.group_id = app_current_group_id()
    )
  );
