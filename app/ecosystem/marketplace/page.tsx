export const dynamic = 'force-dynamic';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Banknote, GraduationCap, HandCoins, Handshake, ShieldCheck, Store } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PageShell } from '@/components/marketing/page-shell';
import { FinanzaHeading, FinanzaSection, IconBadge, btnPrimary } from '@/components/marketing/finanza';
import { CtaBand } from '@/components/marketing/kitabu-sections';
import { ROUTES } from '@/components/marketing/routes';
import { withAdminDb } from '@/lib/db';
import {
  listPublishedOpportunities,
  toPublicOpportunity,
  type Opportunity,
  type PublicOpportunity,
} from '@/lib/services/ecosystem.service';
import { marketingMetadata } from '@/components/marketing/page-metadata';

export const metadata: Metadata = marketingMetadata({
  path: '/ecosystem/marketplace',
  title: 'Marketplace — Grants, Loans & Services for Groups',
  description:
    'Grants, loans, insurance, training and services from partners, offered to chamas, SACCOs and community groups on Kitabu Yetu.',
});

/** The five opportunity_type values in ecosystem_opportunities, in plain language. */
const OFFER_TYPES: { type: Opportunity['opportunity_type']; label: string; body: string; icon: LucideIcon }[] = [
  { type: 'grant', label: 'Grants', body: 'Funding for group projects and community programmes.', icon: HandCoins },
  { type: 'loan', label: 'Loans', body: 'Credit for groups and their members from lending partners.', icon: Banknote },
  { type: 'insurance', label: 'Insurance', body: 'Cover for members, assets and group activities.', icon: ShieldCheck },
  {
    type: 'training',
    label: 'Training',
    body: 'Skills in finance, farming, business and governance.',
    icon: GraduationCap,
  },
  { type: 'service', label: 'Services', body: 'Suppliers and service providers for group activities.', icon: Store },
];

const TYPE_LABEL = Object.fromEntries(OFFER_TYPES.map((t) => [t.type, t.label.replace(/s$/, '')]));

function amountLabel(o: PublicOpportunity): string | null {
  if (o.amount_min && o.amount_max) {
    return `${o.currency} ${o.amount_min.toLocaleString()} – ${o.amount_max.toLocaleString()}`;
  }
  if (o.amount_min) return `From ${o.currency} ${o.amount_min.toLocaleString()}`;
  return null;
}

async function MarketplacePage() {
  let opportunities: Opportunity[] = [];
  try {
    opportunities = await withAdminDb((db) => listPublishedOpportunities(db));
  } catch {
    // Database unreachable (build or preview) — render the empty state rather than fail the page.
  }
  // Anonymous, public page — strip internal-only fields (eligibility_rules)
  // before they're ever in scope here, in case a future edit passes one of
  // these into a client component or otherwise serializes it whole.
  const published: PublicOpportunity[] = opportunities.map(toPublicOpportunity);

  return (
    <PageShell
      title="Marketplace"
      description="Grants, loans, insurance, training and services from partners — offered to groups that keep their books on Kitabu Yetu."
      crumbs={[{ label: 'Ecosystem', href: ROUTES.ecosystem }]}
      layout="sections"
    >
      <FinanzaSection labelledBy="offers-heading" className="pt-4 lg:pt-8">
        <FinanzaHeading
          id="offers-heading"
          pill="Open Offers"
          title={published.length > 0 ? 'Offers open to groups now' : 'Offers are on their way'}
          className="mb-10"
        />
        {published.length === 0 ? (
          <div className="rounded-lg border border-brand-100 bg-brand-50 px-6 py-10 text-center">
            <p className="font-display text-xl font-semibold text-finanza-dark">No offers are open right now.</p>
            <p className="mx-auto mt-2 max-w-xl text-finanza-text">
              We are onboarding partners. Keep your group&apos;s records up to date — a clean record is what makes a
              group ready when offers open.
            </p>
          </div>
        ) : (
          <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {published.map((o) => {
              const offerType = OFFER_TYPES.find((t) => t.type === o.opportunity_type);
              const amount = amountLabel(o);
              return (
                <li key={o.id}>
                  <Link
                    href={`/ecosystem/marketplace/${o.id}`}
                    className="group flex h-full flex-col rounded-lg border border-brand-100 bg-white p-6 transition-colors duration-300 hover:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    <div className="mb-4 flex items-center justify-between gap-3">
                      {offerType && <IconBadge icon={offerType.icon} />}
                      <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-500">
                        {TYPE_LABEL[o.opportunity_type] ?? o.opportunity_type}
                      </span>
                    </div>
                    <h3 className="font-display text-xl font-semibold leading-snug text-finanza-dark">{o.title}</h3>
                    {o.category && <p className="mt-1 text-sm text-finanza-text">{o.category}</p>}
                    <p className="mt-3 line-clamp-3 leading-relaxed text-finanza-text">{o.description}</p>
                    <div className="mt-auto pt-5">
                      {amount && <p className="font-semibold text-finanza-dark">{amount}</p>}
                      {o.terms_summary && <p className="mt-1 text-sm text-finanza-text">{o.terms_summary}</p>}
                      <span className="mt-4 inline-flex items-center gap-1.5 font-medium text-brand-500">
                        View offer
                        <ArrowRight
                          aria-hidden="true"
                          className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                        />
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </FinanzaSection>

      <FinanzaSection labelledBy="types-heading" className="bg-brand-50/60">
        <FinanzaHeading
          id="types-heading"
          align="center"
          pill="What You'll Find"
          title="Five kinds of offers, one place"
          className="mb-12"
        />
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {OFFER_TYPES.map((t) => (
            <li key={t.type} className="rounded-lg border border-brand-100 bg-white p-6">
              <IconBadge icon={t.icon} className="mb-4" />
              <h3 className="font-display text-lg font-semibold text-finanza-dark">{t.label}</h3>
              <p className="mt-2 text-sm leading-relaxed text-finanza-text">{t.body}</p>
            </li>
          ))}
        </ul>
      </FinanzaSection>

      <FinanzaSection labelledBy="partners-heading">
        <div className="flex flex-col items-start gap-8 rounded-lg border border-brand-100 p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-5">
            <IconBadge icon={Handshake} />
            <div>
              <h2 id="partners-heading" className="font-display text-2xl font-semibold text-finanza-dark">
                Serve organized groups?
              </h2>
              <p className="mt-2 max-w-2xl text-finanza-text">
                Lenders, insurers, trainers, suppliers and development partners can list offers for groups on Kitabu
                Yetu. Every offer is published by the Kitabu Yetu team, not by the partner directly.
              </p>
            </div>
          </div>
          <Link href={ROUTES.contact} className={btnPrimary}>
            Become a partner
          </Link>
        </div>
      </FinanzaSection>

      <CtaBand
        title="Get your group marketplace-ready"
        subtitle="Offers go to groups with clear records — start keeping yours on Kitabu Yetu."
      />
    </PageShell>
  );
}

export default MarketplacePage;
