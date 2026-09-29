import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const REGISTRY = path.join(ROOT, 'components/marketing/photos.ts');
const SOURCES = fs.readFileSync(path.join(ROOT, 'public/img/IMAGE_SOURCES.md'), 'utf8');

/** The public/img files photos.ts imports. */
function registryFiles(): string[] {
  const source = fs.readFileSync(REGISTRY, 'utf8');
  return [...source.matchAll(/from '@\/public\/img\/([\w-]+\.(?:jpe?g|png|webp))'/g)].map((m) => m[1]);
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('marketing photo registry', () => {
  const files = registryFiles();

  it('imports at least one photo', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s exists and has its provenance recorded in IMAGE_SOURCES.md', (file) => {
    expect(fs.existsSync(path.join(ROOT, 'public/img', file))).toBe(true);
    expect(SOURCES).toContain(`\`${file}\``);
  });

  it('is the only place marketing pages import a top-level public/img photo from', () => {
    const offenders = [...sourceFiles(path.join(ROOT, 'app')), ...sourceFiles(path.join(ROOT, 'components'))]
      .filter((file) => file !== REGISTRY)
      .filter((file) => /public\/img\/[\w-]+\.(?:jpe?g|png|webp)'/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
