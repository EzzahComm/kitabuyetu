/**
 * The Kitabu Yetu logo (v3, brand kit of 2026-10-01): a three-dot group mark
 * above an open book, a green-and-orange wordmark, and a one-colour uppercase
 * tagline.
 *
 * This is the ONE place the logo is defined. Everything else derives from it:
 *   - components/branding/* render it as inline SVG + live text (no image request)
 *   - scripts/brand/generate-brand-assets.ts writes the public/brand/*.svg files
 *     and every raster (favicons, PWA icons, apple-touch icon, email logo)
 *   - scripts/brand/check-brand.mjs fails CI when those files drift from here
 *   - app/opengraph-image.tsx draws the social card from it
 *
 * Change the logo here, run `npm run brand:assets`, commit the output.
 *
 * Geometry and every colour below are copied exactly from the kit's SVGs, so
 * don't round or nudge them. Colours that also exist as palette steps are taken
 * from the palette, so there is still only one copy of each hex value.
 */
import { brandGreen, brandOrange } from './brand-palette';
import { finanzaBlue, finanzaDark } from './finanza-palette';

/** Which ground the logo sits on. Each has its own kit colourway. */
export type BrandTone = 'light' | 'dark' | 'onBlue';

export interface BrandToneColors {
  /** Centre dot: the single orange highlight. */
  accent: string;
  /** The two side dots. */
  people: string;
  pageLeft: string;
  pageRight: string;
  wordKitabu: string;
  wordYetu: string;
  tagline: string;
  /** Tile behind the mark for app icons / favicons. */
  tile: string;
}

export const BRAND_TONES: Record<BrandTone, BrandToneColors> = {
  // On white / light surfaces.
  light: {
    accent: brandOrange[500], // #E8590C
    people: brandGreen[500], // #12A06B
    pageLeft: finanzaBlue[500], // #355EFC
    pageRight: '#2448D6',
    wordKitabu: brandGreen[600], // #0E9462
    wordYetu: brandOrange[500],
    tagline: finanzaBlue[500],
    tile: '#FFFFFF',
  },
  // On navy (#011A41) and other dark surfaces.
  dark: {
    accent: '#FF8A3D',
    people: brandGreen[400], // #2CC98B
    pageLeft: '#5C80FF',
    pageRight: '#3D63F5',
    wordKitabu: brandGreen[300], // #3FD59A
    wordYetu: '#FF8A3D',
    tagline: '#8DA6FF',
    tile: finanzaDark.DEFAULT, // #011A41
  },
  // On the brand blue (#355EFC).
  onBlue: {
    accent: '#FFA05C',
    people: brandGreen[200], // #8CF2C6
    pageLeft: '#FFFFFF',
    pageRight: finanzaBlue[100], // #DFE4FD
    wordKitabu: brandGreen[200],
    wordYetu: '#FFC49A',
    tagline: '#FFFFFF',
    tile: finanzaBlue[500],
  },
};

/** The mark, drawn on a 64×64 canvas. */
export const MARK_VIEWBOX = '0 0 64 64';

export const MARK_DOTS = [
  { cx: 32, cy: 11, r: 6.5, fill: 'accent' },
  { cx: 15, cy: 18, r: 4.8, fill: 'people' },
  { cx: 49, cy: 18, r: 4.8, fill: 'people' },
] as const satisfies readonly { cx: number; cy: number; r: number; fill: keyof BrandToneColors }[];

export const MARK_PAGES = [
  { d: 'M30 57C24 51 14 49 5 51V30C14 28 24 30 30 37Z', fill: 'pageLeft' },
  { d: 'M34 57C40 51 50 49 59 51V30C50 28 40 30 34 37Z', fill: 'pageRight' },
] as const satisfies readonly { d: string; fill: keyof BrandToneColors }[];

/** Icons place the mark at 80% inside its tile, centred, as the kit's app icon does. */
export const TILE_MARK_SCALE = 0.8;
export const TILE_MARK_OFFSET = 6.4; // (64 - 64 × 0.8) / 2, written out to avoid float noise in the SVG
/** Corner radius of the kit's app-icon tile, on the 64 canvas. */
export const TILE_RADIUS = 14;

export const BRAND_WORDMARK = { first: 'Kitabu', second: 'Yetu' } as const;
export const BRAND_TAGLINE = 'Smart Group-Management Tools';

/** Type in the kit: Jost 800 wordmark, Open Sans 600 tagline (uppercase, 1.5px tracking). */
export const BRAND_FONTS = {
  wordmark: { family: 'Jost', weight: 800, letterSpacingPx: 1 },
  tagline: { family: 'Open Sans', weight: 600, letterSpacingPx: 1.5 },
} as const;

/** The mark's shapes as SVG markup, for a given tone. No wrapper element. */
export function markShapes(tone: BrandTone): string {
  const c = BRAND_TONES[tone];
  const dots = MARK_DOTS.map((d) => `<circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="${c[d.fill]}"/>`).join('');
  const pages = MARK_PAGES.map((p) => `<path d="${p.d}" fill="${c[p.fill]}"/>`).join('');
  return `${dots}\n${pages}`;
}

export interface MarkSvgOptions {
  tone?: BrandTone;
  /**
   * Draw the mark on a tile: 'rounded' is the kit's app icon; 'square' is a
   * full-bleed opaque square for platforms that round the corners themselves
   * (iOS home screen) or that reject transparency.
   */
  tile?: 'rounded' | 'square';
}

/** A standalone SVG document of the mark (64×64 viewBox). */
export function markSvg({ tone = 'light', tile }: MarkSvgOptions = {}): string {
  const shapes = markShapes(tone);
  if (!tile) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}"><g>${shapes}</g></svg>\n`;
  }
  const rx = tile === 'rounded' ? ` rx="${TILE_RADIUS}"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}">` +
    `<rect width="64" height="64"${rx} fill="${BRAND_TONES[tone].tile}"/>` +
    `<g transform="translate(${TILE_MARK_OFFSET} ${TILE_MARK_OFFSET}) scale(${TILE_MARK_SCALE})">${shapes}</g></svg>\n`
  );
}

/**
 * The kit's horizontal lockup (430×110): mark, wordmark, tagline. Its text is
 * live <text> that pulls Jost / Open Sans from Google Fonts, so it renders
 * exactly only inline or via <object>; in an <img> it falls back to the
 * system sans. The app never uses these files. They're for press kits,
 * partner decks and documents. In-app lockups are components/branding/BrandLockup.
 */
export function lockupSvg(tone: BrandTone): string {
  const c = BRAND_TONES[tone];
  const { wordmark, tagline } = BRAND_FONTS;
  const ground = tone === 'onBlue' ? `<rect width="430" height="110" fill="${c.tile}"/>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 430 110" role="img" aria-label="Kitabu Yetu – ${BRAND_TAGLINE}">` +
    `<style>@import url("https://fonts.googleapis.com/css2?family=Jost:wght@800&amp;family=Open+Sans:wght@600&amp;display=swap");` +
    `.t{font-family:${wordmark.family},sans-serif;font-weight:${wordmark.weight};letter-spacing:${wordmark.letterSpacingPx}px}` +
    `.g{font-family:"${tagline.family}",sans-serif;font-weight:${tagline.weight};letter-spacing:${tagline.letterSpacingPx}px}</style>${ground}\n` +
    `<g transform="translate(6 7) scale(1.5)">${markShapes(tone)}</g>\n` +
    `<text class="t" x="270" y="58" font-size="44" text-anchor="middle">` +
    `<tspan fill="${c.wordKitabu}">${BRAND_WORDMARK.first}</tspan><tspan fill="${c.wordYetu}"> ${BRAND_WORDMARK.second}</tspan></text>\n` +
    `<text class="g" x="270" y="86" font-size="12.5" text-anchor="middle" fill="${c.tagline}">${BRAND_TAGLINE.toUpperCase()}</text></svg>\n`
  );
}
