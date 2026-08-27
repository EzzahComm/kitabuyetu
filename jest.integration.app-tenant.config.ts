import type { Config } from 'jest';
import nextJest from 'next/jest.js';

// Same next/jest wrapper as jest.integration.config.ts. Split into its own
// config (rather than folded into that one) so this suite only ever runs
// when TENANT_DATABASE_URL points at the least-privileged `app_tenant` role
// — against the plain BYPASSRLS admin superuser these tests would trivially
// "pass" for the wrong reason. See jest.integration.config.ts's
// testPathIgnorePatterns for the other half of that split.
const createJestConfig = nextJest({ dir: './' });

const config: Config = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/integration/app-tenant/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // Real Postgres, same reasoning as jest.integration.config.ts — Jest's 5s
  // default is a unit-test budget and these are not unit tests. Kept in step
  // with that config deliberately: these two suites differ only in which role
  // they connect as, so a timeout that is right for one is right for the other.
  testTimeout: 30_000,
};

export default createJestConfig(config);
