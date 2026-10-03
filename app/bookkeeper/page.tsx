import type { Metadata } from 'next';
import Link from 'next/link';
import {
  DollarSign,
  Phone,
  BookOpen,
  Users,
  TrendingUp,
  FileText,
  Lock,
  CheckCircle2,
  Home,
  Handshake,
  Building2,
  Leaf,
  ListChecks,
  Coins,
} from 'lucide-react';

import { Container } from '@/components/Container';
import { SectionTitle } from '@/components/SectionTitle';
import { Benefits } from '@/components/Benefits';
import { Cta } from '@/components/Cta';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';
import { displayFont } from '@/components/marketing/display-font';
import { marketingMetadata } from '@/components/marketing/page-metadata';
import { signUpUrl } from '@/lib/app-links';
import { PLAN_MONTHLY_FEES, PLAN_SMS_ALLOWANCE, PLAN_COPY, SELF_SERVE_PLANS } from '@/types/enums';
import { PHOTOS } from '@/components/marketing/photos';

export const metadata: Metadata = marketingMetadata({
  path: '/bookkeeper',
  title: 'Chama Bookkeeping Software with M-Pesa',
  description:
    'Digital bookkeeping for chamas, SACCOs, welfare groups and investment clubs. Collect by M-Pesa, track loans and give every member a clear statement.',
});

/**
 * Kitabu Yetu Bookkeeper - the flagship product page.
 *
 * Built out from the UI template's layout, but three things in that template
 * are deliberately NOT reproduced here:
 *
 *  1. Its "5,000+ groups / KES 50B+ tracked annually" stat band. Those numbers
 *     are not real, and a made-up traction claim on a page selling a financial
 *     product is the kind of thing that has to be true before it is printed.
 *  2. Its hand-typed pricing table, which invented member caps ("Up to 500
 *     members") and SMS quotas that no plan actually enforces. Prices, SMS
 *     allowances and per-tier bullets are all read from types/enums.ts, the
 *     same table the billing page and the M-Pesa callback price against -
 *     see PLAN_COPY's own note on why that list exists.
 *  3. Its "isolated databases per group" security claim. Tenant isolation here
 *     is Postgres row-level security inside one database, which is a different
 *     (and accurately describable) thing.
 */
export default function BookkeeperPage() {
  return (
    <div className={`${displayFont.variable} flex min-h-screen flex-col bg-white`}>
      <SiteHeader />
      <main id="main" className="flex-1">
        <Container className="pt-24 lg:pt-36">
          <div className="mx-auto max-w-3xl text-center">
            <p className="inline-block rounded-lg border border-brand-100 px-3 py-1 text-[0.9375rem] font-medium text-brand-500">
              Bookkeeper
            </p>
            <h1 className="mt-4 font-display text-[2.5rem] font-bold leading-[1.1] text-finanza-dark sm:text-5xl lg:text-6xl">
              Every shilling. Every member. <em className="not-italic text-brand-500">One book.</em>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-finanza-text">
              Replace the notebook with books that always balance - contributions, loans, welfare and shares, with
              M-Pesa recorded for you.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Link
                href={signUpUrl('kitabu_yetu')}
                className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-7 py-3 text-base font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                Start your group book
              </Link>
              <Link
                href="/how-it-works"
                className="inline-flex items-center gap-2 rounded-md border border-brand-100 px-7 py-3 text-base font-medium text-finanza-dark transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                See it in action
              </Link>
            </div>
          </div>
        </Container>

        <SectionTitle preTitle="Features" title="Everything your treasurer needs">
          Members, money, loans and reports - in one place.
        </SectionTitle>

        <Container className="mb-20">
          <div className="grid gap-6 md:grid-cols-2">
            {coreFeatures.map((feature) => (
              <div key={feature.title} className="rounded-lg border border-brand-100 bg-brand-50/60 p-6">
                <div className="flex items-start gap-4">
                  <div className="mt-0.5 shrink-0 text-brand-600">{feature.icon}</div>
                  <div>
                    <h3 className="mb-2 text-xl font-semibold text-finanza-dark">{feature.title}</h3>
                    <p className="leading-relaxed text-finanza-text">{feature.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Container>

        <Benefits data={manageMoney} />

        <SectionTitle preTitle="Pricing" title="One price for the whole group">
          Not per member. SMS included. Pay monthly by M-Pesa.
        </SectionTitle>

        <Container className="mb-20">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => (
              <div
                key={plan.label}
                className={
                  plan.featured
                    ? 'flex flex-col rounded-lg border-2 border-brand-600 bg-brand-50/60 p-6'
                    : 'flex flex-col rounded-lg border border-brand-100 p-6'
                }
              >
                <div>
                  <h3 className="text-xl font-semibold text-finanza-dark">{plan.label}</h3>
                  {plan.featured && <p className="mt-1 text-sm font-semibold text-brand-700">Most popular</p>}
                </div>

                <div className="my-4">
                  <p className="font-display text-3xl font-semibold text-finanza-dark">{plan.price}</p>
                  {plan.period && <p className="mt-1 text-sm text-finanza-text">{plan.period}</p>}
                </div>

                <p className="mb-6 text-sm text-finanza-text">{plan.sms}</p>

                <ul className="mb-6 flex-grow space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-finanza-text">
                      <CheckCircle2 size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-600" />
                      {feature}
                    </li>
                  ))}
                </ul>

                <Link
                  href={plan.ctaHref}
                  className={
                    plan.featured
                      ? 'w-full rounded-md bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-700'
                      : 'w-full rounded-md border border-brand-100 px-4 py-2.5 text-center text-sm font-semibold text-finanza-dark transition-colors hover:bg-brand-50'
                  }
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-sm text-finanza-text">
            Buy any plan yourself by M-Pesa. See{' '}
            <Link href="/pricing" className="font-medium text-brand-700 hover:underline">
              full pricing
            </Link>{' '}
            for both products side by side.
          </p>
        </Container>

        <Container className="mb-20">
          <h2 className="mb-12 text-center font-display text-3xl font-bold text-finanza-dark">
            Built for every kind of group
          </h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {useCases.map((useCase) => (
              <div
                key={useCase.name}
                className="rounded-lg border border-brand-100 p-6 transition-shadow hover:shadow-md"
              >
                <div className="mb-3 text-brand-600">{useCase.icon}</div>
                <h3 className="mb-2 text-lg font-semibold text-finanza-dark">{useCase.name}</h3>
                <p className="leading-relaxed text-finanza-text">{useCase.description}</p>
              </div>
            ))}
          </div>
        </Container>

        <Container className="mb-20">
          <div className="rounded-lg bg-finanza-dark p-8 text-white md:p-12">
            <div className="mx-auto max-w-2xl text-center">
              <Phone size={48} aria-hidden="true" className="mx-auto mb-4 text-brand-400" />
              <h2 className="mb-4 font-display text-3xl font-bold">Built for M-Pesa</h2>
              <p className="mb-6 text-lg leading-relaxed text-white/70">
                M-Pesa is included on every plan. Money in, money out - recorded automatically.
              </p>
              <div className="mt-8 grid gap-6 md:grid-cols-3">
                <div>
                  <p className="mb-2 font-semibold text-brand-400">Collections</p>
                  <p className="text-sm text-white/65">A payment prompt or your PayBill</p>
                </div>
                <div>
                  <p className="mb-2 font-semibold text-brand-400">Matching</p>
                  <p className="text-sm text-white/65">Linked to the right member automatically</p>
                </div>
                <div>
                  <p className="mb-2 font-semibold text-brand-400">Payouts</p>
                  <p className="text-sm text-white/65">Loans, welfare and dividends to M-Pesa</p>
                </div>
              </div>
            </div>
          </div>
        </Container>

        <Cta
          title="Your next meeting, with the books already balanced."
          subtitle="Set up in minutes. Bring your old records with you."
          note="Not sure which plan? We'll recommend one."
          footnote="Month to month - Pay by M-Pesa - Cancel anytime"
          primary={{ text: 'Start your group book', href: signUpUrl('kitabu_yetu') }}
          secondary={{ text: 'Talk to us', href: '/contact' }}
        />
      </main>
      <SiteFooter />
    </div>
  );
}

const coreFeatures = [
  {
    title: 'Member register',
    description: 'Who's in, their role, and what each has paid and owes.',
    icon: <Users size={24} />,
  },
  {
    title: 'Financial tracking',
    description: 'Savings, loans, welfare, shares, investments and expenses - in books that always balance.',
    icon: <DollarSign size={24} />,
  },
  {
    title: 'M-Pesa integration',
    description: 'Payments matched to members automatically. Anything unclear waits for an official - never guessed.',
    icon: <Phone size={24} />,
  },
  {
    title: 'Reporting',
    description: 'Member statements, income and balance sheets - ready in minutes, never retyped.',
    icon: <FileText size={24} />,
  },
  {
    title: 'Loan management',
    description: 'Apply, approve, pay out and track repayments, interest and arrears.',
    icon: <TrendingUp size={24} />,
  },
  {
    title: 'Roles and a record of every change',
    description:
      'Your data is private to your group, officials see only what their role allows, and every change is recorded.',
    icon: <Lock size={24} />,
  },
];

const manageMoney = {
  title: 'Records your members can trust',
  desc: 'From the first member to the first dividend.',
  image: PHOTOS.vslaRecords.src,
  imageAlt: PHOTOS.vslaRecords.alt,
  bullets: [
    {
      title: 'Members and their money',
      desc: 'Every member's role, contacts and full payment history.',
      icon: <Users size={24} />,
    },
    {
      title: 'M-Pesa in and out',
      desc: 'Payments land on the right member; payouts go straight to M-Pesa.',
      icon: <Phone size={24} />,
    },
    {
      title: 'Close the month in minutes',
      desc: 'Statements and reports straight from the books - and closed months can't be changed.',
      icon: <BookOpen size={24} />,
    },
  ],
};

/**
 * Plans are derived, never typed: label and bullets from PLAN_COPY, price from
 * PLAN_MONTHLY_FEES, SMS from PLAN_SMS_ALLOWANCE. Enterprise is negotiated, so
 * it shows "By agreement" rather than the 0 that sits in the fee table.
 */
const plans = PLAN_COPY.kitabu_yetu.map((plan) => {
  const selfServe = SELF_SERVE_PLANS.includes(plan.type);
  const fee = PLAN_MONTHLY_FEES.kitabu_yetu[plan.type];
  const sms = PLAN_SMS_ALLOWANCE.kitabu_yetu[plan.type];

  return {
    label: plan.label,
    price: selfServe ? `KES ${fee.toLocaleString()}` : 'By agreement',
    period: selfServe ? '/month' : '',
    sms: selfServe ? `${sms.toLocaleString()} SMS included` : 'SMS allowance by agreement',
    featured: plan.type === 'growth',
    features: plan.features,
    cta: selfServe ? 'Get started' : 'Contact us',
    ctaHref: selfServe ? signUpUrl('kitabu_yetu') : '/contact',
  };
});

const useCases = [
  {
    name: 'Savings groups (chamas)',
    description: 'Monthly contributions, loan cycles and dividend distribution for savings-based groups.',
    icon: <Coins size={32} />,
  },
  {
    name: 'VSLAs',
    description: 'Village savings and loan associations tracking member cycles, share-outs and group funds.',
    icon: <Home size={32} />,
  },
  {
    name: 'Welfare groups',
    description: 'Welfare contributions, claims, beneficiaries and payouts, with a record of who was paid what.',
    icon: <Handshake size={32} />,
  },
  {
    name: 'Cooperatives',
    description: 'Member shares, share capital, dividends and member equity across a growing membership.',
    icon: <Building2 size={32} />,
  },
  {
    name: 'CBOs',
    description: 'Community-based organizations tracking projects, funding received and what it was spent on.',
    icon: <Leaf size={32} />,
  },
  {
    name: 'Associations',
    description: 'Professional and community associations managing member records, dues and group funds.',
    icon: <ListChecks size={32} />,
  },
];
