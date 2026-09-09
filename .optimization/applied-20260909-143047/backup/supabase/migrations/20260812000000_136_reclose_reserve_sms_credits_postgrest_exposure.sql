-- =============================================================================
-- 136: Re-close the reserve_sms_credits PostgREST exposure (regression of 126)
--
-- Migration 126 (2026-08-08) revoked EXECUTE on reserve_sms_credits from
-- authenticated/anon: it's SECURITY DEFINER, owned by postgres, with no
-- internal authorization check, callable via POST /rest/v1/rpc/... by any
-- self-registered Supabase Auth user (disable_signup=false on this project),
-- completely bypassing the app's own custom-JWT auth layer.
--
-- Migration 127 (2026-08-09, PR #45) redefined this function to fix a
-- billing bug (unqualified SELECT INTO picking an arbitrary subscription
-- row) and copied its GRANT EXECUTE ... TO authenticated line from the
-- earlier migrations 123/124 instead of 126's revoke -- CREATE OR REPLACE
-- doesn't preserve prior REVOKEs, so this silently reintroduced the exact
-- exposure 126 closed. Caught via a routine get_advisors(security) check
-- 2026-08-12, ~1 day after PR #45 merged. auth.users confirmed still 0 rows
-- -- no evidence of actual exploitation, but the window was live.
--
-- Applied directly to production first (2026-08-12, verified via
-- get_advisors: zero findings remain), then shipped through the normal
-- migration/PR/CI path here so a fresh build replays identically.
--
-- settle_sms_credit_reservation was NOT affected (never re-granted).
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.reserve_sms_credits(TEXT, UUID, UUID, INTEGER)
  FROM authenticated;

COMMENT ON FUNCTION public.reserve_sms_credits(TEXT, UUID, UUID, INTEGER) IS
  'SECURITY DEFINER, no internal auth check -- trusts the caller-supplied '
  'group_id/organization_id completely. Must NEVER be reachable by anon or '
  'authenticated via PostgREST (self-registered Supabase Auth users would '
  'bypass this app''s custom-JWT auth entirely). If you CREATE OR REPLACE '
  'this function, you drop its grants back to default -- re-run the REVOKE '
  'from migrations 126/136, do not copy the GRANT from an older migration.';
