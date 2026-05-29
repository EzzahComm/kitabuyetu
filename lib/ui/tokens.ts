/**
 * Kitabu Yetu — design tokens for JavaScript consumers.
 *
 * CSS-driven components should keep using Tailwind tokens (`bg-primary`,
 * `text-muted-foreground`, …) and the HSL variables in app/globals.css.
 * This file exists for the cases CSS can't reach:
 *
 *   • Recharts (needs raw hex for `fill`/`stroke`)
 *   • canvas / SVG generation
 *   • logic that maps a domain status → a visual tone
 *
 * Hex anchors here MUST stay aligned with tailwind.config.ts, lib/brand.ts,
 * and app/globals.css. Do not invent new shades — extend the Tailwind palette
 * and mirror it here.
 */

// ── Brand palette (mirrors tailwind.config.ts `brand` / `brand-blue`) ────────
export const brandGreen = {
  50: '#EAF7EC', 100: '#D2EFD7', 200: '#A8DFB1', 300: '#7CCC89', 400: '#56BC65',
  500: '#3CB043', 600: '#2F9335', 700: '#287629', 800: '#1F5C22', 900: '#143F18',
} as const;

export const brandNavy = {
  50: '#E7EEF8', 100: '#C6D5ED', 200: '#94B0DC', 300: '#5F88C7', 400: '#316AB0',
  500: '#0B3C88', 600: '#0A3477', 700: '#082B62', 800: '#06214C', 900: '#04162F',
} as const;

/** Orange accent reserved for alerts/actions per the brand direction. */
export const brandOrange = {
  50: '#FFF4ED', 100: '#FFE6D5', 300: '#FDA572', 500: '#F97316', 600: '#EA580C', 700: '#C2410C',
} as const;

// ── Semantic financial tones ─────────────────────────────────────────────────
// Used by StatusPill, alerts, and charts. `fg`/`bg` are tuned for AA contrast
// on light surfaces; `solid` is the chart/marker color.
export type Tone = 'positive' | 'negative' | 'neutral' | 'warning' | 'info' | 'pending';

export const tone: Record<Tone, { solid: string; fg: string; bg: string; border: string }> = {
  positive: { solid: '#16A34A', fg: '#166534', bg: '#DCFCE7', border: '#BBF7D0' },
  negative: { solid: '#DC2626', fg: '#991B1B', bg: '#FEE2E2', border: '#FECACA' },
  warning:  { solid: '#D97706', fg: '#92400E', bg: '#FEF3C7', border: '#FDE68A' },
  info:     { solid: '#0B3C88', fg: '#0A3477', bg: '#E7EEF8', border: '#C6D5ED' },
  // Yellow — "awaiting / in progress". Warmer & distinct from amber `warning`;
  // matches the product's status language (pending contributions, KYC, etc.).
  pending:  { solid: '#CA8A04', fg: '#854D0E', bg: '#FEF9C3', border: '#FEF08A' },
  neutral:  { solid: '#64748B', fg: '#334155', bg: '#F1F5F9', border: '#E2E8F0' },
};

/**
 * Maps domain statuses used across the platform (loans, contributions, M-Pesa,
 * KYC, billing, dividends…) to a semantic tone. Unknown statuses fall back to
 * `neutral`. Keys are matched case-insensitively by `statusTone()`.
 */
export const STATUS_TONE: Record<string, Tone> = {
  // money / payments
  paid: 'positive', completed: 'positive', success: 'positive', settled: 'positive',
  reconciled: 'positive', disbursed: 'positive', cleared: 'positive', received: 'positive',
  confirmed: 'positive',
  pending: 'pending', processing: 'pending', submitted: 'pending', queued: 'pending',
  unrouted: 'warning', partial: 'warning', overdue: 'negative', defaulted: 'negative',
  failed: 'negative', reversed: 'negative', cancelled: 'neutral', refunded: 'info',
  // lifecycle / approvals
  active: 'positive', approved: 'positive', verified: 'positive', published: 'positive',
  draft: 'neutral', inactive: 'info', archived: 'neutral', closed: 'neutral',
  review: 'pending', under_review: 'pending', awaiting_approval: 'pending',
  rejected: 'negative', suspended: 'warning', blocked: 'negative', flagged: 'warning',
  // KYC / risk
  unverified: 'warning', expired: 'negative', high_risk: 'negative', low_risk: 'positive',
  // messaging / comms (SMS, email, WhatsApp)
  sent: 'positive', delivered: 'positive', sending: 'pending', scheduled: 'info',
  bounced: 'warning', undelivered: 'negative', dry_run: 'neutral',
  opened: 'info', clicked: 'positive',
  // membership lifecycle
  pending_verification: 'warning', blacklisted: 'negative', exited: 'neutral',
};

export function statusTone(status: string | null | undefined): Tone {
  if (!status) return 'neutral';
  const key = status.toLowerCase().replace(/[\s-]+/g, '_');
  return STATUS_TONE[key] ?? 'neutral';
}

// ── Chart palette ────────────────────────────────────────────────────────────
// Ordered, colour-blind-aware sequence anchored on brand green + navy. Use
// `chartPalette[i % chartPalette.length]` for categorical series.
export const chartPalette = [
  brandGreen[500], // green
  brandNavy[500],  // navy
  '#0EA5E9',       // sky
  brandOrange[500],// orange
  '#7C3AED',       // violet
  '#14B8A6',       // teal
  '#EAB308',       // amber
  '#EC4899',       // pink
] as const;

/** Shared Recharts axis/grid styling so every chart reads consistently. */
export const chartTheme = {
  grid: '#E2E8F0',
  axis: '#94A3B8',
  axisLabel: '#64748B',
  fontSize: 12,
} as const;

// ── Layout scales ────────────────────────────────────────────────────────────
/** Spacing scale in px (Tailwind 4px base) — for JS-computed layouts. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32, '3xl': 48 } as const;

/** Responsive breakpoints (mirror Tailwind defaults; mobile-first). */
export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 } as const;

export const radius = { sm: 6, md: 8, lg: 10, full: 9999 } as const;

/** z-index ladder — keep overlays predictable across portals. */
export const zIndex = {
  base: 0, dropdown: 40, sticky: 30, overlay: 50, modal: 50, toast: 60, tooltip: 70, commandPalette: 80,
} as const;

// ── Motion ───────────────────────────────────────────────────────────────────
/** Framer Motion / CSS durations (seconds). Keep interactions snappy & calm. */
export const motion = {
  duration: { fast: 0.12, base: 0.2, slow: 0.32 },
  ease: [0.16, 1, 0.3, 1] as [number, number, number, number], // easeOutExpo-ish
} as const;
