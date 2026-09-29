import type { Metadata } from 'next';
import Link from 'next/link';
import { Mail, Phone } from 'lucide-react';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';
import { Container } from '@/components/marketing/primitives';
import { CONTACT, ROUTES, telHref } from '@/components/marketing/routes';
import { displayFont } from '@/components/marketing/display-font';
import { marketingMetadata } from '@/components/marketing/page-metadata';
import { JsonLd, faqPageJsonLd } from '@/components/marketing/json-ld';

export const metadata: Metadata = marketingMetadata({
  path: '/support',
  title: 'Support',
  description: 'Get help with your Kitabu Yetu group, a payment, or your account.',
});

/**
 * Grounded in what the platform actually does — no invented features, no
 * promised troubleshooting steps for things that don't exist (an API, a
 * self-serve export tool, etc.). See app/docs/page.tsx for why there's no
 * public API reference here: there is no public API.
 */
const FAQ_CATEGORIES: { heading: string; items: [string, string][] }[] = [
  {
    heading: 'Account & access',
    items: [
      [
        'I forgot my password.',
        'Contact support directly with your registered phone number so we can help you regain access — there is no self-serve password reset by email yet.',
      ],
      [
        'I belong to more than one group. Do I need separate accounts?',
        'No. One login can belong to more than one group or organization; switch between them from inside the app once signed in.',
      ],
      [
        "I'm a member, not an officer — what can I see?",
        'Members can see their own contribution, loan and welfare history. Editing group records is limited to the chairperson, treasurer and secretary roles.',
      ],
    ],
  },
  {
    heading: 'Payments & M-Pesa',
    items: [
      [
        "A payment didn't reflect in my account.",
        "M-Pesa payments are matched automatically by account reference, but if a reference number is missing or mistyped it may need manual reconciliation. Reach out with the M-Pesa confirmation code (the one that starts with a letter, e.g. QDE456UVW) and we'll help trace it.",
      ],
      [
        'How long does a contribution take to show up after paying?',
        "Usually within seconds — Safaricom's payment confirmation arrives, and Kitabu Yetu posts it to your group's ledger automatically. If it's been more than a few minutes, contact support with the confirmation code.",
      ],
      [
        'Can members pay by something other than M-Pesa?',
        'A group can record cash, bank transfer or cheque contributions directly in the ledger as well — M-Pesa is the only channel that posts automatically.',
      ],
    ],
  },
  {
    heading: 'Groups & data',
    items: [
      [
        'Can we bring in our existing records?',
        'Yes. Every plan supports bulk CSV import for members and historical contributions, so you are not starting from a blank book.',
      ],
      [
        "Can another group see our group's records?",
        "No. Each group's records are isolated at the database level — this is enforced by the database itself, not just by the app's screens.",
      ],
      [
        'Who can add or remove members?',
        'Group officials (chairperson, treasurer, secretary) can add, edit or deactivate member records from within the app.',
      ],
    ],
  },
  {
    heading: 'Billing & plans',
    items: [
      [
        'Can we change plan later?',
        'Yes. Buy a different plan by M-Pesa at any time from your billing page and it activates immediately — there is no lock-in period.',
      ],
      [
        'What happens if we run out of SMS credits?',
        'Sending never stops outright — once your included monthly allowance is used up, you top up credits from your billing page, and purchased credits are drawn on after the included allowance.',
      ],
      [
        'Is there a free plan?',
        'No. Every plan is paid, and bought self-service by M-Pesa. See the full price list on the Pricing page.',
      ],
    ],
  },
];

export default function SupportPage() {
  return (
    <div className={`${displayFont.variable} flex min-h-screen flex-col bg-white`}>
      <SiteHeader />

      <main id="main" className="flex-1">
        <div className="border-b border-brand-100 bg-white pb-10 pt-24 lg:pb-12 lg:pt-36">
          <Container>
            <div className="max-w-3xl">
              <p className="inline-block rounded-lg border border-brand-100 px-3 py-1 text-[0.9375rem] font-medium text-brand-500">
                Support
              </p>
              <h1 className="mt-4 font-display text-[2.5rem] font-bold leading-[1.1] text-finanza-dark sm:text-5xl">
                Need a hand with <em className="not-italic text-brand-500">your group</em>?
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-finanza-text">
                If you&apos;re a member of a group, your chairperson, secretary or treasurer can often help directly.
                Otherwise, reach us — real people, not a ticket queue.
              </p>
            </div>
          </Container>
        </div>

        <Container className="py-14 md:py-20">
          <div className="grid gap-5 sm:grid-cols-2">
            <a
              href={`mailto:${CONTACT.supportEmail}`}
              className="group flex items-center gap-4 rounded-lg border border-brand-100 bg-white p-6 transition-colors hover:border-brand-500/40"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                <Mail aria-hidden="true" className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-finanza-dark">Email support</span>
                <span className="block text-[0.9375rem] text-finanza-text">{CONTACT.supportEmail}</span>
              </span>
            </a>
            <a
              href={telHref(CONTACT.phones[0])}
              className="group flex items-center gap-4 rounded-lg border border-brand-100 bg-white p-6 transition-colors hover:border-brand-500/40"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                <Phone aria-hidden="true" className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-finanza-dark">Call us</span>
                <span className="block text-[0.9375rem] text-finanza-text">{CONTACT.phones[0]}</span>
              </span>
            </a>
          </div>

          {FAQ_CATEGORIES.map((category) => (
            <section key={category.heading} className="mt-16 first:mt-20">
              <h2 className="font-display text-2xl font-semibold text-finanza-dark">{category.heading}</h2>
              <dl className="mt-8 grid gap-x-12 gap-y-8 md:grid-cols-2">
                {category.items.map(([question, answer]) => (
                  <div key={question} className="border-t border-brand-100 pt-6">
                    <dt className="text-base font-semibold text-finanza-dark">{question}</dt>
                    <dd className="mt-2.5 text-[0.9375rem] leading-relaxed text-finanza-text">{answer}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          <div className="mt-20 rounded-lg bg-finanza-dark px-7 py-8 text-white sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="font-display text-xl font-semibold">Still stuck?</p>
              <p className="mt-2 text-[0.9375rem] text-brand-100/85">
                Email or call us directly — see above — or browse{' '}
                <Link href={ROUTES.resources} className="font-medium text-brand-400 hover:underline">
                  guides in Resources
                </Link>
                .
              </p>
            </div>
          </div>
        </Container>
      </main>

      <SiteFooter />
      <JsonLd data={faqPageJsonLd(FAQ_CATEGORIES.flatMap((category) => category.items))} />
    </div>
  );
}
