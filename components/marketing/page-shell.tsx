import type { ReactNode } from 'react';
import { Container } from './primitives';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';
import { displayFont } from './display-font';
import { PageHeader, type Crumb } from './finanza';

interface PageShellProps {
  title: string;
  description?: string;
  children: ReactNode;
  /** Breadcrumb steps between Home and this page, e.g. About on the team page. */
  crumbs?: Crumb[];
  /**
   * `prose` (default) sets children in a readable column with typographic
   * defaults — policies, docs, short informational pages. `sections` hands
   * children the full width, for pages composed of Finanza sections.
   */
  layout?: 'prose' | 'sections';
}

/**
 * The wrapper for most public pages that are not the home page — About,
 * Contact, Docs, Ecosystem, Enterprise Solutions, Fundraise, Legal, Products,
 * Status, Support. Bookkeeper and Chama Reminder have their own independent
 * root layout (richer/more custom than this shell supports) — each applies
 * display-font.ts's variable directly rather than through this file.
 *
 * The masthead is the Finanza template's page header: a large title and a
 * breadcrumb on lavender waves, pushed clear of the fixed header.
 */
export function PageShell({ title, description, children, crumbs, layout = 'prose' }: PageShellProps) {
  return (
    <div className={`${displayFont.variable} flex min-h-screen flex-col bg-white`}>
      <SiteHeader />
      <main id="main" className="flex-1">
        <PageHeader title={title} lede={description} crumbs={crumbs} />

        {layout === 'sections' ? (
          children
        ) : (
          <Container className="py-12 md:py-16">
            <div className="max-w-3xl space-y-5 text-base leading-relaxed text-finanza-text [&_a]:font-medium [&_a]:text-brand-500 [&_a:hover]:text-brand-700 [&_a:hover]:underline [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-finanza-dark [&_h3]:font-display [&_h3]:font-semibold [&_h3]:text-finanza-dark [&_strong]:font-semibold [&_strong]:text-finanza-dark">
              {children}
            </div>
          </Container>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

export default PageShell;
