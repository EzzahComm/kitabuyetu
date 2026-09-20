/**
 * Regenerate the favicon / PWA icon set from the canonical Kitabu Yetu logo.
 *
 * Source:  public/brand/kitabu-yetu-logo.png  (1024×1024 RGBA)
 * Output:  public/icons/icon-{size}.png       (PWA icons referenced by manifest)
 *          public/icons/apple-touch-icon.png  (iOS 180×180)
 *          public/favicon.ico                 (16/32/48 multi-resolution — Next picks it up from /public)
 *          public/brand/kitabu-yetu-logo-email.png (144×144, see EMAIL_LOGO_SIZE below)
 *
 * Run:  npx tsx scripts/generate-icons.ts
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'public', 'brand', 'kitabu-yetu-logo.png');
const OUT = join(ROOT, 'public', 'icons');

// Sizes referenced by app/manifest.ts + app/layout.tsx
const PWA_SIZES = [72, 96, 128, 144, 152, 192, 384, 512] as const;
const APPLE_TOUCH_SIZE = 180;
// 2x the largest size the logo is actually rendered at in outbound email
// (emails/components/layout.tsx renders 36x36, lib/email/templates/engine.ts
// renders 72x72) — crisp on retina email clients, without shipping the
// 1024x1024 (1.43MB) master into every recipient's inbox
// (docs/audits/optimization-2026-09).
const EMAIL_LOGO_SIZE = 144;

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

  // Email logo — plain resize, no flatten/background: preserves the master's
  // own appearance exactly (just fewer pixels), rather than the PWA icons'
  // opaque-background treatment above, which those need for OS home screens
  // but an inline <img> in an email does not.
  const emailLogoOut = join(ROOT, 'public', 'brand', 'kitabu-yetu-logo-email.png');
  await sharp(SRC)
    .resize(EMAIL_LOGO_SIZE, EMAIL_LOGO_SIZE, { fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toFile(emailLogoOut);
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${emailLogoOut}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
