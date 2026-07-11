'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Menu, X, ChevronDown, Smartphone, Users, Building2, ShieldCheck, type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { BrandLogo } from '@/components/branding/BrandLogo';
import { cn } from '@/lib/utils';

interface SolutionLink { icon: LucideIcon; label: string; desc: string; href: string }

// Portal entry points — surfaced as a proper menu built on the shared
// DropdownMenu primitive, so the landing nav matches the in-app design system.
const solutionLinks: SolutionLink[] = [
  { icon: Smartphone,  label: 'Member app',     desc: 'Wallet, passbook & savings goals', href: '/me' },
  { icon: Users,       label: 'Group dashboard', desc: 'Run your chama or SACCO',           href: '/register' },
  { icon: Building2,   label: 'Enterprise',     desc: 'Multi-branch, API & white-label',   href: '/enterprise' },
  { icon: ShieldCheck, label: 'Backoffice',     desc: 'Risk, KYC & live monitoring',       href: '/admin-login' },
];

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'Ecosystem', href: '#ecosystem' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Testimonials', href: '#testimonials' },
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
            {/* Solutions menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'group flex items-center gap-1 text-[16px] font-semibold uppercase tracking-wide transition-colors focus:outline-none xl:text-[18px]',
                    linkColor,
                  )}
                >
                  Solutions
                  <ChevronDown className="h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={10} className="w-72">
                {solutionLinks.map((s) => (
                  <DropdownMenuItem key={s.href} asChild className="cursor-pointer gap-3 p-2.5">
                    <Link href={s.href}>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                        <s.icon size={18} />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm font-semibold text-foreground">{s.label}</span>
                        <span className="text-xs text-muted-foreground">{s.desc}</span>
                      </span>
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="cursor-pointer justify-center text-sm font-medium text-brand-600 focus:text-brand-700">
                  <a href="#solutions">Compare all solutions</a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={cn('text-[16px] font-semibold uppercase tracking-wide transition-colors xl:text-[18px]', linkColor)}
              >
                {link.label}
              </a>
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
              <Link href="/register">Open your ledger</Link>
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
          <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Solutions</p>
          <div className="space-y-0.5">
            {solutionLinks.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-brand-50"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <s.icon size={16} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-slate-800">{s.label}</span>
                  <span className="text-xs text-slate-500">{s.desc}</span>
                </span>
              </Link>
            ))}
          </div>

          <div className="my-2 border-t border-slate-100" />
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="block rounded-md px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-600"
              onClick={() => setOpen(false)}
            >
              {link.label}
            </a>
          ))}

          <div className="pt-3 mt-2 border-t border-slate-100 flex flex-col gap-2">
            <Button asChild variant="outline" className="w-full justify-center">
              <Link href="/login">Sign In</Link>
            </Button>
            <Button asChild className="w-full justify-center bg-brand-600 hover:bg-brand-700 text-white">
              <Link href="/register">Open your ledger</Link>
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
