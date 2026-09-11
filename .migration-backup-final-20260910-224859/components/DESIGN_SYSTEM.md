# Kitabu Yetu — Design System

The shared visual language for every portal: Super Admin, Backoffice, B2B Enterprise,
VSLA/Group Admin, and Member self-service. Build screens by composing these primitives —
don't re-style from scratch.

**Live reference:** run the app and open [`/design-system`](../app/design-system/page.tsx) to see
every token and component rendered.

---

## Brand

Derived from the Kitabu Yetu logo — **green + navy**, with orange reserved for alerts/actions.

| Role | Token | Hex |
|------|-------|-----|
| Primary / CTAs / positive | `brand-500` / `--primary` | `#3CB043` |
| Headings, sidebar, nav | `brand-blue-500` | `#0B3C88` |
| Accent / hover tint | `brand-50` / `--accent` | `#EAF7EC` |
| Neutral surface | `brand-neutral` | `#F8FAFC` |
| Alert / action accent | `brandOrange` (tokens.ts) | `#F97316` |

- **CSS / Tailwind components** use the HSL tokens in [`app/globals.css`](../app/globals.css)
  (`bg-primary`, `text-muted-foreground`, `border-border`, …) and the `brand` / `brand-blue`
  palettes in [`tailwind.config.ts`](../tailwind.config.ts).
- **JS consumers** (charts, status logic, email/PDF) use [`lib/ui/tokens.ts`](../lib/ui/tokens.ts)
  and [`lib/brand.ts`](../lib/brand.ts). Keep all three in sync — never introduce loose hex.

## Typography

Inter (`font-sans`) for UI · Fraunces (`font-display`) for marketing · DM Mono (`font-mono`)
for figures. Money values use the `.money` utility (tabular figures) so columns align.

## Design tokens — `lib/ui/tokens.ts`

| Export | Purpose |
|--------|---------|
| `brandGreen` / `brandNavy` / `brandOrange` | Hex palettes mirroring Tailwind |
| `tone` / `Tone` | Semantic financial tones (`positive`, `negative`, `warning`, `info`, `pending`, `neutral`) with `solid`/`fg`/`bg`/`border` |
| `STATUS_TONE` + `statusTone(status)` | Map a domain status string → a tone (loans, M-Pesa, KYC, billing…) |
| `chartPalette` / `chartTheme` | Ordered series colours + axis/grid styling for Recharts |
| `spacing` / `breakpoints` / `radius` / `zIndex` / `motion` | Layout & animation scales for JS-computed UI |

---

## Component library

### Primitives — `components/ui/`
shadcn/ui-based (Radix + cva): `alert`, `avatar`, `badge`, `button`, `card`, `dialog`,
`dropdown-menu`, `input`, `label`, `progress`, `select`, `separator`, `skeleton`, `switch`,
`table`, `tabs`, `textarea`, `toast`/`toaster`, and **`empty-state`** (new).

### Shared composites — `components/shared/`

| Component | Use it for |
|-----------|-----------|
| `PageHeader` | Every screen header — breadcrumbs, title, description, actions slot |
| `StatCard` | KPI / metric tiles with icon + trend |
| `MoneyDisplay` | Inline KES amounts (mono, tabular, colour by sign) |
| `StatusPill` | Financial/lifecycle status — auto-coloured from `statusTone()` |
| `PaginatedTable` | Server-paginated data tables |
| `ConfirmDialog` | Deliberate confirm for destructive/irreversible actions (async-aware) |
| `MoneyActionDialog` | **High-confidence confirmation for money movements** — large amount, itemised summary, trust/warning line |
| `ChartCard` + `TrendChart` / `BarSeriesChart` / `DonutChart` / `Sparkline` | All charts — themed wrappers; never use raw Recharts hex |
| `skeletons` (`StatCardsSkeleton`, `TableSkeleton`, `ListSkeleton`, `ChartSkeleton`, `DashboardSkeleton`) | Loading states matching final layout |

---

## Conventions

- Components live in `components/ui` (primitive) or `components/shared` (domain-aware composite).
- Use cva + `forwardRef` + the `cn()` helper; named exports; match existing file style.
- Money: always `formatKES()` from `lib/utils` and the `.money` / `font-mono tabular-nums` treatment.
- Status: never hardcode a colour — pass the domain string to `StatusPill` / `statusTone()`.
- Dark mode is class-based (`.dark`) and token-driven — new components inherit it for free
  by using semantic tokens (`bg-card`, `text-foreground`) rather than literal colours.
- Mobile-first: design at the smallest breakpoint, enhance upward with `sm:`/`lg:`.

## Accessibility

- Colour is never the only signal — `StatusPill` pairs colour with a label + dot; alerts pair
  colour with an icon + title.
- All interactive elements keep the visible focus ring (`focus-visible:ring-2 ring-ring`).
- Tone `fg`/`bg` pairs in `tokens.ts` target WCAG AA on light surfaces.
- Confirmations for money actions require a deliberate second step and disable dismissal in flight.
