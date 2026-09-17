import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { PageShell } from '@/components/marketing/page-shell';
import { getPosts, urlForImage, type PostCategory } from '@/lib/cms/sanity';

export const metadata: Metadata = {
  title: 'Resources',
  description: 'Guides, case studies and updates on running chamas, VSLAs and community organizations well.',
};

const CATEGORY_LABEL: Record<PostCategory, string> = {
  blog: 'Blog',
  guide: 'Guide',
  'case-study': 'Case study',
  education: 'Education',
  announcement: 'Announcement',
};

interface ResourcesPageProps {
  searchParams: Promise<{ category?: string }>;
}

export default async function ResourcesPage({ searchParams }: ResourcesPageProps) {
  const { category } = await searchParams;
  const posts = await getPosts();
  const filtered = category ? posts.filter((post) => post.category === category) : posts;

  return (
    <PageShell
      title="Resources"
      description="Guides, case studies and updates for people running chamas, VSLAs and community organizations."
    >
      {filtered.length === 0 ? (
        <p className="not-prose text-brand-blue-900/60">
          {posts.length === 0
            ? 'Nothing published yet — check back soon.'
            : 'No posts in this category yet.'}
        </p>
      ) : (
        <div className="not-prose grid gap-5 sm:grid-cols-2">
          {filtered.map((post) => {
            const coverImageUrl = urlForImage(post.coverImage);
            return (
            <Link
              key={post.slug}
              href={`/resources/${post.slug}`}
              className="group flex flex-col overflow-hidden rounded-lg border border-brand-blue-900/10 bg-white transition-colors hover:border-brand-500/40"
            >
              {coverImageUrl && (
                <div className="relative aspect-[16/9] w-full overflow-hidden bg-paper-deep">
                  <Image
                    src={coverImageUrl}
                    alt=""
                    fill
                    className="object-cover"
                    sizes="(min-width: 640px) 50vw, 100vw"
                  />
                </div>
              )}
              <div className="flex flex-1 flex-col p-6">
                <span className="text-[11px] font-medium uppercase tracking-wide text-brand-700">
                  {CATEGORY_LABEL[post.category]}
                </span>
                <h2 className="mt-3 font-display text-xl font-normal text-brand-blue-900">{post.title}</h2>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-brand-blue-900/65">{post.excerpt}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
                  Read more
                  <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
