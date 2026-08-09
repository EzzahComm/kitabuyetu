-- =============================================================================
-- 133: Scope event_outbox / membership_no_counters policies to app_tenant only
--
-- PRODUCTION_READINESS_AUDIT Pass 2: migration 126 (2026-08-08) revoked
-- anon/authenticated's table GRANTs on both tables, closing the real
-- PostgREST exposure. The RLS policy itself was left untouched — both still
-- read `FOR ALL USING (true) WITH CHECK (true)` TO public. Inert today (the
-- only 2 roles the app connects as are postgres, which BYPASSRLS skips this
-- entirely, and app_tenant, which was never granted anything extra) — but a
-- landmine with no upside: if a future migration ever re-grants table access
-- to anon/authenticated on either table (the exact mistake 126 already fixed
-- once), this policy provides zero backstop, unlike every other table in the
-- schema.
--
-- The USING(true) condition itself is correct and stays — both tables are
-- genuine cross-tenant system plumbing (event_outbox: written by tenant AND
-- admin transactions alike, no group_id to scope by; membership_no_counters:
-- a shared sequence, same reasoning) per migrations 057/056's own comments,
-- so app_tenant genuinely needs unrestricted access. What changes is WHO the
-- policy applies to: explicitly `TO app_tenant` instead of the implicit
-- PUBLIC, so a future accidental grant to anon/authenticated would not
-- resurrect the exposure — the policy simply wouldn't apply to them,
-- defaulting to deny regardless of table-level GRANT state.
-- =============================================================================

ALTER POLICY event_outbox_all ON public.event_outbox TO app_tenant;
ALTER POLICY membership_no_counters_all ON public.membership_no_counters TO app_tenant;
