import React from 'react';
import Link from 'next/link';
import { Container } from '@/components/Container';
import { btnOnPrimary, patternBandStyle } from '@/components/marketing/finanza';
import { signUpUrl } from '@/lib/app-links';

interface CtaAction {
  text: string;
  href: string;
}

interface CtaProps {
  title?: string;
  subtitle?: string;
  /** Extra line under the subtitle, e.g. a "not sure where to start?" nudge. */
  note?: string;
  /** Small print under the buttons. */
  footnote?: string;
  primary?: CtaAction;
  secondary?: CtaAction;
}

/**
 * Closing call to action on the Finanza primary pattern band. Every prop
 * defaults to the copy this block has always carried, so pages that render
 * <Cta /> bare are unchanged.
 */
export const Cta = (props: Readonly<CtaProps>) => {
  const {
    title = "Ready to bring your group's records together?",
    subtitle = 'Pay by M-Pesa, from KES 150 a month, with no lock-in period.',
    note,
    footnote,
    primary = { text: 'Get Started', href: signUpUrl() },
    secondary,
  } = props;

  return (
    <Container className="mb-20">
      <div
        className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-6 rounded-lg px-7 py-10 text-white lg:flex-nowrap lg:px-12 lg:py-12"
        style={patternBandStyle}
      >
        <div className="flex-grow text-center lg:text-left">
          <h2 className="font-display text-2xl font-bold text-white lg:text-[2rem]">{title}</h2>
          <p className="mt-2 text-lg text-white/90">{subtitle}</p>
          {note && <p className="mt-3 text-white/85">{note}</p>}
        </div>
        <div className="w-full flex-shrink-0 text-center lg:w-auto">
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
            <Link href={primary.href} className={btnOnPrimary}>
              {primary.text}
            </Link>
            {secondary && (
              <Link
                href={secondary.href}
                className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white px-8 py-3 font-medium text-white transition-colors duration-500 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {secondary.text}
              </Link>
            )}
          </div>
          {footnote && <p className="mt-4 text-sm text-white/85">{footnote}</p>}
        </div>
      </div>
    </Container>
  );
};
