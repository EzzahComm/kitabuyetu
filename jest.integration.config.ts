import type { Config } from 'jest';
import nextJest from 'next/jest.js';

// Same next/jest wrapper as jest.config.ts — needed so `next/server`'s
// NextRequest resolves correctly in the Node test environment, and so
// .env.test is loaded the same way Next.js itself loads it.
const createJestConfig = nextJest({ dir: './' });

const config: Config = {
  testEnvironment: 'node',
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
};

export default createJestConfig(config);
