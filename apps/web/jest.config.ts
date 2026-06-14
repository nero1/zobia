import type { Config } from 'jest';

const isIntegration = process.env.INTEGRATION === '1' ||
  (process.argv.some(a => a.includes('integration')));

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@zobia/types$': '<rootDir>/../../shared/types/index.ts',
  },
  testMatch: isIntegration
    ? ['**/__tests__/integration/**/*.test.ts']
    : [
        '**/__tests__/**/*.test.ts',
        '**/*.test.ts',
        '<rootDir>/../../security-tests/**/*.test.ts',
      ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.next/',
    '/e2e/',
    // Exclude integration tests from default unit test run unless INTEGRATION=1
    ...(isIntegration ? [] : ['/__tests__/integration/']),
  ],
  collectCoverageFrom: ['lib/**/*.ts', '!lib/**/*.d.ts', '!lib/**/__tests__/**'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  // Integration tests need more time for DB operations
  testTimeout: isIntegration ? 60_000 : 30_000,
  // Integration tests must run serially to avoid transaction isolation issues
  ...(isIntegration ? { maxWorkers: 1, runInBand: true } : {}),
};

export default config;
