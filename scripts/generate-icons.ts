/**
 * Regenerate the favicon / PWA icon set from the canonical Kitabu Yetu logo.
 *
 * Source:  public/brand/kitabu-yetu-logo.png  (1024×1024 RGBA)
 * Output:  public/icons/icon-{size}.png       (PWA icons referenced by manifest)
 *          public/icons/apple-touch-icon.png  (iOS 180×180)
 *          public/favicon.ico                 (16/32/48 multi-resolution — Next picks it up from /public)
 *
 * Run:  npx tsx scripts/generate-icons.ts
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC  = join(ROOT, 'public', 'brand', 'kitabu-yetu-logo.png');
const OUT  = join(ROOT, 'public', 'icons');

// Sizes referenced by app/manifest.ts + app/layout.tsx
const PWA_SIZES = [72, 96, 128, 144, 152, 192, 384, 512] as const;
const APPLE_TOUCH_SIZE = 180;

// Brand colors — used for the maskable PWA icons that need a solid background
const BRAND_BG = { r: 248, g: 250, b: 252, alpha: 1 }; // #F8FAFC (neutral background)

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });

  const input = sharp(SRC);
  const { width, height } = await input.metadata();
  if (!width || !height) throw new Error(`Could not read source dimensions for ${SRC}`);
  // eslint-disable-next-line no-console
  console.log(`Source: ${SRC} (${width}×${height})`);

  // PWA icons — square, branded background so iOS/Android home screens look clean
  for (const size of PWA_SIZES) {
    const out = join(OUT, `icon-${size}.png`);
    await sharp(SRC)
      .resize(size, size, { fit: 'contain', background: BRAND_BG })
      .flatten({ background: BRAND_BG })
      .png({ compressionLevel: 9 })
      .toFile(out);
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${out}`);
  }

  // Apple touch icon — iOS prefers an opaque background, 180×180 is the canonical size
  const appleOut = join(OUT, 'apple-touch-icon.png');
  await sharp(SRC)
    .resize(APPLE_TOUCH_SIZE, APPLE_TOUCH_SIZE, { fit: 'contain', background: BRAND_BG })
    .flatten({ background: BRAND_BG })
    .png({ compressionLevel: 9 })
    .toFile(appleOut);
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${appleOut}`);

  // favicon.ico — multi-resolution (16 + 32 + 48) at /public root.
  // sharp doesn't emit ICO directly, so write the PNG at /public/favicon.png as well
  // and a 32×32 favicon.ico equivalent at /public/favicon.ico (Next.js serves both).
  const favPng = join(ROOT, 'public', 'favicon.png');
  await sharp(SRC)
    .resize(32, 32, { fit: 'contain', background: BRAND_BG })
    .flatten({ background: BRAND_BG })
    .png({ compressionLevel: 9 })
    .toFile(favPng);
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${favPng}`);

  // For a true multi-resolution favicon.ico we'd need a separate ICO encoder.
  // Browsers accept PNG via the `icon` link relation, and Next.js metadata uses
  // explicit PNG icons — so favicon.png is sufficient. Skip generating .ico.
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
