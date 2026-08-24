import type { Metadata } from 'next';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';
import { Container } from '@/components/marketing/primitives';
import { ROUTES } from '@/components/marketing/routes';
import {
  PLAN_MONTHLY_FEES, PLAN_SMS_ALLOWANCE, PLAN_COPY, SELF_SERVE_PLANS, PRODUCT_LABEL,
  type SubscriptionProduct,
} from '@/types/enums';

/**
 * No local price/feature data — everything below is read from the same source
 * of truth the billing page and the M-Pesa callback use (`types/enums.ts`).
 * This used to be a static, hand-maintained array that advertised a free tier
 * and prices (2,500 / 8,000) that disagreed with what the server actually
 * charges — see docs/audits/PRODUCT_CONCORDANCE_AUDIT_2026-08.md §1.1. A
 * server component importing the real constants directly, rather than a
 * client-side fetch, is what keeps this page correct with zero new public API
 * surface: it re-reads the same module the app itself prices against on every
 * render.
 *
 * Both products are priced here (audit §1.2 / Phase 2). Chama Reminder was
 * sellable server-side since migration 140 but had no public price anywhere.
 *
 * The 2026-08 redesign changed the presentation only. Every number, label and
 * feature bullet still comes from the constants; nothing was retyped.
 */

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Kitabu Yetu pricing: one monthly price for the whole group, not per member. ' +
    'Full bookkeeping with M-Pesa, or SMS reminders on their own with Chama Reminder.',
  alternates: {
    canonical: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://kitabuyetu.co.ke'}/pricing`,
  },
};

/** Where a "buy this" click goes. Kitabu Yetu is the default product, so it
 *  needs no query string; Chama Reminder must carry one or `register_group()`
 *  seeds it a chart of accounts it will never use. */
function registerHref(product: SubscriptionProduct): string {
  return product === 'kitabu_yetu' ? ROUTES.startGroup : `${ROUTES.startGroup}?product=${product}`;
}

function PlanGrid({ product }: { product: SubscriptionProduct }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {PLAN_COPY[product].map((plan) => {
        const isSelfServe = SELF_SERVE_PLANS.includes(plan.type);
        const featured = plan.type === 'growth';
        const fee = PLAN_MONTHLY_FEES[product][plan.type];

        return (
          <div
            key={plan.type}
            className={cn(
              'relative flex flex-col rounded-2xl p-7',
              featured
                ? 'bg-brand-blue-900 text-white ring-1 ring-brand-blue-900'
                : 'bg-white ring-1 ring-brand-blue-900/[0.09]',
            )}
          >
            {featured && (
              <span className="absolute -top-3 left-7 rounded-full bg-brand-500 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                Most popular
              </span>
            )}

            <h3
              className={cn(
                'font-mono text-[11px] font-medium uppercase tracking-[0.2em]',
                featured ? 'text-brand-400' : 'text-brand-600',
              )}
            >
              {plan.label}
            </h3>

            <p className="mt-4">
              {isSelfServe ? (
                <>
                  <span
                    className={cn(
                      'font-display text-4xl font-normal tabular-nums',
                      featured ? 'text-white' : 'text-brand-blue-900',
                    )}
                  >
                    KES {fee.toLocaleString()}
                  </span>
                  <span
                    className={cn(
                      'ml-2 text-sm',
                      featured ? 'text-brand-blue-100/55' : 'text-brand-blue-900/45',
                    )}
                  >
                    /month
                  </span>
                </>
              ) : (
                <span className="font-display text-3xl font-normal text-brand-blue-900">
                  By agreement
                </span>
              )}
            </p>

            <ul className="mt-7 flex-1 space-y-3">
              {/* The SMS allowance is read from PLAN_SMS_ALLOWANCE, the same
                  constant the subscription is created with — never retyped
                  here. A hand-maintained copy of a plan's numbers is exactly
                  what made this page advertise prices the server did not
                  charge (PRODUCT_CONCORDANCE_AUDIT_2026-08 §1.1). */}
              <li className="flex items-start gap-2.5">
                <Check
                  aria-hidden="true"
                  className={cn('mt-0.5 h-4 w-4 shrink-0', featured ? 'text-brand-400' : 'text-brand-600')}
                />
                <span className={cn('text-[0.9375rem]', featured ? 'text-brand-blue-100/80' : 'text-brand-blue-900/70')}>
                  {isSelfServe ? (
                    <>
                      <strong className="font-semibold">
                        {PLAN_SMS_ALLOWANCE[product][plan.type]} SMS
                      </strong>{' '}
                      included every month
                    </>
                  ) : (
                    'Negotiated SMS allowance'
                  )}
                </span>
              </li>
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5">
                  <Check
                    aria-hidden="true"
                    className={cn('mt-0.5 h-4 w-4 shrink-0', featured ? 'text-brand-400' : 'text-brand-600')}
                  />
                  <span className={cn('text-[0.9375rem]', featured ? 'text-brand-blue-100/80' : 'text-brand-blue-900/70')}>
                    {feature}
                  </span>
                </li>
              ))}
            </ul>

            <Link
              href={isSelfServe ? registerHref(product) : ROUTES.contact}
              className={cn(
                'mt-8 inline-flex items-center justify-center rounded-md px-5 py-3 text-[0.9375rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
                featured
                  ? 'bg-brand-500 text-white hover:bg-brand-400 focus-visible:ring-offset-brand-blue-900'
                  : 'bg-brand-blue-900/[0.05] text-brand-blue-900 hover:bg-brand-blue-900/[0.09] focus-visible:ring-offset-paper',
              )}
            >
              {isSelfServe ? 'Start your group' : 'Talk to us'}
            </Link>
          </div>
        );
      })}
    </div>
  );
}

const FAQS: [string, string][] = [
  ['Is M-Pesa included?', 'Yes. Every Kitabu Yetu plan includes the full Safaricom Daraja integration — STK push prompts, PayBill (C2B) collections and B2C payouts.'],
  ['Can I bring my existing records?', 'Yes. Every plan supports bulk CSV import for members and historical contributions.'],
  ['How is our data kept private?', "Data is stored on encrypted servers, and each group's records are isolated at the database level. One group can never read another's."],
  ['Can we change plan later?', 'Yes. Pay for a different plan by M-Pesa at any time and it activates immediately. There is no lock-in period.'],
  ['What if we use up our SMS?', 'Nothing stops. Each plan includes a set number of messages per billing cycle, and the allowance resets at the start of each new cycle. Once it is used up you buy top-up credits from your billing page; purchased credits are used after the included allowance.'],
  ['Which product should we start with?', 'If you only need to reach members — contribution reminders, meeting notices, birthdays — Chama Reminder is enough. Choose Kitabu Yetu when you also need to record and reconcile the money.'],
  ['Can we move from Chama Reminder to Kitabu Yetu?', 'Yes. Buy a Kitabu Yetu plan from your subscription page and your chart of accounts is set up then. Your group, members and message history carry over unchanged.'],
  ['Is there a free plan?', 'No. Every plan is paid, starting at the Starter price above, and is bought self-service by M-Pesa.'],
];

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <SiteHeader />

      <main id="main" className="flex-1">
        <div className="border-b border-brand-blue-900/10 bg-paper pb-14 pt-28 md:pb-16 md:pt-36">
          <Container>
            <div className="max-w-3xl">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-brand-600">
                Pricing
              </p>
              <h1 className="mt-5 font-display text-[2.25rem] font-light leading-[1.05] tracking-tight text-brand-blue-900 sm:text-5xl">
                One price a month, for{' '}
                <em className="italic font-normal text-brand-600">the whole group</em>.
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-brand-blue-900/65">
                Two products, one bill. Take the full book with{' '}
                <span className="font-medium text-brand-blue-900">{PRODUCT_LABEL.kitabu_yetu}</span>,
                or SMS reminders on their own with{' '}
                <Link href="#chama-reminder" className="font-medium text-brand-700 hover:underline">
                  {PRODUCT_LABEL.chama_reminder}
                </Link>
                . Every price below is the price the system actually charges.
              </p>
            </div>
          </Container>
        </div>

        <Container className="py-14 md:py-20">
          {/* Stated once, prominently, rather than buried per-plan: the
              allowance is a monthly grant, not a cap, and running out means
              buying more rather than being cut off. */}
          <p className="mb-14 rounded-2xl border border-brand-blue-900/10 bg-white px-6 py-5 text-[0.9375rem] leading-relaxed text-brand-blue-900/70">
            Every plan includes a monthly SMS allowance, renewed at the start of each
            billing cycle.{' '}
            <strong className="font-semibold text-brand-blue-900">
              Once your included messages are used up you can buy more at any time
            </strong>{' '}
            — sending never stops, you simply top up.
          </p>

          <section aria-labelledby="kitabu-yetu-heading">
            <div className="mb-8 max-w-3xl">
              <h2 id="kitabu-yetu-heading" className="font-display text-2xl font-normal text-brand-blue-900">
                {PRODUCT_LABEL.kitabu_yetu}
              </h2>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-brand-blue-900/65">
                The full book: double-entry accounting, contributions, loans, M-Pesa
                collection and reconciliation, member records and reporting — with SMS
                included.
              </p>
            </div>
            <PlanGrid product="kitabu_yetu" />
          </section>

          {/* Chama Reminder — the lighter, SMS-only product. */}
          <section id="chama-reminder" aria-labelledby="chama-reminder-heading" className="mt-24 scroll-mt-28">
            <div className="mb-8 max-w-3xl">
              <h2 id="chama-reminder-heading" className="font-display text-2xl font-normal text-brand-blue-900">
                {PRODUCT_LABEL.chama_reminder}
              </h2>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-brand-blue-900/65">
                Just the messaging. Keep your member list, send contribution reminders,
                birthday greetings and group announcements by SMS — no ledger, no
                accounting to set up. Start here and move to{' '}
                {PRODUCT_LABEL.kitabu_yetu} whenever your group is ready; your members
                come with you.
              </p>
            </div>
            <PlanGrid product="chama_reminder" />
          </section>

          <section aria-labelledby="faq-heading" className="mt-24">
            <h2 id="faq-heading" className="font-display text-2xl font-normal text-brand-blue-900">
              Questions we get asked
            </h2>
            <dl className="mt-8 grid gap-x-12 gap-y-8 md:grid-cols-2">
              {FAQS.map(([question, answer]) => (
                <div key={question} className="border-t border-brand-blue-900/10 pt-6">
                  <dt className="text-base font-semibold text-brand-blue-900">{question}</dt>
                  <dd className="mt-2.5 text-[0.9375rem] leading-relaxed text-brand-blue-900/65">
                    {answer}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </Container>
      </main>

      <SiteFooter />
    </div>
  );
}
