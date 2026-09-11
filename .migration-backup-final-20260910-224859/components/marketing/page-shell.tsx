import type { ReactNode } from 'react';
import { Container } from './primitives';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';

interface PageShellProps {
  title:        string;
  description?: string;
  children:     ReactNode;
}

/**
 * The wrapper for every public page that is not the home page — About,
 * Contact, Bookkeeper, Chama Reminder, Fundraise, Ecosystem, Docs, Support,
 * Status. Same three-prop API as the shell it replaces, so those pages only
 * changed an import path.
 *
 * The header is `solid` here, deliberately. The previous shell used the
 * overlay header on every page, which painted white text over a white
 * background: on all nine of these pages the logo and the entire menu were
 * invisible until the visitor happened to scroll. Only the home page, whose
 * first section is a dark hero, gets the overlay treatment.
 */
export function PageShell({ title, description, children }: PageShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <main id="main" className="flex-1">
        {/* Title band, on paper — gives short informational pages a proper
            masthead instead of a heading floating in white space. */}
        <div className="border-b border-brand-blue-900/10 bg-paper-deep pb-14 pt-28 md:pb-20 md:pt-36">
          <Container>
            <div className="max-w-3xl">
              <h1 className="font-display text-[2.25rem] font-light leading-[1.05] tracking-tight text-brand-blue-900 sm:text-5xl">
                {title}
              </h1>
              {description && (
                <p className="mt-5 text-lg leading-relaxed text-brand-blue-900/60">
                  {description}
                </p>
              )}
            </div>
          </Container>
        </div>

        <Container className="py-14 md:py-20">
          <div className="max-w-3xl space-y-5 text-base leading-relaxed text-brand-blue-900/75 [&_a]:font-medium [&_a]:text-brand-700 [&_a:hover]:underline [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-normal [&_h2]:text-brand-blue-900 [&_strong]:font-semibold [&_strong]:text-brand-blue-900">
            {children}
          </div>
        </Container>
      </main>
      <SiteFooter />
    </div>
  );
}

export default PageShell;
