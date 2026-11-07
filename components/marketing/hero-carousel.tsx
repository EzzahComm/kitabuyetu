'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { btnOutline, btnPrimary } from './finanza';
import { PRODUCT_PHOTOS } from './photos';
import { CONTACT, whatsappHref } from './routes';

const WHATSAPP_HREF = whatsappHref(
  CONTACT.phones[0],
  'Hello Kitabu Yetu, I would like to discuss digital tools for our organisation.',
);

/** Product-led slides under a clear corporate promise. */
const SLIDES = [
  {
    id: 'platform',
    product: 'The Digital Operating System for Community Organisations',
    title: 'Equip your organisation to work better and grow stronger.',
    subtitle:
      'Bring membership, finances, communication and programme information into one dependable digital platform.',
    photo: PRODUCT_PHOTOS.enterprise,
    cta: { label: 'Explore the platform', href: '/products' },
    note: 'Practical digital tools for community organisations and the institutions that support them.',
  },
  {
    id: 'bookkeeper',
    product: 'Bookkeeper',
    title: 'Clear financial records. Stronger organisational accountability.',
    subtitle: 'Manage members, savings, loans, contributions, welfare and reports with a shared, reliable record.',
    photo: PRODUCT_PHOTOS.bookkeeper,
    cta: { label: 'Explore Bookkeeper', href: '/bookkeeper' },
    note: 'For chamas, VSLAs, cooperatives, associations and community organisations.',
  },
  {
    id: 'chama-reminder',
    product: 'Chama Reminder',
    title: 'Keep members informed and organisations connected.',
    subtitle: 'Send meeting reminders, contribution notifications, birthdays and important group updates by SMS.',
    photo: PRODUCT_PHOTOS.chamaReminder,
    cta: { label: 'Explore Chama Reminder', href: '/chama-reminder' },
    note: 'Affordable communication for groups and organisations.',
  },
  {
    id: 'enterprise',
    product: 'Kitabu Yetu Enterprise',
    title: 'Coordinate programmes. Strengthen oversight. Protect organisational records.',
    subtitle:
      'Support multiple organisations through portfolio visibility, programme administration, field coordination and reporting.',
    photo: PRODUCT_PHOTOS.enterprise,
    cta: { label: 'Discuss an Enterprise deployment', href: '/enterprise-solutions' },
    note: 'For NGOs, networks, federations and development institutions.',
  },
  {
    id: 'changisha',
    product: 'Changi$ha / Fundraise',
    title: 'Build a stronger pathway for community fundraising.',
    subtitle: 'A developing fundraising capability for campaigns, contribution tracking and supporter communication.',
    photo: PRODUCT_PHOTOS.fundraise,
    cta: { label: 'Learn about Changi$ha', href: '/fundraise' },
    note: 'Some capabilities are in development. Ask our team about availability.',
  },
] as const;

const ROTATION_MS = 6000;
const edgeControl =
  'absolute top-1/2 z-20 hidden h-12 w-12 -translate-y-1/2 items-center justify-center bg-brand-500 text-white transition-colors hover:bg-brand-600 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-300 lg:flex';

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
      aria-label="Kitabu Yetu platform and products"
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
              <div className="relative order-2 aspect-4/3 lg:absolute lg:inset-y-0 lg:right-0 lg:aspect-auto lg:w-[58%]">
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
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 z-1 hidden h-full w-[58%] lg:block"
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
              <div className="relative z-2 order-1 flex items-center py-12 lg:py-20">
                <div className="mx-auto w-full max-w-[82rem] px-5 sm:px-8 lg:px-10">
                  <div className="max-w-xl lg:max-w-[26rem] xl:max-w-[32rem]">
                    <p className="mb-4 inline-block rounded-lg border border-white bg-white/50 px-3 py-1 font-semibold text-brand-600 motion-safe:animate-fade-up">
                      {slide.product}
                    </p>
                    <Title className="mb-5 font-display text-[2.5rem] font-bold leading-[1.1] text-finanza-dark motion-safe:animate-fade-up sm:text-5xl xl:text-[3.5rem]">
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
                        Talk to our team
                      </a>
                    </div>
                    <p className="mt-6 text-sm text-brand-600">{slide.note}</p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => go(-1)} className={cn(edgeControl, 'left-0 rounded-r-full pr-1')}>
        <ChevronLeft aria-hidden="true" className="h-6 w-6" />
        <span className="sr-only">Previous slide</span>
      </button>
      <button type="button" onClick={() => go(1)} className={cn(edgeControl, 'right-0 rounded-l-full pl-1')}>
        <ChevronRight aria-hidden="true" className="h-6 w-6" />
        <span className="sr-only">Next slide</span>
      </button>
      <div className="relative z-20 mx-auto flex w-full max-w-[82rem] items-center justify-center gap-2 bg-white py-4 lg:absolute lg:inset-x-0 lg:bottom-8 lg:justify-start lg:bg-transparent lg:px-10 lg:py-0">
        {SLIDES.map((slide, i) => (
          <button
            key={slide.id}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Show ${slide.product}`}
            aria-current={i === index ? 'true' : undefined}
            className={cn(
              'h-2.5 rounded-full transition-all duration-300 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
              i === index ? 'w-8 bg-brand-500' : 'w-2.5 bg-brand-200 hover:bg-brand-300',
            )}
          />
        ))}
        {!reducedMotion && (
          <button
            type="button"
            onClick={() => setPaused((v) => !v)}
            aria-label={paused ? 'Resume slideshow' : 'Pause slideshow'}
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-full text-brand-500 hover:bg-brand-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
        )}
      </div>
    </section>
  );
}
