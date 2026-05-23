/**
 * Single source of truth for Kitabu Yetu brand constants used outside of
 * Tailwind/CSS — specifically transactional emails and server-rendered PDFs.
 *
 * UI components (navbar, footer, sidebars) use the canonical logo via
 * <BrandLogo /> and Tailwind tokens (`bg-brand-500`, `text-brand-blue-500`).
 * Email + PDF rendering happens server-side and lands in opaque clients
 * (Gmail/Outlook/Adobe Reader), so they need raw hex + absolute URLs.
 */

export const BRAND = {
  name:    'Kitabu Yetu',
  tagline: 'Simple Books. Stronger Groups.',

  // Hex anchors aligned with tailwind.config.ts + app/globals.css.
  // Do not introduce new shades here — extend the Tailwind palette instead.
  colors: {
    green:      '#3CB043', // primary brand green (CTAs, success, accents)
    greenDark:  '#2F9335',
    greenLight: '#EAF7EC', // soft tint for hover/highlight surfaces
    blue:       '#0B3C88', // brand navy (headings, sidebar, OG theme color)
    blueLight:  '#316AB0',
    neutralBg:  '#F8FAFC', // light neutral surface
    surface:    '#FFFFFF',
    border:     '#E5E7EB',
    text:       '#0B3C88', // body copy uses brand navy on light surfaces
    textMuted:  '#6B7280',
    danger:     '#DC2626',
    warning:    '#D97706',
  },

  // Font stack mirrors the Tailwind sans configuration — Inter primary,
  // system fallbacks for environments where the font can't load (email/PDF).
  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
} as const;

/**
 * Absolute URL to the canonical logo, suitable for embedding in emails and
 * PDFs (where relative paths don't resolve).
 *
 * Falls back to the production domain when NEXT_PUBLIC_APP_URL isn't set —
 * which is the case during local development without overrides.
 */
export function getBrandLogoUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://kitabuyetu.vercel.app').replace(/\/$/, '');
  return `${base}/brand/kitabu-yetu-logo.png`;
}

/** Standard email/PDF footer line — brand name + tagline. */
export function brandFooterLine(): string {
  return `${BRAND.name} — ${BRAND.tagline}`;
}
