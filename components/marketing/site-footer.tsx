import Link from 'next/link';
import { ChevronRight, Mail, MapPin, Phone } from 'lucide-react';
import { BrandLockup } from '@/components/branding/BrandLockup';
import { BackToTop } from './back-to-top';
import { NewsletterSignupForm } from './newsletter-signup-form';
import { Container } from './primitives';
import { CONTACT, FOOTER_COLUMNS, ROUTES, telHref, type FooterColumn } from './routes';
import { SocialLinks } from './social-links';

/** Legal lives in the copyright strip; every other column is a link list, as in the template. */
const LEGAL = FOOTER_COLUMNS.find((column) => column.heading === 'Legal');
const LINK_COLUMNS = FOOTER_COLUMNS.filter((column) => column !== LEGAL);

const headingClass = 'mb-5 font-display text-xl font-semibold text-white';
const linkClass =
  'group inline-flex items-start gap-2 rounded-sm text-[0.9375rem] text-brand-100/85 transition-all duration-300 hover:tracking-[0.02em] hover:text-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

function LinkColumn({ column }: { column: FooterColumn }) {
  return (
    <div>
      <h2 className={headingClass}>{column.heading}</h2>
      <ul className="space-y-2.5">
        {column.links.map((link) => (
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
  const year = new Date().getFullYear();

  return (
    <>
      <footer className="mt-12 bg-finanza-dark text-brand-100/85">
        <Container className="py-16 md:py-20">
          <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
            {/* Our office */}
            <div className="lg:col-span-4 xl:col-span-3">
              <Link
                href={ROUTES.home}
                className="mb-5 inline-flex items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-4 focus-visible:ring-offset-finanza-dark"
                aria-label="Kitabu Yetu - home"
              >
                <BrandLockup size={48} tone="dark" tagline />
              </Link>
              <p className="text-[0.9375rem] leading-relaxed">
                Simple books. Stronger groups. Vibrant communities - digital tools for groups and organizations across
                East Africa.
              </p>
              <ul className="mt-5 space-y-2.5 text-[0.9375rem]">
                <li className="flex items-center gap-3">
                  <MapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-400" />
                  <span>{CONTACT.city}</span>
                </li>
                {CONTACT.phones.map((phone) => (
                  <li key={phone} className="flex items-center gap-3">
                    <Phone aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-400" />
                    <a href={telHref(phone)} className="rounded-sm transition-colors hover:text-brand-400">
                      {phone}
                    </a>
                  </li>
                ))}
                <li className="flex items-center gap-3">
                  <Mail aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-400" />
                  <a
                    href={`mailto:${CONTACT.email}`}
                    className="break-all rounded-sm transition-colors hover:text-brand-400"
                  >
                    {CONTACT.email}
                  </a>
                </li>
              </ul>
              <SocialLinks variant="footer" className="mt-6 flex-wrap" />
            </div>

            <nav
              aria-label="Footer"
              className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4 lg:col-span-8 xl:col-span-6"
            >
              {LINK_COLUMNS.map((column) => (
                <LinkColumn key={column.heading} column={column} />
              ))}
            </nav>

            {/* Newsletter */}
            <div className="lg:col-span-12 lg:max-w-md xl:col-span-3 xl:max-w-none">
              <h2 className={headingClass}>Newsletter</h2>
              <p className="mb-4 text-[0.9375rem] leading-relaxed">
                Guides for treasurers and officials, product news and ecosystem opportunities - occasionally, never
                spam.
              </p>
              <NewsletterSignupForm source="footer" appearance="inset" className="text-[0.9375rem] text-white" />
            </div>
          </div>
        </Container>
      </footer>

      <div className="bg-finanza-dark-deep py-6 text-sm text-brand-100/80">
        <Container className="flex flex-col items-center gap-3 text-center md:flex-row md:justify-between md:text-left">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-5">
            <p>
              &copy; {year}{' '}
              <Link href={ROUTES.home} className="border-b border-brand-100/40 hover:text-brand-400">
                Kitabu Yetu
              </Link>
              , All Rights Reserved.
            </p>
            {LEGAL && (
              <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1">
                {LEGAL.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="transition-colors hover:text-brand-400">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p>
            Designed By{' '}
            <a
              href="https://www.ezzahcomm.co.ke"
              target="_blank"
              rel="noopener noreferrer"
              className="border-b border-brand-100/40 hover:text-brand-400"
            >
              EZZAHCOMM
            </a>
            {/* Required attribution: the Finanza template is CC BY 4.0 (HTML Codex). It may only be removed
                after purchasing their credit-removal licence - https://htmlcodex.com/credit-removal */}
            <span className="text-brand-100/60">
              {' '}
              - Template by{' '}
              <a
                href="https://htmlcodex.com"
                target="_blank"
                rel="noopener noreferrer"
                className="border-b border-brand-100/30 hover:text-brand-400"
              >
                HTML Codex
              </a>
            </span>
          </p>
        </Container>
      </div>

      <BackToTop />
    </>
  );
}

export default SiteFooter;
