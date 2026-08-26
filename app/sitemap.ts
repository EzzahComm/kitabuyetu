import type { MetadataRoute } from 'next';

/**
 * The public surface, and only the public surface.
 *
 * Everything under (auth), (dashboard), (member), (admin), (enterprise) and
 * (reminder) is either behind a login or an application route with nothing for
 * a crawler, so none of it appears here — and app/robots.ts disallows those
 * prefixes outright.
 */
const ROUTES: { path: string; priority: number; changeFrequency: 'monthly' | 'weekly' }[] = [
  { path: '/',                priority: 1.0, changeFrequency: 'weekly'  },
  { path: '/pricing',         priority: 0.9, changeFrequency: 'monthly' },
  { path: '/bookkeeper',      priority: 0.8, changeFrequency: 'monthly' },
  { path: '/chama-reminder',  priority: 0.8, changeFrequency: 'monthly' },
  { path: '/ecosystem',       priority: 0.6, changeFrequency: 'monthly' },
  { path: '/fundraise',       priority: 0.4, changeFrequency: 'monthly' },
  { path: '/about',           priority: 0.5, changeFrequency: 'monthly' },
  { path: '/contact',         priority: 0.5, changeFrequency: 'monthly' },
  { path: '/support',         priority: 0.4, changeFrequency: 'monthly' },
  { path: '/docs',            priority: 0.3, changeFrequency: 'monthly' },
  { path: '/status',          priority: 0.3, changeFrequency: 'weekly'  },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://kitabuyetu.co.ke').replace(/\/$/, '');
  const lastModified = new Date();

  return ROUTES.map((route) => ({
    url: `${base}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
