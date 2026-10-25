const mockExecute = jest.fn();
const mockLimit = jest.fn();
const mockGetDb = jest.fn();
const mockPing = jest.fn();
const mockMetrics = jest.fn();
jest.mock('@/lib/db/drizzle', () => ({ getDb: mockGetDb }));
jest.mock('@/lib/redis', () => ({ redis: { ping: mockPing } }));
jest.mock('@/lib/db/circuit', () => ({ dbCircuit: { getMetrics: mockMetrics } }));
jest.mock('@/lib/security/rateLimit', () => ({ enforceRateLimit: jest.fn(), getClientIp: () => '127.0.0.1' }));
jest.mock('@/lib/api/errors', () => ({ handleApiError: () => { throw new Error('unexpected outer error'); } }));
async function request() {
  let result!: Response;
  await jest.isolateModulesAsync(async () => {
    const { GET } = await import('@/app/api/health/route');
    result = await GET(new Request('http://localhost/api/health'));
  });
  return { status: result.status, body: await result.json() };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockExecute.mockReset().mockResolvedValue([]);
  mockLimit.mockReset().mockResolvedValue([]);
  mockGetDb.mockReset().mockResolvedValue({ execute: mockExecute, select: () => ({ from: () => ({ limit: mockLimit }) }) });
  mockPing.mockResolvedValue('PONG');
  mockMetrics.mockResolvedValue({ state: 'CLOSED', failureRate: 0 });
  process.env.JWT_SECRET = 'health-test-secret';
  process.env.DATABASE_URL = 'postgresql://fixture';
});
it('does not declare a reachable outdated database healthy', async () => {
  mockLimit.mockRejectedValueOnce({ cause: { code: '42703', message: 'private SQL params' } });
  const result = await request();
  expect(result.status).toBe(503);
  expect(result.body.checks).toMatchObject({ db: 'ok', schema: 'error', redis: 'ok' });
  expect(result.body.errors.schema).toContain('Database upgrade required');
  expect(JSON.stringify(result.body)).not.toContain('private SQL');
});
it('also catches a missing durable-task table after users passes', async () => {
  mockLimit.mockResolvedValueOnce([]).mockRejectedValueOnce({ code: '42P01' });
  expect((await request()).status).toBe(503);
  expect(mockLimit).toHaveBeenNthCalledWith(1, 0);
  expect(mockLimit).toHaveBeenNthCalledWith(2, 0);
});
it('reports ready only after auth schema and dependencies pass', async () => {
  const result = await request();
  expect(result.status).toBe(200);
  expect(result.body.checks.schema).toBe('ok');
  expect(mockLimit).toHaveBeenCalledTimes(2);
});
it('does not mislabel an unavailable database as an upgrade problem', async () => {
  mockExecute.mockRejectedValueOnce(new Error('credentials must not leak'));
  const result = await request();
  expect(result.status).toBe(503);
  expect(result.body.checks.db).toBe('error');
  expect(result.body.errors.db).toBe('Database connection failed');
  expect(mockLimit).not.toHaveBeenCalled();
});
