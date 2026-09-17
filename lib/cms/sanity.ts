/**
 * Read-only client for Sanity (kitabuyetu-studio — see project memory) that
 * backs the public Resources hub. Provisioned through Vercel's Marketplace
 * Sanity integration on the kitabuyetu Vercel project, so projectId/dataset
 * arrive as ordinary Vercel env vars rather than anything hand-configured.
 */
import { createClient, type SanityClient } from '@sanity/client';
import { createImageUrlBuilder } from '@sanity/image-url';
import type { PortableTextBlock } from '@portabletext/react';

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production';

/** Revalidate published posts every 5 minutes — content is edited by hand
 *  in Sanity Studio, not on every request. */
const REVALIDATE_SECONDS = 300;

export type PostCategory = 'blog' | 'guide' | 'case-study' | 'education' | 'announcement';

export interface Post {
  slug: string;
  title: string;
  excerpt: string;
  content: PortableTextBlock[];
  category: PostCategory;
  authorName: string | null;
  seoDescription: string | null;
  coverImage: { asset: { _ref: string } } | null;
  publishedAt: string | null;
}

const client: SanityClient | null = projectId
  ? createClient({
      projectId,
      dataset,
      apiVersion: '2026-01-01',
      useCdn: true,
    })
  : null;

const builder = client ? createImageUrlBuilder(client) : null;

/** Resolves a Sanity image reference to a usable URL. Returns null if the
 *  client isn't configured yet (NEXT_PUBLIC_SANITY_PROJECT_ID unset) or the
 *  post has no cover image. */
export function urlForImage(image: Post['coverImage']): string | null {
  if (!builder || !image) return null;
  return builder.image(image).width(1200).fit('max').auto('format').url();
}

const POST_FIELDS = `
  "slug": slug.current,
  title,
  excerpt,
  content,
  category,
  authorName,
  seoDescription,
  coverImage,
  publishedAt
`;

async function sanityFetch<T>(query: string, params: Record<string, unknown> = {}): Promise<T | null> {
  if (!client) return null;
  try {
    return await client.fetch<T>(query, params, { next: { revalidate: REVALIDATE_SECONDS } });
  } catch {
    // Studio/API unreachable or misconfigured — pages fall back to an empty
    // list rather than crashing the public site over a content-hub outage.
    return null;
  }
}

export async function getPosts(): Promise<Post[]> {
  const posts = await sanityFetch<Post[]>(
    `*[_type == "post" && defined(publishedAt)] | order(publishedAt desc) { ${POST_FIELDS} }`,
  );
  return posts ?? [];
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  return sanityFetch<Post | null>(
    `*[_type == "post" && slug.current == $slug][0] { ${POST_FIELDS} }`,
    { slug },
  );
}
