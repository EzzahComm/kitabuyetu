import type { Config } from 'jest';
import nextJest from 'next/jest.js';

// Same next/jest wrapper as jest.config.ts — needed so `next/server`'s
// NextRequest resolves correctly in the Node test environment, and so
// .env.test is loaded the same way Next.js itself loads it.
const createJestConfig = nextJest({ dir: './' });

const config: Config = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.integration.setup.ts'],
  testMatch: ['<rootDir>/__tests__/integration/**/*.test.ts'],
  // app-tenant/ has its own config (jest.integration.app-tenant.config.ts) and
  // must never run under this one: it proves RLS enforcement under the
  // least-privileged `app_tenant` role specifically, and would trivially
  // "pass" for the wrong reason against the plain BYPASSRLS admin pool this
  // config's tests otherwise run under.
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/__tests__/integration/app-tenant/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // These hit a real Postgres instance and mutate real rows — no coverage
  // thresholds, and run serially (see package.json's --runInBand) rather
  // than adding transaction-rollback isolation plumbing.
  //
  // Jest's default 5s is a unit-test budget, and these are not unit tests: a
  // single case here can reset tables, seed a group with members, and make
  // several round trips to a real database, all while --runInBand queues it
  // behind every other suite. On a loaded CI runner that legitimately exceeds
  // 5s, and the failure reads "Exceeded timeout of 5000 ms" — indistinguishable
  // from a genuine hang.
  //
  // That produced four separate false CI failures on unrelated PRs (#115,
  // #119, #120, #122), every one of them organization-plans.test.ts, every one
  // green on a rerun with nothing changed. Each cost a round of "is this real
  // or flaky?" against a diff that had never touched the code. 30s is the same
  // budget the local runbook already tells you to pass by hand.
  testTimeout: 30_000,
};

export default createJestConfig(config);
