import type { StaticImageData } from 'next/image';
import benefitOneImg from '@/public/img/benefit-one.jpg';
import benefitTwoImg from '@/public/img/benefit-two.jpg';
import heroOneImg from '@/public/img/hero-one.jpg';
import heroTwoImg from '@/public/img/hero-two.jpg';
import fundraiseImg from '@/public/img/fundraise.jpg';
import enterpriseImg from '@/public/img/enterprise.jpg';

/* ────────────────────────────────────────────────────────────────────────────
 * Every marketing photo, by what it depicts. Pages ask for a photo by role
 * ("the VSLA photo", "the youth-and-technology photo"), never by file, so
 * replacing a picture site-wide is one line here plus the file in public/img.
 *
 * Art direction: East African people, groups and phones. Women's savings
 * groups/VSLAs and young people organising with technology first, generic
 * office stock never. Provenance of every file is in public/img/IMAGE_SOURCES.md.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface Photo {
  src: StaticImageData;
  alt: string;
  /** CSS object-position for cropped (fill) placements, so faces stay in frame. */
  position?: string;
  /**
   * True while the slot still holds generic stock that does not match the art
   * direction above. The site renders it; it is listed so the replacement
   * brief (IMAGE_SOURCES.md) and this file stay in step.
   */
  placeholder?: boolean;
}

export const PHOTOS: Record<
  'youthTech' | 'memberPhone' | 'vslaRecords' | 'vslaReading' | 'payments' | 'organisations',
  Photo
> = {
  /** Young women working through something together on a laptop. */
  youthTech: {
    src: heroOneImg,
    alt: 'Four young women laughing together around a laptop on a coffee table',
    position: '50% 45%',
  },
  /** A member checking their phone — reminders, M-Pesa, the member portal. */
  memberPhone: {
    src: heroTwoImg,
    alt: 'A young man checking his phone while crossing a street in Dar es Salaam',
    position: '40% 55%',
  },
  /** A women's group official keeping the group book (VSLA / chama records). */
  vslaRecords: {
    src: benefitOneImg,
    alt: 'A smiling woman in a headscarf seated at a classroom desk with the group record book open',
    position: '50% 35%',
  },
  /** The same setting, reading back the records. */
  vslaReading: {
    src: benefitTwoImg,
    alt: 'A woman in a headscarf, pen in hand, reading the group record book at a classroom desk',
    position: '50% 35%',
  },
  /** Paying by phone. */
  payments: {
    src: fundraiseImg,
    alt: 'A shopkeeper in Dar es Salaam smiling and holding her phone at her market stall',
    position: '60% 30%',
  },
  /** Two people reaching an agreement — the organisation/Kitabu Yetu partnership. */
  organisations: {
    src: enterpriseImg,
    alt: 'Two people shaking hands in an office in Nairobi',
    position: '55% 50%',
  },
};

export type PhotoKey = keyof typeof PHOTOS;

/** The photo each product is shown with, in the hero carousel and the product tabs. */
export const PRODUCT_PHOTOS = {
  bookkeeper: PHOTOS.youthTech,
  chamaReminder: PHOTOS.memberPhone,
  fundraise: PHOTOS.payments,
  enterprise: PHOTOS.organisations,
} satisfies Record<string, Photo>;

/**
 * Stand-in artwork for CMS content without its own image (blog posts, campaigns).
 * Deterministic per key, so a card keeps the same photo between renders.
 */
const FALLBACK_ROTATION: Photo[] = [PHOTOS.vslaRecords, PHOTOS.youthTech, PHOTOS.memberPhone, PHOTOS.vslaReading];

export function fallbackPhoto(key: string): Photo {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return FALLBACK_ROTATION[hash % FALLBACK_ROTATION.length];
}
