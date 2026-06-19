const isIntegration = process.env.INTEGRATION === '1' ||
  (process.argv.some(a => a.includes('integration')));

/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@zobia/types$': '<rootDir>/../../shared/types/index.ts',
    '^@zobia/shared/utils$': '<rootDir>/../../shared/utils/index.ts',
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
    ...(isIntegration ? [] : ['/__tests__/integration/']),
  ],
  collectCoverageFrom: ['lib/**/*.ts', '!lib/**/*.d.ts', '!lib/**/__tests__/**'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  testTimeout: isIntegration ? 60_000 : 30_000,
  ...(isIntegration ? { maxWorkers: 1, runInBand: true } : {}),
};

module.exports = config;
