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
