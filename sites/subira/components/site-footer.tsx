import Image from 'next/image';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { BackToTop } from './back-to-top';
import { Container } from './primitives';
import { FOOTER_COLUMNS, type NavGroup } from '@/lib/content';

const headingClass = 'mb-5 font-display text-xl font-semibold text-white';
const linkClass =
  'group inline-flex items-start gap-2 rounded-sm text-[0.9375rem] text-brand-100/85 transition-all duration-300 hover:tracking-[0.02em] hover:text-brand-400 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-400';

function LinkColumn({ column }: { column: NavGroup }) {
  return (
    <div>
      <h2 className={headingClass}>{column.label}</h2>
      <ul className="space-y-2.5">
        {column.items.map((link) => (
          <li key={link.label}>
            <Link href={link.href} className={linkClass}>
              <ChevronRight aria-hidden="true" className="mt-1 h-3.5 w-3.5 shrink-0" />
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter() {
  return (
    <>
      <footer className="mt-12 bg-finanza-dark text-brand-100/85">
        <Container className="grid gap-10 py-16 md:grid-cols-[1fr_2fr] md:py-20">
          <Link href="/" className="w-fit self-start rounded-lg bg-white p-3">
            <Image
              src="/subira-logo-300.png"
              width={300}
              height={94}
              alt="Subira International"
              className="h-auto w-44"
            />
          </Link>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-6 sm:grid-cols-3">
            {FOOTER_COLUMNS.map((column) => (
              <LinkColumn key={column.label} column={column} />
            ))}
          </nav>
        </Container>
        <div className="bg-finanza-dark-deep py-6 text-sm text-brand-100/80">
          <Container className="flex flex-wrap justify-between gap-3">
            <p>&copy; {new Date().getFullYear()} Subira International</p>
            <p>
              Template by{' '}
              <a href="https://htmlcodex.com" className="underline">
                HTML Codex
              </a>
            </p>
          </Container>
        </div>
      </footer>
      <BackToTop />
    </>
  );
}
