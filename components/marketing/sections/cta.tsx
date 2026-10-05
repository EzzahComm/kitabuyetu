import Link from 'next/link';
import { signUpUrl } from '@/lib/app-links';
import { PLAN_MONTHLY_FEES } from '@/types/enums';
import { CallbackForm } from '../callback-form';
import { Pill, btnOnPrimary, patternBandStyle } from '../finanza';
import { Container } from '../primitives';
import { ROUTES } from '../routes';

/**
 * Finanza's `.callback`: a white form card straddling a primary band that
 * fills the top half of the section.
 */
export function CallbackSection({ id = 'contact' }: { id?: string }) {
  return (
    <section id={id} aria-labelledby="callback-heading" className="relative isolate my-12 scroll-mt-28 pt-16">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-1/2" style={patternBandStyle} />
      <Container>
        <div className="mx-auto max-w-3xl rounded-lg border border-brand-100 bg-white p-6 shadow-sm sm:p-12">
          <div className="mx-auto mb-10 max-w-xl text-center">
            <Pill>Get In Touch</Pill>
            <h2
              id="callback-heading"
              className="font-display text-[2rem] font-bold leading-tight text-finanza-dark sm:text-[2.5rem]"
            >
              Get a free call-back
            </h2>
            <p className="mt-4 text-finanza-text">
              Tell us about your group. We&apos;ll call and recommend the right plan.
            </p>
          </div>
          <CallbackForm variant="callback" />
        </div>
      </Container>
    </section>
  );
}

interface CtaBandProps {
  id?: string;
  title?: string;
  subtitle?: string;
  footnote?: string;
  /** Show the subscription starting prices under the subtitle. Off for pages about another product. */
  showPlanPrices?: boolean;
  /** Primary button; defaults to group sign-up. */
  primary?: { label: string; href: string };
}

/** Closing call to action on the template's primary pattern band. */
export function CtaBand({
  id,
  title = 'Walk into your next meeting with the books already balanced.',
  subtitle = 'Set up in minutes. Bring your old records with you.',
  footnote = 'Month to month · Pay by M-Pesa · Cancel anytime',
  showPlanPrices = true,
  primary,
}: CtaBandProps) {
  return (
    <section id={id} aria-labelledby="cta-heading" className="scroll-mt-28 py-12">
      <Container>
        <div
          className="flex flex-col items-center gap-8 rounded-lg px-6 py-12 text-center text-white sm:px-12 lg:flex-row lg:justify-between lg:text-left"
          style={patternBandStyle}
        >
          <div className="max-w-2xl">
            <h2
              id="cta-heading"
              className="font-display text-[2rem] font-bold leading-tight text-white sm:text-[2.5rem]"
            >
              {title}
            </h2>
            <p className="mt-3 text-lg text-white/90">{subtitle}</p>
            {showPlanPrices && (
              <p className="mt-4 text-white/90">
                Bookkeeper from KES {PLAN_MONTHLY_FEES.kitabu_yetu.starter}/month · Chama Reminder from KES{' '}
                {PLAN_MONTHLY_FEES.chama_reminder.starter}/month ·{' '}
                <Link href={ROUTES.pricing} className="font-medium underline underline-offset-4 hover:text-white">
                  View pricing
                </Link>
              </p>
            )}
          </div>
          <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row lg:flex-col xl:flex-row">
            <a href={primary?.href ?? signUpUrl()} className={btnOnPrimary}>
              {primary?.label ?? `Start your group — from KES ${PLAN_MONTHLY_FEES.kitabu_yetu.starter}`}
            </a>
            <Link
              href={ROUTES.contact}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white px-8 py-3 font-medium text-white transition-colors duration-500 hover:bg-white/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white"
            >
              Talk to us
            </Link>
          </div>
        </div>
        {footnote && <p className="mt-4 text-center text-sm text-finanza-text">{footnote}</p>}
      </Container>
    </section>
  );
}
