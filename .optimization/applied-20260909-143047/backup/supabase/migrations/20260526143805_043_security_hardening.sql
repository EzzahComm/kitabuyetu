-- =============================================================================
-- 043_security_hardening.sql
--
-- Closes three findings from `mcp get_advisors security` (2026-05-26):
--
-- 1. public.trg_share_txn_immutable() had a mutable search_path. Since it
--    runs as SECURITY DEFINER, an unpinned search_path is a privilege
--    escalation vector — an attacker who controls a schema higher in the
--    path could swap in a malicious table that the trigger writes through.
--    Pin to public.
--
-- 2. public.allocate_share_certificate_serial(uuid, text) was reachable
--    via PostgREST RPC by anon + authenticated. It's an internal helper
--    used by the shares pipeline to allocate gapless certificate serials;
--    no external caller should hit it. Revoke EXECUTE.
--
-- 3. public.trg_apply_share_txn() is a TRIGGER function that was also
--    reachable as RPC. Trigger functions expect NEW/OLD records and crash
--    when invoked outside a trigger context, but their presence in the
--    API surface is noise we don't want. Revoke EXECUTE.
--
-- register_group(jsonb) is intentionally callable by anon — that's the
-- registration entry point for unauthenticated users.
-- =============================================================================

ALTER FUNCTION public.trg_share_txn_immutable() SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.allocate_share_certificate_serial(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.allocate_share_certificate_serial(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.allocate_share_certificate_serial(uuid, text) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.trg_apply_share_txn() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_apply_share_txn() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_apply_share_txn() FROM authenticated;
