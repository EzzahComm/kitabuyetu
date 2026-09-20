import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import { PortableText, type PortableTextComponents } from '@portabletext/react';
import { PageShell } from '@/components/marketing/page-shell';
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

  return {
    title: post.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: post.title,
      description,
      url,
      type: 'article',
      publishedTime: post.publishedAt ?? undefined,
      authors: post.authorName ? [post.authorName] : undefined,
      images: coverImageUrl ? [{ url: coverImageUrl }] : undefined,
    },
    twitter: {
      card: coverImageUrl ? 'summary_large_image' : 'summary',
      title: post.title,
      description,
      images: coverImageUrl ? [coverImageUrl] : undefined,
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

const portableTextComponents: PortableTextComponents = {
  types: {
    image: ({ value }) => {
      const src = urlForImage(value);
      if (!src) return null;
      return (
        <span className="not-prose my-8 block overflow-hidden rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element -- variable aspect ratio, unknown dimensions from Studio */}
          <img src={src} alt="" className="w-full" />
        </span>
      );
    },
  },
};

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
          <Image src={coverImageUrl} alt="" fill className="object-cover" sizes="100vw" priority />
        </div>
      )}
      {post.authorName && <p className="not-prose text-sm font-medium text-brand-blue-900/50">By {post.authorName}</p>}
      <PortableText value={post.content} components={portableTextComponents} />
    </PageShell>
  );
}
