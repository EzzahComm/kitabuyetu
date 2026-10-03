import type { Metadata } from 'next';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { PageShell } from '@/components/marketing/page-shell';
import { FinanzaSection } from '@/components/marketing/finanza';
import { NewsletterSignupForm } from '@/components/marketing/newsletter-signup-form';
import { CATEGORY_LABEL, PostCard } from '@/components/marketing/post-card';
import { getPosts, type PostCategory } from '@/lib/cms/sanity';
import { marketingMetadata } from '@/components/marketing/page-metadata';

export const metadata: Metadata = marketingMetadata({
  path: '/resources',
  title: 'Chama Guides, Tips & Case Studies',
  description:
    'Practical guides on running a chama, table banking group or welfare association in Kenya: contributions, loans, record keeping, rules and more.',
});

interface ResourcesPageProps {
  searchParams: Promise<{ category?: string }>;
}

export default async function ResourcesPage({ searchParams }: ResourcesPageProps) {
  const { category } = await searchParams;
  const posts = await getPosts();
  const filtered = category ? posts.filter((post) => post.category === category) : posts;
  // Only offer filters for categories that actually have posts.
  const categories = Array.from(new Set(posts.map((post) => post.category))) as PostCategory[];

  const pill = (active: boolean) =>
    cn(
      'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
      active
        ? 'border-brand-500 bg-brand-500 text-white'
        : 'border-brand-100 text-finanza-dark hover:border-brand-500 hover:text-brand-500',
    );

  return (
    <PageShell
      title="Blog & Guides"
      description="Practical guides, case studies and updates for people running chamas, VSLAs, SACCOs and community organizations."
      layout="sections"
    >
      <FinanzaSection labelledBy="posts-heading" className="pt-4 lg:pt-8">
        <h2 id="posts-heading" className="sr-only">
          {category ? `${CATEGORY_LABEL[category as PostCategory] ?? 'Posts'} posts` : 'All posts'}
        </h2>
        {categories.length > 1 && (
          <nav aria-label="Filter by category" className="mb-10 flex flex-wrap gap-2">
            <Link href="/resources" className={pill(!category)} aria-current={!category ? 'page' : undefined}>
              All
            </Link>
            {categories.map((c) => (
              <Link
                key={c}
                href={`/resources?category=${c}`}
                className={pill(category === c)}
                aria-current={category === c ? 'page' : undefined}
              >
                {CATEGORY_LABEL[c] ?? c}
              </Link>
            ))}
          </nav>
        )}

        {filtered.length === 0 ? (
          <p className="rounded-lg border border-brand-100 bg-brand-50 px-6 py-10 text-center text-finanza-text">
            {posts.length === 0 ? 'Nothing published yet - check back soon.' : 'No posts in this category yet.'}
          </p>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((post) => (
              <li key={post.slug}>
                <PostCard post={post} />
              </li>
            ))}
          </ul>
        )}
      </FinanzaSection>

      <FinanzaSection labelledBy="subscribe-heading" className="bg-brand-50/60">
        <div className="mx-auto max-w-xl text-center">
          <h2 id="subscribe-heading" className="font-display text-3xl font-bold text-finanza-dark">
            New guides in your inbox
          </h2>
          <p className="mt-3 text-finanza-text">For treasurers and officials - occasionally, never spam.</p>
          <NewsletterSignupForm source="resources" className="mx-auto mt-6 max-w-md" />
        </div>
      </FinanzaSection>
    </PageShell>
  );
}
