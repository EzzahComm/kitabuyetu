/**
 * Regenerate every logo file from lib/ui/brand-mark.ts: the vector masters in
 * public/brand/, the PWA icons, the favicons, and the email logo.
 *
 * Run:  npm run brand:assets
 *
 * Then commit the output. `npm run brand:check` (also run in CI) fails while
 * any committed file differs from what this would write.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BRAND_ASSETS, renderIco, renderPng } from './brand-assets';

async function main(): Promise<void> {
  const root = process.cwd();
  for (const asset of BRAND_ASSETS) {
    const out = join(root, asset.path);
    await mkdir(dirname(out), { recursive: true });
    const data =
      asset.kind === 'svg'
        ? asset.svg
        : asset.kind === 'png'
          ? await renderPng(asset.svg, asset.size)
          : await renderIco(asset.svg, asset.sizes);
    await writeFile(out, data);
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${asset.path}`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
