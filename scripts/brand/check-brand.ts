/**
 * Brand guard, run in CI (npm run brand:check). Fails when:
 *
 *   1. a committed logo file no longer matches lib/ui/brand-mark.ts
 *      (someone edited the mark but didn't run `npm run brand:assets`, or
 *      hand-edited a generated file);
 *   2. a retired brand value creeps back into the source: the old raster
 *      logo, its colours, or the never-used drawings from PR #192.
 *
 * Exit code 0 = clean; 1 = problems (each printed with file and line).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { BRAND_ASSETS, renderPng } from './brand-assets';

const root = process.cwd();
const problems: string[] = [];

// ── 1. generated files in sync ─────────────────────────────────────────────

/** Largest per-channel difference we accept between renders (librsvg/sharp versions anti-alias slightly differently). */
const MAX_MEAN_DIFF = 2;

async function samePixels(committed: Buffer, expected: Buffer): Promise<string | null> {
  const [a, b] = await Promise.all(
    [committed, expected].map((buf) => sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })),
  );
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    return `is ${a.info.width}×${a.info.height}, expected ${b.info.width}×${b.info.height}`;
  }
  let total = 0;
  for (let i = 0; i < a.data.length; i++) total += Math.abs(a.data[i] - b.data[i]);
  const mean = total / a.data.length;
  return mean > MAX_MEAN_DIFF ? `differs from the mark (mean channel diff ${mean.toFixed(2)})` : null;
}

/** The PNG images inside a PNG-in-ICO file, keyed by their declared size. */
function icoImages(buf: Buffer): Map<number, Buffer> {
  const out = new Map<number, Buffer>();
  const count = buf.readUInt16LE(4);
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const size = buf.readUInt8(e) || 256;
    out.set(size, buf.subarray(buf.readUInt32LE(e + 12), buf.readUInt32LE(e + 12) + buf.readUInt32LE(e + 8)));
  }
  return out;
}

async function checkAssets(): Promise<void> {
  for (const asset of BRAND_ASSETS) {
    const file = join(root, asset.path);
    if (!existsSync(file)) {
      problems.push(`${asset.path}: missing (run npm run brand:assets)`);
      continue;
    }
    const committed = readFileSync(file);
    if (asset.kind === 'svg') {
      // Compare ignoring line endings: Windows checkouts may hold CRLF.
      if (committed.toString('utf8').replace(/\r\n/g, '\n') !== asset.svg) {
        problems.push(`${asset.path}: out of date with lib/ui/brand-mark.ts (run npm run brand:assets)`);
      }
    } else if (asset.kind === 'png') {
      const diff = await samePixels(committed, await renderPng(asset.svg, asset.size));
      if (diff) problems.push(`${asset.path}: ${diff} (run npm run brand:assets)`);
    } else {
      const images = icoImages(committed);
      for (const size of asset.sizes) {
        const img = images.get(size);
        const diff = img ? await samePixels(img, await renderPng(asset.svg, size)) : `has no ${size}×${size} image`;
        if (diff) problems.push(`${asset.path} @${size}: ${diff} (run npm run brand:assets)`);
      }
    }
  }
}

// ── 2. retired brand values ─────────────────────────────────────────────────

const RETIRED: { pattern: RegExp; why: string }[] = [
  { pattern: /#3CB043\b/i, why: "the retired raster logo's green; use brandGreen (lib/ui/brand-palette.ts)" },
  { pattern: /#F97316\b/i, why: 'the pre-v3 brand orange; use brandOrange (lib/ui/brand-palette.ts)' },
  { pattern: /brand\/kitabu-yetu-logo\.png/, why: 'the retired raster logo; use <BrandLogo /> / <BrandLockup />' },
  { pattern: /\/img\/logo[-.]/, why: 'PR #192 drawings that never matched the kit; use public/brand/*' },
  {
    pattern: /\buseSvg\b|\btaglineColor\b|\btagline-(?:light|navy|blue)\b/,
    why: 'PR #192 API, replaced by BRAND_TONES',
  },
];

const RETIRED_FILES = [
  'public/brand/kitabu-yetu-logo.png',
  'public/img/logo.svg',
  'public/img/logo-icon.svg',
  'public/img/logo-horizontal.svg',
  'public/img/logo-stacked.svg',
];

/** Paths never scanned: historical records and this guard's own list. */
const SKIP = [/^docs\/audits\//, /(^|\/)yarn\.lock$/, /(^|\/)package-lock\.json$/, /^scripts\/brand\/check-brand\.ts$/];
const TEXT = /\.(?:[cm]?[jt]sx?|css|scss|md|mdx|json|html|svg|ya?ml|txt)$/i;

function checkRetired(): void {
  for (const f of RETIRED_FILES) {
    if (existsSync(join(root, f))) problems.push(`${f}: retired file still present; delete it`);
  }
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((f) => f && TEXT.test(f) && !SKIP.some((re) => re.test(f)) && existsSync(join(root, f)));
  for (const f of files) {
    const lines = readFileSync(join(root, f), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const { pattern, why } of RETIRED) {
        if (pattern.test(line)) problems.push(`${f}:${i + 1}: ${pattern.source}: ${why}`);
      }
    });
  }
}

async function main(): Promise<void> {
  await checkAssets();
  checkRetired();
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error(`brand:check found ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`brand:check OK: ${BRAND_ASSETS.length} logo files match lib/ui/brand-mark.ts, no retired brand values.`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
