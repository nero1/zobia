import { deriveNotificationActionUrl } from '../actionRoute';

describe('blog notification routes', () => {
  it('opens the public canonical post URL', () => {
    expect(deriveNotificationActionUrl('blog_new_post', { blogSlug: 'news', postSlug: 'hello' })).toBe('/b/news/hello');
  });
  it('does not invent a route without a post slug', () => {
    expect(deriveNotificationActionUrl('blog_new_post', { blogSlug: 'news' })).toBeNull();
  });
});
