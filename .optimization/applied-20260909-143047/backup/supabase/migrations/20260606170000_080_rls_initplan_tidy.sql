-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260606170000  name: 080_rls_initplan_tidy
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

ALTER POLICY rls_group_contribution_splits_group ON public.group_contribution_splits
  USING ((group_id)::text = (SELECT current_setting('app.current_group_id', true)));

ALTER POLICY rls_mpesa_charges_group ON public.mpesa_charges
  USING ((group_id)::text = (SELECT current_setting('app.current_group_id', true)));

ALTER POLICY rls_mpesa_qr_codes_group ON public.mpesa_qr_codes
  USING ((group_id)::text = (SELECT current_setting('app.current_group_id', true)));

ALTER POLICY rls_charge_tiers_write ON public.mpesa_b2c_charge_tiers
  USING ((SELECT current_setting('app.current_role', true)) = 'super_admin');

ALTER POLICY rls_mpesa_unrouted_group ON public.mpesa_unrouted
  USING (
        (candidate_group_id)::text   = (SELECT current_setting('app.current_group_id', true))
     OR (resolved_to_group_id)::text = (SELECT current_setting('app.current_group_id', true))
     OR (SELECT current_setting('app.current_role', true)) = ANY (ARRAY['super_admin','support'])
  );
