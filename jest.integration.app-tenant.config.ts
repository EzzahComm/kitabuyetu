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
};

export default createJestConfig(config);
