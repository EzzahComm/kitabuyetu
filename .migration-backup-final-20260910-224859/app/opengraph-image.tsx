import { ImageResponse } from 'next/og';

/**
 * The site-wide OG/Twitter card. `app/page.tsx` declares its own `openGraph`
 * and `twitter` metadata objects (title/description only, no images) — a
 * page-level metadata export replaces the parent's object key for key rather
 * than deep-merging, which is what silently dropped the root layout's
 * `/icons/icon-512.png` fallback. File-convention images are a separate,
 * additive resolution step that survives that, so this is the fix rather
 * than adding an `images` array to page.tsx's metadata (see
 * docs/audits/HERO_BRIEF_CLAIM_AUDIT_2026-08.md §5, defect 4).
 *
 * No twitter-image.tsx alongside this on purpose — Next reuses this file for
 * the Twitter card automatically when a dedicated one isn't present.
 *
 * Colours are the real tokens from lib/ui/brand-palette.ts, not eyeballed —
 * this is the one social-preview surface no design tool touches, so it has
 * to be right without visual review.
 */
export const runtime = 'edge';
export const alt = 'Kitabu Yetu — Simple books. Stronger groups.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          backgroundColor: '#04162F', // brand-blue-900
          backgroundImage:
            'repeating-linear-gradient(to bottom, transparent 0, transparent 39px, rgba(60,176,67,0.07) 39px, rgba(60,176,67,0.07) 40px)',
          padding: '84px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 9999,
              backgroundColor: '#56BC65', // brand-400
              display: 'flex',
            }}
          />
          <span
            style={{
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: 4,
              textTransform: 'uppercase',
              color: '#7CCC89', // brand-300
            }}
          >
            Kitabu Yetu
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 40 }}>
          <span style={{ fontSize: 78, fontWeight: 300, color: '#FFFFFF', lineHeight: 1.05 }}>
            Simple books.
          </span>
          <span
            style={{
              fontSize: 78,
              fontWeight: 500,
              fontStyle: 'italic',
              color: '#56BC65', // brand-400
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
      </div>
    ),
    { ...size },
  );
}
