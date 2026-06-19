/**
 * lib/seo/metadata.ts
 *
 * SEO metadata utilities for generating meta tags, OpenGraph, and structured data.
 */

import { Metadata } from 'next';

export interface SEOConfig {
  title: string;
  description: string;
  keywords?: string[];
  canonical?: string;
  image?: string;
  imageAlt?: string;
  ogType?: 'website' | 'profile' | 'article';
  twitterHandle?: string;
  author?: string;
}

/**
 * Generate Next.js Metadata object for a page.
 * Includes meta tags, OpenGraph, Twitter Card, and canonical URLs.
 */
export function generateMetadata(config: SEOConfig): Metadata {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://zobia.vercel.app';
  const title = `${config.title} | Zobia Social`;
  const description = config.description;
  const image = config.image || `${baseUrl}/og-default.png`;
  const canonical = config.canonical || baseUrl;

  return {
    title,
    description,
    keywords: config.keywords,
    metadataBase: new URL(baseUrl),
    alternates: { canonical },
    authors: config.author ? [{ name: config.author }] : undefined,
    openGraph: {
      title,
      description,
      url: canonical,
      type: config.ogType || 'website',
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: config.imageAlt || config.title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
      creator: config.twitterHandle || '@ZobiaSocial',
    },
  };
}

/**
 * Generate JSON-LD structured data for a page.
 * Helps search engines understand page content (Schema.org).
 */
export function generateStructuredData(
  type: 'Person' | 'Thing' | 'LocalBusiness' | 'BreadcrumbList',
  data: Record<string, any>
): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://zobia.vercel.app';

  const schema = {
    '@context': 'https://schema.org',
    '@type': type,
    ...data,
  };

  return JSON.stringify(schema);
}

// Pre-built structured data generators

/**
 * Generate Person schema for user/creator profiles.
 */
export function generatePersonSchema(profile: {
  name: string;
  description?: string;
  image?: string;
  url?: string;
  sameAs?: string[];
}): string {
  return generateStructuredData('Person', {
    name: profile.name,
    description: profile.description,
    image: profile.image,
    url: profile.url,
    sameAs: profile.sameAs,
  });
}

/**
 * Generate Breadcrumb schema for navigation.
 */
export function generateBreadcrumbSchema(items: Array<{ name: string; url: string }>): string {
  const itemListElement = items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    item: item.url,
  }));

  return generateStructuredData('BreadcrumbList', {
    itemListElement,
  });
}

/**
 * Generate LocalBusiness schema (for room/space pages).
 */
export function generateLocalBusinessSchema(business: {
  name: string;
  description?: string;
  url?: string;
  image?: string;
  genre?: string;
}): string {
  return generateStructuredData('Thing', {
    '@type': 'LocalBusiness',
    name: business.name,
    description: business.description,
    url: business.url,
    image: business.image,
    genre: business.genre,
  });
}
