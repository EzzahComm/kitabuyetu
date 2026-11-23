import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { PublicSite } from '@/components/websites/public-site';
import { publishedWebsite } from '@/lib/services/organization-websites.service';
export const dynamic = 'force-dynamic';
const loadSite = cache(publishedWebsite);
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const site = await loadSite(slug);
  if (!site) return { robots: { index: false, follow: false } };
  const title = site.name;
  const description = site.introduction || site.headline;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: '/sites/' + slug },
    openGraph: { title, description, siteName: title, type: 'website', url: '/sites/' + slug },
    twitter: { card: 'summary', title, description },
  };
}
export default async function OrganizationWebsite({ params }: Props) {
  const { slug } = await params;
  const site = await loadSite(slug);
  if (!site) notFound();
  return (
    <main>
      <PublicSite site={site} slug={slug} />
    </main>
  );
}
