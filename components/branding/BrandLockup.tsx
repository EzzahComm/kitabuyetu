import { BRAND_FONTS, BRAND_TAGLINE, BRAND_TONES, BRAND_WORDMARK, type BrandTone } from '@/lib/ui/brand-mark';
import { cn } from '@/lib/utils';
import { taglineFont, wordmarkFont } from './brand-fonts';
import { BrandMark } from './BrandMark';

interface BrandLockupProps {
  /** Height of the mark in px. The wordmark and tagline scale from it. */
  size?: number;
  /** Ground the lockup sits on: picks the kit colourway. */
  tone?: BrandTone;
  /** Mark beside the words (horizontal) or above them (stacked). */
  layout?: 'horizontal' | 'stacked';
  /** Show the uppercase tagline under the wordmark. */
  tagline?: boolean;
  className?: string;
}

/**
 * The full logo: mark + "Kitabu Yetu" wordmark (green / orange, Jost 800) +
 * optional tagline (one colour, Open Sans 600, uppercase, 1.5px tracking).
 *
 * The words are live text in the kit's fonts rather than an image, so they
 * stay sharp, translate, and need no extra request. The element carries no
 * link or landmark of its own; wrap it in a Link where it should navigate
 * (and give that Link an aria-label, since the mark is decorative).
 */
export function BrandLockup({
  size = 36,
  tone = 'light',
  layout = 'horizontal',
  tagline = false,
  className,
}: BrandLockupProps) {
  const c = BRAND_TONES[tone];
  const stacked = layout === 'stacked';
  // Kit proportions: the wordmark is ~0.46× the mark's height when the tagline
  // sits under it, and fills more of the height when it stands alone.
  const wordSize = Math.round(size * (tagline || stacked ? 0.46 : 0.62) * 10) / 10;
  const taglineSize = Math.max(10, Math.round(wordSize * 0.36));

  return (
    <span
      className={cn(
        'inline-flex',
        stacked ? 'flex-col items-center text-center gap-2' : 'items-center gap-2.5',
        className,
      )}
    >
      <BrandMark size={size} tone={tone} />
      <span className={cn('flex flex-col', stacked ? 'items-center' : 'items-start')}>
        <BrandWordmark fontSize={wordSize} tone={tone} />
        {tagline && (
          <span
            className={cn(taglineFont.className, 'mt-1.5 whitespace-nowrap uppercase leading-none')}
            style={{ fontSize: taglineSize, letterSpacing: BRAND_FONTS.tagline.letterSpacingPx, color: c.tagline }}
          >
            {BRAND_TAGLINE}
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * Just the two-colour "Kitabu Yetu" wordmark, for places that set the mark
 * and words apart (e.g. a sidebar header with a second label line).
 */
export function BrandWordmark({
  fontSize,
  tone = 'light',
  className,
}: {
  /** px */
  fontSize: number;
  tone?: BrandTone;
  className?: string;
}) {
  const c = BRAND_TONES[tone];
  return (
    <span
      className={cn(wordmarkFont.className, 'whitespace-nowrap leading-none', className)}
      style={{ fontSize, letterSpacing: BRAND_FONTS.wordmark.letterSpacingPx }}
    >
      <span style={{ color: c.wordKitabu }}>{BRAND_WORDMARK.first}</span>{' '}
      <span style={{ color: c.wordYetu }}>{BRAND_WORDMARK.second}</span>
    </span>
  );
}

export default BrandLockup;
