"use client";

/**
 * app/(app)/business/pages/[pageId]/page.tsx
 *
 * Manage a single Business Page: edit profile fields and post/manage
 * updates ("post stuff" — PRD §17). Mirrors the Blogs dashboard's
 * edit-profile + posts-list pattern at a smaller scale.
 */

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface BusinessPage {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  status: string;
}

interface Post {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  status: string;
  view_count: number;
  created_at: string;
}

export default function BusinessPageDetail() {
  const params = useParams<{ pageId: string }>();
  const pageId = params.pageId;

  const [page, setPage] = useState<BusinessPage | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const [showPostForm, setShowPostForm] = useState(false);
  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [postImageUrl, setPostImageUrl] = useState("");
  const [posting, setPosting] = useState(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/business/pages/${pageId}`, { credentials: "include" });
      const json = await res.json();
      if (json.success) {
        setPage(json.data.page);
        setPosts(json.data.posts);
        setName(json.data.page.name);
        setBio(json.data.page.bio ?? "");
        setAvatarUrl(json.data.page.avatar_url ?? "");
        setCoverImageUrl(json.data.page.cover_image_url ?? "");
      } else {
        setError(json.error?.message ?? "Failed to load page");
      }
    } catch {
      setError("Failed to load page");
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => { load(); }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/business/pages/${pageId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          bio: bio.trim() || null,
          avatarUrl: avatarUrl.trim() || null,
          coverImageUrl: coverImageUrl.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to save");
      showToast("Page updated");
      setEditing(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreatePost(e: React.FormEvent) {
    e.preventDefault();
    setPosting(true);
    try {
      const res = await fetch(`/api/business/pages/${pageId}/posts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: postTitle.trim(), body: postBody.trim(), imageUrl: postImageUrl.trim() || undefined, status: "published" }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to post");
      setPostTitle(""); setPostBody(""); setPostImageUrl("");
      setShowPostForm(false);
      showToast("Posted!");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post");
    } finally {
      setPosting(false);
    }
  }

  async function handleDeletePost(postId: string) {
    try {
      const res = await fetch(`/api/business/pages/${pageId}/posts/${postId}`, { method: "DELETE", credentials: "include" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to delete post");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete post");
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6"><div className="h-8 w-56 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" /></div>;
  }
  if (!page) {
    return <div className="mx-auto max-w-2xl p-4 sm:p-6"><p className="text-sm text-red-600">{error ?? "Page not found"}</p></div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Link href="/business/pages" className="text-sm text-neutral-500 hover:underline">← Business Pages</Link>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-teal-600 px-4 py-3 text-sm font-medium text-white shadow-lg">{toast}</div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {!editing ? (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{page.name}</h1>
                {page.bio && <p className="mt-1 text-sm text-neutral-500">{page.bio}</p>}
                <a href={`/p/${page.slug}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-blue-600 hover:underline">/p/{page.slug} ↗</a>
              </div>
              <button onClick={() => setEditing(true)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300">
                Edit
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">Name</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">Bio</label>
              <textarea rows={2} value={bio} onChange={(e) => setBio(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">Avatar URL</label>
              <input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://..." className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">Cover Image URL</label>
              <input value={coverImageUrl} onChange={(e) => setCoverImageUrl(e.target.value)} placeholder="https://..." className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditing(false)} className="flex-1 rounded-xl border border-neutral-300 py-2 text-sm font-semibold dark:border-neutral-700">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
            </div>
          </form>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Posts</h2>
        <button onClick={() => setShowPostForm((s) => !s)} className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
          {showPostForm ? "Cancel" : "+ New Post"}
        </button>
      </div>

      {showPostForm && (
        <form onSubmit={handleCreatePost} className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <input required maxLength={150} placeholder="Title" value={postTitle} onChange={(e) => setPostTitle(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
          <textarea required maxLength={5000} rows={4} placeholder="What's new?" value={postBody} onChange={(e) => setPostBody(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
          <input placeholder="Image URL (optional)" value={postImageUrl} onChange={(e) => setPostImageUrl(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
          <button type="submit" disabled={posting || !postTitle.trim() || !postBody.trim()} className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {posting ? "Posting…" : "Post"}
          </button>
        </form>
      )}

      {posts.length === 0 ? (
        <p className="text-sm text-neutral-400">No posts yet.</p>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <div key={post.id} className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">{post.title}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-neutral-500">{post.body}</p>
                  <p className="mt-1 text-xs text-neutral-400">{new Date(post.created_at).toLocaleDateString()} · 👁 {post.view_count} · {post.status}</p>
                </div>
                <button onClick={() => handleDeletePost(post.id)} className="flex-shrink-0 rounded-lg border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
