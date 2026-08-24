import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  PLAN_COPY, PLAN_MONTHLY_FEES, PLAN_SMS_ALLOWANCE, PRODUCT_LABEL, SELF_SERVE_PLANS,
} from '@/types/enums';
import { Container, RevealedHeading, Section } from './primitives';
import { Reveal } from './reveal';
import { ROUTES, SECTION_IDS } from './routes';

/**
 * Section 12 — pricing.
 *
 * NOTHING here is typed by hand. Plan names, monthly fees and the included SMS
 * allowance all come from `types/enums.ts`, which is the same module the
 * /billing API quotes from and the M-Pesa callback verifies a payment against
 * before activating a subscription. A hand-maintained copy of this table is
 * exactly what once had the public pages advertising KES 2,500 and 8,000 while
 * the server charged something else, and advertising a free tier that no
 * longer existed.
 *
 * There is no free tier, so this page does not imply one anywhere.
 */
const plans = PLAN_COPY.kitabu_yetu.filter((plan) => SELF_SERVE_PLANS.includes(plan.type));

export function PricingSection() {
  return (
    <Section id={SECTION_IDS.pricing} tone="paper" labelledBy="pricing-heading">
      <Container>
        <RevealedHeading
          id="pricing-heading"
          eyebrow="Pricing"
          title="One price a month,"
          emphasis="for the whole group"
          trailing="."
          lede="Not per member, and not a percentage of what your group saves. Pay by M-Pesa; change plan whenever you like."
        />

        <div className="mt-14 grid gap-5 lg:mt-20 lg:grid-cols-3">
          {plans.map((plan, i) => {
            const featured = plan.type === 'growth';
            return (
              <Reveal
                key={plan.type}
                delay={i * 80}
                className={cn(
                  'relative flex h-full flex-col rounded-2xl p-8',
                  featured
                    ? 'bg-brand-blue-900 text-white ring-1 ring-brand-blue-900'
                    : 'bg-white ring-1 ring-brand-blue-900/[0.09]',
                )}
              >
                {featured && (
                  <span className="absolute -top-3 left-8 rounded-full bg-brand-500 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
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

                <p className="mt-4 flex items-baseline gap-2">
                  <span
                    className={cn(
                      'font-display text-4xl font-normal tabular-nums',
                      featured ? 'text-white' : 'text-brand-blue-900',
                    )}
                  >
                    KES {PLAN_MONTHLY_FEES.kitabu_yetu[plan.type].toLocaleString()}
                  </span>
                  <span
                    className={cn(
                      'text-sm',
                      featured ? 'text-brand-blue-100/55' : 'text-brand-blue-900/45',
                    )}
                  >
                    /month
                  </span>
                </p>

                <ul className="mt-7 flex-1 space-y-3">
                  <li className="flex items-start gap-2.5">
                    <Check
                      aria-hidden="true"
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0',
                        featured ? 'text-brand-400' : 'text-brand-600',
                      )}
                    />
                    <span
                      className={cn(
                        'text-[0.9375rem]',
                        featured ? 'text-brand-blue-100/80' : 'text-brand-blue-900/70',
                      )}
                    >
                      <strong className="font-semibold">
                        {PLAN_SMS_ALLOWANCE.kitabu_yetu[plan.type]} SMS
                      </strong>{' '}
                      included every month
                    </span>
                  </li>
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5">
                      <Check
                        aria-hidden="true"
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0',
                          featured ? 'text-brand-400' : 'text-brand-600',
                        )}
                      />
                      <span
                        className={cn(
                          'text-[0.9375rem]',
                          featured ? 'text-brand-blue-100/80' : 'text-brand-blue-900/70',
                        )}
                      >
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={ROUTES.startGroup}
                  className={cn(
                    'mt-8 inline-flex items-center justify-center rounded-md px-5 py-3 text-[0.9375rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
                    featured
                      ? 'bg-brand-500 text-white hover:bg-brand-400 focus-visible:ring-offset-brand-blue-900'
                      : 'bg-brand-blue-900/[0.05] text-brand-blue-900 hover:bg-brand-blue-900/[0.09] focus-visible:ring-offset-paper',
                  )}
                >
                  Start your group
                </Link>
              </Reveal>
            );
          })}
        </div>

        <Reveal className="mt-8 flex flex-col gap-5 rounded-2xl border border-brand-blue-900/10 bg-white/60 p-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-brand-blue-900/65">
            Only need to reach your members? {PRODUCT_LABEL.chama_reminder} does reminders,
            announcements and birthday greetings on their own — no ledger to set up — from{' '}
            <strong className="font-semibold text-brand-blue-900">
              KES {PLAN_MONTHLY_FEES.chama_reminder.starter.toLocaleString()}/month
            </strong>
            . Larger networks and organizations are priced per agreement.
          </p>
          <Link
            href={ROUTES.pricing}
            className="group inline-flex shrink-0 items-center gap-2 rounded-sm text-[0.9375rem] font-semibold text-brand-700 transition-colors hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-4 focus-visible:ring-offset-paper"
          >
            See all plans
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </Reveal>
      </Container>
    </Section>
  );
}

export default PricingSection;
