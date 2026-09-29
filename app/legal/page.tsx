import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, FileText, Mail, ShieldCheck, Scale } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PageShell } from '@/components/marketing/page-shell';
import { FinanzaSection, Pill } from '@/components/marketing/finanza';
import { marketingMetadata } from '@/components/marketing/page-metadata';
import { CONTACT, LEGAL_ITEMS, ROUTES } from '@/components/marketing/routes';

export const metadata: Metadata = marketingMetadata({
  path: '/legal',
  title: 'Legal',
  description:
    'The terms, privacy policy and data protection information that govern how Kitabu Yetu is used and how personal information is handled.',
});

/** Status is stated per document so the hub never implies the placeholder is a finished policy. */
const DOCUMENT_META: Record<string, { icon: LucideIcon; status: string; ready: boolean }> = {
  [ROUTES.legalTerms]: { icon: Scale, status: 'Last updated September 2026', ready: true },
  [ROUTES.legalPrivacy]: { icon: FileText, status: 'Last updated September 2026', ready: true },
  [ROUTES.legalDataProtection]: { icon: ShieldCheck, status: 'In progress', ready: false },
};

export default function LegalPage() {
  return (
    <PageShell
      title="Legal"
      description="How Kitabu Yetu may be used, and how the personal information groups entrust to it is handled."
      layout="sections"
    >
      <FinanzaSection labelledBy="legal-documents-heading" className="pt-4 lg:pt-8">
        <h2 id="legal-documents-heading" className="sr-only">
          Legal documents
        </h2>
        <ul className="grid gap-6 md:grid-cols-3">
          {LEGAL_ITEMS.map((item) => {
            const meta = DOCUMENT_META[item.href];
            const Icon = meta?.icon ?? FileText;
            return (
              <li
                key={item.href}
                className="group relative flex flex-col rounded-lg border border-brand-100 bg-white p-7 transition-colors duration-500 hover:border-brand-500"
              >
                <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-brand-500">
                  <Icon aria-hidden="true" className="h-5 w-5 text-white" />
                </span>
                <h3 className="font-display text-xl font-semibold text-finanza-dark">{item.label}</h3>
                <p className="mt-3 flex-1 leading-relaxed text-finanza-text">{item.description}</p>
                {meta && (
                  <p
                    className={
                      meta.ready
                        ? 'mt-5 text-sm text-finanza-text'
                        : 'mt-5 inline-block self-start rounded-full bg-finanza-orange-50 px-3 py-0.5 text-xs font-semibold uppercase tracking-wide text-finanza-orange-600'
                    }
                  >
                    {meta.status}
                  </p>
                )}
                <Link
                  href={item.href}
                  className="mt-5 inline-flex items-center gap-1.5 font-medium text-brand-500 after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand-500"
                >
                  Read {item.label} <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-12 flex flex-col gap-6 rounded-lg bg-brand-50 p-8 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <Pill>Questions</Pill>
            <p className="font-display text-2xl font-semibold text-finanza-dark">
              Need something clarified, or want to make a privacy request?
            </p>
            <p className="mt-2 text-finanza-text">
              Write to us and include the group or account the question is about, so we can answer it properly.
            </p>
          </div>
          <a
            href={`mailto:${CONTACT.email}`}
            className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-500 px-8 py-3 font-medium text-white transition-colors duration-500 hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            <Mail aria-hidden="true" className="h-4 w-4" />
            {CONTACT.email}
          </a>
        </div>
      </FinanzaSection>
    </PageShell>
  );
}
