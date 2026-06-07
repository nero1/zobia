/**
 * app/terms/page.tsx
 *
 * Terms of Service – public, statically rendered.
 */

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service – Zobia Social",
  description: "Read the Zobia Social Terms of Service to understand the rules and guidelines for using our platform.",
};

const LAST_UPDATED = "June 7, 2026";

interface SectionProps {
  id: string;
  title: string;
  children: React.ReactNode;
}

function Section({ id, title, children }: SectionProps) {
  return (
    <section id={id} className="scroll-mt-8">
      <h2 className="mb-3 text-xl font-bold text-neutral-900 dark:text-neutral-50">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
        {children}
      </div>
    </section>
  );
}

const sections = [
  { id: "acceptance", title: "1. Acceptance of Terms" },
  { id: "service", title: "2. Description of Service" },
  { id: "accounts", title: "3. User Accounts" },
  { id: "content", title: "4. User Content" },
  { id: "prohibited", title: "5. Prohibited Conduct" },
  { id: "payments", title: "6. Payments, Coins & Rewards" },
  { id: "ip", title: "7. Intellectual Property" },
  { id: "privacy", title: "8. Privacy" },
  { id: "termination", title: "9. Termination" },
  { id: "disclaimers", title: "10. Disclaimers" },
  { id: "liability", title: "11. Limitation of Liability" },
  { id: "changes", title: "12. Changes to These Terms" },
  { id: "governing", title: "13. Governing Law" },
  { id: "contact", title: "14. Contact Us" },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      {/* Header */}
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="text-xl font-bold text-primary-600 dark:text-primary-400"
          >
            Zobia Social
          </Link>
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

      <div className="mx-auto max-w-4xl px-6 py-12">
        {/* Page title */}
        <div className="mb-10">
          <Link
            href="/"
            className="mb-4 inline-block text-sm font-medium text-primary-600 hover:underline dark:text-primary-400"
          >
            ← Back to Home
          </Link>
          <h1 className="text-4xl font-extrabold tracking-tight text-neutral-900 dark:text-neutral-50">
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            Last updated: {LAST_UPDATED}
          </p>
          <p className="mt-4 text-neutral-600 dark:text-neutral-400">
            Please read these Terms of Service carefully before using Zobia Social. By accessing or
            using the platform, you agree to be bound by these terms.
          </p>
        </div>

        <div className="flex flex-col gap-10 lg:flex-row lg:gap-16">
          {/* Table of contents – sticky on desktop */}
          <aside className="shrink-0 lg:w-56">
            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900 lg:sticky lg:top-6">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Table of Contents
              </p>
              <nav className="space-y-1">
                {sections.map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    className="block rounded-md px-2 py-1.5 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                  >
                    {s.title}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          {/* Content */}
          <div className="min-w-0 flex-1 space-y-10">
            <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
              <div className="space-y-10">

                <Section id="acceptance" title="1. Acceptance of Terms">
                  <p>
                    By accessing or using Zobia Social (the &quot;Service&quot;), you confirm that you are at
                    least 13 years old and that you agree to be legally bound by these Terms of Service
                    (&quot;Terms&quot;). If you are using the Service on behalf of an organisation, you represent
                    that you have the authority to bind that organisation to these Terms.
                  </p>
                  <p>
                    If you do not agree to these Terms, do not access or use the Service.
                  </p>
                </Section>

                <Section id="service" title="2. Description of Service">
                  <p>
                    Zobia Social is a community platform that allows users to connect, communicate, and
                    engage through public rooms, direct messages, group chats, events, and social features
                    including but not limited to leaderboards, guilds, quests, seasons, and creator tools.
                  </p>
                  <p>
                    We reserve the right to modify, suspend, or discontinue any part of the Service at
                    any time with or without notice. We shall not be liable to you or any third party for
                    any modification, suspension, or discontinuation.
                  </p>
                </Section>

                <Section id="accounts" title="3. User Accounts">
                  <p>
                    You must create an account to access most features of Zobia Social. You agree to:
                  </p>
                  <ul className="list-inside list-disc space-y-1 pl-2">
                    <li>Provide accurate, current, and complete information during registration.</li>
                    <li>Keep your account credentials secure and confidential.</li>
                    <li>Notify us immediately of any unauthorised use of your account.</li>
                    <li>Be responsible for all activity that occurs under your account.</li>
                    <li>Not create multiple accounts to circumvent bans or restrictions.</li>
                  </ul>
                  <p>
                    We reserve the right to suspend or terminate accounts that violate these Terms,
                    provide false information, or engage in harmful behaviour.
                  </p>
                </Section>

                <Section id="content" title="4. User Content">
                  <p>
                    You retain ownership of content you create and share on Zobia Social. By posting
                    content, you grant Zobia Social a non-exclusive, royalty-free, worldwide licence to
                    use, display, reproduce, and distribute your content for the purpose of operating the
                    Service.
                  </p>
                  <p>
                    You are solely responsible for your content and represent that:
                  </p>
                  <ul className="list-inside list-disc space-y-1 pl-2">
                    <li>You own or have the necessary rights to share the content.</li>
                    <li>Your content does not violate the rights of any third party.</li>
                    <li>Your content complies with all applicable laws and these Terms.</li>
                  </ul>
                  <p>
                    We may remove content that violates these Terms or our Community Guidelines at our
                    discretion, without prior notice.
                  </p>
                </Section>

                <Section id="prohibited" title="5. Prohibited Conduct">
                  <p>You agree not to:</p>
                  <ul className="list-inside list-disc space-y-1 pl-2">
                    <li>Post content that is abusive, harassing, hateful, obscene, or defamatory.</li>
                    <li>Impersonate any person or entity, or misrepresent your affiliation with any person or entity.</li>
                    <li>Spam, scam, or engage in any form of deceptive activity.</li>
                    <li>Distribute malware, viruses, or any harmful code.</li>
                    <li>Attempt to gain unauthorised access to any part of the Service.</li>
                    <li>Use automated tools (bots, scrapers) to collect data or interact with the Service without permission.</li>
                    <li>Exploit bugs or vulnerabilities for personal gain.</li>
                    <li>Sell, transfer, or trade your account or virtual items outside of authorised channels.</li>
                    <li>Use the Service for any illegal purpose or in violation of any applicable law.</li>
                  </ul>
                  <p>
                    Violations may result in immediate account suspension or permanent termination.
                  </p>
                </Section>

                <Section id="payments" title="6. Payments, Coins & Rewards">
                  <p>
                    Zobia Social offers virtual currency (&quot;Coins&quot; and &quot;Stars&quot;) used within the platform.
                    All purchases of virtual currency are final and non-refundable unless required by law.
                    Virtual currency has no real-world monetary value and cannot be exchanged for cash
                    outside of creator payout programmes.
                  </p>
                  <p>
                    Subscription plans renew automatically unless cancelled before the renewal date.
                    Annual plans are charged as a single payment. You may cancel at any time; access
                    continues until the end of the current billing period.
                  </p>
                  <p>
                    Creator payouts are subject to minimum thresholds, identity verification, and
                    applicable withholding taxes. We reserve the right to withhold payouts for accounts
                    under investigation for fraud or policy violations.
                  </p>
                </Section>

                <Section id="ip" title="7. Intellectual Property">
                  <p>
                    All intellectual property in the Zobia Social platform — including the name, logo,
                    design, code, and brand assets — is owned by Zobia Social or its licensors. You may
                    not copy, modify, distribute, sell, or lease any part of the Service without our
                    express written consent.
                  </p>
                  <p>
                    The name &quot;Zobia Social&quot; and associated marks may not be used in any way that
                    implies endorsement or affiliation without prior written approval.
                  </p>
                </Section>

                <Section id="privacy" title="8. Privacy">
                  <p>
                    Your use of Zobia Social is also governed by our{" "}
                    <Link
                      href="/privacy"
                      className="font-medium text-primary-600 hover:underline dark:text-primary-400"
                    >
                      Privacy Policy
                    </Link>
                    , which is incorporated into these Terms by reference. By using the Service, you
                    consent to the collection and use of your information as described in the Privacy
                    Policy.
                  </p>
                </Section>

                <Section id="termination" title="9. Termination">
                  <p>
                    You may delete your account at any time from your account settings. Upon deletion,
                    your profile and content will be removed, subject to our data retention policies and
                    legal obligations.
                  </p>
                  <p>
                    We may suspend or terminate your access at any time if we believe you have violated
                    these Terms or for any other reason at our discretion. Termination does not entitle
                    you to a refund of any unused Coins, subscriptions, or other purchases.
                  </p>
                </Section>

                <Section id="disclaimers" title="10. Disclaimers">
                  <p>
                    Zobia Social is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind,
                    either express or implied. We do not warrant that the Service will be uninterrupted,
                    error-free, or free of viruses or other harmful components.
                  </p>
                  <p>
                    We are not responsible for the conduct of users or the accuracy, completeness, or
                    legality of any user-generated content.
                  </p>
                </Section>

                <Section id="liability" title="11. Limitation of Liability">
                  <p>
                    To the maximum extent permitted by law, Zobia Social and its affiliates, officers,
                    employees, and agents shall not be liable for any indirect, incidental, special,
                    consequential, or punitive damages, including loss of profits, data, or goodwill,
                    arising from your use of or inability to use the Service.
                  </p>
                  <p>
                    Our total liability for any claim arising from your use of the Service shall not
                    exceed the amount you paid us in the 12 months preceding the claim.
                  </p>
                </Section>

                <Section id="changes" title="12. Changes to These Terms">
                  <p>
                    We may update these Terms from time to time. We will notify you of significant
                    changes via an in-app announcement or email. Your continued use of the Service after
                    such notice constitutes your acceptance of the updated Terms.
                  </p>
                  <p>
                    We encourage you to review these Terms periodically. The &quot;Last updated&quot; date at
                    the top of this page reflects the most recent revision.
                  </p>
                </Section>

                <Section id="governing" title="13. Governing Law">
                  <p>
                    These Terms are governed by and construed in accordance with the laws of the Federal
                    Republic of Nigeria. Any disputes arising from these Terms or your use of the Service
                    shall be subject to the exclusive jurisdiction of the courts of Nigeria.
                  </p>
                </Section>

                <Section id="contact" title="14. Contact Us">
                  <p>
                    If you have questions about these Terms, please contact us at:
                  </p>
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">Zobia Social</p>
                    <p className="mt-1 text-neutral-600 dark:text-neutral-400">
                      Email:{" "}
                      <a
                        href="mailto:legal@zobia.social"
                        className="text-primary-600 hover:underline dark:text-primary-400"
                      >
                        legal@zobia.social
                      </a>
                    </p>
                  </div>
                </Section>

              </div>
            </div>

            {/* Also see privacy */}
            <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Also see our{" "}
                <Link
                  href="/privacy"
                  className="font-medium text-primary-600 hover:underline dark:text-primary-400"
                >
                  Privacy Policy
                </Link>{" "}
                for information on how we collect and use your data.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-12 border-t border-neutral-200 bg-white py-8 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto max-w-6xl px-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
          <div className="mb-3 flex justify-center gap-6">
            <Link href="/terms" className="font-medium text-primary-600 hover:underline dark:text-primary-400">
              Terms of Service
            </Link>
            <Link href="/privacy" className="hover:underline hover:text-neutral-700 dark:hover:text-neutral-300">
              Privacy Policy
            </Link>
          </div>
          &copy; {new Date().getFullYear()} Zobia Social. All rights reserved.
        </div>
      </footer>
    </main>
  );
}
