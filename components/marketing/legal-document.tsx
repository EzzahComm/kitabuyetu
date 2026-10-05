import Link from 'next/link';
import { ChevronRight, FileText, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import { renderLegalMarkdown, type LegalHeading } from './legal-markdown';
import { PageShell } from './page-shell';
import { Container } from './primitives';
import { CONTACT, LEGAL_ITEMS, ROUTES } from './routes';

/* ────────────────────────────────────────────────────────────────────────────
 * Layout for a published policy (Terms, Privacy): the owner-supplied markdown
 * rendered unchanged, with every heading given a stable anchor and the h2s
 * collected into an "On this page" rail. This file only presents the text —
 * it never adds, reorders or rewords a clause.
 * ──────────────────────────────────────────────────────────────────────────── */

const proseClass = cn(
  'max-w-3xl space-y-5 text-base leading-relaxed text-finanza-text',
  '[&_a]:font-medium [&_a]:text-brand-500 [&_a:hover]:text-brand-700 [&_a:hover]:underline',
  '[&_h2]:mt-12 [&_h2]:scroll-mt-28 [&_h2]:border-t [&_h2]:border-brand-100 [&_h2]:pt-8 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-finanza-dark',
  '[&_h3]:mt-6 [&_h3]:scroll-mt-28 [&_h3]:font-display [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-finanza-dark',
  '[&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-6 [&_li]:pl-1 [&_li::marker]:text-brand-500',
  '[&_strong]:font-semibold [&_strong]:text-finanza-dark',
);

function Outline({ headings }: { headings: LegalHeading[] }) {
  return (
    <ol className="space-y-1 text-[0.9375rem]">
      {headings.map((heading) => (
        <li key={heading.id}>
          <a
            href={`#${heading.id}`}
            className="block rounded-sm py-1 leading-snug text-finanza-text transition-colors hover:text-brand-500 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {heading.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

function DocumentsRail({ current, className }: { current: string; className?: string }) {
  return (
    <nav aria-label="Legal documents" className={cn('rounded-lg bg-brand-50 p-5', className)}>
      <p className="mb-3 font-display text-lg font-semibold text-finanza-dark">Legal documents</p>
      <ul className="space-y-2 text-[0.9375rem]">
        {LEGAL_ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.href === current ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-2 rounded-sm transition-colors hover:text-brand-500',
                item.href === current ? 'font-semibold text-brand-500' : 'text-finanza-text',
              )}
            >
              <FileText aria-hidden="true" className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
      <a
        href={`mailto:${CONTACT.email}`}
        className="mt-5 inline-flex items-center gap-2 text-[0.9375rem] font-medium text-brand-500 hover:text-brand-700"
      >
        <Mail aria-hidden="true" className="h-4 w-4 shrink-0" />
        Questions? {CONTACT.email}
      </a>
    </nav>
  );
}

interface LegalDocumentProps {
  title: string;
  /** Shown under the title, e.g. "Last updated: September 2026". */
  updated: string;
  markdown: string;
  /** This document's route, so the "other documents" rail can mark it current. */
  href: string;
}

export function LegalDocument({ title, updated, markdown, href }: LegalDocumentProps) {
  const { html, headings } = renderLegalMarkdown(markdown);

  return (
    <PageShell title={title} description={updated} crumbs={[{ label: 'Legal', href: ROUTES.legal }]} layout="sections">
      <Container className="pb-16 pt-4 md:pb-24">
        <div className="grid gap-10 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-14">
          <aside className="lg:sticky lg:top-28 lg:max-h-[calc(100vh-8rem)] lg:self-start lg:overflow-y-auto lg:pr-2">
            {/* Collapsed on small screens so the policy itself starts above the fold. */}
            <details className="group rounded-lg border border-brand-100 p-5 lg:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between font-display text-lg font-semibold text-finanza-dark [&::-webkit-details-marker]:hidden">
                On this page
                <ChevronRight aria-hidden="true" className="h-5 w-5 transition-transform group-open:rotate-90" />
              </summary>
              <nav aria-label={`${title} sections`} className="mt-4">
                <Outline headings={headings} />
              </nav>
            </details>

            <nav aria-label={`${title} sections`} className="hidden lg:block">
              <p className="mb-3 font-display text-lg font-semibold text-finanza-dark">On this page</p>
              <Outline headings={headings} />
            </nav>

            <DocumentsRail current={href} className="mt-8 hidden lg:block" />
          </aside>

          <div>
            <article className={proseClass} dangerouslySetInnerHTML={{ __html: html }} />
            {/* Below the text on small screens, so the policy itself starts above the fold. */}
            <DocumentsRail current={href} className="mt-12 lg:hidden" />
          </div>
        </div>
      </Container>
    </PageShell>
  );
}
