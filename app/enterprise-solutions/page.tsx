import type { Metadata } from 'next';
import Link from 'next/link';
import { Building2, ClipboardCheck, BarChart3, ShieldCheck, UsersRound, Workflow } from 'lucide-react';
import { PageShell } from '@/components/marketing/page-shell';
import { CONTACT, ROUTES } from '@/components/marketing/routes';
import { ENTERPRISE_SETUP_SERVICES } from '@/lib/billing/enterprise-setup-services';
import { marketingMetadata } from '@/components/marketing/page-metadata';
import { ORGANIZATION_PLAN_FEATURES, ORGANIZATION_PLAN_MONTHLY_FEES } from '@/types/enums';

const standardPlans = ['starter', 'growth', 'premium'] as const;
const formatKes = (amount: number) => `KES ${amount.toLocaleString('en-KE')}`;

export const metadata: Metadata = marketingMetadata({
  path: '/enterprise-solutions',
  title: 'Kitabu Yetu Enterprise | Digital Infrastructure for Institutions',
  description: `Enterprise plans from ${formatKes(ORGANIZATION_PLAN_MONTHLY_FEES.starter)} per month. See pricing for websites, branded onboarding, SMS sender IDs, and custom API, M-Pesa PayBill and bank integrations.`,
});

const CAPABILITIES = [
  {
    icon: Building2,
    title: 'Multi-organisation oversight',
    body: 'Bring supported organisations and branches into a coordinated portfolio while each organisation retains its own records.',
  },
  {
    icon: ClipboardCheck,
    title: 'Programme administration',
    body: 'Organise programmes, budgets, eligibility criteria and participating organisations through a central institutional workspace.',
  },
  {
    icon: UsersRound,
    title: 'Field team coordination',
    body: 'Assign staff roles and access according to responsibilities, with individual accounts rather than shared logins.',
  },
  {
    icon: BarChart3,
    title: 'Consolidated reporting',
    body: 'Review portfolio activity and programme performance using records captured through the platform.',
  },
  {
    icon: ShieldCheck,
    title: 'Accountability and access controls',
    body: 'Use role-based permissions and activity records. Keep member-level personal information restricted to authorised users.',
  },
  {
    icon: Workflow,
    title: 'Configurable workflows',
    body: 'Discuss organisation-specific operating rules, approvals and implementation requirements with our team.',
  },
];

export default function EnterpriseSolutionsPage() {
  return (
    <PageShell
      title="Kitabu Yetu Enterprise"
      description="One institutional platform. Multiple organisations. Stronger programme accountability."
    >
      <p className="text-lg leading-relaxed">
        NGOs, development institutions, networks and federations work with community organisations across locations and
        programmes. Kitabu Yetu Enterprise provides digital infrastructure to coordinate this work, improve operational
        visibility and strengthen the quality of organisational records—without taking away each organisation’s
        ownership of its own operations.
      </p>

      <div className="flex flex-wrap gap-3 pt-5">
        <Link
          href={ROUTES.startOrganization}
          className="rounded-md bg-brand-600 px-5 py-3 text-sm font-semibold !text-white transition-colors hover:bg-brand-700"
        >
          Sign up for Enterprise
        </Link>
        <Link
          href="/enterprise/login"
          className="rounded-md border border-brand-100 px-5 py-3 text-sm font-semibold text-finanza-dark! transition-colors hover:bg-brand-50/60"
        >
          Enterprise portal sign in
        </Link>
      </div>
      <section aria-labelledby="enterprise-products" className="space-y-4">
        <h2 id="enterprise-products">Get started with a Kitabu Yetu product</h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          <li className="flex flex-col gap-2 rounded-lg border border-brand-100 p-4">
            <h3>Bookkeeper</h3>
            <p className="flex-1 text-sm">Manage group records, contributions and reports.</p>
            <Link href={ROUTES.startGroup}>Register for Bookkeeper</Link>
          </li>
          <li className="flex flex-col gap-2 rounded-lg border border-brand-100 p-4">
            <h3>Chama Reminder</h3>
            <p className="flex-1 text-sm">Send reminders and keep members informed.</p>
            <Link href={`${ROUTES.startGroup}?product=chama_reminder`}>Register for Chama Reminder</Link>
          </li>
          <li className="flex flex-col gap-2 rounded-lg border border-brand-100 p-4">
            <h3>Changi$ha</h3>
            <p className="flex-1 text-sm">Start fundraising with a registered group.</p>
            <Link href={ROUTES.startCampaign}>Start a Changi$ha campaign</Link>
          </li>
        </ul>
      </section>

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
      <p>
        Enterprise is designed for NGOs, foundations, community development programmes, cooperative networks,
        federations, faith-based networks and other institutions supporting multiple community organisations.
      </p>

      <section aria-labelledby="enterprise-plans" className="scroll-mt-28 space-y-4">
        <h2 id="enterprise-plans">Enterprise plans</h2>
        <p>
          Start online with Enterprise Starter. Contact our team to arrange Growth, Premium or a custom Premium+
          agreement.
        </p>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {standardPlans.map((plan) => {
            const { maxLinkedGroups, maxStaff } = ORGANIZATION_PLAN_FEATURES[plan];

            return (
              <li key={plan} className="rounded-lg border border-brand-100 bg-brand-50/40 p-4">
                <h3 className="capitalize">{plan}</h3>
                <p className="mt-1 font-semibold text-finanza-dark">
                  {formatKes(ORGANIZATION_PLAN_MONTHLY_FEES[plan])} / month
                </p>
                <p className="mt-1 text-sm">
                  {maxLinkedGroups === null ? 'Unlimited linked groups' : `Up to ${maxLinkedGroups} linked groups`}
                  {' · '}
                  {maxStaff} staff seats
                </p>
              </li>
            );
          })}
          <li className="rounded-lg border border-brand-100 bg-brand-50/40 p-4">
            <h3>Premium+</h3>
            <p className="mt-1 font-semibold text-finanza-dark">From {formatKes(25_000)} / month</p>
            <p className="mt-1 text-sm">Custom terms, branding and support.</p>
          </li>
        </ul>
        <p>
          Group products such as Bookkeeper and Chama Reminder are billed separately. Organizations can arrange to
          sponsor group subscriptions. A group’s existing subscription stays in place when it links to Enterprise. SMS
          usage and applicable payment fees are separate. <Link href={ROUTES.pricing}>See group pricing</Link>.
        </p>
      </section>

      <section aria-labelledby="enterprise-services" className="scroll-mt-28 space-y-4">
        <h2 id="enterprise-services">Setup and integration services</h2>
        <p>
          Request a quote for the services you need. For payment and API integrations, we confirm the provider,
          credentials, supported workflows and testing before activation. Your quote states any applicable taxes and
          third-party fees.
        </p>
        <dl className="divide-y divide-brand-100 rounded-lg border border-brand-100">
          {ENTERPRISE_SETUP_SERVICES.map(({ name, price, description }) => (
            <div key={name} className="grid gap-x-4 px-4 py-4 sm:grid-cols-[1fr_auto]">
              <dt className="font-semibold text-finanza-dark">{name}</dt>
              <dd className="font-semibold text-finanza-dark">{price}</dd>
              <dd className="mt-1 text-sm sm:col-span-2">{description}</dd>
            </div>
          ))}
        </dl>
        <Link href={ROUTES.contact}>Request an implementation quote</Link>
      </section>

      <section aria-labelledby="enterprise-onboarding" className="space-y-3">
        <h2 id="enterprise-onboarding">Branded group onboarding</h2>
        <p>
          Ask about a dedicated signup address on your domain, such as <code>join.yourorganisation.example</code>.
          Custom-domain group and member signup is planned. When available, the planned rate is {formatKes(2_000)} /
          month on Starter, with one subdomain included on Growth and Premium.
        </p>
        <p>
          For now, you can create an Enterprise workspace, use standard Kitabu Yetu signup links and request to link
          existing groups. Contact us to scope branded onboarding for your programme.
        </p>
      </section>

      <h2>Data responsibility by design</h2>
      <p>
        Access should be proportionate to each user’s role. Institutional reporting can be configured around appropriate
        programme-level information, while personal member records remain protected by permissions and applicable
        data-protection requirements.
      </p>

      <p className="pt-3 text-sm text-finanza-text">
        Contact our team at{' '}
        <a
          href={`mailto:${CONTACT.enterpriseEmail}?subject=${encodeURIComponent('Kitabu Yetu Enterprise enquiry')}`}
          className="font-medium text-brand-700 underline-offset-4 hover:underline"
        >
          {CONTACT.enterpriseEmail}
        </a>{' '}
        to scope a pilot or institutional deployment.
      </p>
    </PageShell>
  );
}
