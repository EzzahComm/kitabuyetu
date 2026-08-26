'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Menu, X, ArrowRight } from 'lucide-react';
import { BrandLogo } from '@/components/branding/BrandLogo';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, ROUTES, isNavGroup, type NavGroup } from './routes';

interface SiteHeaderProps {
  /**
   * `overlay` sits transparently on top of a dark hero and turns solid on
   * scroll. `solid` (the default) is opaque from the first pixel.
   *
   * This prop exists because the previous header was overlay-only: on every
   * page except the home page it painted white text over a white background,
   * so the logo and all five menu items were invisible until you scrolled.
   * Any page whose first section is not dark must use `solid`.
   */
  variant?: 'overlay' | 'solid';
}

/**
 * A single top-nav dropdown (About / Products / Ecosystem). Click-to-toggle
 * rather than hover-only — hover panels are unreliable on touch and awkward
 * for keyboard users; a button with aria-expanded works for both.
 */
function NavDropdown({
  group, transparent, pathname,
}: { group: NavGroup; transparent: boolean; pathname: string }) {
  const [open, setOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const active = group.items.some((item) => item.href === pathname);

  // A route change closes any open dropdown. Adjusted during render — the
  // React-recommended way to derive state from a prop change — rather than
  // an effect that calls setOpen, which trips react-hooks/set-state-in-effect.
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex items-center gap-1.5 rounded-sm text-[0.9375rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange-500 focus-visible:ring-offset-4 focus-visible:ring-offset-transparent',
          transparent
            ? 'text-white/75 hover:text-white'
            : 'text-brand-blue-900/70 hover:text-brand-blue-900',
          active && (transparent ? 'text-white' : 'text-brand-blue-900'),
        )}
      >
        {group.label}
        <ChevronDown
          aria-hidden="true"
          className={cn('h-3.5 w-3.5 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={group.label}
          className="absolute left-1/2 top-full z-10 mt-3 w-80 -translate-x-1/2 rounded-lg border border-brand-blue-900/10 bg-white p-2 shadow-xl shadow-brand-blue-900/[0.08]"
        >
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded-md px-3.5 py-3 transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange-500 focus-visible:ring-inset"
            >
              <span className="block text-[0.9375rem] font-medium text-brand-blue-900">{item.label}</span>
              {item.description && (
                <span className="mt-0.5 block text-[0.8125rem] leading-snug text-brand-blue-900/55">
                  {item.description}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** The same group, rendered as a collapsible section inside the mobile sheet
 *  instead of a floating panel — there is no room for a popover at 320px. */
function MobileNavGroup({ group, onNavigate }: { group: NavGroup; onNavigate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between py-4 text-lg text-brand-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange-500"
      >
        {group.label}
        <ChevronDown
          aria-hidden="true"
          className={cn('h-5 w-5 text-brand-blue-900/40 transition-transform duration-200', expanded && 'rotate-180')}
        />
      </button>
      {expanded && (
        <ul className="space-y-1 pb-4 pl-1">
          {group.items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                className="block rounded-md px-3 py-2.5 text-base text-brand-blue-900/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange-500"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function SiteHeader({ variant = 'solid' }: SiteHeaderProps) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (variant !== 'overlay') return;
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [variant]);

  // The panel is closed by every control inside it (each link, both CTAs and
  // the logo call setOpen(false) on click) rather than by an effect watching
  // `pathname`. Same result, one fewer render pass, and it does not trip
  // react-hooks/set-state-in-effect.

  // Escape closes and returns focus to the toggle; the page behind stops
  // scrolling while the panel is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.querySelector<HTMLAnchorElement>('a')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const transparent = variant === 'overlay' && !scrolled && !open;

  return (
    <>
      {/* Every public page gets the skip link, because every public page uses
          this header. Putting it in the home page alone would have left the
          other pages reachable only by tabbing through the whole menu. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-white focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-brand-blue-900 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-orange-500"
      >
        Skip to content
      </a>
      <header
        className={cn(
          'fixed inset-x-0 top-0 z-50 transition-colors duration-300',
          transparent
            ? 'bg-transparent'
            : 'border-b border-brand-blue-900/10 bg-paper/90 backdrop-blur-md supports-[backdrop-filter]:bg-paper/75',
        )}
      >
      <div className="mx-auto w-full max-w-[82rem] px-5 sm:px-8 lg:px-10">
        <div className="flex h-16 items-center justify-between gap-6 lg:h-20">
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="flex shrink-0 items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange-500 focus-visible:ring-offset-4 focus-visible:ring-offset-transparent"
            aria-label="Kitabu Yetu — home"
          >
            <BrandLogo size={34} priority alt="" />
            <span
              className={cn(
                'font-display text-[1.35rem] font-normal tracking-tight transition-colors',
                transparent ? 'text-white' : 'text-brand-blue-900',
              )}
            >
              Kitabu&nbsp;Yetu
            </span>
          </Link>

          <nav aria-label="Primary" className="hidden lg:block">
            <ul className="flex items-center gap-8">
              {NAV_ITEMS.map((entry) => {
                if (isNavGroup(entry)) {
                  return (
                    <li key={entry.label}>
                      <NavDropdown group={entry} transparent={transparent} pathname={pathname} />
                    </li>
                  );
                }
                const active = !entry.href.includes('#') && pathname === entry.href;
                return (
                  <li key={entry.href}>
                    <Link
                      href={entry.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative rounded-sm text-[0.9375rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange-500 focus-visible:ring-offset-4 focus-visible:ring-offset-transparent',
                        transparent
                          ? 'text-white/75 hover:text-white'
                          : 'text-brand-blue-900/70 hover:text-brand-blue-900',
                        active && (transparent ? 'text-white' : 'text-brand-blue-900'),
                      )}
                    >
                      {entry.label}
                      {active && (
                        <span
                          aria-hidden="true"
                          className="absolute -bottom-1.5 left-0 h-px w-full bg-brand-orange-500"
                        />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="hidden shrink-0 items-center gap-1 lg:flex">
            <Link
              href={ROUTES.signIn}
              className={cn(
                'rounded-md px-4 py-2 text-[0.9375rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange-500 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
                transparent
                  ? 'text-white/85 hover:bg-white/10 hover:text-white'
                  : 'text-brand-blue-900/80 hover:bg-brand-blue-900/[0.05] hover:text-brand-blue-900',
              )}
            >
              Sign in
            </Link>
            <Link
              href={ROUTES.startGroup}
              className="group inline-flex items-center gap-2 rounded-md bg-brand-orange-600 px-5 py-2.5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange-500 focus-visible:ring-offset-2"
            >
              Get started
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </div>

          <button
            ref={toggleRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="site-menu"
            className={cn(
              '-mr-2 rounded-md p-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange-500 lg:hidden',
              transparent
                ? 'text-white hover:bg-white/10'
                : 'text-brand-blue-900 hover:bg-brand-blue-900/[0.06]',
            )}
          >
            <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile panel. Full-height sheet rather than a dropdown: at 320 px the
          nav plus two CTAs do not fit under the bar without cramping, and a
          sheet gives each target a comfortable 48 px row. Groups collapse
          into an accordion — there is no room for a floating popover here. */}
      <div
        id="site-menu"
        ref={panelRef}
        hidden={!open}
        className="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-brand-blue-900/10 bg-paper lg:hidden"
      >
        <nav aria-label="Primary" className="px-5 py-4 sm:px-8">
          <ul className="divide-y divide-brand-blue-900/[0.07]">
            {NAV_ITEMS.map((entry) => {
              if (isNavGroup(entry)) {
                return <MobileNavGroup key={entry.label} group={entry} onNavigate={() => setOpen(false)} />;
              }
              return (
                <li key={entry.href}>
                  <Link
                    href={entry.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between py-4 text-lg text-brand-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange-500"
                  >
                    {entry.label}
                    <ArrowRight aria-hidden="true" className="h-4 w-4 text-brand-blue-900/40" />
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-6 flex flex-col gap-3 pb-8">
            <Link
              href={ROUTES.startGroup}
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-md bg-brand-orange-600 px-5 py-3.5 text-base font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange-500 focus-visible:ring-offset-2"
            >
              Get started
            </Link>
            <Link
              href={ROUTES.signIn}
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-md border border-brand-blue-900/15 px-5 py-3.5 text-base font-medium text-brand-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange-500 focus-visible:ring-offset-2"
            >
              Sign in
            </Link>
          </div>
        </nav>
      </div>
      </header>
    </>
  );
}

export default SiteHeader;
