/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // These packages use Node.js native modules / dynamic requires — exclude from bundling.
    serverComponentsExternalPackages: [
      'pg', 'pg-native',
      'ioredis',
      'jsonwebtoken',
      'bcryptjs',
      'nodemailer',
      'africastalking',
    ],
  },
  // shared hosting: sharp native binary is unreliable on CloudLinux — skip optimization
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
  // standalone bundles only the files needed at runtime — smaller upload
  output: 'standalone',
  // Remove X-Powered-By: Next.js header from all responses
  poweredByHeader: false,
  // Gzip responses — no Nginx/CDN middleware on cPanel shared hosting
  compress: true,
  // Security headers
  async headers() {
    const isProd = process.env.NODE_ENV === 'production';
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-DNS-Prefetch-Control',    value: 'on' },
          { key: 'X-Frame-Options',            value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options',     value: 'nosniff' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
          { key: 'Referrer-Policy',            value: 'strict-origin-when-cross-origin' },
          // HSTS — only on production (breaks localhost HTTP dev)
          ...(isProd ? [{
            key:   'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          }] : []),
          {
            key:   'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(self), usb=()',
          },
          // Tight CSP: same-origin scripts + Google Fonts + Supabase/Upstash API origins
          {
            key:   'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",   // Next.js requires unsafe-eval in dev; tighten in prod if no dynamic eval
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob:",
              "connect-src 'self' https://*.supabase.co https://*.upstash.io",
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
