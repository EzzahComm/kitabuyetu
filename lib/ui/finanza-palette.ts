/**
 * The public marketing surface's palette, adopted from the Finanza template
 * (HTML Codex) on 2026-09-28. The authenticated app keeps brand-palette.ts.
 *
 * Steps are taken from the template's own Bootstrap build wherever it declares
 * one (hover, focus, alert and table shades), so the site matches the template
 * rather than an approximation of it. Only 400 and 800 on the blue ramp and
 * 300/400/800/900 on the orange ramp are interpolated.
 *
 * How it reaches the page: tailwind.config.ts compiles `brand-*` utilities to
 * CSS variables that default to brandGreen, and re-points those variables to
 * finanzaBlue on any page that renders the marketing header
 * (`[data-marketing-theme]`). Same class names, two surfaces, one switch.
 */

/** Primary - Finanza's `--primary` / `--bs-primary`. Replaces green on the public site. */
export const finanzaBlue = {
  50: '#F0F3FF',
  100: '#DFE4FD', // template --light: borders, soft panels
  200: '#C2CFFE',
  300: '#9AAFFE', // template form-control:focus border
  400: '#6886FD',
  500: '#355EFC', // ← canonical Finanza primary
  600: '#2D50D6', // template btn-primary:hover
  700: '#2A4BCA', // template a:hover
  800: '#203897', // template alert-primary text
  900: '#1A2D79',
} as const;

/** Secondary - Finanza's `--secondary`. Used sparingly, as the template does. */
export const finanzaOrange = {
  50: '#FDF0EB',
  100: '#FBD8CD', // template table-secondary
  200: '#F8C5B4', // template alert-secondary border
  300: '#F29A7C',
  400: '#ED6337', // template btn-secondary:active
  500: '#E93C05', // ← canonical Finanza secondary
  600: '#C63304', // template btn-secondary focus ring
  700: '#8C2403', // template alert-secondary text
  800: '#701D02',
  900: '#4F1401',
} as const;

/** Headings and the footer ground (`--dark`), and the copyright strip below it. */
export const finanzaDark = {
  DEFAULT: '#011A41',
  deep: '#000B1C',
} as const;

/** Body copy (`--tertiary`). */
export const finanzaText = '#555555';
