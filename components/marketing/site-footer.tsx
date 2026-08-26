import Link from 'next/link';
import { Mail, MapPin, Phone } from 'lucide-react';
import { BrandLogo } from '@/components/branding/BrandLogo';
import { Container } from './primitives';
import { CONTACT, FOOTER_COLUMNS, ROUTES } from './routes';

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-brand-blue-900/10 bg-paper-deep">
      <Container className="py-16 md:py-20">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,2fr)] lg:gap-16">
          {/* Identity */}
          <div>
            <Link
              href={ROUTES.home}
              className="inline-flex items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-4 focus-visible:ring-offset-paper-deep"
              aria-label="Kitabu Yetu — home"
            >
              <BrandLogo size={38} alt="" />
              <span className="font-display text-[1.4rem] tracking-tight text-brand-blue-900">
                Kitabu&nbsp;Yetu
              </span>
            </Link>

            <p className="mt-5 max-w-xs font-display text-xl font-light leading-snug text-brand-blue-900/80">
              Simple books.
              <br />
              <em className="italic text-brand-700">Stronger groups.</em>
            </p>

            <p className="mt-5 max-w-xs text-sm leading-relaxed text-brand-blue-900/65">
              Digital bookkeeping for chamas, SACCOs, welfare groups, investment clubs
              and community organizations across East Africa.
            </p>

            <ul className="mt-7 space-y-3 text-sm text-brand-blue-900/65">
              <li className="flex items-center gap-3">
                <Mail aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-600" />
                <a
                  href={`mailto:${CONTACT.email}`}
                  className="rounded-sm transition-colors hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {CONTACT.email}
                </a>
              </li>
              <li className="flex items-start gap-3">
                <Phone aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                <span className="flex flex-col gap-1">
                  {CONTACT.phones.map((phone) => (
                    <a
                      key={phone}
                      href={`tel:${phone.replace(/\s/g, '')}`}
                      className="rounded-sm transition-colors hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      {phone}
                    </a>
                  ))}
                </span>
              </li>
              <li className="flex items-center gap-3">
                <MapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-600" />
                <span>{CONTACT.city}</span>
              </li>
            </ul>
          </div>

          {/* Link columns */}
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-4">
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.heading}>
                <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-brand-blue-900/70">
                  {column.heading}
                </h2>
                <ul className="mt-5 space-y-3">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="rounded-sm text-[0.9375rem] text-brand-blue-900/70 transition-colors hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-16 flex flex-col gap-4 border-t border-brand-blue-900/10 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-brand-blue-900/65">
            © {year} Kitabu Yetu. All rights reserved.
          </p>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand-blue-900/65">
            Built in Nairobi, for East Africa
          </p>
        </div>
      </Container>
    </footer>
  );
}

export default SiteFooter;
