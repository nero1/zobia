export const dynamic = "force-static";
export const revalidate = 3600;

/**
 * app/help/page.tsx
 *
 * Static FAQ / Help page — pre-rendered at build time, revalidated hourly.
 * Listed in robots.ts allow list and sitemap.ts static pages.
 */

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Help & FAQ — Zobia Social",
  description:
    "Find answers to common questions about Zobia Social — coins, stars, rooms, gifts, payouts, PIN security, and more.",
};

interface FAQItem {
  q: string;
  a: string;
}

interface FAQSection {
  id: string;
  title: string;
  items: FAQItem[];
}

const FAQ_SECTIONS: FAQSection[] = [
  {
    id: "account",
    title: "Account & Profile",
    items: [
      {
        q: "How do I create an account?",
        a: "Sign in with Google or Telegram from the login page. Your account is created automatically on first login.",
      },
      {
        q: "How do I change my username or display name?",
        a: "Go to Settings → Profile and update your display name. Usernames can only be changed once every 30 days.",
      },
      {
        q: "How do I delete my account?",
        a: "Go to Settings → Account → Delete Account. Your data is soft-deleted for 30 days; contact support to cancel within that window.",
      },
      {
        q: "Can I restore a deleted account?",
        a: "Yes, within 30 days of deletion. Use the account restore link sent to your registered email, or contact support.",
      },
    ],
  },
  {
    id: "coins",
    title: "Coins & Stars",
    items: [
      {
        q: "What are Coins?",
        a: "Coins are the in-app currency used to send gifts, unlock premium rooms, and tip creators. You can purchase Coin packs from the shop.",
      },
      {
        q: "What are Stars?",
        a: "Stars are a premium currency earned through subscriptions or special events. Stars can be converted to coins or used for exclusive features.",
      },
      {
        q: "How do I earn Coins without buying?",
        a: "Complete daily quests, level up your XP track, refer friends, and participate in guild events to earn free coins.",
      },
      {
        q: "Why are my coins missing after a purchase?",
        a: "Purchases are credited within a few seconds. If coins don't appear after 5 minutes, contact support with your payment reference — we will credit manually if verified.",
      },
    ],
  },
  {
    id: "rooms",
    title: "Rooms & Messaging",
    items: [
      {
        q: "What are Rooms?",
        a: "Rooms are public or private spaces where members can chat, share content, and interact in real time.",
      },
      {
        q: "How do I join a private room?",
        a: "Private rooms require an invite link or a one-time entry payment set by the room creator.",
      },
      {
        q: "How do I report an abusive message or user?",
        a: 'Long-press (mobile) or right-click (web) any message and select "Report". Moderators review all reports within 24 hours.',
      },
      {
        q: "Are direct messages private?",
        a: "DMs are encrypted in transit and stored server-side. Only you and the recipient can read them. Zobia staff can access messages only under a valid legal request.",
      },
    ],
  },
  {
    id: "gifts",
    title: "Gifts & Payouts",
    items: [
      {
        q: "How do gifts work?",
        a: "Send a gift in a Room or DM to show appreciation. Gifts cost Coins and convert to Stars on the recipient's side. Creators can withdraw Stars as cash.",
      },
      {
        q: "How do I withdraw my earnings as a creator?",
        a: "Go to Creator → Wallet → Withdraw. Payouts are processed within 3 business days. You must have completed identity verification (KYC) to withdraw.",
      },
      {
        q: "What is the minimum payout amount?",
        a: "The minimum withdrawal is ₦1,000 (or equivalent). Platform fee is 15% for standard creators and 10% for Pro/Max subscribers.",
      },
      {
        q: "My payout failed. What do I do?",
        a: "Payout failures are automatically retried up to 3 times. If still pending after 48 hours, contact support with your payout reference number.",
      },
    ],
  },
  {
    id: "security",
    title: "Security (PIN & 2FA)",
    items: [
      {
        q: "What is the Transaction PIN?",
        a: "A 4-6 digit PIN required before sending gifts, withdrawing funds, or transferring coins. Set it in Settings → Security → Transaction PIN.",
      },
      {
        q: "I forgot my Transaction PIN.",
        a: "Go to Settings → Security → Reset PIN. A verification code will be sent to your email. PINs cannot be recovered — only reset.",
      },
      {
        q: "What is two-factor authentication (2FA)?",
        a: "2FA adds a second layer of login security using an authenticator app (e.g. Google Authenticator). Enable it in Settings → Security → 2FA.",
      },
      {
        q: "I lost access to my 2FA app.",
        a: "Use one of the recovery codes generated when you set up 2FA. If you no longer have them, contact support with identity verification.",
      },
    ],
  },
  {
    id: "reporting",
    title: "Reporting Abuse",
    items: [
      {
        q: "How do I report a user?",
        a: 'Visit the user profile and tap "Report". Choose the reason (spam, harassment, inappropriate content) and submit.',
      },
      {
        q: "What happens after I report?",
        a: "Reports are reviewed by our Trust & Safety team within 24 hours. We may remove content, warn, suspend, or permanently ban violating accounts.",
      },
      {
        q: "Can I block someone?",
        a: 'Yes — visit their profile and tap "Block". Blocked users cannot see your profile, send you messages, or interact with your content.',
      },
      {
        q: "How do I report illegal content?",
        a: "Email safety@zobia.app immediately with a description and screenshots. Illegal content (e.g. CSAM) is reported to relevant authorities.",
      },
    ],
  },
];

export default function HelpPage() {
  return (
    <main id="main-content" className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">Help & FAQ</h1>
        <p className="text-muted-foreground mb-8">
          Find answers to common questions. Can&apos;t find what you need?{" "}
          <a
            href="mailto:support@zobia.app"
            className="text-primary underline hover:no-underline"
          >
            Contact support
          </a>
          .
        </p>

        {/* Section navigation */}
        <nav aria-label="FAQ sections" className="flex flex-wrap gap-2 mb-10">
          {FAQ_SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="text-sm px-3 py-1 rounded-full border border-border hover:bg-muted transition"
            >
              {section.title}
            </a>
          ))}
        </nav>

        {/* FAQ sections */}
        <div className="space-y-12">
          {FAQ_SECTIONS.map((section) => (
            <section key={section.id} id={section.id}>
              <h2 className="text-xl font-semibold mb-4 border-b border-border pb-2">
                {section.title}
              </h2>
              <dl className="space-y-4">
                {section.items.map((item, idx) => (
                  <div key={idx} className="rounded-lg border border-border p-4">
                    <dt className="font-medium mb-1">{item.q}</dt>
                    <dd className="text-sm text-muted-foreground">{item.a}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-border text-center text-sm text-muted-foreground">
          <p>
            Still need help?{" "}
            <a href="mailto:support@zobia.app" className="text-primary underline">
              Email us
            </a>{" "}
            or visit our{" "}
            <Link href="/" className="text-primary underline">
              home page
            </Link>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
