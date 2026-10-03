import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MessageSquare,
  Calendar,
  Users,
  Phone,
  CheckCircle2,
  TrendingUp,
  Bell,
  Clock,
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
import { PLAN_MONTHLY_FEES, PLAN_SMS_ALLOWANCE, PLAN_COPY, SELF_SERVE_PLANS, PRODUCT_LABEL } from '@/types/enums';
import { PHOTOS } from '@/components/marketing/photos';

export const metadata: Metadata = marketingMetadata({
  path: '/chama-reminder',
  title: 'Kumbusha — Bulk SMS Reminders for Chamas & Welfare Groups',
  description:
    'Automated SMS reminders for contributions, meetings and loan repayments, plus announcements, so every member of your chama or welfare group stays informed.',
});

/**
 * Chama Reminder — the communication-only product. Separate purchase from
 * Bookkeeper, with its own pricing tier. No accounting setup, just a member
 * list and scheduled SMS.
 *
 * Pricing reads from PLAN_COPY and PLAN_MONTHLY_FEES; no hand-typed member
 * caps or SMS quotas (see /bookkeeper's note on why).
 */
export default function ChamaReminderPage() {
  return (
    <div className={`${displayFont.variable} flex min-h-screen flex-col bg-white`}>
      <SiteHeader />
      <main id="main" className="flex-1">
        <Container className="pt-24 lg:pt-36">
          <div className="mx-auto max-w-3xl text-center">
            <p className="inline-block rounded-lg border border-brand-100 px-3 py-1 text-[0.9375rem] font-medium text-brand-500">
              Chama Reminder · Kumbusha
            </p>
            <h1 className="mt-4 font-display text-[2.5rem] font-bold leading-[1.1] text-finanza-dark sm:text-5xl lg:text-6xl">
              Contributions on time. <em className="not-italic text-brand-500">No follow-up calls.</em>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-finanza-text">
              Automatic SMS reminders and announcements to every member’s phone. Nothing to install, nothing to set up.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Link
                href={signUpUrl('chama_reminder')}
                className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-7 py-3 text-base font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                Send your first reminder
              </Link>
              <Link
                href="/bookkeeper"
                className="inline-flex items-center gap-2 rounded-md border border-brand-100 px-7 py-3 text-base font-medium text-finanza-dark transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                Need full bookkeeping?
              </Link>
            </div>
          </div>
        </Container>

        <SectionTitle preTitle="Features" title="Reach every member, every time">
          Your member list and SMS — no bookkeeping needed.
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

        <Benefits data={keepMembersInformed} />

        <Container className="mb-20">
          <div className="rounded-lg bg-brand-50/40 p-8 md:p-12">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="mb-4 font-display text-3xl font-bold text-finanza-dark">
                Start with reminders. Add bookkeeping later.
              </h2>
              <p className="mb-8 text-lg leading-relaxed text-finanza-text">
                Upgrade whenever you&apos;re ready. Your members and messages come with you.
              </p>
              <div className="mt-8 grid gap-6 md:grid-cols-2">
                <div className="text-left">
                  <h3 className="mb-3 font-semibold text-brand-700">Start here (Chama Reminder)</h3>
                  <ul className="space-y-2 text-sm text-finanza-text">
                    <li>✓ Member list</li>
                    <li>✓ SMS reminders &amp; announcements</li>
                    <li>✓ Nothing to set up</li>
                    <li>✓ Lowest price</li>
                  </ul>
                </div>
                <div className="text-left">
                  <h3 className="mb-3 font-semibold text-brand-700">Grow here (Kitabu Yetu)</h3>
                  <ul className="space-y-2 text-sm text-finanza-text">
                    <li>✓ Add full bookkeeping</li>
                    <li>✓ Members &amp; history carry over</li>
                    <li>✓ All messaging stays</li>
                    <li>✓ Upgrade by M-Pesa, any time</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </Container>

        <SectionTitle preTitle="Pricing" title="SMS included. Top up any time.">
          One price for the whole group. Pay monthly by M-Pesa.
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
                      <IconCircleCheck size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-600" />
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
          <h2 className="mb-12 text-center font-display text-3xl font-bold text-finanza-dark">What groups send</h2>
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

        <Cta
          title="Stop chasing contributions."
          subtitle="Set your reminders once. They go out on their own."
          note="Add bookkeeping any time — no re-setup."
          footnote="Month to month · Pay by M-Pesa · Free move to Bookkeeper"
          primary={{
            text: 'Send your first reminder',
            href: signUpUrl('chama_reminder'),
          }}
          secondary={{ text: 'Compare with Bookkeeper', href: '/bookkeeper' }}
        />
      </main>
      <SiteFooter />
    </div>
  );
}

const coreFeatures = [
  {
    title: ‘Member list’,
    description: ‘Names and numbers in one place, ready to message.’,
    icon: <Users size={24} />,
  },
  {
    title: ‘SMS campaigns’,
    description: ‘Send now or schedule — to one member or everyone.’,
    icon: <MessageSquare size={24} />,
  },
  {
    title: ‘Message templates’,
    description: ‘Personalised with each member’s name, amount and date.’,
    icon: <Bell size={24} />,
  },
  {
    title: ‘Scheduled reminders’,
    description: ‘Contribution reminders, meeting notices and birthday greetings — on time, every time.’,
    icon: <Clock size={24} />,
  },
  {
    title: ‘Delivery tracking’,
    description: ‘See what was delivered and resend what wasn’t.’,
    icon: <CheckCircle2 size={24} />,
  },
  {
    title: ‘Simple pricing’,
    description: ‘SMS included every month. Top up only when you need to.’,
    icon: <TrendingUp size={24} />,
  },
];

const keepMembersInformed = {
  title: 'Every member, in the loop',
  desc: 'Reminders that never forget.',
  image: PHOTOS.memberPhone.src,
  imageAlt: PHOTOS.memberPhone.alt,
  bullets: [
    {
      title: 'A member list that is yours',
      desc: 'Names and numbers, always ready to message.',
      icon: <Users size={24} />,
    },
    {
      title: 'Reminders that go out on time',
      desc: 'Scheduled once, sent automatically — no one has to remember.',
      icon: <Clock size={24} />,
    },
    {
      title: 'Move to Bookkeeper when ready',
      desc: 'Upgrade any time. Your members and messages come with you.',
      icon: <TrendingUp size={24} />,
    },
  ],
};

/**
 * Plans derived from canonical sources, not hand-typed.
 */
const plans = PLAN_COPY.chama_reminder.map((plan) => {
  const selfServe = SELF_SERVE_PLANS.includes(plan.type);
  const fee = PLAN_MONTHLY_FEES.chama_reminder[plan.type];
  const sms = PLAN_SMS_ALLOWANCE.chama_reminder[plan.type];

  return {
    label: plan.label,
    price: selfServe ? `KES ${fee.toLocaleString()}` : 'By agreement',
    period: selfServe ? '/month' : '',
    sms: selfServe ? `${sms.toLocaleString()} SMS included` : 'SMS allowance by agreement',
    featured: plan.type === 'growth',
    features: plan.features,
    cta: selfServe ? 'Get started' : 'Contact us',
    ctaHref: selfServe ? signUpUrl('chama_reminder') : '/contact',
  };
});

const useCases = [
  {
    name: 'Contribution reminders',
    description: 'Sent automatically before every due date.',
    icon: '📱',
  },
  {
    name: 'Birthday greetings',
    description: 'Every member greeted on their day.',
    icon: '🎂',
  },
  {
    name: 'Meeting notices',
    description: 'Date, venue and agenda to everyone at once.',
    icon: '📅',
  },
  {
    name: 'Payment confirmations',
    description: 'Members know their payment arrived.',
    icon: '✅',
  },
  {
    name: 'Group announcements',
    description: 'News and decisions, to everyone at once.',
    icon: '📢',
  },
  {
    name: 'Loan reminders',
    description: 'Repayment due dates, before they’re missed.',
    icon: '💳',
  },
];
