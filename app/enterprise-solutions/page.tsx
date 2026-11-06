import type { Metadata } from 'next';
import Link from 'next/link';
import { Building2, ClipboardCheck, BarChart3, ShieldCheck, UsersRound, Workflow } from 'lucide-react';
import { PageShell } from '@/components/marketing/page-shell';
import { CONTACT, ROUTES } from '@/components/marketing/routes';
import { marketingMetadata } from '@/components/marketing/page-metadata';

export const metadata: Metadata = marketingMetadata({
  path: '/enterprise-solutions',
  title: 'Kitabu Yetu Enterprise | Digital Infrastructure for Institutions',
  description: 'Coordinate community organisations and development programmes with portfolio oversight, programme administration, field coordination and accountable reporting.',
});

const CAPABILITIES = [
  { icon: Building2, title: 'Multi-organisation oversight', body: 'Bring supported organisations and branches into a coordinated portfolio while each organisation retains its own records.' },
  { icon: ClipboardCheck, title: 'Programme administration', body: 'Organise programmes, budgets, eligibility criteria and participating organisations through a central institutional workspace.' },
  { icon: UsersRound, title: 'Field team coordination', body: 'Assign staff roles and access according to responsibilities, with individual accounts rather than shared logins.' },
  { icon: BarChart3, title: 'Consolidated reporting', body: 'Review portfolio activity and programme performance using records captured through the platform.' },
  { icon: ShieldCheck, title: 'Accountability and access controls', body: 'Use role-based permissions and activity records. Keep member-level personal information restricted to authorised users.' },
  { icon: Workflow, title: 'Configurable workflows', body: 'Discuss organisation-specific operating rules, approvals and implementation requirements with our team.' },
];

export default function EnterpriseSolutionsPage() {
  return (
    <PageShell title="Kitabu Yetu Enterprise" description="One institutional platform. Multiple organisations. Stronger programme accountability.">
      <p className="text-lg leading-relaxed">
        NGOs, development institutions, networks and federations work with community organisations across locations and programmes. Kitabu Yetu Enterprise provides digital infrastructure to coordinate this work, improve operational visibility and strengthen the quality of organisational records—without taking away each organisation’s ownership of its own operations.
      </p>

      <h2>Designed for institutional work</h2>
      <div className="not-prose grid gap-5 pt-3 md:grid-cols-2">
        {CAPABILITIES.map((item) => (
          <article key={item.title} className="rounded-lg border border-brand-100 bg-white p-6">
            <item.icon aria-hidden="true" className="mb-4 h-8 w-8 text-brand-500" />
            <h3 className="font-display text-xl font-semibold text-finanza-dark">{item.title}</h3>
            <p className="mt-2 leading-relaxed text-finanza-text">{item.body}</p>
          </article>
        ))}
      </div>

      <h2>Who it serves</h2>
      <p>Enterprise is designed for NGOs, foundations, community development programmes, cooperative networks, federations, faith-based networks and other institutions supporting multiple community organisations.</p>

      <h2>Implementation that fits your programme</h2>
      <ol className="ml-5 list-decimal space-y-2">
        <li><strong>Discover:</strong> understand your programme structure, organisations, reporting needs and operating context.</li>
        <li><strong>Configure:</strong> agree roles, access, workflows, reporting and implementation scope.</li>
        <li><strong>Onboard:</strong> prepare participating organisations and train the relevant teams.</li>
        <li><strong>Operate:</strong> coordinate activities and review information through authorised dashboards.</li>
        <li><strong>Improve:</strong> assess adoption, data quality and programme outcomes together.</li>
      </ol>

      <h2>Data responsibility by design</h2>
      <p>Access should be proportionate to each user’s role. Institutional reporting can be configured around appropriate programme-level information, while personal member records remain protected by permissions and applicable data-protection requirements.</p>

      <div className="flex flex-wrap gap-3 pt-5">
        <Link href={ROUTES.contact} className="rounded-md bg-brand-600 px-5 py-3 text-sm font-semibold !text-white transition-colors hover:bg-brand-700">Discuss an Enterprise deployment</Link>
        <Link href={ROUTES.orgPortal} className="rounded-md border border-brand-100 px-5 py-3 text-sm font-semibold text-finanza-dark! transition-colors hover:bg-brand-50/60">Enterprise portal sign in</Link>
      </div>
      <p className="pt-3 text-sm text-finanza-text">Contact our team at <a href={`mailto:${CONTACT.enterpriseEmail}?subject=${encodeURIComponent('Kitabu Yetu Enterprise enquiry')}`} className="font-medium text-brand-700 underline-offset-4 hover:underline">{CONTACT.enterpriseEmail}</a> to scope a pilot or institutional deployment.</p>
    </PageShell>
  );
}
