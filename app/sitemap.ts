import type { MetadataRoute } from 'next';
import { getPosts, getOpenJobs } from '@/lib/cms/sanity';
import { SITE_URL } from '@/components/marketing/page-metadata';
import { logger } from '@/lib/logger';

// Per request, never at build: the campaign and marketplace entries read the DB, which builds can't reach.
export const dynamic = 'force-dynamic';

/**
 * The public surface, and only the public surface.
 *
 * Everything under (auth), (dashboard), (member), (admin), (enterprise) and
 * (reminder) is either behind a login or an application route with nothing for
 * a crawler, so none of it appears here — and app/robots.ts disallows those
 * prefixes outright.
 */
const ROUTES: { path: string; priority: number; changeFrequency: 'monthly' | 'weekly' }[] = [
  { path: '/', priority: 1.0, changeFrequency: 'weekly' },
  { path: '/pricing', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/products', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/bookkeeper', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/chama-reminder', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/enterprise-solutions', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/ecosystem', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/ecosystem/organizations', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/ecosystem/donors', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/ecosystem/marketplace', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/ecosystem/programs', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/fundraise', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/how-it-works', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/about', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/about/team', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/about/impact', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/contact', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/support', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/docs', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/status', priority: 0.3, changeFrequency: 'weekly' },
  { path: '/resources', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/careers', priority: 0.5, changeFrequency: 'weekly' },
  { path: '/legal/privacy', priority: 0.2, changeFrequency: 'monthly' },
  { path: '/legal/terms', priority: 0.2, changeFrequency: 'monthly' },
  // Not /legal/data-protection: it is still a placeholder and sets robots noindex.
];

const SOURCE_TIMEOUT_MS = 5_000;

type SitemapEntry = MetadataRoute.Sitemap[number];

async function entriesFrom<T>(
  source: string,
  load: () => Promise<T[]>,
  toEntry: (item: T) => SitemapEntry,
): Promise<MetadataRoute.Sitemap> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const items = await Promise.race([
      load(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${SOURCE_TIMEOUT_MS}ms`)), SOURCE_TIMEOUT_MS);
      }),
    ]);
    return items.map(toEntry);
  } catch (err) {
    logger.error(`[sitemap] ${source} entries omitted`, err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// An Invalid Date would throw later, in Next's serializer, outside every source's try.
function lastModifiedOf(value: string | Date | null | undefined): { lastModified?: Date } {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? { lastModified: date } : {};
}

// Imported lazily so a DB module that fails to initialize drops these entries instead of the whole sitemap.
async function activeCampaigns() {
  const { campaignsService } = await import('@/lib/services/campaigns.service');
  return campaignsService.listActiveCampaigns();
}

async function publishedOpportunities() {
  const [{ withAdminDb }, { listPublishedOpportunities }] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/services/ecosystem.service'),
  ]);
  return withAdminDb((db) => listPublishedOpportunities(db));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // No lastModified: at request time it would claim every page changed on every crawl.
  const staticEntries: MetadataRoute.Sitemap = ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  // No /ecosystem/programs/[slug]: it duplicates /fundraise/[slug] and canonicalizes to it.
  const dynamicEntries = await Promise.all([
    entriesFrom('resources posts', getPosts, (post) => ({
      url: `${SITE_URL}/resources/${post.slug}`,
      ...lastModifiedOf(post.publishedAt),
      changeFrequency: 'monthly',
      priority: 0.5,
    })),
    entriesFrom('careers jobs', getOpenJobs, (job) => ({
      url: `${SITE_URL}/careers/${job.slug}`,
      ...lastModifiedOf(job.postedAt),
      changeFrequency: 'weekly',
      priority: 0.4,
    })),
    entriesFrom('Changi$ha campaigns', activeCampaigns, (campaign) => ({
      url: `${SITE_URL}/fundraise/${campaign.slug}`,
      ...lastModifiedOf(campaign.updated_at),
      changeFrequency: 'weekly',
      priority: 0.4,
    })),
    entriesFrom('marketplace opportunities', publishedOpportunities, (opportunity) => ({
      url: `${SITE_URL}/ecosystem/marketplace/${opportunity.id}`,
      ...lastModifiedOf(opportunity.updated_at),
      changeFrequency: 'monthly',
      priority: 0.3,
    })),
  ]);

  return [...staticEntries, ...dynamicEntries.flat()];
}
