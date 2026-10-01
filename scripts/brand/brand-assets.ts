/**
 * The list of every logo file the site ships, and how each one is made from
 * lib/ui/brand-mark.ts. Shared by generate-brand-assets.ts (writes them) and
 * check-brand.ts (fails CI if the committed files no longer match).
 */
import sharp from 'sharp';
import { lockupSvg, markSvg } from '../../lib/ui/brand-mark';

export interface SvgAsset {
  kind: 'svg';
  path: string;
  svg: string;
}

export interface PngAsset {
  kind: 'png';
  path: string;
  /** Source drawing, rendered at `size`×`size`. */
  svg: string;
  size: number;
}

export interface IcoAsset {
  kind: 'ico';
  path: string;
  svg: string;
  sizes: number[];
}

export type BrandAsset = SvgAsset | PngAsset | IcoAsset;

// Sizes referenced by app/manifest.ts and app/layout.tsx.
const PWA_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

const appIcon = markSvg({ tone: 'light', tile: 'rounded' });
// iOS rounds home-screen icons itself and draws transparency as black, so the
// touch icon is a full-bleed opaque square rather than the rounded tile.
const touchIcon = markSvg({ tone: 'light', tile: 'square' });
// Browser-tab favicons are the bare mark, as in the kit: at 16-32px a tile
// would shrink the mark to a few pixels.
const faviconMark = markSvg({ tone: 'light' });

export const BRAND_ASSETS: BrandAsset[] = [
  // Vector masters: press kits, partner decks, Sanity, the SVG favicon.
  { kind: 'svg', path: 'public/brand/mark.svg', svg: markSvg({ tone: 'light' }) },
  { kind: 'svg', path: 'public/brand/mark-dark.svg', svg: markSvg({ tone: 'dark' }) },
  { kind: 'svg', path: 'public/brand/mark-on-blue.svg', svg: markSvg({ tone: 'onBlue' }) },
  { kind: 'svg', path: 'public/brand/app-icon.svg', svg: appIcon },
  { kind: 'svg', path: 'public/brand/app-icon-dark.svg', svg: markSvg({ tone: 'dark', tile: 'rounded' }) },
  { kind: 'svg', path: 'public/brand/logo-horizontal-light.svg', svg: lockupSvg('light') },
  { kind: 'svg', path: 'public/brand/logo-horizontal-dark.svg', svg: lockupSvg('dark') },
  { kind: 'svg', path: 'public/brand/logo-horizontal-on-blue.svg', svg: lockupSvg('onBlue') },

  // PWA / install icons (app/manifest.ts) and the <link rel=icon> set (app/layout.tsx).
  ...PWA_SIZES.map((size): PngAsset => ({ kind: 'png', path: `public/icons/icon-${size}.png`, svg: appIcon, size })),
  { kind: 'png', path: 'public/icons/apple-touch-icon.png', svg: touchIcon, size: 180 },
  { kind: 'png', path: 'public/favicon.png', svg: faviconMark, size: 32 },
  { kind: 'ico', path: 'public/favicon.ico', svg: faviconMark, sizes: [16, 32, 48] },

  // Email header logo: emails render it at 36×36 and 72×72 (emails/components/layout.tsx,
  // lib/email/templates/engine.ts), so 144 is crisp on retina without shipping a large file.
  { kind: 'png', path: 'public/brand/kitabu-yetu-logo-email.png', svg: appIcon, size: 144 },
];

/** Render an SVG drawing to a PNG of exactly size×size. */
export async function renderPng(svg: string, size: number): Promise<Buffer> {
  // density scales the 64-unit viewBox so librsvg rasterises at (or above) the
  // target size before the resize, which keeps small icons sharp.
  const density = Math.max(72, Math.ceil((72 * size) / 64) * 2);
  return sharp(Buffer.from(svg), { density })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * A .ico holding one PNG per size. Every current browser reads PNG-in-ICO; it
 * is the format the kit's own favicon.ico uses.
 */
export async function renderIco(svg: string, sizes: number[]): Promise<Buffer> {
  const pngs = await Promise.all(sizes.map((s) => renderPng(svg, s)));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  const entries = Buffer.alloc(16 * pngs.length);
  let offset = header.length + entries.length;
  pngs.forEach((png, i) => {
    const e = i * 16;
    const s = sizes[i];
    entries.writeUInt8(s >= 256 ? 0 : s, e); // width (0 means 256)
    entries.writeUInt8(s >= 256 ? 0 : s, e + 1); // height
    entries.writeUInt8(0, e + 2); // palette size
    entries.writeUInt8(0, e + 3); // reserved
    entries.writeUInt16LE(1, e + 4); // colour planes
    entries.writeUInt16LE(32, e + 6); // bits per pixel
    entries.writeUInt32LE(png.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, entries, ...pngs]);
}
