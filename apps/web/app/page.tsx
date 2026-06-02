/**
 * app/page.tsx
 *
 * Landing page for Zobia Social.
 * Marketing page shown to unauthenticated visitors.
 */

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Zobia Social – Connect, Engage, Belong",
  description:
    "Join Zobia Social – the platform for authentic connections, vibrant rooms, and real community.",
};

// ---------------------------------------------------------------------------
// Feature card
// ---------------------------------------------------------------------------

interface FeatureCardProps {
  icon: string;
  title: string;
  description: string;
}

function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-4 text-3xl">{icon}</div>
      <h3 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
        {title}
      </h3>
      <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
        {description}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const features: FeatureCardProps[] = [
  {
    icon: "🏠",
    title: "Public Rooms",
    description:
      "Join topic-based rooms and connect with people who share your interests.",
  },
  {
    icon: "💬",
    title: "Direct Messages",
    description:
      "Private, end-to-end encrypted conversations with friends and connections.",
  },
  {
    icon: "🏆",
    title: "Rankings & Rewards",
    description:
      "Earn ranks, receive gifts, and climb the leaderboard in your community.",
  },
  {
    icon: "🌍",
    title: "Multi-language",
    description:
      "Available in English, Arabic, French, Hausa, Yorùbá, and Igbo.",
  },
  {
    icon: "🤖",
    title: "AI Assistant",
    description:
      "Powered by DeepSeek with Gemini fallback – your always-on smart companion.",
  },
  {
    icon: "📱",
    title: "Works Everywhere",
    description:
      "Progressive Web App – install on any device, works offline.",
  },
];

/**
 * Public landing page.
 */
export default function LandingPage() {
  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      {/* Header */}
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-xl font-bold text-primary-600 dark:text-primary-400">
            Zobia Social
          </span>
          <nav className="flex items-center gap-4">
            <Link
              href="/auth/login"
              className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Log in
            </Link>
            <Link
              href="/auth/register"
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h1 className="mb-6 text-5xl font-extrabold leading-tight tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-6xl">
          Connect.{" "}
          <span className="text-primary-600 dark:text-primary-400">Engage.</span>{" "}
          Belong.
        </h1>
        <p className="mx-auto mb-10 max-w-2xl text-xl text-neutral-600 dark:text-neutral-400">
          Zobia Social is where communities form, conversations flow, and
          real connections are made. Join thousands of people already on the
          platform.
        </p>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href="/auth/register"
            className="w-full rounded-xl bg-primary-600 px-8 py-4 text-base font-semibold text-white shadow-elevated transition-colors hover:bg-primary-700 sm:w-auto"
          >
            Create free account
          </Link>
          <Link
            href="/auth/login"
            className="w-full rounded-xl border border-neutral-300 bg-white px-8 py-4 text-base font-semibold text-neutral-700 shadow-card transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700 sm:w-auto"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="mb-12 text-center text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          Everything you need to build your community
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <FeatureCard key={feature.title} {...feature} />
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-200 bg-white py-8 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto max-w-6xl px-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
          &copy; {new Date().getFullYear()} Zobia Social. All rights reserved.
        </div>
      </footer>
    </main>
  );
}
