'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Menu, X, ArrowRight, Mail, MapPin, Phone } from 'lucide-react';
import { BrandLockup } from '@/components/branding/BrandLockup';
import { cn } from '@/lib/utils';
import { displayFont } from './display-font';
import { CONTACT, NAV_ITEMS, ROUTES, isNavGroup, telHref, type NavGroup } from './routes';
import { SocialLinks } from './social-links';

/** Height of the Finanza top bar (lg+). The fixed nav starts this far down and slides up as it scrolls away. */
const TOP_BAR_PX = 44;

/**
 * Exposes the display face at the document root on every page that renders
 * this header, so public pages without their own font wrapper still set
 * headings in Jost. The value is next/font's generated family list - static,
 * build-time output, not user input.
 */
const ROOT_FONT_CSS = `html:has([data-marketing-theme]){--font-display:${displayFont.style.fontFamily};}`;

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
 * A single top-nav dropdown (About / Products / Ecosystem). Opens on hover for
 * a mouse, and on click for everything else - touch has no hover, and the
 * button with aria-expanded is what keyboard and screen-reader users operate.
 */
function NavDropdown({ group, transparent, pathname }: { group: NavGroup; transparent: boolean; pathname: string }) {
  const [open, setOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedByHover = useRef(false);
  const active = group.items.some((item) => item.href === pathname);

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  const onPointerEnter = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    cancelClose();
    if (!open) {
      openedByHover.current = true;
      setOpen(true);
    }
  };

  // A short grace period, so a diagonal move from the label toward the panel
  // does not close it on the way.
  const onPointerLeave = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  // A mouse click on a panel that hover already opened keeps it open, rather
  // than toggling it shut under the cursor.
  const onClick = () => {
    if (openedByHover.current) {
      openedByHover.current = false;
      return;
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) openedByHover.current = false;
  }, [open]);

  // A route change closes any open dropdown. Adjusted during render - the
  // React-recommended way to derive state from a prop change - rather than
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
    <div ref={wrapperRef} className="relative" onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
      <button
        type="button"
        onClick={onClick}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex items-center gap-1.5 rounded-sm py-2 text-[0.9375rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-4 focus-visible:ring-offset-transparent',
          transparent ? 'text-white/80 hover:text-white' : 'text-finanza-text hover:text-brand-500',
          (active || open) && (transparent ? 'text-white' : 'text-brand-500'),
        )}
      >
        {group.label}
        <ChevronDown
          aria-hidden="true"
          className={cn('h-4 w-4 transition-transform duration-300', open && 'rotate-180')}
        />
      </button>

      {open && (
        // pt-3 rather than a margin: the gap stays inside the wrapper, so the
        // pointer crossing it never counts as leaving.
        <div className="absolute left-1/2 top-full z-10 w-80 -translate-x-1/2 pt-3">
          <div
            role="menu"
            aria-label={group.label}
            className="origin-top rounded-lg border border-brand-100 bg-white py-2 shadow-xl shadow-finanza-dark/[0.08] motion-safe:animate-fade-up"
          >
            {group.items.map((item) => {
              const current = item.href === pathname;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  aria-current={current ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'block px-4 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500',
                    current ? 'bg-brand-500' : 'hover:bg-brand-50',
                  )}
                >
                  <span
                    className={cn('block text-[0.9375rem] font-medium', current ? 'text-white' : 'text-finanza-dark')}
                  >
                    {item.label}
                  </span>
                  {item.description && (
                    <span
                      className={cn(
                        'mt-0.5 block text-[0.8125rem] leading-snug',
                        current ? 'text-white/80' : 'text-finanza-text/80',
                      )}
                    >
                      {item.description}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** The same group, rendered as a collapsible section inside the mobile sheet
 *  instead of a floating panel - there is no room for a popover at 320px. */
function MobileNavGroup({ group, onNavigate }: { group: NavGroup; onNavigate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between py-3.5 text-base font-medium text-finanza-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {group.label}
        <ChevronDown
          aria-hidden="true"
          className={cn('h-5 w-5 text-brand-500 transition-transform duration-200', expanded && 'rotate-180')}
        />
      </button>
      {expanded && (
        <ul className="space-y-1 pb-3 pl-1">
          {group.items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                className="block rounded-md px-3 py-2.5 text-[0.9375rem] text-finanza-text hover:bg-brand-50 hover:text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
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

/** Finanza's top bar: contact details and social profiles, above the nav on large screens only. */
function TopBar() {
  return (
    <div className="hidden border-b border-brand-500/[0.07] bg-white lg:block" style={{ height: TOP_BAR_PX }}>
      <div className="mx-auto flex h-full w-full max-w-[82rem] items-center justify-between gap-6 px-5 text-sm text-finanza-text sm:px-8 lg:px-10">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2">
            <MapPin aria-hidden="true" className="h-4 w-4 text-brand-500" />
            {CONTACT.city}
          </span>
          <a
            href={`mailto:${CONTACT.email}`}
            className="flex items-center gap-2 rounded-sm transition-colors hover:text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Mail aria-hidden="true" className="h-4 w-4 text-brand-500" />
            {CONTACT.email}
          </a>
          <a
            href={telHref(CONTACT.phones[0])}
            className="flex items-center gap-2 rounded-sm transition-colors hover:text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Phone aria-hidden="true" className="h-4 w-4 text-brand-500" />
            {CONTACT.phones[0]}
          </a>
        </div>
        <SocialLinks variant="nav" className="gap-1.5 [&_a]:h-7 [&_a]:w-7 [&_span]:h-7 [&_span]:w-7" />
      </div>
    </div>
  );
}

export function SiteHeader({ variant = 'solid' }: SiteHeaderProps) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // One rAF-throttled listener drives both the solid-on-scroll state and the
  // nav's slide up over the top bar. The slide is written straight to a CSS
  // variable, so scrolling causes no re-renders.
  useEffect(() => {
    const header = headerRef.current;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      header?.style.setProperty('--topbar-offset', `${Math.max(0, TOP_BAR_PX - y)}px`);
      setScrolled(y > 12);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

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
      <style dangerouslySetInnerHTML={{ __html: ROOT_FONT_CSS }} />
      {/* Every public page gets the skip link, because every public page uses
          this header. Putting it in the home page alone would have left the
          other pages reachable only by tabbing through the whole menu. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-white focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-finanza-dark focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        Skip to content
      </a>

      {/* In normal flow, not fixed: it adds clearance above every page's own
          header offset rather than covering any of its content. */}
      <TopBar />

      <header
        ref={headerRef}
        data-marketing-theme
        className={cn(
          'fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow] duration-300 lg:top-[var(--topbar-offset,44px)]',
          transparent ? 'bg-transparent' : 'bg-white',
          scrolled && !transparent && 'shadow-[0_0.5rem_1rem_rgba(1,26,65,0.08)]',
        )}
      >
        <div className="mx-auto w-full max-w-[82rem] px-5 sm:px-8 lg:px-10">
          <div className="flex h-16 items-center justify-between gap-6 lg:h-20">
            <Link
              href="/"
              onClick={() => setOpen(false)}
              className="flex shrink-0 items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-4 focus-visible:ring-offset-transparent"
              aria-label="Kitabu Yetu - home"
            >
              {/* Over the hero photo the header is transparent, so the lockup takes the kit's dark-ground colourway. */}
              <BrandLockup size={40} tone={transparent ? 'dark' : 'light'} tagline />
            </Link>

            {/* xl, not lg: the seven items need ~700px, so between 1024 and
                1279px the row overflowed and pushed "Get started" off-screen. */}
            <nav aria-label="Primary" className="hidden xl:block">
              <ul className="flex items-center gap-7">
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
                          'block rounded-sm py-2 text-[0.9375rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-4 focus-visible:ring-offset-transparent',
                          transparent ? 'text-white/80 hover:text-white' : 'text-finanza-text hover:text-brand-500',
                          active && (transparent ? 'text-white' : 'text-brand-500'),
                        )}
                      >
                        {entry.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="hidden shrink-0 items-center gap-2 xl:flex">
              <Link
                href={ROUTES.signIn}
                className={cn(
                  'rounded-lg px-4 py-2.5 text-[0.9375rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
                  transparent
                    ? 'text-white/85 hover:bg-white/10 hover:text-white'
                    : 'text-finanza-text hover:bg-brand-50 hover:text-brand-500',
                )}
              >
                Sign in
              </Link>
              <Link
                href={ROUTES.startGroup}
                className="group inline-flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-[0.9375rem] font-medium text-white transition-colors duration-300 hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
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
                '-mr-2 rounded-lg border p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 xl:hidden',
                transparent
                  ? 'border-white/30 text-white hover:bg-white/10'
                  : 'border-finanza-dark/10 text-finanza-text hover:bg-brand-50',
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
          into an accordion - there is no room for a floating popover here. */}
        <div
          id="site-menu"
          ref={panelRef}
          hidden={!open}
          className="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-finanza-dark/[0.07] bg-white lg:max-h-[calc(100dvh-5rem-var(--topbar-offset,44px))] xl:hidden"
        >
          <nav aria-label="Primary" className="px-5 py-4 sm:px-8">
            <ul className="divide-y divide-finanza-dark/[0.07]">
              {NAV_ITEMS.map((entry) => {
                if (isNavGroup(entry)) {
                  return <MobileNavGroup key={entry.label} group={entry} onNavigate={() => setOpen(false)} />;
                }
                const active = !entry.href.includes('#') && pathname === entry.href;
                return (
                  <li key={entry.href}>
                    <Link
                      href={entry.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center justify-between py-3.5 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                        active ? 'text-brand-500' : 'text-finanza-text',
                      )}
                    >
                      {entry.label}
                      <ArrowRight aria-hidden="true" className="h-4 w-4 text-brand-500/60" />
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-6 flex flex-col gap-3">
              <Link
                href={ROUTES.startGroup}
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center rounded-lg bg-brand-500 px-5 py-3.5 text-base font-medium text-white hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                Get started
              </Link>
              <Link
                href={ROUTES.signIn}
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center rounded-lg border border-brand-500 px-5 py-3.5 text-base font-medium text-brand-500 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                Sign in
              </Link>
            </div>
            <SocialLinks variant="nav" className="mt-6 justify-center pb-8" />
          </nav>
        </div>
      </header>
    </>
  );
}

export default SiteHeader;
