# SEO Implementation Guide - Zobia Social

## Overview

This document outlines SEO best practices and implementations for Zobia Social across web and mobile platforms.

## Public URL Structure (SEO-Friendly Slugs)

Public, crawlable, shareable surfaces use short human-readable paths. Internal app navigation continues to use immutable UUIDs; the slug is a mutable public alias resolving to the UUID (see PRD → "Public URL Structure — SEO-Friendly Slugs").

| Surface | Public URL | Route file | Resolver |
|---|---|---|---|
| Profile | `/u/<username>` | `app/u/[username]/page.tsx` | by `username` |
| Room | `/r/<slug>` | `app/r/[slug]/page.tsx` | `lib/public/resolveRoom.ts` |
| Course / classroom | `/c/<slug>` | `app/c/[slug]/page.tsx` | `lib/public/resolveRoom.ts` (classroom types) |
| Game (upcoming) | `/g/<slug>` | `app/g/[slug]/page.tsx` | `lib/public/resolveGame.ts` |
| Forum question (Zobia Answers) | `/a/<slug>` | `app/a/[slug]/page.tsx` | `lib/public/resolveForumQuestion.ts` |

- **Duplicate names** get a numeric suffix with no separator (`/r/dorcas-cuisine`, `/r/dorcas-cuisine2`).
- **Legacy `/r/<uuid>` links and retired slugs 301-redirect** to the canonical slug (UUID fallback + `slug_redirects` table), so no shared link ever breaks or splits link-equity.
- **Canonical tags** always point at the slug path; the sitemap emits slug paths.
- **Referrals:** `?r=<code>` can be attached to any of these URLs and is captured/attributed cross-platform (see PRD → Referral System).

## 1. Meta Tags Implementation Examples

### Title Tags
- **Format:** `{Page Title} | Zobia Social`
- **Length:** 50-60 characters (displays fully in search results)
- **Requirement:** Every page must have a unique, descriptive title

### Meta Descriptions
- **Length:** 155-160 characters (mobile) / 150-160 (desktop)
- **Content:** Clear, action-oriented description of page content
- **Format:** Should include primary keyword naturally

### Open Graph Tags
All public pages should include OpenGraph metadata for social sharing:
```html
<meta property="og:title" content="Page Title" />
<meta property="og:description" content="Page description" />
<meta property="og:image" content="https://..." />
<meta property="og:url" content="https://..." />
<meta property="og:type" content="website" />
```

### Twitter Card Tags
Enable rich sharing on Twitter:
```html
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Page Title" />
<meta name="twitter:description" content="Page description" />
<meta name="twitter:image" content="https://..." />
<meta name="twitter:creator" content="@ZobiaSocial" />
```

## 2. Structured Data (JSON-LD)

### Schema Types Implemented

#### Person Schema (User Profiles)
```json
{
  "@context": "https://schema.org",
  "@type": "Person",
  "name": "Creator Name",
  "description": "Bio/description",
  "image": "avatar-url",
  "url": "https://zobia.org/u/username",
  "sameAs": ["twitter-profile", "instagram-profile"]
}
```

#### LocalBusiness Schema (Rooms)
```json
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Room Name",
  "description": "Room description",
  "image": "room-image",
  "genre": "room-type",
  "url": "https://zobia.org/r/room-slug"
}
```

#### BreadcrumbList Schema (Navigation)
```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "name": "Home",
      "item": "https://zobia.org"
    },
    {
      "@type": "ListItem",
      "position": 2,
      "name": "Profiles",
      "item": "https://zobia.org/profiles"
    }
  ]
}
```

## 3. Sitemap Implementation

### Dynamic Sitemap (`/sitemap.xml`)
- **Location:** `apps/web/app/sitemap.ts`
- **Coverage (all use the SEO-friendly slug paths):**
  - Static public pages (landing, terms, privacy)
  - Public user profiles → `/u/<username>` (last 30 days active, limit 5000)
  - Public rooms → `/r/<slug>` (free_open type, limit 2000; falls back to UUID for any room not yet backfilled)
  - Public courses → `/c/<slug>` (classroom-type rooms, limit 2000)
  - Public games → `/g/<slug>` (limit 2000)
  - Public forum questions (Zobia Answers) → `/a/<slug>` (visible, non-deleted only; limit 2000)
- **Revalidation:** Hourly (3600s)
- **Base URL:** `NEXT_PUBLIC_APP_URL` (falls back to `https://zobia.vercel.app`)

### Robots.txt Configuration
**Location:** `apps/web/app/robots.ts` (generated dynamically so the `Sitemap:` URL tracks `NEXT_PUBLIC_APP_URL`; replaces the old static `public/robots.txt`).

```
User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Disallow: /auth/

Sitemap: ${NEXT_PUBLIC_APP_URL}/sitemap.xml
```

## 4. Implementation in Pages

> **Note on routes:** Public pages live at the SEO-friendly slug paths
> `/u/<username>` (profiles), `/r/<slug>` (rooms), `/c/<slug>` (courses) and
> `/g/<slug>` (games) — see "Public URL Structure" below. The examples in this
> section predate the slug scheme; treat their `/profiles/…` and `/rooms/<id>…`
> paths as illustrative of the metadata pattern, and use the slug paths for the
> `canonical` value.

### Example: User Profile Page

```typescript
// app/u/[username]/page.tsx

import { Metadata } from 'next';
import { generateMetadata, generatePersonSchema } from '@/lib/seo/metadata';

export async function generateMetadata({ params }): Promise<Metadata> {
  const { username } = params;
  const user = await fetchUser(username); // Your data fetch

  return generateMetadata({
    title: user.displayName,
    description: user.bio || `${user.displayName}'s profile on Zobia Social`,
    keywords: ['creator', 'profile', user.displayName],
    canonical: `https://zobia.org/u/${username}`,
    image: user.avatarUrl,
    imageAlt: `${user.displayName}'s avatar`,
    ogType: 'profile',
    author: user.displayName,
  });
}

export default function ProfilePage({ params }) {
  const { username } = params;
  const user = await fetchUser(username);

  const structuredData = generatePersonSchema({
    name: user.displayName,
    description: user.bio,
    image: user.avatarUrl,
    url: `https://zobia.org/u/${username}`,
    sameAs: user.socialLinks || [],
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: structuredData }}
      />
      {/* Page content */}
    </>
  );
}
```

### Example: Room/Space Page

```typescript
// app/rooms/[roomId]/page.tsx

import { generateMetadata, generateLocalBusinessSchema } from '@/lib/seo/metadata';

export async function generateMetadata({ params }): Promise<Metadata> {
  const { roomId } = params;
  const room = await fetchRoom(roomId);

  return generateMetadata({
    title: room.name,
    description: room.description,
    keywords: ['room', 'space', room.type, room.name],
    canonical: `https://zobia.org/r/${room.slug}`,
    image: room.imageUrl,
    imageAlt: `${room.name} cover image`,
  });
}

export default function RoomPage({ params }) {
  const { roomId } = params;
  const room = await fetchRoom(roomId);

  const structuredData = generateLocalBusinessSchema({
    name: room.name,
    description: room.description,
    url: `https://zobia.org/r/${room.slug}`,
    image: room.imageUrl,
    genre: room.type,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: structuredData }}
      />
      {/* Page content */}
    </>
  );
}
```

## 5. Image Optimization for SEO

### OG Image Guidelines
- **Size:** 1200×630 pixels (optimal for social sharing)
- **Format:** JPG or PNG (JPG preferred for file size)
- **Compression:** Optimize to <200KB
- **Contrast:** High contrast for visibility in feeds
- **Brand:** Include logo or branding element

### Responsive Images
```typescript
<Image
  src={imageUrl}
  alt="Descriptive alt text"
  width={1200}
  height={630}
  priority={isAboveTheFold}
  placeholder="blur"
  blurDataURL={blurredImageData}
/>
```

## 6. Mobile SEO (Expo App)

### Web Sharing (Deep Links)
```typescript
// Share with meta tags for link preview
const shareData = {
  title: 'Room Name',
  text: 'Check out this room',
  url: 'https://zobia.org/r/room-slug',
};
```

### Twitter/Social Previews
When sharing Zobia links on social platforms, meta tags ensure:
- Custom title displayed
- Description visible
- Image thumbnail shown
- Clickable link to platform

## 7. Local SEO (Geographic Targeting)

### City-Based Pages
For city leaderboards and local content:
```html
<meta name="geo.position" content="latitude; longitude" />
<meta name="geo.placename" content="City, Country" />
<meta name="geo.region" content="Country" />
```

## 8. SEO Monitoring & Testing

### Tools
- **Google Search Console:** Monitor indexing, keywords, click-through rates
- **Google Analytics 4:** Track organic search traffic
- **Lighthouse:** Periodic accessibility and performance audits
- **Schema.org Validator:** Verify structured data correctness

### Regular Checks
1. **Monthly:** Review Search Console for indexing errors
2. **Quarterly:** Audit top pages for SEO best practices
3. **Before release:** Validate structured data on new page types
4. **Weekly:** Monitor Core Web Vitals in CrUX data

### Performance Targets
- **Core Web Vitals:**
  - LCP (Largest Contentful Paint): < 2.5s
  - FID (First Input Delay): < 100ms
  - CLS (Cumulative Layout Shift): < 0.1
- **Page Load:** < 3 seconds on 4G
- **Mobile Usability:** Pass Mobile Friendly Test

## 9. Content Guidelines

### Keyword Strategy
- **Primary keyword:** Include in title, H1, first paragraph
- **Long-tail keywords:** Naturally in content (3-5 variants per page)
- **LSI keywords:** Related terms for context (20% of content)
- **Avoid:** Keyword stuffing, unnatural phrasing

### Heading Hierarchy
```
H1: Page main title (only one per page)
  H2: Major sections
    H3: Subsections
      H4-H6: Details (use sparingly)
```

### Internal Linking
- Link to related profiles, rooms, and content
- Use descriptive anchor text (not "click here")
- Aim for 3-5 internal links per page
- Prioritize linking to high-value pages

## 10. Canonical URLs

All pages should include self-referential canonical tags:
```html
<link rel="canonical" href="https://zobia.org/r/room-slug" />
```

This prevents duplicate content issues and consolidates ranking signals.

## Checklist: New Page SEO Implementation

- [ ] Title tag (50-60 chars)
- [ ] Meta description (155-160 chars)
- [ ] OpenGraph tags (title, description, image, url)
- [ ] Twitter Card tags
- [ ] Canonical URL
- [ ] H1 heading on page
- [ ] Alt text on all images
- [ ] Structured data (JSON-LD) if applicable
- [ ] Internal links (3-5)
- [ ] Mobile-friendly layout
- [ ] Page load time < 3 seconds
- [ ] Validated with Lighthouse

## Resources

- [Google Search Central](https://developers.google.com/search)
- [Schema.org](https://schema.org/)
- [Next.js Metadata API](https://nextjs.org/docs/app/building-your-application/optimizing/metadata)
- [Web.dev Performance Guide](https://web.dev/performance/)
- 
