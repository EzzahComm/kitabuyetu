import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FinanzaHeading, FinanzaSection, btnOutline } from '../finanza';
import { PostCard } from '../post-card';
import { CampaignCard } from '../campaign-card';
import type { Campaign } from '@/lib/services/campaigns.service';
import { getPosts } from '@/lib/cms/sanity';
import { ROUTES } from '../routes';

/** The three newest posts from the Sanity blog. Renders nothing when the CMS has none (or is unreachable). */
export async function LatestPostsSection({ id }: { id?: string }) {
  const posts = (await getPosts()).slice(0, 3);
  if (posts.length === 0) return null;
  return (
    <FinanzaSection id={id} labelledBy="blog-heading">
      <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <FinanzaHeading
          id="blog-heading"
          pill="From The Blog"
          title="Guides for the people who run groups."
          className="max-w-2xl"
        />
        <Link href={ROUTES.resources} className={cn(btnOutline, 'shrink-0 self-start sm:self-auto')}>
          All articles <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>
      <ul className="grid gap-6 md:grid-cols-3">
        {posts.map((post) => (
          <li key={post.slug}>
            <PostCard post={post} />
          </li>
        ))}
      </ul>
    </FinanzaSection>
  );
}

/**
 * Live Changi$ha campaigns — or, when none are live, the most recent finished
 * ones. The service is imported lazily inside try/catch (as app/sitemap.ts
 * does): it validates DB env on load, and a build or preview without a
 * database must render the page without this section rather than fail.
 */
export async function LiveCampaignsSection({ id }: { id?: string }) {
  let live: Campaign[] = [];
  let past: Campaign[] = [];
  try {
    const { campaignsService } = await import('@/lib/services/campaigns.service');
    live = (await campaignsService.listActiveCampaigns()).slice(0, 3);
    if (live.length === 0) past = await campaignsService.listPastCampaigns(3);
  } catch {
    return null;
  }
  const shown = live.length > 0 ? live : past;
  if (shown.length === 0) return null;
  const ended = live.length === 0;

  return (
    <FinanzaSection id={id} labelledBy="live-campaigns-heading" className="bg-brand-50/60">
      <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <FinanzaHeading
          id="live-campaigns-heading"
          pill="Changi$ha"
          title={ended ? 'Recently funded by the community.' : 'Campaigns you can support today.'}
          lede="Checked by Kitabu Yetu. Give by M-Pesa. Donors pay nothing extra."
          className="max-w-2xl"
        />
        <Link href={ROUTES.fundraise} className={cn(btnOutline, 'shrink-0 self-start bg-white sm:self-auto')}>
          All campaigns <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>
      <ul className="grid gap-6 md:grid-cols-3">
        {shown.map((campaign) => (
          <li key={campaign.slug}>
            <CampaignCard campaign={campaign} ended={ended} />
          </li>
        ))}
      </ul>
    </FinanzaSection>
  );
}
