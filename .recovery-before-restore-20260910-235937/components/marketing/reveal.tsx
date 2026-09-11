'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Tags this wrapper is allowed to render as. Kept to a closed set so the
 *  `as 'div'` cast below stays honest — every member takes the same
 *  HTMLElement props and ref. */
type RevealTag = 'div' | 'li' | 'section' | 'article' | 'figure' | 'p' | 'span';

interface RevealProps {
  children:   ReactNode;
  as?:        RevealTag;
  /** Stagger within a group, in milliseconds. */
  delay?:     number;
  className?: string;
}

/** Literal class names, written out so Tailwind's content scanner generates
 *  them — they are added from JS, never rendered into JSX. */
const HIDDEN_CLASS = 'opacity-0';
const REVEAL_CLASS = 'motion-safe:animate-fade-up';

/**
 * The marketing surface's only scroll animation, and (with the header) one of
 * its only two client components.
 *
 * The previous landing page marked all twelve sections `'use client'` purely
 * so each could call framer-motion's `whileInView` — roughly 50 KB of JS
 * shipped to every visitor to fade some headings in. framer-motion was
 * imported by nothing else in the app (twelve files, all of them landing
 * sections), so this replaces the whole dependency on the public surface with
 * ~40 lines of IntersectionObserver, and lets every section stay a server
 * component.
 *
 * It drives the element through `classList` rather than React state. That is
 * not a shortcut around `react-hooks/set-state-in-effect` — a purely visual
 * class toggle IS the "update an external system" case effects are for, and
 * doing it this way means a page with sixty of these performs exactly zero
 * re-renders while you scroll.
 *
 * Three details matter and are easy to get wrong:
 *
 *  1. The server-rendered markup is VISIBLE. Nothing is hidden until the
 *     client has mounted and confirmed it can un-hide it again, so a JS
 *     failure, a crawler, or a browser without IntersectionObserver sees the
 *     full page rather than a blank one — the standard failure mode of
 *     reveal-on-scroll.
 *  2. Content already on screen at mount is left alone. Fading in what the
 *     user is already looking at reads as a flash, not a reveal; only content
 *     scrolled to later animates.
 *  3. `prefers-reduced-motion` short-circuits the whole thing.
 */
export function Reveal({ children, as = 'div', delay = 0, className }: RevealProps) {
  // Cast to a single concrete tag: every RevealTag shares the same DOM props
  // and ref type, and this is what keeps `ref` type-checking without `any`.
  const Comp = as as 'div';
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      el.getBoundingClientRect().top < window.innerHeight * 0.92
    ) {
      return;
    }

    el.classList.add(HIDDEN_CLASS);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        if (delay) el.style.animationDelay = `${delay}ms`;
        el.classList.remove(HIDDEN_CLASS);
        el.classList.add(REVEAL_CLASS);
        observer.disconnect();
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
    );
    observer.observe(el);

    return () => {
      observer.disconnect();
      el.classList.remove(HIDDEN_CLASS);
    };
  }, [delay]);

  return (
    <Comp ref={ref} className={cn(className)}>
      {children}
    </Comp>
  );
}

export default Reveal;
