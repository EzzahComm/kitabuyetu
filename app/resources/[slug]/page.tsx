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

export async function generateMetadata({ params }: PostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return { title: 'Resources' };
  return {
    title: post.title,
    description: post.seoDescription ?? post.excerpt,
  };
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

  return (
    <PageShell title={post.title} description={post.excerpt}>
      {coverImageUrl && (
        <div className="not-prose relative mb-8 aspect-[16/9] w-full overflow-hidden rounded-lg bg-paper-deep">
          <Image src={coverImageUrl} alt="" fill className="object-cover" sizes="100vw" priority />
        </div>
      )}
      {post.authorName && (
        <p className="not-prose text-sm font-medium text-brand-blue-900/50">By {post.authorName}</p>
      )}
      <PortableText value={post.content} components={portableTextComponents} />
    </PageShell>
  );
}
