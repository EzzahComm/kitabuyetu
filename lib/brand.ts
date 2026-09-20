/**
 * Single source of truth for Kitabu Yetu brand constants used outside of
 * Tailwind/CSS — specifically transactional emails and server-rendered PDFs.
 *
 * UI components (navbar, footer, sidebars) use the canonical logo via
 * <BrandLogo /> and Tailwind tokens (`bg-brand-500`, `text-brand-blue-500`).
 * Email + PDF rendering happens server-side and lands in opaque clients
 * (Gmail/Outlook/Adobe Reader), so they need raw hex + absolute URLs.
 */

import { brandGreen, brandNavy, brandNeutral } from '@/lib/ui/brand-palette';

export const BRAND = {
  name: 'Kitabu Yetu',
  tagline: 'Build Vibrant Communities',

  // Hex values sourced from lib/ui/brand-palette.ts (also consumed by
  // tailwind.config.ts and lib/ui/tokens.ts) — do not hand-copy shades here.
  colors: {
    green: brandGreen[500], // primary brand green (CTAs, success, accents)
    greenDark: brandGreen[600],
    greenLight: brandGreen[50], // soft tint for hover/highlight surfaces
    blue: brandNavy[500], // brand navy (headings, sidebar, OG theme color)
    blueLight: brandNavy[400],
    neutralBg: brandNeutral, // light neutral surface
    surface: '#FFFFFF',
    border: '#E5E7EB',
    text: brandNavy[500], // body copy uses brand navy on light surfaces
    textMuted: '#6B7280',
    danger: '#DC2626',
    warning: '#D97706',
  },

  // Font stack mirrors the Tailwind sans configuration — Inter primary,
  // system fallbacks for environments where the font can't load (email/PDF).
  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
} as const;

/**
 * Absolute URL to the logo, sized for embedding in emails (where relative
 * paths don't resolve). Points at a 144x144 raster (12.7KB) generated from
 * the 1024x1024 canonical master (1.43MB) by scripts/generate-icons.ts —
 * emails only ever render this at 36x36 or 72x72
 * (emails/components/layout.tsx, lib/email/templates/engine.ts), so every
 * recipient whose client loads images was downloading ~115x more image
 * data than the logo is ever displayed at (docs/audits/optimization-2026-09).
 */
export function getBrandLogoUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://kitabuyetu.vercel.app').replace(/\/$/, '');
  return `${base}/brand/kitabu-yetu-logo-email.png`;
}

/** Standard email/PDF footer line — brand name + tagline. */
export function brandFooterLine(): string {
  return `${BRAND.name} — ${BRAND.tagline}`;
}
