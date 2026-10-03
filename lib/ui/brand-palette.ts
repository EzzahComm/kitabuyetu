/**
 * Single source of truth for Kitabu Yetu's raw brand color scales.
 *
 * This is the one place the brand green/navy hex values are declared.
 * `tailwind.config.ts`, `lib/ui/tokens.ts`, and `lib/brand.ts` all import
 * from here instead of each hand-copying the scale — previously all three
 * (plus this file, before it existed) carried their own literal copy, which
 * is exactly the kind of silent-drift risk a design system should not have.
 *
 * app/globals.css cannot import TS, so its HSL custom properties stay
 * hand-authored — each one is commented with the hex anchor it corresponds
 * to here, which is the closest a plain CSS file can get to staying in sync.
 *
 * Do not invent new shades — extend this file and let the derived tokens
 * (Tailwind classes, `lib/ui/tokens.ts`, `lib/brand.ts`) flow from it.
 */

/**
 * Primary green — the brand kit's #12A06B (logo v3, 2026-10-01; replaced
 * the retired raster logo's brighter leaf green). Kit anchors: 600 is the "Kitabu" wordmark on
 * light grounds, 300/400 the wordmark and dots on navy, 200 the mark on blue.
 */
export const brandGreen = {
  50: '#EAF8F1', // light accent
  100: '#CDF5E3',
  200: '#8CF2C6', // kit: people dots on blue
  300: '#3FD59A', // kit: "Kitabu" on navy
  400: '#2CC98B', // kit: people dots on navy
  500: '#12A06B', // ← canonical brand green (kit)
  600: '#0E9462', // kit: "Kitabu" on light
  700: '#0B7A51',
  800: '#085F3F',
  900: '#05412B',
} as const;

/**
 * App navy — headings and body copy in the authenticated app. Built around the
 * retired raster logo's book colour; logo v3 itself uses the Finanza blue and
 * navy (lib/ui/finanza-palette.ts), so this scale is a UI token, not a logo colour.
 */
export const brandNavy = {
  50: '#E7EEF8',
  100: '#C6D5ED',
  200: '#94B0DC',
  300: '#5F88C7',
  400: '#316AB0',
  500: '#0B3C88', // ← canonical brand navy
  600: '#0A3477',
  700: '#082B62',
  800: '#06214C',
  900: '#04162F',
} as const;

/**
 * Orange accent reserved for alerts/actions per the brand direction.
 *
 * This is an ACCENT, not a brand colour: money-out/disbursement states, and
 * on the marketing surface the "Coming soon" / not-yet-live markers. Green
 * stays the brand. The ramp is deliberately partial — only the steps actually
 * in use are declared, per this file's "do not invent new shades" rule.
 *
 * (Briefly promoted to the marketing primary on 2026-08-26 and reverted the
 * next day; the 200/400/800/900 steps that promotion needed went with it,
 * since nothing references them.)
 */
export const brandOrange = {
  50: '#FEF1E9',
  100: '#FCDCC8',
  300: '#F5975C',
  500: '#E8590C', // ← kit orange: the centre dot and "Yetu"
  600: '#C74A08',
  700: '#A13C06',
} as const;

/**
 * Ground for the public marketing surface.
 *
 * Was a warm cream (`#FBFAF5` / `#F4F1E7`) until 2026-08-26, when the brand
 * direction moved to a clean white page with orange carrying the warmth
 * instead of the paper. `deep` is the one step down, used to separate stacked
 * light sections without reaching for a border — it is a cool neutral now, so
 * it sits under white without the cream cast the old pairing had.
 *
 * The name is kept: it is referenced as `bg-paper` in ~30 places, and the
 * token's JOB (the marketing ground) has not changed, only its value.
 */
export const brandPaper = {
  DEFAULT: '#FFFFFF',
  deep: '#F8FAFC',
} as const;

/** Convenience aliases for the spec's named neutral/accent tokens. */
export const brandAccent = brandGreen[50];
export const brandNeutral = '#F8FAFC';
