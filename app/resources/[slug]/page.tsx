import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import { PortableText, type PortableTextComponents } from '@portabletext/react';
import { PageShell } from '@/components/marketing/page-shell';
import { OG_FALLBACK } from '@/components/marketing/page-metadata';
import { getPostBySlug, getPosts, urlForImage } from '@/lib/cms/sanity';

interface PostPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const posts = await getPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://kitabuyetu.co.ke').replace(/\/$/, '');

export async function generateMetadata({ params }: PostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return { title: 'Resources' };

  const description = post.seoDescription ?? post.excerpt;
  const url = `${SITE_URL}/resources/${post.slug}`;
  const coverImageUrl = urlForImage(post.coverImage);
  const shareImage = coverImageUrl ? { url: coverImageUrl } : OG_FALLBACK;

  return {
    title: post.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: post.title,
      description,
      url,
      type: 'article',
      siteName: 'Kitabu Yetu',
      publishedTime: post.publishedAt ?? undefined,
      authors: post.authorName ? [post.authorName] : undefined,
      images: [shareImage],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description,
      images: [shareImage],
    },
  };
}

/**
 * BlogPosting structured data. Sanity Studio editors are trusted staff, not
 * public visitors, but the fields still originate outside this file — unlike
 * the fully-static JSON-LD on the homepage, so `<` is escaped before
 * embedding to rule out a `</script>`-breakout edge case in a title/excerpt.
 */
function StructuredData({
  post,
  url,
  coverImageUrl,
}: {
  post: NonNullable<Awaited<ReturnType<typeof getPostBySlug>>>;
  url: string;
  coverImageUrl: string | null;
}) {
  const json = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.seoDescription ?? post.excerpt,
    url,
    ...(post.publishedAt ? { datePublished: post.publishedAt } : {}),
    ...(post.authorName ? { author: { '@type': 'Person', name: post.authorName } } : {}),
    ...(coverImageUrl ? { image: coverImageUrl } : {}),
    publisher: { '@type': 'Organization', name: 'Kitabu Yetu', url: SITE_URL },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json).replace(/</g, '\\u003c') }}
    />
  );
}

const FALLBACK_IMAGE_DIMENSIONS = { width: 1200, height: 800 };

function sanityImageDimensions(ref: unknown): { width: number; height: number } | null {
  const match = typeof ref === 'string' ? /^image-[A-Za-z0-9]+-(\d+)x(\d+)-[a-z0-9]+$/.exec(ref) : null;
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

// next/image, not a raw <img>: the CSP's img-src 'self' blocks direct cdn.sanity.io URLs.
function portableTextComponents(postTitle: string): PortableTextComponents {
  return {
    types: {
      image: ({ value }) => {
        const src = urlForImage(value);
        if (!src) return null;
        const { width, height } = sanityImageDimensions(value?.asset?._ref) ?? FALLBACK_IMAGE_DIMENSIONS;
        return (
          <span className="not-prose my-8 block overflow-hidden rounded-lg">
            <Image
              src={src}
              alt={postTitle}
              width={width}
              height={height}
              sizes="(min-width: 768px) 768px, 100vw"
              className="h-auto w-full"
            />
          </span>
        );
      },
    },
  };
}

export default async function PostPage({ params }: PostPageProps) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const coverImageUrl = urlForImage(post.coverImage);
  const url = `${SITE_URL}/resources/${post.slug}`;

  return (
    <PageShell title={post.title} description={post.excerpt}>
      <StructuredData post={post} url={url} coverImageUrl={coverImageUrl} />
      {coverImageUrl && (
        <div className="not-prose relative mb-8 aspect-[16/9] w-full overflow-hidden rounded-lg bg-paper-deep">
          <Image
            src={coverImageUrl}
            alt={post.title}
            fill
            className="object-cover"
            sizes="(min-width: 768px) 768px, 100vw"
            priority
          />
        </div>
      )}
      {post.authorName && <p className="not-prose text-sm font-medium text-brand-blue-900/50">By {post.authorName}</p>}
      <PortableText value={post.content} components={portableTextComponents(post.title)} />
    </PageShell>
  );
}
