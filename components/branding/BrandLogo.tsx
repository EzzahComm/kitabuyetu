import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface BrandLogoProps {
  /** Pixel height (and width — the source is square). Defaults to 36. */
  size?: number;
  /** Wrap in a Link to the given href. Omit to render plain. */
  href?: string;
  /** Add eager-load + fetchPriority. Use for above-the-fold logos (navbar, auth hero). */
  priority?: boolean;
  /** Extra classes applied to the outer wrapper (Link if href set, else span). */
  className?: string;
  /** Override the rendered alt text. */
  alt?: string;
}

/**
 * Kitabu Yetu logo image — the single source of truth for rendering the brand mark.
 * Use this anywhere the logo appears in the UI; do not import the PNG directly.
 *
 * The source asset is the full lockup (graphic + wordmark + tagline). At small sizes
 * the visual marks dominate; the wordmark/tagline become decorative. Consumers that
 * want a separate text wordmark next to the logo (e.g. navbar) can render their own
 * <span>Kitabu Yetu</span> alongside this component.
 */
export function BrandLogo({
  size = 36,
  href,
  priority = false,
  className,
  alt = 'Kitabu Yetu Logo',
}: BrandLogoProps): React.ReactElement {
  const img = (
    <Image
      src="/brand/kitabu-yetu-logo.png"
      alt={alt}
      width={size}
      height={size}
      priority={priority}
      sizes={`${size}px`}
      className="object-contain"
    />
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn('inline-flex items-center', className)}
        aria-label={alt}
      >
        {img}
      </Link>
    );
  }

  return (
    <span className={cn('inline-flex items-center', className)}>
      {img}
    </span>
  );
}

export default BrandLogo;
