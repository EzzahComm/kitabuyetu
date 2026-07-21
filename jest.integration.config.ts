import type { Config } from 'jest';
import nextJest from 'next/jest.js';

// Same next/jest wrapper as jest.config.ts — needed so `next/server`'s
// NextRequest resolves correctly in the Node test environment, and so
// .env.test is loaded the same way Next.js itself loads it.
const createJestConfig = nextJest({ dir: './' });

const config: Config = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/integration/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // These hit a real Postgres instance and mutate real rows — no coverage
  // thresholds, and run serially (see package.json's --runInBand) rather
  // than adding transaction-rollback isolation plumbing.
};

export default createJestConfig(config);
