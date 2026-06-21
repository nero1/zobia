// Suppress env validation at module load time for unit tests.
// Modules that import @/lib/env will get a Proxy returning undefined for all
// accesses instead of throwing; real dependencies are mocked per test file.
process.env.SKIP_ENV_VALIDATION = '1';
