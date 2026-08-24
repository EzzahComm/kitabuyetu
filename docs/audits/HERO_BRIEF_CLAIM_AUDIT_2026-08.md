# Hero Brief — Claim Audit

**Date:** 2026-08-25 · **Method:** 8 source-grounded verification agents + 2 adversarial refutation passes over the highest-stakes clusters · **Subject:** the photography-led, two-audience hero brief

Every factual claim in the hero brief was checked against code, schema, migrations and services before any of it became marketing copy. Verdicts below are grounded in file paths, not intent.

> **Headline:** the brief's two named leading differentiators — *project tracking* and *investment tracking* — cannot both be published. One does not exist at all; the other is record-only. Its trust-strip custody sentence is false and regulatory. Its audience-matched CTA requirement is unsatisfiable without new pages.

---

## 1. Build-blocking issues, most severe first

### 1.1 The trust-strip custody sentence is false — do not publish

> ~~"Kitabu Yetu records and instructs — your group's money moves directly between your members and your own M-Pesa or bank accounts. Kitabu Yetu never holds group funds."~~

There is **one platform-wide M-Pesa paybill** (`MPESA_SHORTCODE`, production, shortcode 4044141) that every group's members pay into. `initiateStkPush` sends `BusinessShortCode: SHORTCODE` / `PartyB: SHORTCODE` and `StkPushInput` (`daraja.service.ts:263-268`) takes **no group or shortcode parameter** — there is nowhere to put one. No per-group M-Pesa account exists in the schema: `groups.mpesa_paybill_prefix` (migration 047) is a BillRef *string* defaulting to `'KYT-'`, and `group_bank_accounts` (migration 129) is a sweep *destination*.

The codebase states it outright at `accounting.service.ts:755-762`:

> "All groups share one M-Pesa shortcode, so the correct comparison is platform-wide: SUM of every group's '1001 Cash and M-Pesa' GL account against the one real Daraja Working+Utility balance — not a per-group comparison, since no single group's ledger represents the whole paybill."

A single real-money account whose balance equals the sum of many parties' ledger claims is a pooled omnibus custodial account. Per-group `accounts` code `1001` rows are its sub-ledger and gate real payouts (`settlements.service.ts:72-84`).

**Sharpest disproof:** unrouted payments. `mpesa-c2b.service.ts:208-224` writes an `mpesa_unrouted` row when inbound money cannot be attributed — the cash is already in Kitabu's paybill and stays there. `resolveUnrouted()` (`mpesa-unrouted.service.ts:46-129`) inserts a contribution and posts a journal: **zero Daraja calls, no transfer**. KES 15,631 is sitting in that queue live.

The existence of the settlement-sweep feature is itself proof — you do not build a sweep for money you never held.

**Two code comments are factually wrong** and are the likely origin of the brief's claim: `settlements.service.ts:88-89` and migration 134's header both assert B2B PartyA is "always the group's own shortcode". `initiateB2B` (`daraja.service.ts:533-560`) hardcodes the platform `SHORTCODE`, and no group-shortcode column exists to supply one. **Reword to say "planned", do not delete.**

**Safe framing:** "your group's books stay yours", "every shilling is tracked to a member". Never a custody claim.

*Caveat: the adversarial refutation of this cluster did not run (session limit). The verdict is single-source, but the project-tracking refuter independently reached the same conclusion from different files.*

### 1.2 Project tracking (Audience 01 anchor) does not exist

Repo-wide, "project" hits **twice**: a comment about projecting a QR code, and marketing prose on the `/fundraise` coming-soon page. No table under any name across 168 migrations; no route among 21 dashboard route dirs; no sidebar entry.

| Brief noun | Verdict | Reality |
|---|---|---|
| budgets | FALSE | Only `funding_programs.budget` (migration 055), whose own COMMENT calls it "a SPENDING AUTHORITY, not a cash balance". Behind an `aud:'backoffice'` token, org-scoped RLS, and org creation is `withPlatformRole(req, 'super_admin')`. A group cannot reach it by any path. |
| funds raised | FALSE | The only `target_amount` in the entire schema is `member_goals` (migration 103), whose header says it is "deliberately a PERSONAL TRACKING TOOL, not tied to real money movement… no officer visibility", self-only RLS. |
| spend vs budget | **FALSE** *(overturned from PARTIAL)* | Funder-side only, and further gated by `assertReportsAccess` → `advancedReports`, false on the starter org plan. The subject ("projects") does not exist, so the claim cannot be partly true. |
| milestone status | FALSE | Zero milestone tables/columns/enums. One free-text placeholder at `enterprise/funding/page.tsx:852`. |

**"Grant & donor governance" — overturned PARTIAL → FALSE** for Audience 01. The group side is one read-only GET (`treasury/external-funding`, no POST/PATCH/DELETE) rendering a receipt list. A group **cannot record a grant from any donor not already an organization on the platform**: `external_grant` is a legal `source_type` (migration 115) with no service function, no API route, no UI — the only production INSERT hardcodes `'organization_allocation'`.

### 1.3 Investment tracking (Audience 02 anchor) is record-only

Real tables, RLS, permissions, service, three API routes, sidebar entry, feature flag on for everyone. But `app/(dashboard)/investments/` contains **only `page.tsx`** — no detail page — and `useInvestment`, `useUpdateInvestment`, `useRecordInvestmentReturn` have **zero consumers** repo-wide.

| Brief claim | Verdict |
|---|---|
| current valuation tracked | **FALSE** *(overturned from PARTIAL)* — no UI writer; `current_value` is always NULL for a customer |
| returns tracked | **FALSE** *(overturned from PARTIAL)* — the only writer is one API route with no caller; "Returns Earned" is permanently KES 0 |
| per-member proportional stake | FALSE — `member_investment_shares` has **zero writers**; migration 072b's header admits the history "never actually reached a working state" for it. No percentage is computed anywhere in the codebase |
| asset classes | PARTIAL — land/shares/money_market/treasury_bills/business are real enum values. **"Rental property" is not** (nearest `real_estate`). Type is a label only; nothing branches on it, and the page exposes no asset-class filter |

**Publishable:** "record your group's investments in one place." **Not publishable:** "track", "monitor", "returns", "ROI", "what your portfolio is worth", or anything about a member's share.

### 1.4 Audience-matched CTAs are unsatisfiable

The brief's acceptance criterion "both panel CTAs route to distinct, audience-matched destinations" **cannot be met**. Nothing in this codebase segments community-groups/VSLAs from modern chamas:

- No `vsla` member of `group_type` (chama, sacco, welfare, investment, ngo_group, self_help_group, cbo, society, cooperative, faith_based, other).
- Repo-wide grep for `vsla|village savings|savings group` hits only two test fixtures and a placeholder.
- `components/landing/personas.tsx` and the redesign's `ROLE_CARDS` both segment by **role**, not audience.
- `/bookkeeper` and `/chama-reminder` address the *same* audience — that is a **product** split.

As things stand both panels land on `/register` — same page, same form, same copy.

**Options:** build `/for-community-groups` and `/for-chamas`, or rewrite the criterion to *product*-matched (`/bookkeeper` vs `/chama-reminder`). The latter is honest and needs no new pages, but it must be stated as a reinterpretation.

### 1.5 Photography is a procurement blocker, not an engineering one

`git rev-list --all --objects` across **all branches and all history** returns exactly 12 image files — every one a PNG logo/icon/placeholder. **No photograph has ever been committed to this repository.** `public/screenshots/dashboard.png` is confirmed a 1280×720 flat solid-blue rectangle.

The brief needs three licensed photographs and forbids AI-generated people. Nothing in the codebase can close that gap.

**Not a gap — do not spend budget here:** AVIF+WebP is already configured (`next.config.js:17-23`, AVIF first) and Next's optimizer negotiates format from the Accept header. Commit high-quality source JPEG/PNG and let `/_next/image` emit AVIF; hand-authoring `.avif` or `<picture>` markup would bypass the optimizer.

**Hard constraint:** CSP at `next.config.js:61` is `img-src 'self' data: blob:`. Photos **must** be committed to `public/` and served same-origin — a stock-library hotlink is blocked at the browser regardless of `remotePatterns` (which only whitelists Supabase).

### 1.6 The DPA 2019 compliance marker is false

**There is no Privacy Policy page and no Terms page anywhere in `app/`** — not unlinked, non-existent. The redesign's omission of those links was correct, not an oversight. No ODPC reference, no consent capture, no retention/purge job, no subject-access or erasure endpoint. The only four data-protection strings in the repo are in its own audit documents, all saying it is *not* compliant. The SMS audit dated 2026-08-20 records as an open P1 that a member replying STOP has no effect — no inbound SMS route exists.

What *does* exist is real but is access control, not compliance: role-based PII masking (`lib/utils/mask.ts`), officer-driven SMS opt-out, email suppression, immutable `audit_logs`. Those could support a weaker truthful marker — "role-based PII masking and audit logging" — but not a compliance badge.

**Drop this marker until a privacy policy exists and ODPC registration is real.**

### 1.7 Credit marketplace and micro-insurance are fabricated

Both FALSE, exhaustively. Their only appearance in the repo is `components/landing/ecosystem.tsx` — **the file the redesign deletes.** The brief has harvested its product list from the very component that was removed for being unbacked. Reintroducing them would undo a deliberate correction.

Two decoys not to be fooled by: a table literally named `policies` is the Configuration Service policy-resolution engine (migration 086), nothing to do with insurance; and `insurance` is one CHECK value in `funding_programs.program_type` — a dropdown label an NGO can pick, not a feature.

A credit **score** exists and is not a marketplace: eight *internal* signals, tenant-scoped, and **no organization/admin service reads `credit_scores`** — no lender can see it even in principle. The old copy's "verified M-Pesa history" was also false; no M-Pesa signal feeds the score.

---

## 2. What the trust strip may honestly say

| Marker | Verdict | Notes |
|---|---|---|
| M-Pesa / Safaricom Daraja integration | **TRUE** | Production-grade: 23 route files, 3,045 lines of service, Redis-cached OAuth, backoff retry, constant-time callback token check, `UNIQUE(mpesa_receipt_number)` idempotency, DLQ replay. Pointed at production. Two caveats: IP allow-listing is **advisory only** (`assertSafaricomIp` logs and processes anyway) so do not claim "IP-whitelisted callbacks"; and airtime throws `NotImplementedError` — do not market it. |
| Double-entry accounting | **TRUE** | Genuinely double-entry, and balance is enforced by a **DEFERRABLE constraint trigger at COMMIT** (migration 027), not just app code — a developer cannot write an unbalanced posted entry even bypassing the service layer. |
| Ledger is append-only / immutable | **PARTIAL — do not publish** | No immutability trigger on `journal_entries`/`journal_lines`, though the exact pattern *is* applied to `audit_logs`, `share_transactions`, `sms_trigger_executions`. Headers mutate (draft→posted→void); `journal_lines` cascades on delete; the balance trigger is AFTER INSERT only. Append-only **by convention in application code**, not enforced. Publish "double-entry", not "immutable". |
| Kenya DPA 2019 compliance | **FALSE** | See §1.6. |

---

## 3. Honest anchor capabilities

The brief's structure — two audiences, each led by a capability that earns the click — is sound. The anchors were chosen from aspiration. Replacements drawn only from what verifiably exists:

**Audience 01 (moving from paper):** M-Pesa collections reconciled into the books. It is the deepest, most production-proven thing in the product, and it is exactly the pain of a paper-based group. Supporting: member statements, automated contribution splitting, receipts.

**Audience 02 (already digital):** **share capital and dividends.** `share_classes` / `share_transactions` / `share_holdings` is a real ledger with a trigger maintaining per-member holdings, a full `/shares` UI (holdings, ledger, top-holders), per-member quantity + total invested + current value + appreciation, and PDF certificates. `computeAllocations` does genuine proportional distribution. It answers "what is my share worth" — the question the brief wanted investment tracking to answer — and it actually works.

Note `/shares` never renders a *percentage*; it shows KES amounts. Copy accordingly.

---

## 4. Build context for whoever writes the hero

- **Branch:** `redesign/public-marketing-site`. Check it out first — every audit agent found the tree on a different branch and had to read blobs via `git show`.
- **Design language ("the ledger"):** paper ground `#FBFAF5`, Fraunces display + DM Mono figures, hairline rules, no shadow-cards. Extend it; do not replace it.
- **Fonts:** three families load via `next/font/google` in the **root** layout (Inter, Fraunces variable w/ opsz+SOFT axes, DM Mono), all self-hosted, all preloaded on **every** route. The hero `<h1>` in Fraunces is the current LCP element and competes with any hero photograph.
- **LCP hazard:** `hero.tsx` wraps the product column in `motion-safe:animate-fade-up` with `animationDelay: 120ms` and fill-mode `both` — an element there paints at opacity 0 for 120ms then fades 600ms. A photograph dropped into that column defers LCP by up to ~720ms. Exempt the photo or drop the delay.
- **No `next/image` pattern to copy:** only 3 call sites repo-wide, 2 of them `unoptimized`. `fill` is used zero times; responsive `sizes` zero times; `placeholder="blur"` zero times; `aspect-*` once (a Radix avatar). You are establishing the pattern, not following one.
- **Config filename is `next.config.js`**, not `.ts`. Editing "next.config.ts" would create a second conflicting file.
- **The floating stat card does not exist as a component** — extract from `DashboardMockup`/`MemberPhoneMockup` or write it.
- **CTA destinations:** `Get Started` → `/register` (real, public, `register_group()` RPC — but leads to signup → verification → **payment**, not a working dashboard). `Explore Products` → `/ecosystem` (real but modest: 97 lines, three cards, one "Coming soon"). The current hero's secondary is an in-page `#how-it-works` anchor, so `/ecosystem` is **new wiring**, not existing behaviour. Link `/register` only — never `/groups/new` (authenticated).
- **13 safe public routes:** `/`, `/pricing`, `/bookkeeper`, `/chama-reminder`, `/fundraise`, `/ecosystem`, `/about`, `/contact`, `/support`, `/docs`, `/status`, `/login`, `/register` (+`?product=chama_reminder`). **Never link:** `/design-system`, `/unauthorized`, `/admin-login`, `/enterprise/login`. **Not landing pages** (bounce anonymous visitors to login): `/me`, `/enterprise`, `/admin` — yet the redesign's footer currently links all three.

---

## 5. Defects surfaced along the way

1. **Meeting resolutions can never be recorded or completed.** `meeting_resolutions` (migration 023) has `implementation_deadline`, `responsible_party`, `implemented`, `implemented_at` — but `useAddResolution` has **zero callers**, there is no meeting detail page, and **no UPDATE statement against the table exists anywhere**. So `meetings/page.tsx` will always render "0 resolutions" and "0 implemented" while line 127 advertises "Schedule, record minutes, and track resolutions."
2. **The investments summary fix (`cb36bc6`) trades one wrong number for another.** Because `current_value` still has no UI writer and now COALESCEs to `principal_amount`, the "Current Portfolio Value" card is **mathematically identical** to "Total Principal", and Overall ROI is a structural constant **0.0% forever**. The old −100% looked broken; 0.0% looks like a real answer. The column headed "Current Value" now shows the purchase price with only a hover title disclosing it. **Recommended follow-up:** render "—" / "not revalued" instead of a fabricated-looking 0.0%, and only show ROI once a revaluation or return exists.
3. **The PWA install prompt shows a blank blue rectangle** as the app preview (`app/manifest.ts:66` → the placeholder screenshot).
4. **The home page ships a `summary_large_image` Twitter card with no image.** `app/page.tsx` declares `openGraph`/`twitter` without an `images` key; Next merges metadata shallowly, so the parent's `/icons/icon-512.png` is replaced, not inherited. No `opengraph-image.tsx` exists on either branch. Budget a 1200×630 card as a fourth asset.
5. **`/status` is hardcoded** "All systems operational" — not a live probe.

---

## 6. Not determined

- **Refutation of the custody and ecosystem-products clusters never ran** (session limit). Those verdicts are single-source, though custody was independently corroborated by the project-tracking refuter.
- **No visual verification of anything.** No agent, and no one in this session, has viewed the redesigned marketing site rendered in a browser at any breakpoint.
- **Exact wording of the three trust markers as written in `components/marketing/`** was read via `git show`, not from a checked-out tree.
