const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    // These packages use Node.js native modules / dynamic requires — exclude from bundling.
    'pg',
    'pg-native',
    'ioredis',
    'jsonwebtoken',
    'bcryptjs',
    'nodemailer',
  ],
  turbopack: {
    root: path.join(__dirname),
  },
  // Vercel's CDN handles image optimization natively
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: '**.supabase.in' },
      { protocol: 'https', hostname: 'cdn.sanity.io' },
    ],
  },
  reactStrictMode: true,
  // Remove X-Powered-By: Next.js header from all responses
  poweredByHeader: false,
  // Vercel handles compression at the CDN layer
  compress: true,
  // Security headers
  async headers() {
    const isProd = process.env.NODE_ENV === 'production';
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // HSTS — only on production (breaks localhost HTTP dev)
          ...(isProd
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains; preload',
                },
              ]
            : []),
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(self), usb=()',
          },
          // CSP: unsafe-eval is required by Next.js dev tooling (HMR/eval-source-maps)
          // but must NOT appear in production — it opens XSS vectors.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              isProd
                ? "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com"
                : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https://www.google-analytics.com https://www.googletagmanager.com",
              // Google tag (G-7BM93MVBVY) measurement endpoints
              "connect-src 'self' https://*.supabase.co https://*.upstash.io https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
              "frame-ancestors 'self'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
