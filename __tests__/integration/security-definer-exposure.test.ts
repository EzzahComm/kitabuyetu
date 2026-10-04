/**
 * SECURITY DEFINER functions must never be callable by Supabase's PostgREST
 * roles (migration 210).
 *
 * These functions run as their owner and bypass row-level security. The app
 * reaches them over its own pg pool, never through PostgREST, so `anon` and
 * `authenticated` have no legitimate reason to execute any of them. Leaving one
 * open lets anyone with the public Supabase key call it at /rest/v1/rpc/<name>
 * and skip the app's validation (register_organization and register_campaign
 * were open this way until 210; migration 107 closed three earlier ones).
 *
 * Postgres grants EXECUTE to PUBLIC on every new function, so a migration that
 * adds a SECURITY DEFINER function must REVOKE ... FROM PUBLIC, anon,
 * authenticated. Note that `REVOKE ... FROM PUBLIC` alone is not enough on a
 * real Supabase project, which also grants anon/authenticated by name; the
 * default-privilege change in 210 covers that, and this test covers the rest.
 */
import { rawQuery } from './helpers/db';

describe('SECURITY DEFINER function exposure', () => {
  it('has SECURITY DEFINER functions to check (guards against a vacuous pass)', async () => {
    const rows = await rawQuery<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef`,
    );
    expect(Number(rows[0].n)).toBeGreaterThan(0);

    const named = await rawQuery<{ proname: string }>(
      `SELECT p.proname
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef
          AND p.proname IN ('register_group', 'register_organization', 'register_campaign')`,
    );
    expect(named.map((r) => r.proname).sort()).toEqual([
      'register_campaign',
      'register_group',
      'register_organization',
    ]);
  });

  it('no SECURITY DEFINER function in public is executable by anon or authenticated', async () => {
    const exposed = await rawQuery<{ fn: string; anon: boolean; authenticated: boolean }>(
      `SELECT p.oid::regprocedure::text AS fn,
              has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef
          AND (has_function_privilege('anon', p.oid, 'EXECUTE')
               OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
        ORDER BY 1`,
    );
    expect(exposed).toEqual([]);
  });
});
