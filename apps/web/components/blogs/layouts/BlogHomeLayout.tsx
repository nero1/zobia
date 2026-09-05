/**
 * components/blogs/layouts/BlogHomeLayout.tsx
 *
 * Structural theme dispatcher for the public blog homepage. All four
 * variants render the SAME already-fetched props (see types.ts) — only the
 * DOM arrangement differs:
 *   - classic:       current single-column list + right sidebar (baseline).
 *   - magazine:      a featured-post hero above a grid of post cards.
 *   - minimal-cards: a compact card grid, less metadata per post.
 *   - sidebar-left:  categories/recent-posts sidebar on the LEFT of the list.
 *
 * Theme tokens (bg/card/accent/text/muted) are applied as CSS custom
 * properties on the outer wrapper and consumed via inline style on a
 * handful of load-bearing elements (accent links/badges/borders) rather
 * than a full class-map rewrite — enough for each theme to look and feel
 * distinct without re-deriving the whole design system per theme.
 */

import Link from "next/link";
import { formatShortDate } from "@/lib/format/date";
import type { BlogHomeLayoutProps, HomeArticle } from "./types";

function ArticleMeta({ a, dense }: { a: HomeArticle; dense?: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {a.published_at && <span>{formatShortDate(a.published_at)}</span>}
      {!dense && a.category_name && <span className="rounded-full bg-neutral-800 px-2 py-0.5">{a.category_name}</span>}
      {!dense && <span>👁 {a.view_count}</span>}
      {!dense && <span>❤️ {a.like_count}</span>}
    </div>
  );
}

function ArticleImage({ a, className }: { a: HomeArticle; className: string }) {
  if (!a.featured_image_url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={a.featured_image_url} alt="" className={className} />;
}

function Sidebar({ props }: { props: BlogHomeLayoutProps }) {
  const { blogSlug, categories, popular } = props;
  if (categories.length === 0 && popular.length === 0) return null;
  return (
    <aside className="space-y-6">
      {categories.length > 0 && (
        <div id="categories" className="rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">Categories</h3>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <span key={c.id} className="rounded-full bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300">{c.name} ({c.post_count})</span>
            ))}
          </div>
        </div>
      )}
      {popular.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">Popular</h3>
          <div className="space-y-2">
            {popular.map((p) => (
              <Link key={p.id} href={`/b/${blogSlug}/${p.slug}`} className="block text-sm text-foreground hover:text-primary truncate">
                {p.title}
              </Link>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function ClassicHome(props: BlogHomeLayoutProps) {
  const { blogSlug, articles } = props;
  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
      <div className="md:col-span-2 space-y-4">
        {articles.length === 0 ? (
          <p className="text-muted-foreground">No articles yet.</p>
        ) : (
          articles.map((a) => (
            <Link key={a.id} href={`/b/${blogSlug}/${a.slug}`} className="block rounded-2xl border border-border bg-card p-4 hover:border-primary/60 transition-colors">
              <div className="flex gap-4">
                <ArticleImage a={a} className="h-20 w-20 flex-shrink-0 rounded-xl object-cover" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-bold text-foreground">{a.title}</h2>
                    {a.is_paywalled && <span className="text-[10px] rounded-full bg-amber-950/40 text-amber-400 px-1.5 py-0.5">🔒</span>}
                  </div>
                  {a.excerpt && <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{a.excerpt}</p>}
                  <ArticleMeta a={a} />
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
      <Sidebar props={props} />
    </div>
  );
}

function MagazineHome(props: BlogHomeLayoutProps) {
  const { blogSlug, articles, tokens } = props;
  const [featured, ...rest] = articles;
  return (
    <div>
      {featured && (
        <Link href={`/b/${blogSlug}/${featured.slug}`} className="mb-8 block overflow-hidden rounded-3xl border border-border bg-card group">
          {featured.featured_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={featured.featured_image_url} alt="" className="h-64 w-full object-cover transition-transform group-hover:scale-[1.02]" />
          ) : (
            <div className="h-64 w-full" style={{ background: `linear-gradient(135deg, ${tokens.accent}33, ${tokens.card})` }} />
          )}
          <div className="p-6">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: tokens.accent }}>Featured</span>
            <h2 className="mt-1 text-2xl font-bold text-foreground">{featured.title}</h2>
            {featured.excerpt && <p className="mt-2 text-muted-foreground line-clamp-2">{featured.excerpt}</p>}
            <ArticleMeta a={featured} />
          </div>
        </Link>
      )}
      {rest.length === 0 && !featured ? (
        <p className="text-muted-foreground">No articles yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((a) => (
            <Link key={a.id} href={`/b/${blogSlug}/${a.slug}`} className="block overflow-hidden rounded-2xl border border-border bg-card hover:border-primary/60 transition-colors">
              <ArticleImage a={a} className="h-36 w-full object-cover" />
              <div className="p-4">
                <h3 className="font-bold text-foreground line-clamp-2">{a.title}</h3>
                {a.excerpt && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{a.excerpt}</p>}
                <ArticleMeta a={a} dense />
              </div>
            </Link>
          ))}
        </div>
      )}
      <div className="mt-8">
        <Sidebar props={props} />
      </div>
    </div>
  );
}

function MinimalCardsHome(props: BlogHomeLayoutProps) {
  const { blogSlug, articles } = props;
  return (
    <div>
      {articles.length === 0 ? (
        <p className="text-muted-foreground">No articles yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {articles.map((a) => (
            <Link key={a.id} href={`/b/${blogSlug}/${a.slug}`} className="block rounded-xl border border-border bg-card p-3 hover:border-primary/60 transition-colors">
              <ArticleImage a={a} className="mb-2 h-24 w-full rounded-lg object-cover" />
              <h3 className="text-sm font-semibold text-foreground line-clamp-2">{a.title}</h3>
              {a.published_at && <span className="mt-1 block text-[11px] text-muted-foreground">{formatShortDate(a.published_at)}</span>}
            </Link>
          ))}
        </div>
      )}
      <div className="mt-8">
        <Sidebar props={props} />
      </div>
    </div>
  );
}

function SidebarLeftHome(props: BlogHomeLayoutProps) {
  const { blogSlug, articles } = props;
  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
      <div className="md:order-1 md:col-span-1">
        <Sidebar props={props} />
      </div>
      <div className="md:order-2 md:col-span-3 space-y-4">
        {articles.length === 0 ? (
          <p className="text-muted-foreground">No articles yet.</p>
        ) : (
          articles.map((a) => (
            <Link key={a.id} href={`/b/${blogSlug}/${a.slug}`} className="flex gap-4 rounded-2xl border border-border bg-card p-4 hover:border-primary/60 transition-colors">
              <ArticleImage a={a} className="h-20 w-20 flex-shrink-0 rounded-xl object-cover" />
              <div className="min-w-0">
                <h2 className="font-bold text-foreground">{a.title}</h2>
                {a.excerpt && <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{a.excerpt}</p>}
                <ArticleMeta a={a} />
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

export function BlogHomeLayout(props: BlogHomeLayoutProps) {
  switch (props.layoutVariant) {
    case "magazine":
      return <MagazineHome {...props} />;
    case "minimal-cards":
      return <MinimalCardsHome {...props} />;
    case "sidebar-left":
      return <SidebarLeftHome {...props} />;
    case "classic":
    default:
      return <ClassicHome {...props} />;
  }
}
