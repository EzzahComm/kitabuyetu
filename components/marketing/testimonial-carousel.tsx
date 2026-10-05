'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image, { type StaticImageData } from 'next/image';
import { Pause, Play, Quote } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Testimonial {
  quote: string;
  name: string;
  title: string;
  image?: StaticImageData;
}

const AUTOPLAY_MS = 5000;

/**
 * Finanza's testimonial carousel (Owl Carousel + dots) rebuilt on native
 * scroll-snap: swipeable on touch, one card per view on phones, two on
 * tablets, three on desktop. Autoplay pauses on hover, on focus, when the
 * visitor presses pause (WCAG 2.2.2), and never starts under
 * prefers-reduced-motion.
 */
export function TestimonialCarousel({ items }: { items: Testimonial[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [perView, setPerView] = useState(1);
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const pages = Math.max(1, items.length - perView + 1);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const card = track.firstElementChild as HTMLElement | null;
      if (card?.offsetWidth) setPerView(Math.max(1, Math.round(track.clientWidth / card.offsetWidth)));
    };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => setReducedMotion(media.matches);
    measure();
    onMotion();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    media.addEventListener('change', onMotion);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', onMotion);
    };
  }, []);

  const goTo = useCallback((index: number) => {
    const track = trackRef.current;
    const card = track?.children[index] as HTMLElement | undefined;
    if (track && card) track.scrollTo({ left: card.offsetLeft, behavior: 'smooth' });
  }, []);

  const onScroll = () => {
    const track = trackRef.current;
    const card = track?.firstElementChild as HTMLElement | null;
    if (!track || !card?.offsetWidth) return;
    setPage(Math.min(pages - 1, Math.round(track.scrollLeft / card.offsetWidth)));
  };

  const autoplay = !paused && !hovering && !reducedMotion && pages > 1;
  useEffect(() => {
    if (!autoplay) return;
    const timer = setInterval(() => goTo((page + 1) % pages), AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [autoplay, page, pages, goTo]);

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="What groups say about Kitabu Yetu"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHovering(false);
      }}
    >
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="relative -mx-3 flex snap-x snap-mandatory overflow-x-auto scroll-smooth scrollbar-none [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item, i) => (
          <figure
            key={item.name}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${items.length}`}
            className="w-full shrink-0 snap-start px-3 pt-[30px] text-center md:w-1/2 lg:w-1/3"
          >
            <blockquote
              className={cn(
                'relative mb-[60px] rounded-lg border border-brand-100 bg-white px-6 pb-8 pt-12 text-finanza-text',
                // The template's speech-bubble tail: a lavender triangle with a white one inset over it.
                "before:absolute before:bottom-[-60px] before:left-1/2 before:-translate-x-1/2 before:border-30 before:border-transparent before:border-t-brand-100 before:content-['']",
                "after:absolute after:bottom-[-59px] after:left-1/2 after:-translate-x-1/2 after:border-30 after:border-transparent after:border-t-white after:content-['']",
              )}
            >
              <span className="absolute top-[-30px] left-1/2 flex h-[60px] w-[60px] -translate-x-1/2 items-center justify-center rounded-full border border-brand-100 bg-white">
                <Quote aria-hidden="true" className="h-7 w-7 fill-brand-500 text-brand-500" />
              </span>
              <p className="text-[1.0625rem] leading-relaxed">{item.quote}</p>
            </blockquote>
            <figcaption>
              {item.image ? (
                <Image
                  src={item.image}
                  alt=""
                  sizes="100px"
                  className="mx-auto mb-3 h-[100px] w-[100px] rounded-full object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="mx-auto mb-3 flex h-[100px] w-[100px] items-center justify-center rounded-full bg-brand-100 font-display text-2xl font-bold text-brand-500"
                >
                  {item.name
                    .split(' ')
                    .map((w) => w[0])
                    .join('')
                    .slice(0, 2)}
                </span>
              )}
              <span className="block font-display text-xl font-semibold text-finanza-dark">{item.name}</span>
              <span className="text-finanza-text">{item.title}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      {pages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-3">
          {Array.from({ length: pages }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Show testimonials, page ${i + 1} of ${pages}`}
              aria-current={i === page ? 'true' : undefined}
              className={cn(
                'relative h-[30px] w-[30px] rounded-full border transition-colors duration-500 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
                i === page ? 'border-brand-500' : 'border-brand-100',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'absolute left-[6px] top-[6px] h-4 w-4 rounded-full transition-colors duration-500',
                  i === page ? 'bg-brand-500' : 'bg-brand-100',
                )}
              />
            </button>
          ))}
          {!reducedMotion && (
            <button
              type="button"
              onClick={() => setPaused((v) => !v)}
              aria-label={paused ? 'Resume automatic scrolling' : 'Pause automatic scrolling'}
              className="ml-2 flex h-[30px] w-[30px] items-center justify-center rounded-full text-brand-500 transition-colors hover:bg-brand-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {paused ? (
                <Play aria-hidden="true" className="h-4 w-4" />
              ) : (
                <Pause aria-hidden="true" className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
