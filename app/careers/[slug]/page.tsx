import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortableText } from '@portabletext/react';
import { IconArrowUpRight, IconArrowLeft } from '@tabler/icons-react';
import { Container } from '@/components/Container';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';
import { getJobBySlug, getOpenJobs } from '@/lib/cms/sanity';

const DEPARTMENT_LABEL: Record<string, string> = {
  'product-and-engineering': 'Product and engineering',
  'community-and-operations': 'Community and operations',
  partnerships: 'Partnerships',
  'customer-experience': 'Customer experience',
};

const EMPLOYMENT_LABEL: Record<string, string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
};

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
    openGraph: { title, description: job.summary, url, type: 'article' },
    twitter: { title, description: job.summary },
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
    jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: job.location, addressCountry: 'KE' } },
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

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <StructuredData job={job} url={url} />
      <SiteHeader />
      <main id="main" className="flex-1 pt-16 lg:pt-20">
        <Container className="py-12 md:py-16">
          <Link
            href="/careers"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          >
            <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
            All open positions
          </Link>

          <div className="mt-6 max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-wider text-indigo-600">
              {DEPARTMENT_LABEL[job.department] ?? job.department}
            </p>
            <h1 className="mt-3 text-3xl font-bold leading-tight text-gray-800 dark:text-white sm:text-4xl">
              {job.title}
            </h1>
            <p className="mt-3 text-sm font-semibold text-gray-500 dark:text-gray-300">
              {job.location} · {EMPLOYMENT_LABEL[job.employmentType] ?? job.employmentType}
            </p>
            <p className="mt-6 text-lg leading-relaxed text-gray-600 dark:text-gray-300">
              {job.summary}
            </p>
          </div>

          <div className="mt-10 max-w-3xl space-y-5 text-base leading-7 text-gray-600 dark:text-gray-300 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-gray-800 [&_h2]:dark:text-white [&_strong]:font-semibold [&_strong]:text-gray-800 [&_strong]:dark:text-white [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2">
            <PortableText value={job.description} />
          </div>

          <div className="mt-12 flex max-w-3xl flex-col items-start gap-4 rounded-lg border border-gray-200 bg-gray-50 p-6 dark:border-trueGray-700 dark:bg-trueGray-800/40 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-bold text-gray-800 dark:text-white">Ready to apply?</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-300">
                Send your CV and a short note to our team.
              </p>
            </div>
            <a
              href={`mailto:careers@kitabuyetu.co.ke?subject=${encodeURIComponent(`Application: ${job.title}`)}`}
              className="inline-flex shrink-0 items-center gap-2 rounded-md bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              Apply for this role <IconArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </Container>
      </main>
      <SiteFooter />
    </div>
  );
}
