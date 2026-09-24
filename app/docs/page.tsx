import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';
import { Container } from '@/components/marketing/primitives';
import { ROUTES } from '@/components/marketing/routes';
import { fraunces } from '@/components/marketing/fraunces-font';
import { marketingMetadata } from '@/components/marketing/page-metadata';

export const metadata: Metadata = marketingMetadata({
  path: '/docs',
  title: 'Documentation',
  description: 'Getting-started guides for Kitabu Yetu — set up your group, collect by M-Pesa, and manage your book.',
});

/**
 * No fabricated API reference or written manual — there is no public API,
 * and no separate documentation content system exists yet. What genuinely
 * does exist (a real setup flow, real product pages, real pricing FAQ) is
 * organized here as a starting point instead of a one-paragraph stub, and
 * Resources (Sanity-backed, see /resources) is where deeper written guides
 * will land as they're published — this page links there, it doesn't
 * pretend to already be it.
 */
const GUIDES: { title: string; body: string; href: string }[] = [
  {
    title: 'Set up your group',
    body: 'Register, choose what to manage, add members and invite officials — the onboarding flow walks through it step by step.',
    href: ROUTES.startGroup,
  },
  {
    title: 'How Kitabu Yetu works',
    body: 'The six-step overview: create your group, set its rules, add members, start managing finances, communicate, and connect to growth opportunities.',
    href: '/how-it-works',
  },
  {
    title: 'What Bookkeeper covers',
    body: 'Members, contributions, savings, loans, welfare, shares, dividends, investments, accounting, M-Pesa and reports — the full book, explained.',
    href: ROUTES.bookkeeper,
  },
  {
    title: 'What Chama Reminder covers',
    body: 'Meeting, contribution and loan reminders, birthdays and announcements by SMS — no ledger required.',
    href: ROUTES.chamaReminder,
  },
  {
    title: 'Pricing questions',
    body: 'Plan prices, SMS allowances, switching plans, and moving from Chama Reminder to the full book — answered on the Pricing page.',
    href: ROUTES.pricing,
  },
  {
    title: 'Guides & resources',
    body: 'Longer-form guides on group bookkeeping and governance as they get published.',
    href: ROUTES.resources,
  },
];

export default function DocsPage() {
  return (
    <div className={`${fraunces.variable} flex min-h-screen flex-col bg-paper`}>
      <SiteHeader />

      <main id="main" className="flex-1">
        <div className="border-b border-brand-blue-900/10 bg-paper pb-14 pt-28 md:pb-16 md:pt-36">
          <Container>
            <div className="max-w-3xl">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-brand-700">
                Documentation
              </p>
              <h1 className="mt-5 font-display text-[2.25rem] font-light leading-[1.05] tracking-tight text-brand-blue-900 sm:text-5xl">
                Getting started with <em className="italic font-normal text-brand-600">Kitabu Yetu</em>
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-brand-blue-900/65">
                A written manual and API reference are on the way. In the meantime, here is where to start.
              </p>
            </div>
          </Container>
        </div>

        <Container className="py-14 md:py-20">
          <div className="grid gap-5 sm:grid-cols-2">
            {GUIDES.map((guide) => (
              <Link
                key={guide.title}
                href={guide.href}
                className="group flex flex-col rounded-lg border border-brand-blue-900/10 bg-white p-6 transition-colors hover:border-brand-500/40"
              >
                <h2 className="font-display text-xl font-normal text-brand-blue-900">{guide.title}</h2>
                <p className="mt-2 flex-1 text-[0.9375rem] leading-relaxed text-brand-blue-900/65">{guide.body}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
                  Read more
                  <ArrowRight
                    aria-hidden="true"
                    className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </span>
              </Link>
            ))}
          </div>

          <p className="mt-14 text-[0.9375rem] leading-relaxed text-brand-blue-900/60">
            Trying to do something specific — set up M-Pesa collections, understand a report, or integrate with the API
            as an enterprise partner?{' '}
            <Link href={ROUTES.support} className="font-medium text-brand-700 hover:underline">
              Contact support
            </Link>{' '}
            and we&apos;ll help directly.
          </p>
        </Container>
      </main>

      <SiteFooter />
    </div>
  );
}
