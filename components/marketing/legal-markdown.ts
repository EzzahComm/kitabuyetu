import { Marked, type Tokens } from 'marked';

/* Pure markdown → HTML for the legal pages, kept free of React/Next imports so it is unit-testable. */

export interface LegalHeading {
  id: string;
  text: string;
}

/** "3. Your Privacy Rights" → "3-your-privacy-rights". Deterministic, so anchors survive redeploys. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/&[a-z]+;|&#\d+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function plainText(tokens: Tokens.Heading['tokens']): string {
  return tokens.map((token) => ('text' in token ? token.text : token.raw)).join('');
}

/** Renders the markdown with heading ids and returns the h2 outline alongside it. */
export function renderLegalMarkdown(markdown: string): { html: string; headings: LegalHeading[] } {
  const headings: LegalHeading[] = [];
  const seen = new Map<string, number>();

  const marked = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const text = plainText(tokens);
        const base = slugifyHeading(text) || 'section';
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const id = count === 0 ? base : `${base}-${count}`;
        if (depth === 2) headings.push({ id, text });
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
    },
  });

  return { html: marked.parse(markdown, { async: false }) as string, headings };
}
