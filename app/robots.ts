import type { MetadataRoute } from 'next';

/**
 * Keeps crawlers on the marketing surface.
 *
 * The disallow list is every authenticated or operational prefix in the app —
 * portals, the API, and the backoffice. None of it is reachable without a
 * session anyway, but a crawler burning its budget on redirect chains to
 * /login is wasted, and /admin should not be advertised at all.
 */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://kitabuyetu.co.ke').replace(/\/$/, '');

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/admin',
        '/admin-login',
        '/dashboard',
        '/me',
        // Exact path + subtree, not a bare '/enterprise' prefix — that would
        // also match /enterprise-solutions, the public marketing page for
        // this same product, which crawlers should see.
        '/enterprise$',
        '/enterprise/',
        '/reminder',
        '/members',
        '/contributions',
        '/loans',
        '/mpesa',
        '/accounting',
        '/reports',
        '/settings',
        '/billing',
        '/treasury',
        '/welfare',
        '/shares',
        '/dividends',
        '/meetings',
        '/sms',
        '/whatsapp',
        '/email',
        '/investments',
        '/credit-scores',
        '/analytics',
        '/data-import',
        '/groups',
        '/unauthorized',
        '/design-system',
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
