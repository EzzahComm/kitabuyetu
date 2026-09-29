import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { urlForImage, type Post, type PostCategory } from '@/lib/cms/sanity';

export const CATEGORY_LABEL: Record<PostCategory, string> = {
  blog: 'Blog',
  guide: 'Guide',
  'case-study': 'Case study',
  education: 'Education',
  announcement: 'Announcement',
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** One blog/resources card — shared by /resources and the home page's latest-posts strip. */
export function PostCard({ post, headingAs: Heading = 'h3' }: { post: Post; headingAs?: 'h2' | 'h3' }) {
  const cover = urlForImage(post.coverImage);
  const date = formatDate(post.publishedAt);
  return (
    <Link
      href={`/resources/${post.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-lg border border-brand-100 bg-white transition-colors duration-300 hover:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      {cover && (
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-brand-50">
          {/* alt="" — the card link already carries the title. */}
          <Image
            src={cover}
            alt=""
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          />
        </div>
      )}
      <div className="flex flex-1 flex-col p-6">
        <p className="flex items-center gap-2 text-sm">
          <span className="rounded-full bg-brand-50 px-2.5 py-0.5 font-medium text-brand-500">
            {CATEGORY_LABEL[post.category] ?? 'Blog'}
          </span>
          {date && <span className="text-finanza-text">{date}</span>}
        </p>
        <Heading className="mt-3 font-display text-xl font-semibold leading-snug text-finanza-dark">
          {post.title}
        </Heading>
        <p className="mt-2 line-clamp-3 leading-relaxed text-finanza-text">{post.excerpt}</p>
        <span className="mt-auto inline-flex items-center gap-1.5 pt-5 font-medium text-brand-500">
          Read more
          <ArrowRight
            aria-hidden="true"
            className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </span>
      </div>
    </Link>
  );
}
