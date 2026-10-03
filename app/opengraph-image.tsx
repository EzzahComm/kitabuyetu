import { ImageResponse } from 'next/og';
import { brandGreen } from '@/lib/ui/brand-palette';
import { BRAND_TONES, MARK_DOTS, MARK_PAGES, MARK_VIEWBOX } from '@/lib/ui/brand-mark';
import { finanzaDark } from '@/lib/ui/finanza-palette';

/**
 * The site-wide OG/Twitter card, served at /opengraph-image. Next attaches this
 * file-convention image to `/` only; the root layout and every marketing page
 * reference it explicitly (OG_FALLBACK in components/marketing/page-metadata.ts).
 *
 * The mark and every colour come from lib/ui/brand-mark.ts and the palettes, not
 * eyeballed. This is the one social-preview surface no design tool touches, so
 * it has to be right without visual review. It sits on the kit navy, so it uses
 * the kit's dark-ground colourway.
 */
export const runtime = 'edge';
export const alt = 'Kitabu Yetu — Simple books. Stronger groups.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const tone = BRAND_TONES.dark;

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        backgroundColor: finanzaDark.DEFAULT,
        backgroundImage:
          'repeating-linear-gradient(to bottom, transparent 0, transparent 39px, rgba(18,160,107,0.08) 39px, rgba(18,160,107,0.08) 40px)',
        padding: '84px',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <svg width="64" height="64" viewBox={MARK_VIEWBOX}>
          {MARK_DOTS.map((d) => (
            <circle key={`${d.cx}-${d.cy}`} cx={d.cx} cy={d.cy} r={d.r} fill={tone[d.fill]} />
          ))}
          {MARK_PAGES.map((p) => (
            <path key={p.fill} d={p.d} fill={tone[p.fill]} />
          ))}
        </svg>
        <span style={{ display: 'flex', fontSize: 40, fontWeight: 800, letterSpacing: 1 }}>
          <span style={{ color: tone.wordKitabu }}>Kitabu</span>
          <span style={{ color: tone.wordYetu, marginLeft: 12 }}>Yetu</span>
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 40 }}>
        <span style={{ fontSize: 78, fontWeight: 300, color: '#FFFFFF', lineHeight: 1.05 }}>Simple books.</span>
        <span
          style={{
            fontSize: 78,
            fontWeight: 500,
            fontStyle: 'italic',
            color: brandGreen[300],
            lineHeight: 1.05,
          }}
        >
          Stronger groups.
        </span>
      </div>

      <span
        style={{
          display: 'flex',
          marginTop: 44,
          fontSize: 30,
          color: 'rgba(255,255,255,0.7)',
          maxWidth: 860,
        }}
      >
        Savings, loans, members and money — for chamas, SACCOs, VSLAs and welfare groups.
      </span>
    </div>,
    { ...size },
  );
}
