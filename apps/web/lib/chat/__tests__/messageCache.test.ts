import { clearCachedMessages, readCachedMessages, writeCachedMessages } from '../messageCache';

function storage() {
  const values: Record<string, unknown> = {};
  Object.defineProperties(values, {
    getItem: { value: (key: string) => values[key] ?? null },
    setItem: { value: (key: string, value: string) => { values[key] = value; } },
    removeItem: { value: (key: string) => { delete values[key]; } },
  });
  return values as unknown as Storage;
}
const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
beforeEach(() => Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage(), sessionStorage: storage() } }));
afterAll(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); });

describe('private offline message cache', () => {
  it('requires an authenticated account scope and never restores another account’s messages', () => {
    writeCachedMessages('room:shared', [{ text: 'Private content' }], 'alice');
    expect(readCachedMessages('room:shared', 'alice')).toEqual([{ text: 'Private content' }]);
    expect(readCachedMessages('room:shared', 'bob')).toBeNull();
    expect(readCachedMessages('room:shared')).toBeNull();
    window.localStorage.setItem('chatcache:room:shared', '["legacy private content"]');
    expect(readCachedMessages('room:shared', 'bob')).toBeNull();
  });
  it('retains only the last 50 messages', () => {
    writeCachedMessages('dm:one', Array.from({ length: 80 }, (_, n) => n), 'alice');
    expect(readCachedMessages<number>('dm:one', 'alice')).toEqual(Array.from({ length: 50 }, (_, n) => n + 30));
  });
  it('clears private and legacy messages and personalized feed snapshots on logout', () => {
    writeCachedMessages('room:shared', [1], 'alice');
    window.localStorage.setItem('chatcache:room:legacy', '[2]');
    window.sessionStorage.setItem('zobia:home:feed:for_you:v2', 'private feed');
    clearCachedMessages();
    expect(readCachedMessages('room:shared', 'alice')).toBeNull();
    expect(window.localStorage.getItem('chatcache:room:legacy')).toBeNull();
    expect(window.sessionStorage.getItem('zobia:home:feed:for_you:v2')).toBeNull();
  });
});
