import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortableText } from '@portabletext/react';
import { ArrowLeft, Briefcase, Clock, Mail, MapPin } from 'lucide-react';
import { PageShell } from '@/components/marketing/page-shell';
import { Container } from '@/components/marketing/primitives';
import { ApplicationForm } from '@/components/marketing/application-form';
import { departmentLabel, employmentLabel } from '@/components/marketing/careers-labels';
import { OG_FALLBACK } from '@/components/marketing/page-metadata';
import { CONTACT, ROUTES } from '@/components/marketing/routes';
import { getJobBySlug, getOpenJobs } from '@/lib/cms/sanity';

interface JobPageProps {
  params: Promise<{ slug: string }>;
}

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://kitabuyetu.co.ke').replace(/\/$/, '');

export async function generateStaticParams() {
  const jobs = await getOpenJobs();
  return jobs.map((job) => ({ slug: job.slug }));
}

export async function generateMetadata({ params }: JobPageProps): Promise<Metadata> {
  const { slug } = await params;
  const job = await getJobBySlug(slug);
  if (!job) return { title: 'Careers' };
  const title = `${job.title} — Careers`;
  const url = `${SITE_URL}/careers/${job.slug}`;
  return {
    title,
    description: job.summary,
    alternates: { canonical: url },
    openGraph: {
      siteName: 'Kitabu Yetu',
      title,
      description: job.summary,
      url,
      type: 'article',
      images: [OG_FALLBACK],
    },
    twitter: { card: 'summary_large_image', title, description: job.summary, images: [OG_FALLBACK] },
  };
}

/** JobPosting structured data — see the resources/[slug] page for the escaping rationale. */
function StructuredData({ job, url }: { job: NonNullable<Awaited<ReturnType<typeof getJobBySlug>>>; url: string }) {
  const json = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: job.summary,
    url,
    ...(job.postedAt ? { datePosted: job.postedAt } : {}),
    employmentType: job.employmentType.toUpperCase().replace('-', '_'),
    hiringOrganization: { '@type': 'Organization', name: 'Kitabu Yetu', sameAs: SITE_URL },
    jobLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: job.location, addressCountry: 'KE' },
    },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json).replace(/</g, '\\u003c') }}
    />
  );
}

export default async function JobPage({ params }: JobPageProps) {
  const { slug } = await params;
  const job = await getJobBySlug(slug);
  if (!job) notFound();
  const url = `${SITE_URL}/careers/${job.slug}`;

  const facts = [
    { icon: Briefcase, label: 'Department', value: departmentLabel(job.department) },
    { icon: MapPin, label: 'Location', value: job.location },
    { icon: Clock, label: 'Type', value: employmentLabel(job.employmentType) },
  ];

  return (
    <PageShell
      title={job.title}
      description={job.summary}
      crumbs={[{ label: 'Careers', href: ROUTES.careers }]}
      layout="sections"
    >
      <StructuredData job={job} url={url} />
      <Container className="pb-16 pt-4 md:pb-24">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div>
            <Link
              href={ROUTES.careers}
              className="inline-flex items-center gap-1.5 rounded-sm font-medium text-brand-500 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              All open positions
            </Link>

            <div className="mt-8 max-w-3xl space-y-5 text-base leading-relaxed text-finanza-text [&_a]:font-medium [&_a]:text-brand-500 [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-finanza-dark [&_h3]:font-display [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-finanza-dark [&_li::marker]:text-brand-500 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_strong]:font-semibold [&_strong]:text-finanza-dark [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
              <PortableText value={job.description} />
            </div>

            <div id="apply" className="mt-12 max-w-3xl scroll-mt-28">
              <ApplicationForm jobSlug={job.slug} jobTitle={job.title} />
            </div>
          </div>

          <aside className="lg:sticky lg:top-28 lg:self-start">
            <div className="rounded-lg border border-brand-100 p-6">
              <p className="font-display text-xl font-semibold text-finanza-dark">Role at a glance</p>
              <dl className="mt-5 space-y-4">
                {facts.map((fact) => (
                  <div key={fact.label} className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50">
                      <fact.icon aria-hidden="true" className="h-4 w-4 text-brand-500" />
                    </span>
                    <div>
                      <dt className="text-sm text-finanza-text">{fact.label}</dt>
                      <dd className="font-medium text-finanza-dark">{fact.value}</dd>
                    </div>
                  </div>
                ))}
              </dl>
              <a
                href="#apply"
                className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-brand-500 px-6 py-3 font-medium text-white transition-colors duration-500 hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                Apply for this role
              </a>
            </div>
            <div className="mt-6 rounded-lg bg-brand-50 p-6 text-[0.9375rem] text-finanza-text">
              <p className="font-medium text-finanza-dark">Questions about the role?</p>
              <a
                href={`mailto:${CONTACT.careersEmail}?subject=${encodeURIComponent(job.title)}`}
                className="mt-2 inline-flex items-center gap-2 font-medium text-brand-500 hover:text-brand-700"
              >
                <Mail aria-hidden="true" className="h-4 w-4" />
                {CONTACT.careersEmail}
              </a>
            </div>
          </aside>
        </div>
      </Container>
    </PageShell>
  );
}
