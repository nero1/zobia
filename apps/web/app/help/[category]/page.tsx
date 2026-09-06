/**
 * app/help/[category]/page.tsx
 *
 * Help Center category page at the SEO-friendly /help/<category-slug> URL —
 * lists the category's published docs grouped by difficulty tier.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { listDocsByCategory, resolveCategorySlug, type HelpDifficulty } from "@/lib/help/service";

export const revalidate = 300;

const DIFFICULTY_ORDER: HelpDifficulty[] = ["first_time", "beginner", "intermediate", "advanced"];
const DIFFICULTY_LABEL: Record<HelpDifficulty, string> = {
  first_time: "First Time",
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category } = await params;
  try {
    const { category: cat } = await listDocsByCategory(category);
    return { title: `${cat.name} — Help Center — Zobia Social`, description: cat.description ?? undefined };
  } catch {
    return { title: "Help Center — Zobia Social" };
  }
}

export default async function HelpCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;

  try {
    const { category: cat, docs } = await listDocsByCategory(category);
    const byDifficulty = DIFFICULTY_ORDER.map((d) => ({ difficulty: d, docs: docs.filter((doc) => doc.difficulty === d) })).filter((g) => g.docs.length > 0);

    return (
      <main id="main-content" className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-4 py-12">
          <Link href="/help" className="text-sm text-primary underline">&larr; Help Center</Link>
          <h1 className="mt-2 mb-2 text-3xl font-bold">{cat.name}</h1>
          {cat.description && <p className="mb-8 text-muted-foreground">{cat.description}</p>}

          {byDifficulty.length === 0 ? (
            <p className="text-sm text-muted-foreground">No docs published in this category yet.</p>
          ) : (
            <div className="space-y-8">
              {byDifficulty.map((group) => (
                <section key={group.difficulty}>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{DIFFICULTY_LABEL[group.difficulty]}</h2>
                  <div className="space-y-2">
                    {group.docs.map((doc) => (
                      <Link key={doc.id} href={`/help/${cat.slug}/${doc.slug}`} className="block rounded-lg border border-border p-4 hover:border-primary hover:bg-muted/50">
                        <p className="font-medium">{doc.title}</p>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
    );
  } catch {
    const redirectSlug = await resolveCategorySlug(category);
    if (redirectSlug) redirect(`/help/${redirectSlug}`);
    notFound();
  }
}
