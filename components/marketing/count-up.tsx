'use client';

import { useEffect, useRef } from 'react';

interface CountUpProps {
  value: number;
  /** Rendered before the number, e.g. "KES ". */
  prefix?: string;
  durationMs?: number;
}

/**
 * Finanza's counter-up, without jQuery/Waypoints. Same visibility policy as
 * Reveal: the server renders the final figure (crawlers and no-JS readers see
 * the truth), figures already on screen at mount are left alone, and
 * prefers-reduced-motion skips the animation entirely. Counts by writing
 * textContent, so it never re-renders.
 */
export function CountUp({ value, prefix = '', durationMs = 2000 }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) return;

    const format = (n: number) => `${prefix}${n.toLocaleString('en-KE')}`;
    el.textContent = format(0);
    let frame = 0;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / durationMs);
          const eased = 1 - Math.pow(1 - t, 3);
          el.textContent = format(Math.round(value * eased));
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      el.textContent = format(value);
    };
  }, [value, prefix, durationMs]);

  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {value.toLocaleString('en-KE')}
    </span>
  );
}
