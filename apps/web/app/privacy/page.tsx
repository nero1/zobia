/**
 * app/privacy/page.tsx
 *
 * Privacy Policy – public, statically rendered.
 */

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy – Zobia Social",
  description: "Learn how Zobia Social collects, uses, and protects your personal information.",
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
  { id: "overview", title: "Overview" },
  { id: "collect", title: "1. Information We Collect" },
  { id: "use", title: "2. How We Use Your Information" },
  { id: "sharing", title: "3. Sharing Your Information" },
  { id: "security", title: "4. Data Security" },
  { id: "retention", title: "5. Data Retention" },
  { id: "rights", title: "6. Your Rights" },
  { id: "cookies", title: "7. Cookies & Tracking" },
  { id: "children", title: "8. Children's Privacy" },
  { id: "international", title: "9. International Users" },
  { id: "changes", title: "10. Changes to This Policy" },
  { id: "contact", title: "11. Contact Us" },
];

export default function PrivacyPage() {
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
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            Last updated: {LAST_UPDATED}
          </p>
          <p className="mt-4 text-neutral-600 dark:text-neutral-400">
            Zobia Social (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) is committed to protecting your personal
            information. This Privacy Policy explains what data we collect, why we collect it,
            and how we use and protect it.
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

                <Section id="overview" title="Overview">
                  <p>
                    This policy applies to all users of Zobia Social, including visitors,
                    registered users, creators, and business accounts. It covers data collected
                    through our web app, mobile app (Android and iOS), and any related services.
                  </p>
                  <p>
                    By using Zobia Social, you agree to the practices described in this Privacy
                    Policy. If you do not agree, please discontinue use of the Service.
                  </p>
                </Section>

                <Section id="collect" title="1. Information We Collect">
                  <p>We collect the following types of information:</p>

                  <div className="space-y-4">
                    <div>
                      <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                        Information you provide directly:
                      </p>
                      <ul className="mt-1 list-inside list-disc space-y-1 pl-2">
                        <li>Name, username, and profile photo</li>
                        <li>Email address and password (if using email registration)</li>
                        <li>Bio, location, and other optional profile details</li>
                        <li>Messages, posts, and content you create or share</li>
                        <li>Payment and billing information (processed via secure third-party providers)</li>
                        <li>Bank account details (for creators using payout features)</li>
                        <li>Identity verification documents (if required for creator payouts)</li>
                      </ul>
                    </div>

                    <div>
                      <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                        Information collected automatically:
                      </p>
                      <ul className="mt-1 list-inside list-disc space-y-1 pl-2">
                        <li>Device information (type, operating system, browser)</li>
                        <li>IP address and approximate location</li>
                        <li>Usage data (pages visited, features used, session duration)</li>
                        <li>Log data (error logs, request timestamps)</li>
                        <li>Cookies and similar tracking technologies</li>
                      </ul>
                    </div>

                    <div>
                      <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                        Information from third parties:
                      </p>
                      <ul className="mt-1 list-inside list-disc space-y-1 pl-2">
                        <li>OAuth data from Google or Telegram (name, email, profile photo) when you sign in via these providers</li>
                        <li>Referral data when you join via a referral link</li>
                      </ul>
                    </div>
                  </div>
                </Section>

                <Section id="use" title="2. How We Use Your Information">
                  <p>We use the information we collect to:</p>
                  <ul className="list-inside list-disc space-y-1 pl-2">
                    <li>Create and manage your account</li>
                    <li>Provide, operate, and improve the Service</li>
                    <li>Personalise your experience (feed, recommendations, leaderboards)</li>
                    <li>Process payments and manage subscriptions</li>
                    <li>Send notifications about activity, messages, and platform updates</li>
                    <li>Enforce our Terms of Service and Community Guidelines</li>
                    <li>Detect and prevent fraud, abuse, and security threats</li>
                    <li>Comply with legal obligations</li>
                    <li>Communicate important service announcements</li>
                    <li>Conduct analytics to understand how users interact with the platform</li>
                  </ul>
                  <p>
                    We do not sell your personal data to third parties for marketing purposes.
                  </p>
                </Section>

                <Section id="sharing" title="3. Sharing Your Information">
                  <p>We may share your information with:</p>
                  <ul className="list-inside list-disc space-y-1 pl-2">
                    <li>
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">Service providers:</span>{" "}
                      Trusted third parties who help us operate the platform (cloud hosting, payment processing,
                      email delivery, analytics). These providers are contractually obligated to protect your data.
                    </li>
                    <li>
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">Other users:</span>{" "}
                      Your public profile, posts, and activity within rooms are visible to other users according
                      to your privacy settings.
                    </li>
                    <li>
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">Legal authorities:</span>{" "}
                      When required by law, court order, or to protect the rights and safety of our users.
                    </li>
                    <li>
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">Business transfers:</span>{" "}
                      In the event of a merger, acquisition, or sale of assets, your data may be transferred
                      as part of that transaction. You will be notified of any such change.
                    </li>
                  </ul>
                </Section>

                <Section id="security" title="4. Data Security">
                  <p>
                    We take data security seriously and implement appropriate technical and
                    organisational measures to protect your information against unauthorised access,
                    alteration, disclosure, or destruction. These measures include:
                  </p>
                  <ul className="list-inside list-disc space-y-1 pl-2">
                    <li>Encryption of data in transit using TLS/HTTPS</li>
                    <li>Encryption of sensitive data at rest</li>
                    <li>Regular security audits and vulnerability assessments</li>
                    <li>Access controls limiting who can access your data internally</li>
                    <li>JWT-based authentication with short expiry windows</li>
                    <li>Optional two-factor authentication (2FA) for your account</li>
                  </ul>
                  <p>
                    No method of transmission over the internet is 100% secure. While we strive to
                    protect your data, we cannot guarantee absolute security. In the event of a data
                    breach, we will notify affected users as required by applicable law.
                  </p>
                </Section>

                <Section id="retention" title="5. Data Retention">
                  <p>
                    We retain your personal data for as long as your account is active or as needed
                    to provide the Service. If you delete your account, we will delete or anonymise
                    your personal data within 30 days, except where:
                  </p>
                  <ul className="list-inside list-disc space-y-1 pl-2">
                    <li>Retention is required by law (e.g. tax records, financial transaction logs)</li>
                    <li>Data is needed to resolve disputes or enforce our Terms</li>
                    <li>Backup systems have not yet cycled (typically up to 90 days)</li>
                  </ul>
                  <p>
                    Some aggregated, anonymised data may be retained indefinitely for analytics purposes.
                  </p>
                </Section>

                <Section id="rights" title="6. Your Rights">
                  <p>
                    Depending on your location, you may have the following rights regarding your
                    personal data:
                  </p>
                  <ul className="list-inside list-disc space-y-1 pl-2">
                    <li><span className="font-medium">Access:</span> Request a copy of the data we hold about you.</li>
                    <li><span className="font-medium">Correction:</span> Request correction of inaccurate or incomplete data.</li>
                    <li><span className="font-medium">Deletion:</span> Request deletion of your account and associated data.</li>
                    <li><span className="font-medium">Portability:</span> Request your data in a machine-readable format.</li>
                    <li><span className="font-medium">Objection:</span> Object to certain types of data processing.</li>
                    <li><span className="font-medium">Restriction:</span> Request that we restrict processing of your data.</li>
                  </ul>
                  <p>
                    To exercise these rights, visit your account settings or contact us at{" "}
                    <a
                      href="mailto:privacy@zobia.social"
                      className="text-primary-600 hover:underline dark:text-primary-400"
                    >
                      privacy@zobia.social
                    </a>
                    . We will respond to requests within 30 days.
                  </p>
                </Section>

                <Section id="cookies" title="7. Cookies & Tracking">
                  <p>
                    We use cookies and similar technologies to maintain your session, remember your
                    preferences (such as language and theme), and analyse platform usage.
                  </p>

                  <div className="space-y-3">
                    <div>
                      <p className="font-semibold text-neutral-900 dark:text-neutral-100">Essential cookies:</p>
                      <p>Required for the platform to function (session management, authentication).</p>
                    </div>
                    <div>
                      <p className="font-semibold text-neutral-900 dark:text-neutral-100">Preference cookies:</p>
                      <p>Remember your language, theme, and other settings.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-neutral-900 dark:text-neutral-100">Analytics cookies:</p>
                      <p>Help us understand how users interact with the platform so we can improve it.</p>
                    </div>
                  </div>

                  <p>
                    You can manage your cookie preferences through your browser settings. Disabling
                    certain cookies may affect platform functionality.
                  </p>
                </Section>

                <Section id="children" title="8. Children's Privacy">
                  <p>
                    Zobia Social is not intended for children under the age of 13. We do not
                    knowingly collect personal data from children under 13. If we become aware that
                    we have inadvertently collected data from a child under 13, we will promptly
                    delete that data.
                  </p>
                  <p>
                    If you believe a child under 13 has created an account, please contact us at{" "}
                    <a
                      href="mailto:privacy@zobia.social"
                      className="text-primary-600 hover:underline dark:text-primary-400"
                    >
                      privacy@zobia.social
                    </a>
                    .
                  </p>
                </Section>

                <Section id="international" title="9. International Users">
                  <p>
                    Zobia Social is operated from Nigeria. If you are accessing the Service from
                    outside Nigeria, please be aware that your information may be transferred to and
                    processed in Nigeria or other countries where our service providers operate.
                  </p>
                  <p>
                    By using the Service, you consent to the transfer of your information to Nigeria
                    and other countries, which may have different data protection rules than your country.
                  </p>
                  <p>
                    For users in the European Economic Area (EEA) or United Kingdom, we comply with
                    applicable data protection regulations including GDPR where required.
                  </p>
                </Section>

                <Section id="changes" title="10. Changes to This Policy">
                  <p>
                    We may update this Privacy Policy from time to time. When we make significant
                    changes, we will notify you via an in-app announcement or email at least 14 days
                    before the changes take effect.
                  </p>
                  <p>
                    Your continued use of the Service after changes take effect constitutes your
                    acceptance of the updated Privacy Policy. The &quot;Last updated&quot; date at the top
                    of this page reflects the most recent revision.
                  </p>
                </Section>

                <Section id="contact" title="11. Contact Us">
                  <p>
                    If you have questions, concerns, or requests related to this Privacy Policy or
                    how we handle your data, please contact our privacy team:
                  </p>
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">Zobia Social – Privacy Team</p>
                    <p className="mt-1 text-neutral-600 dark:text-neutral-400">
                      Email:{" "}
                      <a
                        href="mailto:privacy@zobia.social"
                        className="text-primary-600 hover:underline dark:text-primary-400"
                      >
                        privacy@zobia.social
                      </a>
                    </p>
                  </div>
                </Section>

              </div>
            </div>

            {/* Also see terms */}
            <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Also see our{" "}
                <Link
                  href="/terms"
                  className="font-medium text-primary-600 hover:underline dark:text-primary-400"
                >
                  Terms of Service
                </Link>{" "}
                for the rules and guidelines governing your use of the platform.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-12 border-t border-neutral-200 bg-white py-8 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto max-w-6xl px-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
          <div className="mb-3 flex justify-center gap-6">
            <Link href="/terms" className="hover:underline hover:text-neutral-700 dark:hover:text-neutral-300">
              Terms of Service
            </Link>
            <Link href="/privacy" className="font-medium text-primary-600 hover:underline dark:text-primary-400">
              Privacy Policy
            </Link>
          </div>
          &copy; {new Date().getFullYear()} Zobia Social. All rights reserved.
        </div>
      </footer>
    </main>
  );
}
