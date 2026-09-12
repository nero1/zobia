/**
 * apps/android/src/lib/wiki/api.ts
 *
 * Shared types + fetch functions for the Wiki feature — analogous to
 * lib/blogs/menu.ts's role of holding cross-route shared logic (blogs itself
 * fetches inline per-route since each blog screen only ever needs its own
 * shape; wiki's screens repeatedly need the same wiki-detail/collaborator/
 * treasury shapes across settings/manage/treasury/page routes, so those live
 * here once instead of being redeclared in every route file).
 *
 * Every fetch here goes through `apiClient`, whose response interceptor
 * already unwraps the backend's { success, data, error } envelope down to
 * `data` — so `res.data` below IS the payload shape already (see
 * lib/api/client.ts and the "double-unwrap" comments throughout lib/blogs
 * routes for the bug this avoids).
 *
 * Caching: no bespoke query-client config here — the app's single QueryClient
 * (lib/query/client.ts) already persists all query results to IndexedDB and
 * treats them as fresh for 60s / cached for 7 days, same as every other
 * feature including blogs. Individual routes just call useQuery/useMutation
 * with a queryKey rooted at 'wiki'.
 */

import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types (mirror apps/web/lib/wiki/repo.ts row shapes)
// ---------------------------------------------------------------------------

export type WikiTab = 'popular' | 'trending' | 'new' | 'random';
export type ContributePolicy = 'everyone' | 'friends' | 'selected';

export interface WikiSummary {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  contribute_policy: ContributePolicy;
  status: string;
  page_count: number;
  contributor_count: number;
  view_count: number;
  created_at: string;
  owner_username: string | null;
}

export interface WikiDetail extends WikiSummary {
  status_reason: string | null;
  edit_count: number;
  owner_display_name: string | null;
  owner_avatar_url: string | null;
}

export interface WikiPageSummary {
  id: string;
  wiki_id: string;
  slug: string;
  title: string;
  status: string;
  revision_count: number;
  view_count: number;
  created_by: string;
  last_edited_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WikiPageDetail extends WikiPageSummary {
  content_markdown: string;
  content_html: string;
  content_format: 'markdown' | 'plaintext';
  creator_username: string | null;
  last_editor_username: string | null;
}

export interface WikiPageRevision {
  id: string;
  page_id: string;
  revision_number: number;
  title: string;
  content_markdown: string;
  content_format: 'markdown' | 'plaintext';
  edit_summary: string | null;
  edited_by: string;
  editor_username: string | null;
  created_at: string;
}

export interface WikiCollaborator {
  id: string;
  wiki_id: string;
  user_id: string;
  role: string;
  is_moderator: boolean;
  moderator_granted_at: string | null;
  status: string;
  page_edit_count: number;
  created_at: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export interface WikiInvite {
  id: string;
  wiki_id: string;
  token: string;
  invited_user_id: string | null;
  created_by: string;
  expires_at: string;
  used_at: string | null;
  used_by_user_id: string | null;
  created_at: string;
  invited_username: string | null;
}

export interface WikiTreasury {
  status: string;
  maxClaimants: number;
  claimantCount: number;
  rewardPerClaimant: number;
}

export interface UserSuggestion {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
}

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

export async function fetchWikiList(tab: WikiTab, q: string, cursor?: string | null) {
  const params = new URLSearchParams({ tab });
  if (q.trim()) params.set('q', q.trim());
  if (cursor) params.set('cursor', cursor);
  const { data } = await apiClient.get<{ wikis: WikiSummary[]; nextCursor: string | null; hasMore: boolean }>(
    `/wiki?${params.toString()}`
  );
  return data ?? { wikis: [], nextCursor: null, hasMore: false };
}

export async function fetchMyWikis() {
  const { data } = await apiClient.get<{ owned: WikiDetail[]; contributing: WikiDetail[] }>('/wiki/me');
  return data ?? { owned: [], contributing: [] };
}

export interface WikiDetailResponse {
  wiki: WikiDetail;
  isOwner: boolean;
  canManage: boolean;
  canContribute: boolean;
}

export async function fetchWiki(slug: string): Promise<WikiDetailResponse | null> {
  const { data } = await apiClient.get<WikiDetailResponse>(`/wiki/${slug}`);
  return data ?? null;
}

export async function fetchWikiPages(slug: string, q = '', cursor?: string | null) {
  const params = new URLSearchParams({ limit: '50' });
  if (q.trim()) params.set('q', q.trim());
  if (cursor) params.set('cursor', cursor);
  const { data } = await apiClient.get<{ pages: WikiPageSummary[]; nextCursor: string | null; hasMore: boolean }>(
    `/wiki/${slug}/pages?${params.toString()}`
  );
  return data ?? { pages: [], nextCursor: null, hasMore: false };
}

export interface WikiPageDetailResponse {
  wiki: WikiDetail;
  page: WikiPageDetail;
  canManage: boolean;
  canContribute: boolean;
}

export async function fetchWikiPage(slug: string, pageSlug: string): Promise<WikiPageDetailResponse | null> {
  const { data } = await apiClient.get<WikiPageDetailResponse>(`/wiki/${slug}/pages/${pageSlug}`);
  return data ?? null;
}

export async function fetchPageRevisions(slug: string, pageSlug: string) {
  const { data } = await apiClient.get<{ revisions: WikiPageRevision[] }>(`/wiki/${slug}/pages/${pageSlug}/revisions`);
  return data?.revisions ?? [];
}

export async function fetchCollaborators(slug: string) {
  const { data } = await apiClient.get<{ collaborators: WikiCollaborator[] }>(`/wiki/${slug}/moderators`);
  return data?.collaborators ?? [];
}

export async function fetchInvites(slug: string) {
  const { data } = await apiClient.get<{ invites: WikiInvite[] }>(`/wiki/${slug}/invites`);
  return data?.invites ?? [];
}

export async function fetchTreasury(slug: string) {
  const { data } = await apiClient.get<{ treasury: WikiTreasury | null }>(`/wiki/${slug}/treasury`);
  return data?.treasury ?? null;
}

export async function searchUsers(q: string): Promise<UserSuggestion[]> {
  if (!q.trim()) return [];
  const { data } = await apiClient.get<{ users?: UserSuggestion[]; data?: { users: UserSuggestion[] } }>(
    `/users/search?q=${encodeURIComponent(q.trim())}&limit=6`
  );
  return data?.users ?? data?.data?.users ?? [];
}

export interface InvitePreview {
  wiki: { slug: string; name: string };
  expired: boolean;
  used: boolean;
}

export async function fetchInvitePreview(token: string): Promise<InvitePreview | null> {
  const { data } = await apiClient.get<InvitePreview>(`/wiki/invites/${token}`);
  return data ?? null;
}
