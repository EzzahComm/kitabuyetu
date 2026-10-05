# Kitabu Yetu brand (logo v3)

The brand kit of 2026-10-01: a three-dot group mark above an open book, a green-and-orange wordmark, and a
one-colour uppercase tagline.

## Where the logo lives

| What                                                              | Where                                       |
| ----------------------------------------------------------------- | ------------------------------------------- |
| Geometry, colourways, wordmark, tagline, fonts (source of truth)  | `lib/ui/brand-mark.ts`                      |
| Colour scales (green, orange, app navy)                           | `lib/ui/brand-palette.ts`                   |
| Marketing blue / navy / mist (shared with the kit)                | `lib/ui/finanza-palette.ts`                 |
| Mark only, as inline SVG                                          | `<BrandMark />`, `<BrandLogo />`            |
| Mark + wordmark (+ tagline), horizontal or stacked                | `<BrandLockup />`                           |
| Wordmark only                                                     | `<BrandWordmark />`                         |
| Generated files (favicons, PWA icons, email logo, vector masters) | `public/brand/`, `public/icons/`, `public/` |
| Social card                                                       | `app/opengraph-image.tsx`                   |

Never import a logo image into a component. Use the components above; they render inline SVG and live text, so
nothing extra is downloaded.

## Commands

```bash
npm run brand:assets   # regenerate every logo file from lib/ui/brand-mark.ts
npm run brand:check    # fail if a logo file is stale or a retired brand value is back (runs in CI)
```

To change the logo: edit `lib/ui/brand-mark.ts`, run `npm run brand:assets`, commit the source and the output
together. CI's `brand:check` fails while they disagree.

`brand:check` also rejects the retired brand values: the old raster logo, its green and orange, and the unused
drawings from PR #192. The list, with the reason for each, is `RETIRED` in `scripts/brand/check-brand.ts`.

## The mark

- Three dots: the centre dot is orange (the single highlight); the two side dots are green.
- The open book below: left page brand blue, right page a deeper blue.
- On a 64×64 canvas. App icons draw it at 80% on a rounded tile (radius 14).

## Colourways

Pick the tone for the ground the logo sits on (`tone` prop):

| Tone     | Ground               | Dots (side / centre)  | Book                  | Wordmark "Kitabu" / "Yetu" | Tagline   |
| -------- | -------------------- | --------------------- | --------------------- | -------------------------- | --------- |
| `light`  | white / light        | `#12A06B` / `#E8590C` | `#355EFC` / `#2448D6` | `#0E9462` / `#E8590C`      | `#355EFC` |
| `dark`   | navy `#011A41`, dark | `#2CC98B` / `#FF8A3D` | `#5C80FF` / `#3D63F5` | `#3FD59A` / `#FF8A3D`      | `#8DA6FF` |
| `onBlue` | brand blue `#355EFC` | `#8CF2C6` / `#FFA05C` | white / `#DFE4FD`     | `#8CF2C6` / `#FFC49A`      | white     |

## Type

- Wordmark: **Jost 800**, 1px letter-spacing.
- Tagline: **Open Sans 600**, uppercase, 1.5px letter-spacing, one colour. The tagline is
  "Smart Group-Management Tools" (`BRAND_TAGLINE`).

Both load through `next/font` in `components/branding/brand-fonts.ts`, one weight each, only on routes that render a
lockup.

## Palette (from the kit)

| Role            | Hex       | Share | Token                                       |
| --------------- | --------- | ----- | ------------------------------------------- |
| Blue            | `#355EFC` | 60%   | `finanzaBlue[500]` (marketing `brand-*`)    |
| Green           | `#12A06B` | 30%   | `brandGreen[500]` (app `brand-*`, primary)  |
| Orange (accent) | `#E8590C` | 10%   | `brandOrange[500]`                          |
| Navy            | `#011A41` |       | `finanzaDark.DEFAULT` (footer, theme-color) |
| Mist            | `#DFE4FD` |       | `finanzaBlue[100]`                          |

The marketing site already runs on the kit blue (`[data-marketing-theme]`, see `tailwind.config.ts`); the
authenticated app keeps green as its primary, now the kit green.

## Vector files for outside use

`public/brand/logo-horizontal-{light,dark,on-blue}.svg` are the kit's horizontal lockups for press kits, decks and
documents. Their text pulls Jost / Open Sans from Google Fonts, so it renders exactly only inline or via `<object>`;
convert the text to outlines before sending them to print. `public/brand/mark*.svg` and `app-icon*.svg` have no text
and render anywhere.
