import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { PortableText, type PortableTextComponents } from '@portabletext/react';
import { PageShell } from '@/components/marketing/page-shell';
import { OG_FALLBACK } from '@/components/marketing/page-metadata';
import { getPostBySlug, getPosts, getRelatedPosts, urlForImage } from '@/lib/cms/sanity';

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
/** One `<script type="application/ld+json">` per structured-data object,
 *  rather than a single `@graph`: Google's Rich Results Test validates each
 *  type independently either way, and separate tags are easier to diff when
 *  only one of them (say, the FAQ) changes. */
function StructuredData({
  post,
  url,
  coverImageUrl,
}: {
  post: NonNullable<Awaited<ReturnType<typeof getPostBySlug>>>;
  url: string;
  coverImageUrl: string | null;
}) {
  const article = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.seoDescription ?? post.excerpt,
    url,
    ...(post.publishedAt ? { datePublished: post.publishedAt } : {}),
    ...(post.updatedAt ? { dateModified: post.updatedAt } : {}),
    ...(post.authorName ? { author: { '@type': 'Person', name: post.authorName } } : {}),
    ...(coverImageUrl ? { image: coverImageUrl } : {}),
    publisher: { '@type': 'Organization', name: 'Kitabu Yetu', url: SITE_URL },
  };

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Resources', item: `${SITE_URL}/resources` },
      { '@type': 'ListItem', position: 2, name: post.title, item: url },
    ],
  };

  const faqPage =
    post.faq && post.faq.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: post.faq.map((item) => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: { '@type': 'Answer', text: item.answer },
          })),
        }
      : null;

  const howTo =
    post.howToSteps && post.howToSteps.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'HowTo',
          name: post.title,
          step: post.howToSteps.map((step) => ({ '@type': 'HowToStep', name: step.name, text: step.text })),
        }
      : null;

  const graphs = [article, breadcrumb, faqPage, howTo].filter(Boolean);

  return (
    <>
      {graphs.map((json, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(json).replace(/</g, '\\u003c') }}
        />
      ))}
    </>
  );
}

const FALLBACK_IMAGE_DIMENSIONS = { width: 1200, height: 800 };

function sanityImageDimensions(ref: unknown): { width: number; height: number } | null {
  const match = typeof ref === 'string' ? /^image-[A-Za-z0-9]+-(\d+)x(\d+)-[a-z0-9]+$/.exec(ref) : null;
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

interface TableValue {
  hasHeaderRow?: boolean;
  rows?: { cells?: string[] }[];
}

function ContentTable({ value }: { value: TableValue }) {
  const rows = value.rows ?? [];
  if (rows.length === 0) return null;
  const headerRow = value.hasHeaderRow ? rows[0] : null;
  const restRows = value.hasHeaderRow ? rows.slice(1) : rows;

  return (
    <span className="not-prose my-8 block overflow-x-auto rounded-lg border border-brand-blue-900/10">
      <table className="w-full text-left text-sm">
        {headerRow && (
          <thead>
            <tr className="bg-paper-deep">
              {(headerRow.cells ?? []).map((cell, i) => (
                <th key={i} className="border-b border-brand-blue-900/10 px-4 py-2.5 font-semibold text-brand-blue-900">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {restRows.map((row, i) => (
            <tr key={i} className="border-b border-brand-blue-900/10 last:border-0">
              {(row.cells ?? []).map((cell, j) => (
                <td key={j} className="px-4 py-2.5 text-brand-blue-900/75">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </span>
  );
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
      table: ({ value }) => <ContentTable value={value} />,
    },
  };
}

const PRODUCT_LINK_LABEL: Record<string, string> = {
  '/bookkeeper': 'See how the Bookkeeper works',
  '/chama-reminder': 'See how Chama Reminder works',
  '/fundraise': 'See how Changi$ha works',
  '/enterprise-solutions': 'See Kitabu Yetu for organizations',
  '/pricing': 'See pricing',
};

function ProductCta({ href }: { href: string }) {
  return (
    <div className="not-prose my-8 flex flex-col items-start gap-3 rounded-lg border border-brand-500/20 bg-brand-50 p-5 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-medium text-brand-blue-900">
        Kitabu Yetu keeps these records for you automatically.
      </p>
      <Link
        href={href}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
      >
        {PRODUCT_LINK_LABEL[href] ?? 'See how Kitabu Yetu helps'}
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function ReviewedOn({ date }: { date: string }) {
  const formatted = new Date(date).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' });
  return <p className="not-prose text-sm italic text-brand-blue-900/50">Last reviewed: {formatted}</p>;
}

function Faq({ items }: { items: { question: string; answer: string }[] }) {
  return (
    <section className="not-prose mt-10 border-t border-brand-blue-900/10 pt-8">
      <h2 className="font-display text-2xl font-normal text-brand-blue-900">Frequently asked questions</h2>
      <dl className="mt-5 space-y-5">
        {items.map((item) => (
          <div key={item.question}>
            <dt className="font-semibold text-brand-blue-900">{item.question}</dt>
            <dd className="mt-1.5 leading-relaxed text-brand-blue-900/70">{item.answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function RelatedGuides({ posts }: { posts: { slug: string; title: string; excerpt: string }[] }) {
  return (
    <section className="not-prose mt-10 border-t border-brand-blue-900/10 pt-8">
      <h2 className="font-display text-2xl font-normal text-brand-blue-900">Read next</h2>
      <ul className="mt-5 space-y-4">
        {posts.map((post) => (
          <li key={post.slug}>
            <Link href={`/resources/${post.slug}`} className="group block">
              <span className="font-semibold text-brand-700 group-hover:underline">{post.title}</span>
              <p className="mt-1 text-sm text-brand-blue-900/60">{post.excerpt}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function PostPage({ params }: PostPageProps) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const coverImageUrl = urlForImage(post.coverImage);
  const url = `${SITE_URL}/resources/${post.slug}`;
  const relatedPosts = post.relatedSlugs ? await getRelatedPosts(post.relatedSlugs) : [];

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
      {post.reviewedOn && <ReviewedOn date={post.reviewedOn} />}
      <PortableText value={post.content} components={portableTextComponents(post.title)} />
      {post.productLink && <ProductCta href={post.productLink} />}
      {post.faq && post.faq.length > 0 && <Faq items={post.faq} />}
      {relatedPosts.length > 0 && <RelatedGuides posts={relatedPosts} />}
    </PageShell>
  );
}
