import Link from 'next/link';
import type { BrandTone } from '@/lib/ui/brand-mark';
import { cn } from '@/lib/utils';
import { BrandMark } from './BrandMark';

interface BrandLogoProps {
  /** Pixel height and width (the mark is square). Defaults to 36. */
  size?: number;
  /** Wrap in a Link to the given href. Omit to render plain. */
  href?: string;
  /** Ground the mark sits on. Defaults to 'light'. */
  tone?: BrandTone;
  /** Extra classes applied to the outer wrapper (Link if href set, else span). */
  className?: string;
  /** Accessible name. Pass '' when adjacent text already says "Kitabu Yetu". */
  alt?: string;
}

/**
 * The Kitabu Yetu mark on its own: the three-dot group above the open book.
 * Use it where there's only room for an icon. For the mark with the wordmark
 * (and optionally the tagline), use <BrandLockup />.
 */
export function BrandLogo({
  size = 36,
  href,
  tone = 'light',
  className,
  alt = 'Kitabu Yetu',
}: BrandLogoProps): React.ReactElement {
  const mark = <BrandMark size={size} tone={tone} title={href ? undefined : alt} />;

  if (href) {
    return (
      <Link href={href} className={cn('inline-flex items-center', className)} aria-label={alt || undefined}>
        {mark}
      </Link>
    );
  }

  return <span className={cn('inline-flex items-center', className)}>{mark}</span>;
}

export default BrandLogo;
