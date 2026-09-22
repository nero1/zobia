/**
 * apps/android/src/components/classroom/Community.tsx
 *
 * Classroom community feed — mirrors apps/web/components/classroom/
 * CommunityFeed.tsx: composer (category, posting policy, mutes), category
 * chips + sort, keyset-paginated posts, likes (1 like = 1 point for the
 * author), threaded comments, moderator pin/lock/hide/delete and reports.
 */

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiError, get, send, type Author, type ClassroomComment, type ClassroomHome, type ClassroomPost } from '@/lib/classroom/api';

const REASONS = ['spam', 'harassment', 'hate_speech', 'sexual_content', 'misinformation', 'scam', 'off_topic', 'other'] as const;

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function AuthorLine({ a, when }: { a: Author; when: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="text-lg">{a.avatarEmoji}</span>
        <span className="truncate text-sm font-semibold">{a.displayName}</span>
        <span className="rounded-full bg-primary-100 dark:bg-primary-900/40 px-1.5 text-[10px] font-bold text-primary-700 dark:text-primary-300">{a.level}</span>
        {a.isCreator && <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700">{t('classroom.roles.creator', 'Creator')}</span>}
        {a.isModerator && !a.isCreator && <span className="rounded-full bg-sky-100 px-1.5 text-[10px] font-semibold text-sky-700">{t('classroom.roles.moderator', 'Moderator')}</span>}
      </span>
      <span className="shrink-0 text-[11px] text-neutral-400">{ago(when)}</span>
    </div>
  );
}

export function ReportLink({ roomId, target }: { roomId: string; target: { postId?: string; commentId?: string } }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]>('spam');
  const [msg, setMsg] = useState<string | null>(null);
  const submit = useMutation({
    mutationFn: () => send('post', `/${roomId}/reports`, { ...target, reason }),
    onSuccess: () => setMsg(t('classroom.report.thanks', 'Thanks — the classroom moderators will review it.')),
    onError: (e) => setMsg(apiError(e).message),
  });
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-neutral-400">
        {t('classroom.report.button', 'Report')}
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      <select value={reason} onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])} className="rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-1 py-0.5 text-xs">
        {REASONS.map((r) => (
          <option key={r} value={r}>
            {t(`classroom.report.reasons.${r}`, r)}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => submit.mutate()} className="text-xs font-semibold text-danger-600">
        {t('classroom.report.submit', 'Submit report')}
      </button>
      {msg && <span className="text-xs text-neutral-500">{msg}</span>}
    </span>
  );
}

function Thread({ home, post }: { home: ClassroomHome; post: ClassroomPost }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roomId = home.classroom.id;
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<ClassroomComment | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = ['classroom', roomId, 'comments', post.id];
  const comments = useQuery({ queryKey: key, queryFn: () => get<{ comments: ClassroomComment[] }>(`/${roomId}/posts/${post.id}/comments`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['classroom', roomId, 'posts'] });
  };
  const add = useMutation({
    mutationFn: () => send('post', `/${roomId}/posts/${post.id}/comments`, { body: body.trim(), parentId: replyTo?.id ?? null }),
    onSuccess: () => {
      setBody('');
      setReplyTo(null);
      setErr(null);
      refresh();
    },
    onError: (e) => setErr(apiError(e).message),
  });
  const like = useMutation({ mutationFn: (c: ClassroomComment) => send(c.likedByMe ? 'delete' : 'post', `/${roomId}/comments/${c.id}/like`), onSettled: refresh });
  const del = useMutation({ mutationFn: (c: ClassroomComment) => send('delete', `/${roomId}/comments/${c.id}`), onSettled: refresh });
  const hide = useMutation({ mutationFn: (c: ClassroomComment) => send('patch', `/${roomId}/comments/${c.id}`, { isHidden: !c.isHidden }), onSettled: refresh });

  const list = comments.data?.comments ?? [];
  const canComment = home.viewer.can.comment && (!post.isLocked || home.viewer.can.managePosts);
  const row = (c: ClassroomComment, nested: boolean) => (
    <div key={c.id} className={`${nested ? 'ml-6' : ''} rounded-lg bg-neutral-50 dark:bg-neutral-900 p-2 ${c.isHidden ? 'opacity-60' : ''}`}>
      <AuthorLine a={c.author} when={c.createdAt} />
      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{c.body}</p>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-neutral-500">
        <button type="button" disabled={!home.viewer.can.like} onClick={() => like.mutate(c)} className={c.likedByMe ? 'font-semibold text-primary-600' : ''}>
          👍 {c.likeCount || t('classroom.feed.like', 'Like')}
        </button>
        {canComment && !nested && (
          <button type="button" onClick={() => setReplyTo(c)}>
            {t('classroom.feed.reply', 'Reply')}
          </button>
        )}
        {home.viewer.can.managePosts && (
          <button type="button" onClick={() => hide.mutate(c)}>
            {c.isHidden ? t('classroom.feed.unhide', 'Unhide') : t('classroom.feed.hide', 'Hide')}
          </button>
        )}
        {c.canDelete && (
          <button type="button" onClick={() => confirm(t('classroom.feed.deleteCommentConfirm', 'Delete this comment?')) && del.mutate(c)}>
            {t('classroom.feed.delete', 'Delete')}
          </button>
        )}
        {home.viewer.can.report && c.author.id !== home.viewer.userId && <ReportLink roomId={roomId} target={{ commentId: c.id }} />}
      </div>
    </div>
  );
  return (
    <div className="mt-2 space-y-2 border-t border-neutral-100 dark:border-neutral-700 pt-2">
      {list.filter((c) => !c.parentId).map((c) => (
        <div key={c.id} className="space-y-2">
          {row(c, false)}
          {list.filter((r) => r.parentId === c.id).map((r) => row(r, true))}
        </div>
      ))}
      {canComment ? (
        <div className="space-y-1">
          {replyTo && (
            <p className="text-xs text-neutral-500">
              {t('classroom.feed.replyingTo', 'Replying to {{name}}', { name: replyTo.author.displayName })}{' '}
              <button type="button" onClick={() => setReplyTo(null)} className="text-primary-600">
                {t('classroom.common.cancel', 'Cancel')}
              </button>
            </p>
          )}
          <div className="flex gap-2">
            <input value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} placeholder={t('classroom.feed.commentPlaceholder', 'Write a comment…')} className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2 text-sm" />
            <button type="button" disabled={!body.trim() || add.isPending} onClick={() => add.mutate()} className="rounded-lg bg-primary-600 px-3 text-sm font-semibold text-white disabled:opacity-50">
              {t('classroom.feed.send', 'Send')}
            </button>
          </div>
          {err && <p className="text-xs text-danger-600">{err}</p>}
        </div>
      ) : post.isLocked ? (
        <p className="text-xs text-neutral-400">🔒 {t('classroom.feed.lockedNotice', 'Comments are closed on this post.')}</p>
      ) : null}
    </div>
  );
}

function PostItem({ home, post }: { home: ClassroomHome; post: ClassroomPost }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roomId = home.classroom.id;
  const [open, setOpen] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['classroom', roomId, 'posts'] });
  const like = useMutation({ mutationFn: () => send(post.likedByMe ? 'delete' : 'post', `/${roomId}/posts/${post.id}/like`), onSettled: refresh });
  const patch = useMutation({ mutationFn: (b: Record<string, unknown>) => send('patch', `/${roomId}/posts/${post.id}`, b), onSettled: refresh });
  const del = useMutation({ mutationFn: () => send('delete', `/${roomId}/posts/${post.id}`), onSettled: refresh });

  return (
    <article className={`rounded-xl bg-white dark:bg-neutral-800 p-3 shadow-card ${post.isPinned ? 'ring-1 ring-primary-300' : ''} ${post.isHidden ? 'opacity-70' : ''}`}>
      <AuthorLine a={post.author} when={post.createdAt} />
      <p className="mt-0.5 text-[11px] text-neutral-400">
        {post.category}
        {post.isPinned && ` · 📌 ${t('classroom.feed.pinned', 'Pinned')}`}
        {post.isLocked && ` · 🔒 ${t('classroom.feed.locked', 'Locked')}`}
        {post.isHidden && ` · ${t('classroom.feed.hiddenNotice', 'Hidden by a moderator')}`}
      </p>
      {post.title && <h3 className="mt-1 font-semibold">{post.title}</h3>}
      <p className={`mt-1 whitespace-pre-wrap break-words text-sm text-neutral-700 dark:text-neutral-300 ${open ? '' : 'line-clamp-6'}`}>{post.body}</p>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-neutral-500">
        <button type="button" disabled={!home.viewer.can.like} onClick={() => like.mutate()} className={post.likedByMe ? 'font-semibold text-primary-600' : ''}>
          👍 {post.likeCount || t('classroom.feed.like', 'Like')}
        </button>
        <button type="button" onClick={() => setOpen((v) => !v)}>
          💬 {t('classroom.feed.comments', '{{count}} comments', { count: post.commentCount })}
        </button>
        {home.viewer.can.managePosts && (
          <>
            <button type="button" onClick={() => patch.mutate({ isPinned: !post.isPinned })}>{post.isPinned ? t('classroom.feed.unpin', 'Unpin') : t('classroom.feed.pin', 'Pin')}</button>
            <button type="button" onClick={() => patch.mutate({ isLocked: !post.isLocked })}>{post.isLocked ? t('classroom.feed.unlock', 'Unlock') : t('classroom.feed.lock', 'Lock')}</button>
            <button type="button" onClick={() => patch.mutate({ isHidden: !post.isHidden })}>{post.isHidden ? t('classroom.feed.unhide', 'Unhide') : t('classroom.feed.hide', 'Hide')}</button>
          </>
        )}
        {post.canDelete && (
          <button type="button" onClick={() => confirm(t('classroom.feed.deletePostConfirm', 'Delete this post?')) && del.mutate()}>
            {t('classroom.feed.delete', 'Delete')}
          </button>
        )}
        {home.viewer.can.report && post.author.id !== home.viewer.userId && <ReportLink roomId={roomId} target={{ postId: post.id }} />}
      </div>
      {open && <Thread home={home} post={post} />}
    </article>
  );
}

export function CommunityFeed({ home }: { home: ClassroomHome }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roomId = home.classroom.id;
  const staffy = home.viewer.can.managePosts || home.viewer.isModerator;
  const cats = home.classroom.postCategories.filter((c) => staffy || c.toLowerCase() !== 'announcements');
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<'activity' | 'new' | 'top'>('activity');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [postCat, setPostCat] = useState(cats[0] ?? 'General');
  const [err, setErr] = useState<string | null>(null);

  const feed = useInfiniteQuery({
    queryKey: ['classroom', roomId, 'posts', category, sort],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => get<{ posts: ClassroomPost[]; nextCursor: string | null }>(`/${roomId}/posts`, { sort, category: category ?? undefined, cursor: pageParam ?? undefined }),
    getNextPageParam: (last) => last.nextCursor,
  });
  const create = useMutation({
    mutationFn: () => send('post', `/${roomId}/posts`, { title: title.trim() || null, body: body.trim(), category: postCat }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setErr(null);
      void qc.invalidateQueries({ queryKey: ['classroom', roomId, 'posts'] });
    },
    onError: (e) => setErr(apiError(e).message),
  });
  const posts = feed.data?.pages.flatMap((p) => p.posts) ?? [];

  return (
    <div className="space-y-3">
      {home.viewer.mutedUntil && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('classroom.feed.mutedBanner', "You're muted in this classroom until {{date}}.", { date: new Date(home.viewer.mutedUntil).toLocaleString() })}
        </p>
      )}
      {home.viewer.can.createPost && (
        <div className="space-y-2 rounded-xl bg-white dark:bg-neutral-800 p-3 shadow-card">
          <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={t('classroom.feed.titlePlaceholder', 'Title (optional)')} className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-transparent px-3 py-2 text-sm" />
          <textarea value={body} rows={3} maxLength={10000} onChange={(e) => setBody(e.target.value)} placeholder={t('classroom.feed.bodyPlaceholder', 'Share a question, a win or an idea with the class…')} className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-transparent px-3 py-2 text-sm" />
          <div className="flex items-center justify-between gap-2">
            <select value={postCat} onChange={(e) => setPostCat(e.target.value)} className="rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-2 py-1 text-sm">
              {cats.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button type="button" disabled={!body.trim() || create.isPending} onClick={() => create.mutate()} className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {create.isPending ? t('classroom.feed.posting', 'Posting…') : t('classroom.feed.post', 'Post')}
            </button>
          </div>
          {err && <p className="text-xs text-danger-600">{err}</p>}
        </div>
      )}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <button onClick={() => setCategory(null)} className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${category === null ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'bg-neutral-100 dark:bg-neutral-700'}`}>
          {t('classroom.feed.allCategories', 'All')}
        </button>
        {home.classroom.postCategories.map((c) => (
          <button key={c} onClick={() => setCategory(category === c ? null : c)} className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${category === c ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'bg-neutral-100 dark:bg-neutral-700'}`}>
            {c}
          </button>
        ))}
        <select value={sort} onChange={(e) => setSort(e.target.value as 'activity' | 'new' | 'top')} className="ml-auto shrink-0 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-1 text-xs">
          <option value="activity">{t('classroom.feed.sort.activity', 'Latest activity')}</option>
          <option value="new">{t('classroom.feed.sort.new', 'Newest')}</option>
          <option value="top">{t('classroom.feed.sort.top', 'Most liked')}</option>
        </select>
      </div>
      {feed.isPending ? (
        <div className="h-24 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
      ) : feed.isError ? (
        <p className="text-sm text-danger-600">{apiError(feed.error).message}</p>
      ) : posts.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500">💬 {t('classroom.feed.empty', 'No posts yet — start the first conversation!')}</p>
      ) : (
        <>
          {posts.map((p) => (
            <PostItem key={p.id} home={home} post={p} />
          ))}
          {feed.hasNextPage && (
            <button type="button" onClick={() => void feed.fetchNextPage()} className="w-full rounded-xl border border-neutral-200 dark:border-neutral-700 py-2 text-sm">
              {t('classroom.feed.loadMore', 'Load more')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
