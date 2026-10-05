-- =============================================================================
-- 211: Remove anonymous campaign registration.
--
-- register_campaign() (migration 208) let someone with no Kitabu Yetu account
-- create a brand-new group, with themselves as its only officer, and a campaign
-- in one call. That is the wrong shape for money that has to be released with
-- sign-off from three different offices of the group (migration 212): a
-- one-person group can never satisfy that, and a throwaway group created for a
-- single fundraiser has no standing behind the money it raises.
--
-- Campaigns now belong to an existing, registered group that has an active
-- chairperson, treasurer and secretary (lib/services/campaign-officers.service.ts),
-- and are created from that group's own dashboard. The public route, the page
-- that called it and the validator are removed in the same change.
--
-- Existing campaigns created through the old path are untouched.
-- =============================================================================

DROP FUNCTION IF EXISTS public.register_campaign(jsonb);
