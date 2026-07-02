/**
 * lib/seo/metadata.ts
 *
 * SEO metadata utilities for generating meta tags, OpenGraph, and structured data.
 */

import { Metadata } from 'next';
import { env } from '@/lib/env';

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
  const baseUrl = env.NEXT_PUBLIC_APP_URL || 'https://zobia.vercel.app';
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
  type: 'Person' | 'Thing' | 'LocalBusiness' | 'BreadcrumbList' | 'QAPage' | 'BlogPosting',
  data: Record<string, any>
): string {
  const baseUrl = env.NEXT_PUBLIC_APP_URL || 'https://zobia.vercel.app';

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
 * Generate QAPage schema (schema.org) for a forum question detail page —
 * https://schema.org/QAPage. `acceptedAnswer` is the marked-best answer (if
 * any); the rest are listed as `suggestedAnswer`, matching how Stack
 * Overflow / Reddit question pages are marked up for rich Q&A search results.
 */
export function generateQAPageSchema(question: {
  title: string;
  body: string;
  url: string;
  createdAt: string;
  authorName?: string;
  answerCount: number;
  voteScore: number;
  answers: Array<{
    body: string;
    createdAt: string;
    authorName?: string;
    voteScore: number;
    isBest: boolean;
  }>;
}): string {
  const toAnswerSchema = (a: (typeof question.answers)[number]) => ({
    '@type': 'Answer',
    text: a.body,
    dateCreated: a.createdAt,
    upvoteCount: Math.max(a.voteScore, 0),
    author: a.authorName ? { '@type': 'Person', name: a.authorName } : undefined,
  });

  const best = question.answers.find((a) => a.isBest);
  const suggested = question.answers.filter((a) => a !== best);

  return generateStructuredData('QAPage', {
    mainEntity: {
      '@type': 'Question',
      name: question.title,
      text: question.body,
      url: question.url,
      answerCount: question.answerCount,
      upvoteCount: Math.max(question.voteScore, 0),
      dateCreated: question.createdAt,
      author: question.authorName ? { '@type': 'Person', name: question.authorName } : undefined,
      acceptedAnswer: best ? toAnswerSchema(best) : undefined,
      suggestedAnswer: suggested.length > 0 ? suggested.map(toAnswerSchema) : undefined,
    },
  });
}

/**
 * Generate BlogPosting schema (schema.org) for a blog article page —
 * https://schema.org/BlogPosting.
 */
export function generateArticleSchema(article: {
  title: string;
  description: string;
  url: string;
  image?: string;
  datePublished: string;
  authorName?: string;
}): string {
  return generateStructuredData('BlogPosting', {
    headline: article.title,
    description: article.description,
    url: article.url,
    image: article.image,
    datePublished: article.datePublished,
    author: article.authorName ? { '@type': 'Person', name: article.authorName } : undefined,
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
  return generateStructuredData('LocalBusiness', {
    name: business.name,
    description: business.description,
    url: business.url,
    image: business.image,
    genre: business.genre,
  });
}
