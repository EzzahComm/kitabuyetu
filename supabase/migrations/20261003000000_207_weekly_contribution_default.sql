-- =============================================================================
-- 207: Default weekly contribution target — KES 200/week, platform-wide
--
-- Every new group starts with NO contribution_plan configured (contribution-
-- plan.service.ts's DEFAULT_PLAN is {monthlyContribution: 0, welfareAmount: 0}
-- — "0 means this group doesn't track that obligation"), so the existing
-- monthly arrears reminder (notify_contribution_reminders) simply excludes
-- any group that has never configured one. That is correct for the MONTHLY
-- reminder, but the new WEEKLY savings-update reminder is meant to reach
-- every member of every group, which means every group needs SOME baseline
-- expectation to measure "outstanding" against, even if nobody ever visited
-- the treasury settings page.
--
-- This is a SEPARATE policy domain from 'contribution_plan' (deliberately —
-- see lib/services/contribution-plan.service.ts's own header on why 0 there
-- means "untracked", not "free"), resolved through the existing Configuration
-- Service cascade (configuration.service.ts's resolvePolicy/setPolicy):
-- group override > organization > this platform-wide seed > the hardcoded
-- {weeklyContribution: 0} fallback in code (which should never actually be
-- reached once this row exists). A group can still set its own weekly target
-- later without any schema change — it just writes a group-scoped row at the
-- same (domain, policy_key), which the resolver already prefers.
--
-- 200 is a product decision, not a technical one — kept here as a single
-- platform-wide row specifically so it is "revisable by admins" (per the
-- request) via an UPDATE through setPolicy, not a code deploy.
-- =============================================================================

INSERT INTO policies (domain, policy_key, value, version)
VALUES ('weekly_contribution_default', 'amount', '{"weeklyContribution": 200}'::jsonb, 1)
ON CONFLICT DO NOTHING;
