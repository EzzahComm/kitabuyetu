/**
 * Run: node scripts/generate-icons.mjs
 * Requires: npm install -D sharp
 * Generates all PWA icon sizes from the SVG source.
 */
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'public', 'icons');

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#2563eb"/>
  <text x="256" y="310" font-family="system-ui,sans-serif" font-size="260" font-weight="700"
    text-anchor="middle" fill="white">KY</text>
</svg>`;

const sizes = [72, 96, 128, 144, 152, 180, 192, 384, 512];

let sharp;
try {
  const mod = await import('sharp');
  sharp = mod.default;
} catch {
  console.error('sharp not installed. Run: npm install -D sharp');
  process.exit(1);
}

for (const size of sizes) {
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(join(outDir, name));
  console.log(`  ✓ ${name}`);
}

console.log('\nAll icons generated in public/icons/');
