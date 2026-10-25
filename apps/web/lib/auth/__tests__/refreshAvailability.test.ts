const mockFetch = jest.fn();
const mockExpired = jest.fn();
jest.mock("@/lib/auth/sessionExpiredBus", () => ({
  rawFetch: (...args: unknown[]) => mockFetch(...args),
  markSessionExpired: () => mockExpired(),
}));
jest.mock("@/lib/auth/sessionExpiryBus", () => ({
  setSessionExpiresAt: jest.fn(),
}));
import {
  refreshSession,
  SessionRefreshUnavailableError,
} from "../refreshSession";
import { authFetch } from "@/lib/api/authFetch";
const response = (status: number) =>
  new Response(JSON.stringify({}), {
    status,
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset();
  mockExpired.mockClear();
});
afterEach(() => jest.useRealTimers());
it("does not expire a browser session when refresh authority stays unavailable, and permits recovery", async () => {
  mockFetch.mockImplementation(async (path: string) =>
    response(path === "/api/private" ? 401 : 503),
  );
  const pending = authFetch("/api/private");
  const assertion = expect(pending).rejects.toBeInstanceOf(
    SessionRefreshUnavailableError,
  );
  await jest.runAllTimersAsync();
  await assertion;
  expect(mockExpired).not.toHaveBeenCalled();
  mockFetch.mockResolvedValueOnce(response(200));
  await expect(refreshSession()).resolves.toBe(true);
});
it("still reports a definitive rejected refresh as expired", async () => {
  mockFetch.mockResolvedValue(response(401));
  const result = await authFetch("/api/private");
  expect(result.status).toBe(401);
  expect(mockExpired).toHaveBeenCalledTimes(1);
});
it("retries rate limiting and in-progress responses with one shared bounded refresh", async () => {
  mockFetch
    .mockResolvedValueOnce(response(401))
    .mockResolvedValueOnce(response(429))
    .mockResolvedValueOnce(response(409))
    .mockResolvedValueOnce(response(200));
  const first = refreshSession(),
    second = refreshSession();
  expect(second).toBe(first);
  await jest.runAllTimersAsync();
  await expect(first).resolves.toBe(true);
  expect(mockFetch).toHaveBeenCalledTimes(4);
  expect(mockExpired).not.toHaveBeenCalled();
});

it('falls back to per-tab renewal if the browser denies the Web Locks API',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');const lock=jest.fn().mockRejectedValue(new Error('Lock API denied'));
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:lock}}});
 mockFetch.mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200));
 try{await expect(refreshSession()).resolves.toBe(true);expect(lock).toHaveBeenCalledTimes(1);expect(mockExpired).not.toHaveBeenCalled();}
 finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete (globalThis as unknown as {navigator?:unknown}).navigator;}
});
