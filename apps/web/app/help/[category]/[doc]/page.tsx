/**
 * app/help/[category]/[doc]/page.tsx
 *
 * Help Center doc page at the SEO-friendly /help/<category-slug>/<doc-slug>
 * URL (Feature 2 §1). No auth wall. Ends with the "Ask AI" block (Feature 2
 * §5-6), a client island that branches by auth/eligibility state.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDoc, resolveDocRedirect } from "@/lib/help/service";
import { AskAiBlock } from "@/components/help/AskAiBlock";

export const revalidate = 300;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";

export async function generateMetadata({ params }: { params: Promise<{ category: string; doc: string }> }): Promise<Metadata> {
  const { category, doc } = await params;
  try {
    const { doc: d } = await getDoc(category, doc);
    return {
      title: d.seo_title || `${d.title} — Help Center — Zobia Social`,
      description: d.seo_description || d.title,
      alternates: { canonical: `${APP_URL}/help/${category}/${doc}` },
    };
  } catch {
    return { title: "Help Center — Zobia Social" };
  }
}

export default async function HelpDocPage({ params }: { params: Promise<{ category: string; doc: string }> }) {
  const { category, doc } = await params;

  try {
    const { category: cat, doc: d } = await getDoc(category, doc);
    return (
      <main id="main-content" className="min-h-screen bg-background">
        <article className="max-w-3xl mx-auto px-4 py-12">
          <Link href={`/help/${cat.slug}`} className="text-sm text-primary underline">&larr; {cat.name}</Link>
          <h1 className="mt-2 mb-6 text-3xl font-bold">{d.title}</h1>
          {/* eslint-disable-next-line react/no-danger */}
          <div className="prose prose-neutral dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: d.body_html }} />

          <div className="mt-12 pt-8 border-t border-border">
            <AskAiBlock docId={d.id} docTitle={d.title} />
          </div>
        </article>
      </main>
    );
  } catch {
    const redirectTo = await resolveDocRedirect(category, doc);
    if (redirectTo) redirect(`/help/${redirectTo.categorySlug}/${redirectTo.docSlug}`);
    notFound();
  }
}
