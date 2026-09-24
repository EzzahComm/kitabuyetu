# Kitabu Yetu — Landing Page & Public Website Optimization Audit

**Date:** 2026-09-24
**Scope:** All 27 public marketing/landing pages under `app/` (home, about+team+impact, bookkeeper, chama-reminder, fundraise+[slug], enterprise-solutions, ecosystem+donors+marketplace[+[id]]+organizations+programs[+[slug]], how-it-works, pricing, products, resources+[slug], careers+[slug], docs, support, contact, status, legal/privacy/terms/data-protection).
**Method:** Source-grounded — 2 parallel research passes (SEO/accessibility inventory; client-component/image/dependency audit) plus direct verification of the app-wide `Providers` wrapper, a fresh production build, and `.next` build-manifest inspection. No live-browser/Lighthouse run performed this pass (not available in this session) — sizes below are measured from build artifacts, not a synthetic Lighthouse score.
**This is NOT a rebuild of the 2026-09-17 content-completeness audit** ([[kitabu_yetu_public_website_ui_spec]]) — that one confirmed ~80-85% spec match and closed the homepage's two biggest content gaps (commit `1b19cd5`). This pass covers SEO metadata, structured data, performance/bundle weight, and visual/design consistency — dimensions that audit didn't cover in depth.

---

## Executive summary

The content and information architecture of the public site is in good shape (confirmed by the prior spec audit and re-confirmed here: clean single-h1 hierarchy on all 27 pages, no broken/placeholder links, forms properly labeled, no icon-only buttons, status indicators pair color with text). The gaps found this pass are concentrated in three areas, all fixable without new product work:

1. **Social-share metadata is wrong on two-thirds of the site** — real, verifiable, cheap to fix.
2. **A handful of real performance/consistency bugs**, the most valuable being a homepage LCP image misconfiguration and a header/footer container-width mismatch on 7 pages.
3. **Thin structured data and sitemap gaps** that reduce how well search engines and AI answer surfaces understand and index the site.

No critical/blocking issues. Nothing here requires new backend work — every fix is frontend-only.

---

## Implementation status (same day)

Priorities 1–4 were implemented and verified against a local production build with Playwright (8 pages × 1440/1100/390px, before = production, after = local build). Priority 5 and three Priority 4 items remain open (listed at the end of this section).

### Done

- **P1 metadata:** `marketingMetadata()` on every marketing page, and each page now has its own title, description, canonical and OG/Twitter card, with the branded image as fallback. Privacy and Terms stay **indexable**: commit `97bf25a` deliberately removed their noindex, and the sitemap comment claiming otherwise was stale. Both now have descriptions and sitemap entries. `legal/data-protection` is still a noindex placeholder.
- **P2 LCP:** hero image uses `preload` + `fetchPriority="high"` (`priority` is deprecated in Next 16 and never set fetchPriority). Both `AnimatePresence` wrappers use `initial={false}`, so the first slide is server-rendered visible instead of sitting at opacity 0 until JS loads.
- **P2 container:** body content was inset from the header by 40px (1440), 46px (1100) and 12px (390) on 7 pages. It now lines up exactly on all 8 measured pages at all 3 widths.
- **P2 font — worse than reported:** Fraunces was not missing on 5 pages. It was **missing everywhere**. Since `eea9003` (2026-09-09), `font-display` resolved to `var(--font-display)`, a custom property that is never defined, which invalidates the whole declaration. Every wordmark and display heading has rendered in Inter since then. Fixed in `tailwind.config.ts`, and `fraunces.variable` was added on the 5 pages that lacked it.
- **P3:** Organization + WebSite JSON-LD added on the homepage. It goes there rather than in the layout, which also wraps authenticated routes. There is no SearchAction because the site has no search. FAQPage markup was added on pricing and support, but Google retired FAQ rich results for most sites in 2023, so this only helps generic schema understanding and will not produce snippets. The sitemap gained `fundraise/[slug]` and `ecosystem/marketplace/[id]`. `ecosystem/programs/[slug]` duplicates the fundraise page and now canonicalizes to it. The sitemap is `force-dynamic`, each DB source has a 5s timeout, and a failing source is logged and omitted rather than failing the whole sitemap (verified locally with no DB). `robots.txt` pointed its sitemap URL at `kitabuyetu.vercel.app`; it now uses the real domain.
- **P4:** real alts on the campaign and blog **detail-page** covers. The listing-card covers on `/fundraise` and `/resources` deliberately keep `alt=""`: each sits inside a card link that already contains the title, so an alt would make screen readers read the title twice. `Benefits` now requires `imageAlt`, and the 10 data objects have one. The 4 hero alts described the wrong photos and have been rewritten. Blog images moved from raw `<img>` to `next/image` with dimensions parsed from the Sanity asset ID.

### New findings while implementing

- **Homepage nav invisible at the top of the page since `9bfbf23` (2026-09-11).** The homepage used `SiteHeader variant="overlay"` (white text) over a light hero, so the logo text and all nav links were white-on-cream until the visitor scrolled. It is now `solid`, as the component's own doc comment requires for any page without a dark hero.
- **Desktop nav overflowed from 1024px to 1279px.** The seven items need about 700px, so "How it works" wrapped onto three lines and "Get started" was pushed up to 95px off-screen at 1024px. The desktop nav now starts at `xl` (1280px), with the hamburger sheet below that.
- **Nav dropdowns open on hover** for mouse users, as the product requires; click, touch, keyboard and Escape still work.
- **Blog images were blocked in production by CSP.** `img-src 'self' data: blob:` does not allow `cdn.sanity.io`, so raw `<img>` Sanity images could never load. `next/image` serves them from `/_next/image`, which is same-origin.
- **Sibling dynamic segments** `app/api/v1/campaigns/[slug]/donate` and `.../[id]` made local `next start` return 500 on **every** route (Vercel was unaffected). The donate route moved to `[id]`, and it still receives the slug.
- **`components/Container.tsx` `py-12`/`py-16` were dead classes.** Tailwind emits `.py-8` after them, so they never applied. The trailing `py-8` is kept so current spacing does not shift.
- **Hero photography is generic Western stock imagery,** while the spec calls for Kenyan community imagery. This is a content decision and was not changed.

**Still open:** Priority 5 (Providers split), consolidating the two icon libraries, removing framer-motion from the homepage hero, and the orphaned `reveal.tsx`.

---

## Priority 1 — Social-share metadata (18 of 27 pages)

**The bug:** Next.js metadata resolution replaces the parent's `openGraph`/`twitter` object key-by-key, it does not deep-merge. Any page that exports `title`/`description` but no `openGraph`/`twitter` key silently inherits the **entire** root layout object verbatim (`app/layout.tsx:87-99`) — meaning a share of `/bookkeeper` or `/ecosystem` on WhatsApp, Twitter, or LinkedIn shows the generic homepage title, description, and logo, not that page's own content.

**Affected:** `about` (+`/team`,`/impact`), `bookkeeper`, `careers`, `chama-reminder`, `contact`, `ecosystem` (+`donors`,`marketplace`,`marketplace/[id]`,`organizations`,`programs`,`programs/[slug]`), `how-it-works`, `products`, `resources`, `status`, `pricing` (has canonical, missing OG/Twitter), `fundraise/[slug]` (has OG/Twitter, missing canonical).

**The fix already exists in the codebase** — `app/enterprise-solutions/page.tsx:17-22` has a code comment explicitly documenting and fixing this exact bug. `docs`, `fundraise`, `support`, `careers/[slug]`, and `resources/[slug]` show the correct pattern. This is a template-copy fix across ~18 files: add explicit `openGraph`/`twitter`/`alternates.canonical` to each page's own `metadata` export, using that page's real title/description rather than the inherited generic one.

**Effort:** Low (mechanical, one pattern, ~18 files). **Impact:** High — every social share and every search-result snippet for these pages is currently wrong.

> **Correction found while implementing (same day):** the `enterprise-solutions` pattern is only half the fix. A page that sets its own `openGraph` object also drops the root layout's `images`, and `app/opengraph-image.tsx` attaches **only to `/`** — it is not inherited by other routes. Verified in built HTML: `enterprise-solutions`, `docs` and `support` (the "correct" pages) all shipped with **no `og:image` at all**, and copying their pattern to the other pages would have traded a generic logo preview for an image-less one. Implemented instead as a shared helper, `components/marketing/page-metadata.ts` (`marketingMetadata()`), which sets title, description, canonical and image together (falling back to the branded `/opengraph-image` card, `summary_large_image`), used by every marketing page.

**Also in this bucket:** `legal/privacy/page.tsx` and `legal/terms/page.tsx` export `title` only, no `description` at all. `app/sitemap.ts` comments that legal pages are excluded because "each sets `robots: { index: false }`" — but only `legal/data-protection/page.tsx` actually does. Privacy and Terms hold real, dated, indexable policy content with no noindex tag, yet are invisible to search engines (excluded from the sitemap, no canonical). Either genuinely noindex them (defensible for legal boilerplate) or add them to the sitemap with real metadata — the current state (silently absent, no explicit decision encoded) is the one bad option.

---

## Priority 2 — Homepage LCP image + container-width inconsistency

**Homepage hero image uses `loading="eager"` instead of Next's `priority` prop** (`components/Hero.tsx:169`). This is the Largest Contentful Paint element on the single highest-traffic page on the site, and it's the _only_ full-bleed hero image across all 27 pages misconfigured this way — every other image on the surface (including the `resources/[slug]` and `fundraise/[slug]` detail-page covers) correctly uses `priority`. `loading="eager"` alone does not add `fetchPriority="high"` or the `<link rel="preload">` that `priority` adds — so the homepage's own LCP image is currently the worst-optimized image on the site. **One-line fix, direct Core Web Vitals impact on the page that matters most.**

**Header/footer chrome doesn't share a container definition with page body on 7 of 28 pages.** Two `Container` components are live simultaneously: the newer `components/marketing/primitives.tsx` one (`max-w-[82rem]`, used by `SiteHeader`/`SiteFooter` on every page) and the older `components/Container.tsx` (Tailwind `.container` utility, different breakpoint padding). 18 pages use the shared `PageShell` wrapper (consistent). 11 hand-roll their own `<SiteHeader/><main>…</main><SiteFooter/>` — of those, 7 (`page.tsx`, `about`, `bookkeeper`, `careers`, `careers/[slug]`, `chama-reminder`, `ecosystem`) import the _older_ `Container.tsx` for body content while header/footer on the same page use the _newer_ one. Net effect: on those 7 pages, the page content is a visibly different width than the header/footer bar above and below it. This is a real, visible design-consistency bug, not just a code-hygiene note — worth a screenshot check before fixing. **Fix:** migrate those 7 pages onto `PageShell` (matches the other 18), or at minimum swap their body `Container` import to `primitives.tsx`'s version.

**Fraunces (brand display serif) missing on 5 pages that need it.** `about`, `ecosystem`, `how-it-works`, `careers`, `careers/[slug]` render `SiteHeader`/`SiteFooter` — both of which style the "Kitabu Yetu" wordmark with `font-display` — but these 5 pages roll a custom wrapper that never applies `fraunces.variable`. Result: the brand wordmark silently falls back to Georgia/serif on these 5 pages while rendering correctly on the other 23. Same root cause as the container-width issue (these are the pages that skip `PageShell`), so likely a one-pass fix alongside it.

**Effort:** Low-Medium (image fix is one line; container/font fix touches 5-7 files but is a known-good pattern-copy from `PageShell`). **Impact:** Medium-High — LCP directly affects Core Web Vitals/SEO ranking and perceived speed; the container/font inconsistency is a visible brand-polish issue a visitor would notice.

---

## Priority 3 — Structured data & sitemap completeness

- **Only 2 of 27 pages carry JSON-LD** (`careers/[slug]` → JobPosting, `resources/[slug]` → BlogPosting). No sitewide `Organization`/`WebSite` schema exists anywhere (checked `app/layout.tsx` — none). Adding an `Organization` schema (name, logo, sameAs social links) to the root layout and a `WebSite` schema with `SearchAction` are both cheap, sitewide, and directly help how Google/AI answer engines represent the brand.
- **No `FAQPage` schema** despite real, substantial FAQ content already on `pricing/page.tsx:164-197` and `support/page.tsx:29-98` (both use plain `<dl>` markup). This is a genuine missed opportunity for rich-result FAQ snippets in search — the content exists, it's just not marked up.
- **`app/sitemap.ts` fetches dynamic entries for `resources/[slug]` and `careers/[slug]` but never for `fundraise/[slug]`, `ecosystem/marketplace/[id]`, or `ecosystem/programs/[slug]`** — three real, indexable, dynamic-route page types are entirely invisible to search engines. Same fetch-and-map pattern already proven for the other two; straightforward to extend.

**Effort:** Low-Medium. **Impact:** Medium — compounds over time (search visibility), not an urgent fix, but cheap enough to bundle with the Priority 1 work since it touches the same files/pattern.

---

## Priority 4 — Minor content/UX cleanup

- **5 content images use `alt=""`** (marked decorative) when they're real photos that should describe their content: `fundraise/page.tsx:73`, `fundraise/[slug]/page.tsx:46`, `resources/page.tsx:53`, `resources/[slug]/page.tsx:92,112` (campaign covers, blog covers/inline images).
- **`components/Benefits.tsx:39` uses the section heading as `alt` text** (e.g., "Manage your money with confidence") rather than describing the actual photo — affects the Benefits image on `page.tsx`, `bookkeeper`, `chama-reminder`, `ecosystem`, `how-it-works` (5 pages, 1 shared component, one fix).
- **Blog body images use raw `<img>`** (`resources/[slug]/page.tsx:92`, Sanity portable-text content) with no `width`/`height`/`aspect-ratio` — real CLS risk for every inline image inside a blog post, and bypasses `next/image`'s automatic resizing/format conversion. Worth a portable-text image-block override once resources content volume grows.
- **Two parallel icon libraries** (`lucide-react` and `@tabler/icons-react`) both actively used across the marketing surface, split roughly evenly by page. Both use tree-shakeable named imports so the per-page cost is small, but standardizing on one avoids shipping two icon systems' worth of SVG/JS to the same page when both appear together (e.g., `site-header.tsx` uses lucide while `WhoItsFor.tsx`/`ProblemSolution.tsx` on the same homepage use Tabler).
- **`components/marketing/reveal.tsx`** — a well-built IntersectionObserver scroll-reveal component (its own doc comment says it replaced 12 files' worth of framer-motion `whileInView` calls) — **has zero current importers** anywhere in `app/` or `components/`. Either it was superseded and never removed, or it's mid-rollout and got dropped. Worth a quick check before the next cleanup pass touches it.
- **`Hero.tsx` statically imports framer-motion** for the homepage's 4-message crossfade via `LazyMotion`/`domAnimation` — but since the import is static, not dynamic, `LazyMotion`'s code-splitting benefit doesn't apply here; the animation core ships in the homepage's initial JS regardless of the `LazyMotion` wrapper. A CSS-only crossfade (or reusing the now-orphaned `reveal.tsx` pattern) would remove framer-motion from the homepage's critical path entirely.

**Effort:** Low, all independent one-file fixes. **Impact:** Low-Medium, mostly polish.

---

## Priority 5 — Known, already-scoped, not re-litigated here

These were found and deliberately deferred in a prior audit (`docs/audits/optimization-2026-09/verified/frontend-performance-and-bundle-weight-n.json`, finding #5) — **confirmed still true this pass**, included for completeness since it's the single largest lever on this list, not because it's a new finding:

- **`app/layout.tsx` wraps every route — all 27 marketing pages included — in `providers/index.tsx`**, a client component mounting React Query's `QueryClientProvider`, `AuthProvider` (reads `localStorage` on mount, no network call — so the cost is bundle weight and hydration, not a blocking request), `ThemeProvider`, and `Toaster`, none of which a marketing visitor who never logs in actually needs. Measured this pass: **~430KB of uncompressed JS in the root-shared chunks loaded on every route** (`static/chunks/{1edfvwc5_eck-,0if-vqkhyn-zc,0-_5q-bedv_lk,1vgpv7vwitdbl,turbopack-2te8aw8vmunkw}.js`) — this figure includes the unavoidable React/Next.js runtime plus the avoidable Providers stack combined; no bundle analyzer is wired up in this repo to cleanly isolate the Providers' own share, so treat it as an upper bound on the opportunity, not the fix's guaranteed savings.
- The prior audit's own assessment stands: fixing this requires splitting each of the 5 authenticated route-group layouts (`(dashboard)`, `(admin)`, `(member)`, `(enterprise)`, `(reminder)`) into a server-component wrapper + a renamed client-component inner (each currently calls `useAuth()` directly in its top-level body, which is incompatible with moving the provider below it), plus adding `<Providers>` to `(auth)`'s layout separately. A real, moderate-effort refactor across 5 critical auth-guarding files — worth its own careful pass with real testing, not a drive-by fix bundled into a landing-page audit.

---

## Suggested order of work

1. **Priority 1** (social-share metadata, ~18 files, one proven pattern to copy) + the legal-pages description/sitemap decision — cheapest, highest-visibility fix, bundle together.
2. **Priority 2's image fix** (`Hero.tsx:169`, one line) — do immediately, zero risk.
3. **Priority 2's container/font fix** (7 pages → `PageShell`) — screenshot before/after given it's a visible layout change.
4. **Priority 3** (Organization/WebSite/FAQPage JSON-LD + 3 missing sitemap entries) — bundle with #1 since it's the same metadata files.
5. **Priority 4** — opportunistic, no urgency, good "while you're in the file" cleanup.
6. **Priority 5** (Providers split) — separate, larger initiative; sequence whenever there's room for a dedicated pass with real auth-flow testing across all 5 portals.

---

## What's already good (don't re-litigate)

- Clean single-`<h1>` hierarchy on all 27 pages.
- No broken or placeholder (`href="#"`) links anywhere on the surface.
- Forms properly labeled throughout; no icon-only buttons without accessible text; status indicators pair color with text.
- `app/opengraph-image.tsx` — a properly engineered dynamic 1200×630 OG image generator, already fixed a real metadata-merge bug from a prior audit (`HERO_BRIEF_CLAIM_AUDIT_2026-08.md` §5). Note: it attaches only to `/` on its own — other pages reference it explicitly via `marketingMetadata()` (see the Priority 1 correction).
- `app/robots.ts` correctly allows all 27 marketing paths, disallows only authenticated/admin prefixes.
- Client-component boundaries are well-scoped sitewide — every `page.tsx` is a server component; the only client leaves are individually justified (hero rotator, header dropdown/mobile-menu, video play-toggle, forms).
- Favicon/PWA icons — a gap noted 9 days ago (not tracked in git) — confirmed resolved; all now tracked.
