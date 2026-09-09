import type { Config } from 'jest';
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

const config: Config = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: [
    '<rootDir>/__tests__/**/*.test.ts',
    '<rootDir>/__tests__/**/*.test.tsx',
  ],
  // Real-Postgres integration tests run separately via `test:integration`
  // (jest.integration.config.ts) — they need a live DB, unlike this suite's
  // fake DATABASE_URL (see ci.yml).
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/__tests__/integration/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  collectCoverageFrom: [
    'lib/**/*.ts',
    '!lib/**/*.d.ts',
    '!lib/jobs/**',
    '!lib/queue/**',
  ],
  coverageReporters: ['text', 'lcov'],
  coverageThreshold: {
    global: { branches: 50, functions: 50, lines: 50, statements: 50 },
  },
};

export default createJestConfig(config);
