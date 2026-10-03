'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { signUpUrl } from '@/lib/app-links';
import { CHANGISHA_PRICING, PLAN_MONTHLY_FEES } from '@/types/enums';
import { btnOutline, btnPrimary } from './finanza';
import { PRODUCT_PHOTOS } from './photos';
import { CONTACT, whatsappHref } from './routes';

const WHATSAPP_HREF = whatsappHref(CONTACT.phones[0], 'Hello Kitabu Yetu, I would like to know more for my group.');

/**
 * The four product pillars rotate through the home hero so the platform is
 * immediately legible as an ecosystem, not a generic bookkeeping product.
 * Photos come from photos.ts (provenance: public/img/IMAGE_SOURCES.md); the
 * first slide is the LCP image, so it carries the strongest group photo.
 */
const SLIDES = [
  {
    id: 'bookkeeper',
    product: 'Bookkeeper',
    title: 'Every shilling. Every member. One book.',
    subtitle: 'Contributions, loans and welfare that always balance — with M-Pesa payments recorded for you.',
    photo: PRODUCT_PHOTOS.bookkeeper,
    cta: { label: 'Start your group book', href: signUpUrl('kitabu_yetu') },
    note: `From KES ${PLAN_MONTHLY_FEES.kitabu_yetu.starter}/month · Pay by M-Pesa · Cancel anytime`,
  },
  {
    id: 'chama-reminder',
    product: 'Chama Reminder / Kumbusha',
    title: 'Contributions on time. No follow-up calls.',
    subtitle: 'Automatic SMS reminders to every member’s phone. Nothing for members to install.',
    photo: PRODUCT_PHOTOS.chamaReminder,
    cta: { label: 'Send your first reminder', href: signUpUrl('chama_reminder') },
    note: `From KES ${PLAN_MONTHLY_FEES.chama_reminder.starter}/month · Works on any phone · Cancel anytime`,
  },
  {
    id: 'fundraise',
    product: 'Fundraise / Changi$ha',
    title: 'Raise it together. Track every shilling.',
    subtitle: 'A shareable M-Pesa campaign page, kept separate from your group’s savings.',
    photo: PRODUCT_PHOTOS.fundraise,
    cta: { label: 'Start a campaign', href: '/start-campaign' },
    note: `No monthly fee · ${CHANGISHA_PRICING.platformFeePct}% only when you withdraw · Donors pay nothing extra`,
  },
  {
    id: 'enterprise',
    product: 'Enterprise',
    title: 'Every group you support. One dashboard.',
    subtitle: 'Portfolio reports, programme funding and disbursements — while each group keeps its own book.',
    photo: PRODUCT_PHOTOS.enterprise,
    cta: { label: 'Book an Enterprise demo', href: '/contact' },
    note: 'Priced by the groups you oversee · Staff roles and audit log included',
  },
] as const;

/** Bootstrap's carousel default, which the template uses. */
const ROTATION_MS = 5000;

const edgeControl =
  'absolute top-1/2 z-20 hidden h-12 w-12 -translate-y-1/2 items-center justify-center bg-brand-500 text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 lg:flex';

/**
 * Finanza's header carousel: caption on a lavender wave to the left, photo to
 * the right, square edge controls. Auto-advances, but pauses on hover, on
 * focus, on the pause button (WCAG 2.2.2), when the tab is hidden, and never
 * starts under prefers-reduced-motion. Every slide is server-rendered; only
 * the active one is exposed to assistive tech, and its title is the page h1.
 */
export function HeroCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const go = useCallback((delta: number) => setIndex((i) => (i + delta + SLIDES.length) % SLIDES.length), []);

  const rotating = !paused && !hovering && !reducedMotion;
  useEffect(() => {
    if (!rotating) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      timer = setInterval(() => go(1), ROTATION_MS);
    };
    const stop = () => clearInterval(timer);
    // Don't burn CPU/battery animating a rotation nobody can see.
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [rotating, go]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Kitabu Yetu products"
      className="relative isolate overflow-hidden bg-brand-100 pt-16 lg:bg-white lg:pt-20"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHovering(false);
      }}
    >
      <div className="relative grid lg:min-h-[640px]">
        {SLIDES.map((slide, i) => {
          const active = i === index;
          const Title = active ? 'h1' : 'p';
          return (
            <div
              key={slide.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${SLIDES.length}: ${slide.product}`}
              aria-hidden={!active}
              inert={!active}
              className={cn(
                'relative col-start-1 row-start-1 grid transition-opacity duration-700 ease-in-out',
                active ? 'z-10 opacity-100' : 'pointer-events-none opacity-0',
              )}
            >
              {/* Photo: full width on phones, the right half (under the wave) on desktop. */}
              <div className="relative order-2 aspect-[4/3] lg:absolute lg:inset-y-0 lg:right-0 lg:aspect-auto lg:w-[58%]">
                <Image
                  src={slide.photo.src}
                  alt={slide.photo.alt}
                  fill
                  sizes="(max-width: 1023px) 100vw, 58vw"
                  className="object-cover"
                  style={{ objectPosition: slide.photo.position }}
                  placeholder="blur"
                  preload={i === 0}
                  fetchPriority={i === 0 ? 'high' : 'low'}
                />
              </div>

              {/* The template's lavender wave, drawn over the photo's left edge. */}
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 z-[1] hidden h-full w-[58%] lg:block"
                viewBox="0 0 800 640"
                preserveAspectRatio="none"
              >
                <path
                  className="fill-white"
                  d="M0 0H760C700 40 690 90 700 150C712 225 650 260 640 330C630 400 690 440 650 510C615 572 540 590 500 640H0Z"
                />
                <path
                  className="fill-brand-100"
                  d="M0 0H700C640 40 630 90 640 150C652 225 590 260 580 330C570 400 630 440 590 510C555 572 480 590 440 640H0Z"
                />
              </svg>

              <div className="relative z-[2] order-1 flex items-center py-12 lg:py-20">
                <div className="mx-auto w-full max-w-[82rem] px-5 sm:px-8 lg:px-10">
                  {/* Narrow enough to stay on the lavender at every width: the wave's edge sits
                      at ~46% of the viewport at mid-height. */}
                  <div className="max-w-xl lg:max-w-[26rem] xl:max-w-[32rem]">
                    <p className="mb-4 inline-block rounded-lg border border-white bg-white/40 px-3 py-1 font-medium text-brand-500 motion-safe:animate-fade-up">
                      {slide.product}
                    </p>
                    <Title className="mb-5 font-display text-[2.5rem] font-bold leading-[1.1] text-finanza-dark motion-safe:animate-fade-up sm:text-5xl xl:text-[3.75rem]">
                      {slide.title}
                    </Title>
                    <p className="mb-8 text-lg leading-relaxed text-finanza-text">{slide.subtitle}</p>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <a href={slide.cta.href} className={btnPrimary}>
                        {slide.cta.label}
                      </a>
                      <a
                        href={WHATSAPP_HREF}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(btnOutline, 'bg-white/60')}
                      >
                        Chat on WhatsApp
                      </a>
                    </div>
                    <p className="mt-6 text-sm text-finanza-text">{slide.note}</p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button type="button" onClick={() => go(-1)} className={cn(edgeControl, 'left-0 rounded-r-full pr-1')}>
        <ChevronLeft aria-hidden="true" className="h-6 w-6" />
        <span className="sr-only">Previous product</span>
      </button>
      <button type="button" onClick={() => go(1)} className={cn(edgeControl, 'right-0 rounded-l-full pl-1')}>
        <ChevronRight aria-hidden="true" className="h-6 w-6" />
        <span className="sr-only">Next product</span>
      </button>

      {/* Slide picker + pause: a strip under the photo on phones (no edge controls there);
          on desktop, aligned under the caption on the lavender. */}
      <div className="relative z-20 mx-auto flex w-full max-w-[82rem] items-center justify-center gap-2 bg-white py-4 lg:absolute lg:inset-x-0 lg:bottom-8 lg:justify-start lg:bg-transparent lg:px-10 lg:py-0">
        {SLIDES.map((slide, i) => (
          <button
            key={slide.id}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Show ${slide.product}`}
            aria-current={i === index ? 'true' : undefined}
            className={cn(
              'h-2.5 rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
              i === index ? 'w-8 bg-brand-500' : 'w-2.5 bg-brand-200 hover:bg-brand-300',
            )}
          />
        ))}
        {!reducedMotion && (
          <button
            type="button"
            onClick={() => setPaused((v) => !v)}
            aria-label={paused ? 'Resume slideshow' : 'Pause slideshow'}
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-full text-brand-500 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {paused ? (
              <Play aria-hidden="true" className="h-3.5 w-3.5" />
            ) : (
              <Pause aria-hidden="true" className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>
    </section>
  );
}
