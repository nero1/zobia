import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@zobia/types$': '<rootDir>/../../shared/types/index.ts',
  },
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/*.test.ts',
    '<rootDir>/../../security-tests/**/*.test.ts',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/e2e/'],
  collectCoverageFrom: ['lib/**/*.ts', '!lib/**/*.d.ts', '!lib/**/__tests__/**'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  testTimeout: 30_000,
};

export default config;
