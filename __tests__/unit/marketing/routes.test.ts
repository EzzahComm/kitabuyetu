import fs from 'node:fs';
import path from 'node:path';
import { ABOUT_ITEMS, FOOTER_COLUMNS, LEGAL_ITEMS, NAV_LINKS, ROUTES } from '@/components/marketing/routes';
import { renderLegalMarkdown, slugifyHeading } from '@/components/marketing/legal-markdown';

// marked ships ESM as its main entry, which this CommonJS jest setup cannot parse; its UMD build is the same code.
jest.mock('marked', () => jest.requireActual(`${process.cwd()}/node_modules/marked/lib/marked.umd.js`));

const APP_DIR = path.join(process.cwd(), 'app');

/** Every page.tsx under app/, as its public URL path (route groups stripped, dynamic segments kept). */
function publicPagePaths(): Set<string> {
  const pages = new Set<string>();
  const walk = (dir: string, segments: string[]) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const isGroup = entry.name.startsWith('(') && entry.name.endsWith(')');
        walk(path.join(dir, entry.name), isGroup ? segments : [...segments, entry.name]);
      } else if (entry.name === 'page.tsx') {
        pages.add(`/${segments.join('/')}`);
      }
    }
  };
  walk(APP_DIR, []);
  return pages;
}

/** Strip query and hash: `/resources?category=guide` and `/#faq` resolve to their page. */
function pagePath(href: string): string {
  return href.split(/[?#]/)[0] || '/';
}

describe('marketing routes', () => {
  const pages = publicPagePaths();

  it.each(Object.entries(ROUTES))('ROUTES.%s (%s) resolves to a page', (_name, href) => {
    expect(pages).toContain(pagePath(href));
  });

  it('every nav, footer and legal link resolves to a page', () => {
    const hrefs = [
      ...NAV_LINKS,
      ...ABOUT_ITEMS,
      ...LEGAL_ITEMS,
      ...FOOTER_COLUMNS.flatMap((column) => column.links),
    ].map((link) => pagePath(link.href));
    const missing = hrefs.filter((href) => href.startsWith('/') && !pages.has(href));
    expect(missing).toEqual([]);
  });

  it('links Careers and the Legal hub from the site navigation', () => {
    expect(ABOUT_ITEMS.map((item) => item.href)).toContain(ROUTES.careers);
    const footerHrefs = FOOTER_COLUMNS.flatMap((column) => column.links.map((link) => link.href));
    expect(footerHrefs).toEqual(expect.arrayContaining([ROUTES.careers, ROUTES.legal, ROUTES.legalTerms]));
  });
});

describe('legal markdown', () => {
  it('slugifies numbered headings into stable anchors', () => {
    expect(slugifyHeading('3. Your Privacy Rights')).toBe('3-your-privacy-rights');
    expect(slugifyHeading("27. Children's Privacy")).toBe('27-childrens-privacy');
  });

  it('gives headings ids and returns only the h2s as the outline', () => {
    const { html, headings } = renderLegalMarkdown('## 1. Scope\n\nText.\n\n### 1.1 Detail\n\n## 2. **Bold** Rights\n');
    expect(html).toContain('<h2 id="1-scope">1. Scope</h2>');
    expect(html).toContain('<h3 id="11-detail">1.1 Detail</h3>');
    expect(html).toContain('<h2 id="2-bold-rights">2. <strong>Bold</strong> Rights</h2>');
    expect(headings).toEqual([
      { id: '1-scope', text: '1. Scope' },
      { id: '2-bold-rights', text: '2. Bold Rights' },
    ]);
  });

  it('de-duplicates repeated heading ids', () => {
    const { headings } = renderLegalMarkdown('## Contact\n\n## Contact\n');
    expect(headings.map((h) => h.id)).toEqual(['contact', 'contact-1']);
  });

  it('keeps the Privacy Policy anchors the Data Protection page links to', () => {
    const source = fs.readFileSync(path.join(APP_DIR, 'legal/privacy/page.tsx'), 'utf8');
    const markdown = source.slice(source.indexOf('`') + 1, source.lastIndexOf('`'));
    const ids = new Set(renderLegalMarkdown(markdown).headings.map((h) => h.id));
    const linked = fs
      .readFileSync(path.join(APP_DIR, 'legal/data-protection/page.tsx'), 'utf8')
      .match(/id: '([^']+)'/g)
      ?.map((match) => match.slice(5, -1));
    expect(linked?.length).toBeGreaterThan(0);
    for (const id of linked ?? []) expect(ids).toContain(id);
  });
});
