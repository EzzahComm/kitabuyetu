import {
  BRAND_TONES,
  MARK_DOTS,
  MARK_PAGES,
  MARK_VIEWBOX,
  TILE_MARK_OFFSET,
  TILE_MARK_SCALE,
  TILE_RADIUS,
  type BrandTone,
} from '@/lib/ui/brand-mark';
import { cn } from '@/lib/utils';

interface BrandMarkProps {
  /** Rendered width and height in px. */
  size?: number;
  tone?: BrandTone;
  /** Draw on the kit's rounded app-icon tile (the tone's ground colour). */
  tile?: boolean;
  className?: string;
  /** Accessible name. Omit (or pass '') when visible text already names the brand. */
  title?: string;
}

/**
 * The three-dot group mark above the open book, as inline SVG: no image
 * request, crisp at any size, and coloured for the ground it sits on.
 * Geometry and colours come from lib/ui/brand-mark.ts.
 */
export function BrandMark({ size = 36, tone = 'light', tile = false, className, title }: BrandMarkProps) {
  const c = BRAND_TONES[tone];
  const shapes = (
    <>
      {MARK_DOTS.map((d) => (
        <circle key={`${d.cx}-${d.cy}`} cx={d.cx} cy={d.cy} r={d.r} fill={c[d.fill]} />
      ))}
      {MARK_PAGES.map((p) => (
        <path key={p.fill} d={p.d} fill={c[p.fill]} />
      ))}
    </>
  );
  const labelled = Boolean(title);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={MARK_VIEWBOX}
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      role={labelled ? 'img' : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      {labelled && <title>{title}</title>}
      {tile ? (
        <>
          <rect width="64" height="64" rx={TILE_RADIUS} fill={c.tile} />
          <g transform={`translate(${TILE_MARK_OFFSET} ${TILE_MARK_OFFSET}) scale(${TILE_MARK_SCALE})`}>{shapes}</g>
        </>
      ) : (
        shapes
      )}
    </svg>
  );
}

export default BrandMark;
