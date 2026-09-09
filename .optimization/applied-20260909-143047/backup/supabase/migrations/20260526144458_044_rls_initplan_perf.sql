-- =============================================================================
-- 044_rls_initplan_perf.sql
--
-- Wraps every RLS-policy call to app_current_*, is_super_admin, and
-- current_setting in `(select fn())`. PG's planner treats the subquery
-- as an initplan and evaluates it ONCE per query instead of per row.
--
-- Closed 57 `auth_rls_initplan` WARNs from mcp get_advisors performance
-- (475 lints → 418). Pure perf rewrite — policy SEMANTICS are unchanged.
-- The helper functions are STABLE / no-arg / no-side-effects so a
-- subselect wrap is equivalent to inlining.
--
-- Idempotent: policies already containing `SELECT app_current_…` (PG's
-- canonical form after the wrap) are skipped, so re-running this file
-- against an already-fixed schema is a no-op. Useful for local
-- `supabase db reset` runs that might pick this up after the helper
-- definitions are recreated.
-- =============================================================================

DO $migrate$
DECLARE
  r          RECORD;
  new_qual   TEXT;
  new_check  TEXT;
  stmt       TEXT;
  touched    INT := 0;
  skipped    INT := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd,
           COALESCE(qual,       '') AS qual_txt,
           COALESCE(with_check, '') AS check_txt
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (
         qual       ~ '(app_current_|is_super_admin\(|current_setting\()'
         OR with_check ~ '(app_current_|is_super_admin\(|current_setting\()'
       )
  LOOP
    IF (r.qual_txt  ~ 'SELECT (app_current_|is_super_admin|current_setting)')
    OR (r.check_txt ~ 'SELECT (app_current_|is_super_admin|current_setting)') THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;

    new_qual  := r.qual_txt;
    new_check := r.check_txt;

    new_qual  := regexp_replace(new_qual,  '\yapp_current_group_id\(\)',  '(select app_current_group_id())',  'g');
    new_qual  := regexp_replace(new_qual,  '\yapp_current_user_id\(\)',   '(select app_current_user_id())',   'g');
    new_qual  := regexp_replace(new_qual,  '\yapp_current_role\(\)',      '(select app_current_role())',      'g');
    new_qual  := regexp_replace(new_qual,  '\yapp_current_ngo_id\(\)',    '(select app_current_ngo_id())',    'g');
    new_qual  := regexp_replace(new_qual,  '\yis_super_admin\(\)',        '(select is_super_admin())',        'g');
    new_check := regexp_replace(new_check, '\yapp_current_group_id\(\)',  '(select app_current_group_id())',  'g');
    new_check := regexp_replace(new_check, '\yapp_current_user_id\(\)',   '(select app_current_user_id())',   'g');
    new_check := regexp_replace(new_check, '\yapp_current_role\(\)',      '(select app_current_role())',      'g');
    new_check := regexp_replace(new_check, '\yapp_current_ngo_id\(\)',    '(select app_current_ngo_id())',    'g');
    new_check := regexp_replace(new_check, '\yis_super_admin\(\)',        '(select is_super_admin())',        'g');

    new_qual  := regexp_replace(new_qual,  'current_setting\(([^)]*)\)', '(select current_setting(\1))', 'g');
    new_check := regexp_replace(new_check, 'current_setting\(([^)]*)\)', '(select current_setting(\1))', 'g');

    stmt := 'ALTER POLICY ' || quote_ident(r.policyname)
         || ' ON ' || quote_ident(r.schemaname) || '.' || quote_ident(r.tablename);

    IF new_qual <> '' THEN
      stmt := stmt || ' USING (' || new_qual || ')';
    END IF;
    IF new_check <> '' THEN
      stmt := stmt || ' WITH CHECK (' || new_check || ')';
    END IF;

    EXECUTE stmt;
    touched := touched + 1;
  END LOOP;

  RAISE NOTICE 'RLS initplan rewrite: % policies touched, % already-wrapped skipped',
               touched, skipped;
END $migrate$;
