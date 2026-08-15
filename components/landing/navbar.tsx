'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/branding/BrandLogo';
import { cn } from '@/lib/utils';

/**
 * The primary bar: five flat items, no dropdowns.
 *
 * This replaced a Solutions dropdown + Features anchor + Resources dropdown.
 * Each item is a real page (see app/bookkeeper, app/chama-reminder,
 * app/fundraise, app/ecosystem) — the footer's own comment records a version
 * that shipped 10 of 16 dead links, so "every href resolves" is an invariant
 * here, not an aspiration.
 *
 * The portal entry points that used to live in the Solutions dropdown
 * (Member app, Group dashboard, Organizations, Backoffice) are in the
 * footer's Ecosystem column and on /ecosystem; Sign In / Register cover the
 * common case from the bar itself.
 */
const navLinks = [
  { label: 'Bookkeeper',     href: '/bookkeeper' },
  { label: 'Chama Reminder', href: '/chama-reminder' },
  { label: 'Fundraise',      href: '/fundraise' },
  { label: 'Ecosystem',      href: '/ecosystem' },
  { label: 'Pricing',        href: '/pricing' },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const linkColor = scrolled
    ? 'text-slate-600 hover:text-brand-600'
    : 'text-white/80 hover:text-white';

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-300',
        scrolled
          ? 'bg-white/95 backdrop-blur-md shadow-sm border-b border-slate-100'
          : 'bg-transparent',
      )}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* 65px bar on small screens → 84px on desktop (mirrors the Safaricom header spec) */}
        <div className="flex h-[65px] items-center justify-between lg:h-[84px]">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group" aria-label="Kitabu Yetu home">
            <BrandLogo size={36} priority alt="Kitabu Yetu" />
            <span className={cn('text-lg font-bold transition-colors', scrolled ? 'text-slate-900' : 'text-white')}>
              Kitabu Yetu
            </span>
          </Link>

          {/* Desktop nav — shown at lg+ (like Safaricom hiding its menu on smaller screens) */}
          <nav className="hidden lg:flex items-center gap-7">
            {navLinks.map((link) => (
              link.href.startsWith('#') ? (
                <a
                  key={link.href}
                  href={link.href}
                  className={cn('text-[16px] font-semibold uppercase tracking-wide transition-colors xl:text-[18px]', linkColor)}
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn('text-[16px] font-semibold uppercase tracking-wide transition-colors xl:text-[18px]', linkColor)}
                >
                  {link.label}
                </Link>
              )
            ))}
          </nav>

          {/* Desktop CTAs */}
          <div className="hidden lg:flex items-center gap-3">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className={cn(scrolled ? 'text-slate-700 hover:text-slate-900' : 'text-white/90 hover:text-white hover:bg-white/10')}
            >
              <Link href="/login">Sign In</Link>
            </Button>
            <Button asChild size="sm" className="bg-brand-600 hover:bg-brand-700 text-white font-semibold px-5">
              <Link href="/register">Register/Sign-Up</Link>
            </Button>
          </div>

          {/* Mobile hamburger */}
          <button
            type="button"
            className={cn(
              'lg:hidden rounded-md p-2 transition-colors',
              scrolled ? 'text-slate-700 hover:bg-slate-100' : 'text-white hover:bg-white/10',
            )}
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="lg:hidden bg-white border-t border-slate-100 px-4 py-4">
          {/* Same five items as the desktop bar, from the same array — the two
              used to be parallel hand-maintained lists, which is how they drift. */}
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block rounded-md px-3 py-2.5 text-sm font-semibold uppercase tracking-wide text-slate-700 hover:bg-brand-50 hover:text-brand-600"
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}

          <div className="pt-3 mt-2 border-t border-slate-100 flex flex-col gap-2">
            <Button asChild variant="outline" className="w-full justify-center">
              <Link href="/login">Sign In</Link>
            </Button>
            <Button asChild className="w-full justify-center bg-brand-600 hover:bg-brand-700 text-white">
              <Link href="/register">Register/Sign-Up</Link>
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
