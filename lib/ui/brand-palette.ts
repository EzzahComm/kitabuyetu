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

/** Primary green — built around the logo's vibrant #3CB043 leaf/people mark. */
export const brandGreen = {
  50:  '#EAF7EC', // light accent
  100: '#D2EFD7',
  200: '#A8DFB1',
  300: '#7CCC89',
  400: '#56BC65',
  500: '#3CB043', // ← canonical brand green
  600: '#2F9335',
  700: '#287629',
  800: '#1F5C22',
  900: '#143F18',
} as const;

/** Primary navy — built around the logo's deep #0B3C88 book/wordmark. */
export const brandNavy = {
  50:  '#E7EEF8',
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
  50:  '#FFF4ED',
  100: '#FFE6D5',
  300: '#FDA572',
  500: '#F97316',
  600: '#EA580C',
  700: '#C2410C',
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
  deep:    '#F8FAFC',
} as const;

/** Convenience aliases for the spec's named neutral/accent tokens. */
export const brandAccent = brandGreen[50];
export const brandNeutral = '#F8FAFC';
