import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { ROUTES } from '@/components/marketing/routes';

export const metadata: Metadata = {
  title: 'Programs',
  description: 'Grants, opportunities and interventions for qualifying groups. Coming soon.',
};

export default function ProgramsPage() {
  return (
    <PageShell
      title="Programs"
      description="A place for enterprises, NGOs and donors to announce and manage programs for qualifying groups — coming soon."
    >
      <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700">
        Coming soon. This part of the ecosystem is not available yet.
      </div>

      <p>
        Grants, training, matched-savings schemes and other interventions aimed at
        community groups usually reach them through word of mouth, if they reach them
        at all. Programs is where an enterprise, NGO or donor will be able to announce
        an opportunity directly to the groups already using the platform — and where a
        group&apos;s own record can help show it qualifies.
      </p>

      <h2>What we are building towards</h2>
      <ul className="ml-5 list-disc space-y-2">
        <li>Programs and grants listed by the organizations running them.</li>
        <li>Eligibility a group can demonstrate from its own real record, not a paper application alone.</li>
        <li>A clear path from a group&apos;s book to the opportunities it qualifies for.</li>
      </ul>

      <p>
        Organizations ready to reach the groups on Kitabu Yetu today can start with{' '}
        <Link href={ROUTES.enterprise}>Enterprise</Link>.
      </p>

      <div className="flex flex-wrap gap-3 pt-4">
        <Link
          href={ROUTES.contact}
          className="rounded-md border border-brand-blue-900/15 px-5 py-2.5 text-sm font-semibold text-brand-blue-900 transition-colors hover:bg-paper-deep"
        >
          Talk to us about a program
        </Link>
      </div>
    </PageShell>
  );
}
