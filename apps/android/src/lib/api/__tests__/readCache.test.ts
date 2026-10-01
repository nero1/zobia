import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import {
  READ_CACHE_POLICIES,
  invalidateReadCache,
  isCacheableRead,
  isWriteRequest,
  withReadCache,
} from '@/lib/api/readCache';

function cfg(url: string, method = 'get', auth = 'Bearer a', params?: Record<string, unknown>): InternalAxiosRequestConfig {
  return { url, method, params, headers: { Authorization: auth } } as unknown as InternalAxiosRequestConfig;
}

function ok(data: unknown, config: InternalAxiosRequestConfig): AxiosResponse {
  return { data, status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse;
}

beforeEach(() => {
  invalidateReadCache();
  vi.useRealTimers();
});

describe('isCacheableRead', () => {
  it('accepts listed GETs and only the allowed query strings', () => {
    expect(isCacheableRead(cfg('/users/me'))).toBe(true);
    expect(isCacheableRead(cfg('/ads/serve?placement=home_top'))).toBe(true);
    expect(isCacheableRead(cfg('/users/me', 'put'))).toBe(false);
    expect(isCacheableRead(cfg('/users/me?x=1'))).toBe(false);
    expect(isCacheableRead(cfg('/users/me', 'get', 'Bearer a', { x: 1 }))).toBe(false);
    expect(isCacheableRead(cfg('/feed'))).toBe(false);
  });

  it('classifies writes', () => {
    expect(isWriteRequest(cfg('/x', 'post'))).toBe(true);
    expect(isWriteRequest(cfg('/x', 'get'))).toBe(false);
  });
});

describe('withReadCache', () => {
  it('dedupes concurrent reads and reuses within the TTL', async () => {
    const base = vi.fn(async (c: InternalAxiosRequestConfig) => ok({ user: { id: 'u1' } }, c));
    const adapter = withReadCache(base);
    const [a, b] = await Promise.all([adapter(cfg('/users/me')), adapter(cfg('/users/me'))]);
    await adapter(cfg('/users/me'));
    expect(base).toHaveBeenCalledTimes(1);
    expect(a.data).toEqual({ user: { id: 'u1' } });
    // Copies: mutating one caller's data never touches another's.
    (a.data as { user: { id: string } }).user.id = 'changed';
    expect((b.data as { user: { id: string } }).user.id).toBe('u1');
  });

  it('expires after the policy TTL', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const base = vi.fn(async (c: InternalAxiosRequestConfig) => ok({}, c));
    const adapter = withReadCache(base);
    await adapter(cfg('/users/me'));
    vi.setSystemTime(1_000_000 + READ_CACHE_POLICIES['/users/me'].ttlMs + 1);
    await adapter(cfg('/users/me'));
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('never shares answers between different tokens', async () => {
    const base = vi.fn(async (c: InternalAxiosRequestConfig) => ok({ who: c.headers.Authorization }, c));
    const adapter = withReadCache(base);
    const a = await adapter(cfg('/users/me', 'get', 'Bearer a'));
    const b = await adapter(cfg('/users/me', 'get', 'Bearer b'));
    expect(a.data).toEqual({ who: 'Bearer a' });
    expect(b.data).toEqual({ who: 'Bearer b' });
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('does not store an answer that was in flight during invalidation', async () => {
    let release!: (r: AxiosResponse) => void;
    const slow = vi.fn((c: InternalAxiosRequestConfig) => new Promise<AxiosResponse>((res) => { release = () => res(ok({ coins: 10 }, c)); }));
    const pending = withReadCache(slow)(cfg('/users/me'));
    invalidateReadCache();
    release(undefined as unknown as AxiosResponse);
    expect((await pending).data).toEqual({ coins: 10 });
    const fresh = vi.fn(async (c: InternalAxiosRequestConfig) => ok({ coins: 5 }, c));
    expect((await withReadCache(fresh)(cfg('/users/me'))).data).toEqual({ coins: 5 });
    expect(fresh).toHaveBeenCalledTimes(1);
  });
});
