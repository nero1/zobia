import { isProtectedRealtimeChannel } from '@zobia/shared/utils';
import { SupabaseRealtimeProvider } from '../providers/supabase-realtime';

describe('private realtime payloads', () => {
  it.each(['room:123:messages','dm:conversation:123','group:123:messages','user:123'])('recognizes the protected channel %s', (channel) => {
    expect(isProtectedRealtimeChannel(channel)).toBe(true);
  });
  it('never sends protected payloads to public Supabase Broadcast topics', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unexpected network call'));
    try {
      await new SupabaseRealtimeProvider().publish('room:123:messages', 'new_message', { content: 'private' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { fetchMock.mockRestore(); }
  });
});
