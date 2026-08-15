import Link from 'next/link';
import { Mail, Phone, MapPin } from 'lucide-react';
import { BrandLogo } from '@/components/branding/BrandLogo';
import { PRODUCT_LABEL } from '@/types/enums';

// Every href below must resolve to a real page — the prior version linked
// 10 of 16 entries (Pricing, Security, all of Company/Legal, most of
// Resources) to routes that didn't exist. Legal pages (Privacy/Terms/
// Cookies) are deliberately absent rather than stubbed: fabricated legal
// text for a product handling real money and PII would be actively worse
// than no link. See docs/audits/UX_SURFACE_AUDIT_2026-07.md §8.
//
// Column ORDER is the render order: Company first, as requested.
//
// "Digital Tools" is the three products, matching navbar.tsx's primary bar and
// the landing page's own section — add to one, add to the others.
// "Ecosystem" replaced the old "Products" column and carries the portal entry
// points that used to sit in the navbar's Solutions dropdown.
const footerLinks = {
  Company: [
    { label: 'About', href: '/about' },
    { label: 'Contact', href: '/contact' },
  ],
  'Digital Tools': [
    { label: 'Kitabu Yetu Bookkeeper', href: '/bookkeeper' },
    { label: PRODUCT_LABEL.chama_reminder, href: '/chama-reminder' },
    { label: 'Fundraise / Changi$ha', href: '/fundraise' },
    { label: 'Pricing', href: '/pricing' },
  ],
  Ecosystem: [
    { label: 'The ecosystem', href: '/ecosystem' },
    { label: 'Member app', href: '/me' },
    { label: 'Group dashboard', href: '/register' },
    { label: 'Organizations', href: '/enterprise' },
    { label: 'Backoffice', href: '/admin-login' },
  ],
  // Legal pages (Terms/Privacy/Legal Assurances) are still deliberately
  // ABSENT, per the note above — fabricated legal text for a product handling
  // real money and PII is worse than no link. They go here once real,
  // approved wording exists.
  Resources: [
    { label: 'Documentation', href: '/docs' },
    { label: 'Status', href: '/status' },
    { label: 'Support', href: '/support' },
  ],
};

export default function Footer() {
  return (
    <footer className="border-t border-slate-100 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        {/* Top row */}
        <div className="grid gap-10 md:grid-cols-3 lg:grid-cols-6 lg:gap-8">
          {/* Brand */}
          <div className="lg:col-span-2">
            <Link href="/" className="flex items-center gap-2.5 group w-fit" aria-label="Kitabu Yetu home">
              <BrandLogo size={40} alt="Kitabu Yetu" />
              <span className="text-lg font-bold text-slate-900">Kitabu Yetu</span>
            </Link>
            <p className="mt-3 text-sm font-medium text-brand-600">
              Build Vibrant Communities
            </p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-500">
              Digital bookkeeping for chamas, SACCOs, welfare groups, and investment
              clubs across East Africa.
            </p>

            {/* Contact */}
            <div className="mt-6 space-y-2 text-sm text-slate-500">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-slate-400 flex-shrink-0" />
                <a
                  href="mailto:info@kitabuyetu.co.ke"
                  className="hover:text-green-600 transition-colors"
                >
                  info@kitabuyetu.co.ke
                </a>
              </div>
              <div className="flex items-start gap-2">
                <Phone className="h-4 w-4 text-slate-400 flex-shrink-0 mt-0.5" />
                <div className="flex flex-col">
                  <a href="tel:+254717548646" className="hover:text-green-600 transition-colors">
                    +254 717 548 646
                  </a>
                  <a href="tel:+254738692698" className="hover:text-green-600 transition-colors">
                    +254 738 692 698
                  </a>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-slate-400 flex-shrink-0" />
                <span>Nairobi, Kenya</span>
              </div>
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([heading, links]) => (
            <div key={heading}>
              <h3 className="mb-4 text-sm font-semibold text-slate-900">{heading}</h3>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm text-slate-500 hover:text-green-600 transition-colors"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom row */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-slate-100 pt-8 sm:flex-row">
          <p className="text-sm text-slate-400">
            © {new Date().getFullYear()} Kitabu Yetu. All rights reserved.
          </p>
          <div className="flex items-center gap-1 text-sm text-slate-400">
            <span>Made with</span>
            <span className="text-red-500">♥</span>
            <span>in Kenya 🇰🇪</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
