import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Container, LedgerRules, Section } from './primitives';
import { Reveal } from './reveal';
import { ROUTES } from './routes';

/** Section 13 — the closing ask. One statement, two real destinations. */
export function FinalCta() {
  return (
    <Section tone="ink" labelledBy="cta-heading">
      <LedgerRules className="text-white" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[520px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500/10 blur-[140px]"
      />

      <Container>
        <Reveal className="mx-auto max-w-3xl text-center">
          <h2
            id="cta-heading"
            className="font-display text-[2.375rem] font-light leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-[3.5rem]"
          >
            Retire the spreadsheet.
            <br />
            <em className="italic font-normal text-brand-400">Keep a better book.</em>
          </h2>

          <p className="mx-auto mt-7 max-w-xl text-lg leading-relaxed text-brand-blue-100/70">
            Bring your group&apos;s savings, loans, members and records into one place —
            and let everybody see where things stand.
          </p>

          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href={ROUTES.startGroup}
              className="group inline-flex items-center justify-center gap-2 rounded-md bg-brand-500 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-900/30 transition-colors hover:bg-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-blue-900"
            >
              Start your group
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <Link
              href={ROUTES.contact}
              className="inline-flex items-center justify-center rounded-md border border-white/20 px-8 py-3.5 text-base font-medium text-white/90 transition-colors hover:border-white/35 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-blue-900"
            >
              Talk to us
            </Link>
          </div>

          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-white/60">
            Already have an account?{' '}
            <Link
              href={ROUTES.signIn}
              className="rounded-sm text-white/60 underline underline-offset-4 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              Sign in
            </Link>
          </p>
        </Reveal>
      </Container>
    </Section>
  );
}

export default FinalCta;
