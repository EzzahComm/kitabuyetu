import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, Gift, MessageSquareText, Network } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageShell } from '@/components/marketing/page-shell';
import { FinanzaHeading, FinanzaSection, IconBadge, btnOutline, btnPrimary } from '@/components/marketing/finanza';
import { ROUTES } from '@/components/marketing/routes';
import { marketingMetadata } from '@/components/marketing/page-metadata';
import { JsonLd, faqPageJsonLd } from '@/components/marketing/json-ld';
import {
  CHANGISHA_PRICING,
  PLAN_MONTHLY_FEES,
  PLAN_SMS_ALLOWANCE,
  PLAN_COPY,
  SELF_SERVE_PLANS,
  PRODUCT_LABEL,
  type SubscriptionProduct,
} from '@/types/enums';

/**
 * No local price/feature data — every number below is read from the same
 * source of truth the billing page, the M-Pesa callback and the Changi$ha
 * withdrawal service use (`types/enums.ts`). A hand-maintained copy once
 * advertised a free tier and prices the server did not charge — see
 * docs/audits/PRODUCT_CONCORDANCE_AUDIT_2026-08.md §1.1.
 */

export const metadata: Metadata = marketingMetadata({
  path: '/pricing',
  title: 'Chama App Pricing — One Price per Group',
  description:
    'One monthly price for the whole group, not per member, paid by M-Pesa. Plans for chamas, welfare groups and SMS reminders, and Changi$ha fundraising with no monthly fee.',
});

/** Kitabu Yetu is the default product, so it needs no query string; Chama
 *  Reminder must carry one or `register_group()` seeds it a chart of accounts
 *  it will never use. */
function registerHref(product: SubscriptionProduct): string {
  return product === 'kitabu_yetu' ? ROUTES.startGroup : `${ROUTES.startGroup}?product=${product}`;
}

const EXAMPLE_WITHDRAWAL = 10_000;
const exampleFee = (EXAMPLE_WITHDRAWAL * CHANGISHA_PRICING.platformFeePct) / 100;

function PlanGrid({ product }: { product: SubscriptionProduct }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {PLAN_COPY[product].map((plan) => {
        const isSelfServe = SELF_SERVE_PLANS.includes(plan.type);
        const featured = plan.type === 'growth';
        const fee = PLAN_MONTHLY_FEES[product][plan.type];
        // The SMS allowance is read from PLAN_SMS_ALLOWANCE, the same constant
        // the subscription is created with — never retyped here.
        const items = [
          isSelfServe ? `${PLAN_SMS_ALLOWANCE[product][plan.type]} SMS a month` : 'SMS allowance by agreement',
          ...plan.features,
        ];

        return (
          <div
            key={plan.type}
            className={cn(
              'relative flex flex-col rounded-lg border p-7',
              featured ? 'border-brand-500 bg-brand-500 text-white' : 'border-brand-100 bg-white',
            )}
          >
            {featured && (
              <span className="absolute -top-3 left-7 rounded-full bg-finanza-dark px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                Most popular
              </span>
            )}
            <h3 className={cn('font-display text-xl font-semibold', featured ? 'text-white' : 'text-finanza-dark')}>
              {plan.label}
            </h3>
            <p className="mt-3">
              {isSelfServe ? (
                <>
                  <span
                    className={cn(
                      'font-display text-4xl font-bold tabular-nums',
                      featured ? 'text-white' : 'text-finanza-dark',
                    )}
                  >
                    KES {fee.toLocaleString()}
                  </span>
                  <span className={cn('ml-1.5 text-sm', featured ? 'text-white/80' : 'text-finanza-text')}>/month</span>
                </>
              ) : (
                <span className="font-display text-3xl font-bold text-finanza-dark">By agreement</span>
              )}
            </p>
            <ul className="mt-6 flex-1 space-y-2.5">
              {items.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-[0.9375rem]">
                  <Check
                    aria-hidden="true"
                    className={cn('mt-0.5 h-4 w-4 shrink-0', featured ? 'text-white' : 'text-brand-500')}
                  />
                  <span className={featured ? 'text-white/90' : 'text-finanza-text'}>{item}</span>
                </li>
              ))}
            </ul>
            <Link
              href={isSelfServe ? registerHref(product) : ROUTES.contact}
              className={cn(
                'mt-7 inline-flex min-h-11 items-center justify-center rounded-lg px-5 py-2.5 font-medium transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                featured
                  ? 'bg-white text-brand-500 hover:bg-brand-100 focus-visible:ring-white focus-visible:ring-offset-brand-500'
                  : 'border border-brand-500 text-brand-500 hover:bg-brand-500 hover:text-white focus-visible:ring-brand-500',
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
  [
    'Is M-Pesa included?',
    'Yes. Every Kitabu Yetu plan includes the Safaricom Daraja integration — STK push prompts, PayBill (C2B) collections and B2C payouts.',
  ],
  ['Can I bring my existing records?', 'Yes. Every plan supports bulk CSV import for members and past contributions.'],
  [
    'How is our data kept private?',
    "Data is stored on encrypted servers, and each group's records are isolated at the database level. One group can never read another's.",
  ],
  [
    'Can we change plan later?',
    'Yes. Pay for a different plan by M-Pesa at any time and it activates immediately. There is no lock-in period.',
  ],
  [
    'What if we use up our SMS?',
    'Nothing stops. The allowance renews each billing cycle; in between, buy top-up credits from your billing page.',
  ],
  [
    'Which product should we start with?',
    'Chama Reminder if you only need to reach members. Kitabu Yetu when you also need to record and reconcile the money.',
  ],
  [
    'Can we move from Chama Reminder to Kitabu Yetu?',
    'Yes. Buy a Kitabu Yetu plan from your subscription page. Your group, members and message history carry over unchanged.',
  ],
  [
    'What does Changi$ha cost?',
    `No monthly fee. When the group withdraws raised funds, a standard ${CHANGISHA_PRICING.platformFeePct}% platform fee and Safaricom's M-Pesa transfer charge are deducted. Donors pay nothing extra.`,
  ],
  ['Is there a free plan?', 'No. Every plan is paid, and bought self-service by M-Pesa.'],
];

export default function PricingPage() {
  return (
    <PageShell
      title="Pricing"
      description="One price a month for the whole group — not per member. Paid by M-Pesa, no lock-in. Every price here is the price the system charges."
      layout="sections"
    >
      <FinanzaSection labelledBy="kitabu-yetu-heading" className="pt-4 lg:pt-8">
        <FinanzaHeading
          id="kitabu-yetu-heading"
          pill="Bookkeeper"
          title={PRODUCT_LABEL.kitabu_yetu}
          lede="The full book: double-entry accounting, contributions, loans, M-Pesa collection and reconciliation, member records and reports — SMS included."
          className="mb-10 max-w-3xl"
        />
        <PlanGrid product="kitabu_yetu" />
        <p className="mt-6 text-sm text-finanza-text">
          Every plan includes a monthly SMS allowance. Used it up? Top up any time — sending never stops.
        </p>
      </FinanzaSection>

      <FinanzaSection id="chama-reminder" labelledBy="chama-reminder-heading" className="bg-brand-50/60">
        <FinanzaHeading
          id="chama-reminder-heading"
          pill="SMS only · Kumbusha"
          title={PRODUCT_LABEL.chama_reminder}
          lede={`Reminders, announcements and birthday greetings by SMS — no ledger to set up. Move to ${PRODUCT_LABEL.kitabu_yetu} whenever you're ready; your members come with you.`}
          className="mb-10 max-w-3xl"
        />
        <PlanGrid product="chama_reminder" />
      </FinanzaSection>

      <FinanzaSection labelledBy="more-heading">
        <h2 id="more-heading" className="sr-only">
          Changi$ha and Enterprise
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Changi$ha — priced per withdrawal, from CHANGISHA_PRICING (the withdrawal service's defaults). */}
          <section
            id="changisha"
            aria-labelledby="changisha-heading"
            className="flex scroll-mt-28 flex-col rounded-lg border border-brand-100 p-8"
          >
            <div className="mb-5 flex items-center gap-4">
              <IconBadge icon={Gift} />
              <h3 id="changisha-heading" className="font-display text-2xl font-semibold text-finanza-dark">
                Changi$ha fundraising
              </h3>
            </div>
            <p className="font-display text-4xl font-bold text-finanza-dark">
              {CHANGISHA_PRICING.platformFeePct}%
              <span className="ml-2 text-base font-normal text-finanza-text">of each withdrawal</span>
            </p>
            <p className="mt-2 text-finanza-text">No monthly fee. You pay only when you take money out.</p>
            <ul className="mt-6 flex-1 space-y-2.5 text-[0.9375rem] text-finanza-text">
              {[
                'Donors give by M-Pesa and pay nothing extra',
                "Safaricom's M-Pesa transfer charge is passed on at cost",
                `Minimum withdrawal KES ${CHANGISHA_PRICING.minWithdrawal.toLocaleString()}, to an M-Pesa number, paybill or till`,
                'Every campaign is reviewed by Kitabu Yetu before it goes live',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-6 rounded-lg bg-brand-50 px-4 py-3 text-sm text-finanza-text">
              Example: withdraw KES {EXAMPLE_WITHDRAWAL.toLocaleString()} and the platform fee is KES{' '}
              {exampleFee.toLocaleString()}, plus the M-Pesa charge.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={ROUTES.fundraise} className={btnPrimary}>
                See live campaigns
              </Link>
              <Link href={ROUTES.contact} className={btnOutline}>
                Start a campaign
              </Link>
            </div>
          </section>

          <section
            id="enterprise"
            aria-labelledby="enterprise-heading"
            className="flex scroll-mt-28 flex-col rounded-lg bg-finanza-dark p-8 text-white"
          >
            <div className="mb-5 flex items-center gap-4">
              <IconBadge icon={Network} />
              <h3 id="enterprise-heading" className="font-display text-2xl font-semibold text-white">
                Enterprise
              </h3>
            </div>
            <p className="font-display text-4xl font-bold">By agreement</p>
            <p className="mt-2 flex-1 text-brand-100/85">
              For organizations managing many groups — portfolio dashboards, multi-group reporting and programme
              management. Priced on the number of groups and members you oversee.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={ROUTES.contact}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-white px-8 py-3 font-medium text-brand-500 transition-colors hover:bg-brand-100"
              >
                Talk to us
              </Link>
              <Link
                href={ROUTES.enterprise}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/60 px-8 py-3 font-medium text-white transition-colors hover:bg-white/10"
              >
                Explore Enterprise <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </section>
        </div>
      </FinanzaSection>

      <FinanzaSection labelledBy="faq-heading" className="bg-brand-50/60">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <FinanzaHeading
            id="faq-heading"
            pill="FAQ"
            title="Pricing questions"
            lede="Anything else? We answer on WhatsApp and email."
          />
          <dl className="grid gap-4">
            {FAQS.map(([question, answer]) => (
              <div key={question} className="rounded-lg border border-brand-100 bg-white px-6 py-5">
                <dt className="flex items-start gap-3 font-display text-lg font-semibold text-finanza-dark">
                  <MessageSquareText aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-brand-500" />
                  {question}
                </dt>
                <dd className="mt-2 pl-8 leading-relaxed text-finanza-text">{answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      </FinanzaSection>
      <JsonLd data={faqPageJsonLd(FAQS)} />
    </PageShell>
  );
}
