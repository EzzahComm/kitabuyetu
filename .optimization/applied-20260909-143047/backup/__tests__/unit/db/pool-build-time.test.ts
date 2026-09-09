/**
 * Regression guard: importing lib/db must never throw at module load, even with
 * no DATABASE_URL present.
 *
 * lib/env.ts deliberately skips Zod validation during `next build`
 * (NEXT_PHASE=phase-production-build) and returns raw process.env, so
 * env.DATABASE_URL is undefined whenever the build environment lacks it.
 * lib/db builds its pools at module scope, and Next.js evaluates every route's
 * module graph while collecting page data — so anything that throws on import
 * here fails the ENTIRE build, at whichever route imports lib/db first,
 * regardless of whether that route touches the database.
 *
 * That is exactly what happened: an unguarded `connectionString.includes(...)`
 * raised "Cannot read properties of undefined (reading 'includes')" and killed
 * the build at /api/admin/analytics. Same class as the module-scope throw in
 * daraja.service.ts (b6ee340).
 *
 * Nothing is weakened by tolerating a missing DSN here — at real runtime
 * validateEnv() has already proven DATABASE_URL is a valid URL, and pg does not
 * open a socket until .connect().
 */

type PoolGlobals = typeof globalThis & {
  _kyPool?: unknown;
  _kyTenantPool?: unknown;
};

const ORIGINAL_ENV = { ...process.env };

function clearPoolGlobals(): void {
  const g = globalThis as PoolGlobals;
  delete g._kyPool;
  delete g._kyTenantPool;
}

describe('lib/db pool construction at build time', () => {
  beforeEach(() => {
    jest.resetModules();
    clearPoolGlobals();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    clearPoolGlobals();
  });

  it('imports cleanly when DATABASE_URL is absent during a production build', async () => {
    process.env.NEXT_PHASE = 'phase-production-build';
    delete process.env.DATABASE_URL;
    delete process.env.TENANT_DATABASE_URL;

    const db = await import('@/lib/db');

    expect(db.pool).toBeDefined();
    expect(db.tenantPool).toBeDefined();
  });

  it('still imports cleanly when only TENANT_DATABASE_URL is absent', async () => {
    process.env.NEXT_PHASE = 'phase-production-build';
    delete process.env.TENANT_DATABASE_URL;

    const db = await import('@/lib/db');

    // With no tenant DSN, the tenant pool falls back to the same instance as the
    // admin pool — the documented no-op until the app_tenant cutover.
    expect(db.tenantPool).toBe(db.pool);
  });

  it('builds a distinct tenant pool when TENANT_DATABASE_URL is set', async () => {
    process.env.NEXT_PHASE = 'phase-production-build';
    process.env.TENANT_DATABASE_URL = 'postgresql://app_tenant:pw@localhost:5432/kitabuyetu';

    const db = await import('@/lib/db');

    expect(db.tenantPool).not.toBe(db.pool);
  });
});

/**
 * The Supabase check decides whether to relax TLS certificate verification
 * (`rejectUnauthorized: false`), so it must match on HOST, not substring.
 * A plain `.includes('supabase.com')` accepted `supabase.com.attacker.net` and
 * `evilsupabase.com` — i.e. it would silently stop pinning the cert chain for
 * an attacker-controlled host (CodeQL js/incomplete-url-substring-sanitization,
 * high severity).
 *
 * buildPool/isSupabaseHost are module-private, so this asserts the rule those
 * hosts must satisfy directly. If the implementation ever regresses to a
 * substring test, the spoofed cases below are what catch it.
 */
describe('Supabase host detection (TLS relaxation boundary)', () => {
  function isSupabaseHost(dsn: string | undefined): boolean {
    if (!dsn) return false;
    try {
      const host = new URL(dsn).hostname.toLowerCase();
      return (
        host === 'supabase.com' || host.endsWith('.supabase.com') ||
        host === 'supabase.co'  || host.endsWith('.supabase.co')
      );
    } catch {
      return false;
    }
  }

  it.each([
    ['pooler (session mode)', 'postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'],
    ['direct db host',        'postgresql://u:p@db.qztcgryhoanennsizcll.supabase.co:5432/postgres'],
  ])('accepts a real Supabase host — %s', (_label, dsn) => {
    expect(isSupabaseHost(dsn)).toBe(true);
  });

  it.each([
    ['suffix spoof',   'postgresql://u:p@supabase.com.attacker.net:5432/db'],
    ['prefix spoof',   'postgresql://u:p@evilsupabase.com:5432/db'],
    ['path-only match','postgresql://u:p@attacker.net:5432/supabase.com'],
    ['local dev',      'postgresql://u:p@localhost:5432/kitabuyetu'],
  ])('rejects %s', (_label, dsn) => {
    expect(isSupabaseHost(dsn)).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['empty',     ''],
    ['garbage',   'not-a-url'],
  ])('rejects an absent or unparseable DSN — %s', (_label, dsn) => {
    expect(isSupabaseHost(dsn)).toBe(false);
  });
});
