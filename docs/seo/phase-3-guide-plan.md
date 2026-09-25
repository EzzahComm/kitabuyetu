# SEO Phase 3 — Guides in /resources

Imported from the "SEO Phase 3 — Guides" Claude Docs artifact (2026-09-25).
Publishes 10 practical guides in `/resources` over 10 weeks, aimed at the
questions treasurers and founders search before they ever look for an app.
Each guide answers one question fully and ends at the product feature that
solves it.

**Infrastructure correction:** the original plan's "Code tasks" section
assumed guides would ship as MDX files in `content/resources/`. That's not
how `/resources` actually works — it's backed by Sanity CMS
(`app/resources/[slug]/page.tsx` reads from `lib/cms/sanity.ts`, editable in
`kitabuyetu-studio`). All guides ship as Sanity `post` documents
(`category: "guide"`) instead. See "How a guide actually gets published"
below — the old MDX plan is superseded, not just adjusted.

## Target searches (checked 25 September 2026)

Most results are competitor blogs (MyChama, Chamasoft, Digichama) and small
finance sites, with national media on only one query — a well-built guide
can reach page 1. Search Console has no volume data for the site yet;
volumes get confirmed in week 4 from Performance → Queries.

| Search | Who ranks now | Opening |
|---|---|---|
| how to start a chama in Kenya | MyChama (~900 words, April 2026), Business Today, MasiboLaw | Thin, generic steps; nobody shows the money flow or a first-meeting agenda |
| how to register a chama in Kenya | Digichama, Kenyans.co.ke, AMG Advocates | Most pages predate the [September 2026 High Court ruling](https://streamlinefeed.co.ke/news/court-declares-community-groups-registration-act-unconstitutional); none explain what it changes |
| chama constitution template | Money Issues, MyChama, Chamasoft | Templates are Word-style text; none give a downloadable, clause-by-clause version |
| table banking how it works | Chamasoft (2015), Enid Kathambi | Top result is 11 years old; no worked interest example |
| merry-go-round vs investment chama | Daily Nation, Huduma Global | No decision guide for when to switch |
| chama records / chama bookkeeping | Scattered, no clear owner | Strongest fit for Kitabu Yetu's double-entry book, least contested |

**The timely one:** the Community Groups Registration Act 2022 was declared
unconstitutional in September 2026, with a cure period to 10 February 2027.
Chamas are searching for what this means now, and no guide explains it yet.
That guide ships first (and is done — see below).

## Article plan

One guide a week. The first two answer the highest-intent searches; the
rest build the cluster around records, loans and M-Pesa, where Kitabu Yetu
is strongest.

| # | Title (H1) | Slug under `/resources/` | Main search | Ends at | Status |
|---|---|---|---|---|---|
| 1 | How to Register a Chama in Kenya After the 2026 Court Ruling | `register-a-chama-kenya` | how to register a chama in Kenya | `/bookkeeper` | **Published** — `post-register-a-chama-kenya`, 2026-09-25 |
| 2 | How to Start a Chama in Kenya: 8 Steps and a First-Meeting Agenda | `how-to-start-a-chama` | how to start a chama | `/pricing` | Not started |
| 3 | Chama Constitution Template (Free, Editable) | `chama-constitution-template` | chama constitution template | Sign-up | Not started |
| 4 | Chama Records Every Treasurer Must Keep | `chama-records` | chama records, chama bookkeeping | `/bookkeeper` | Not started |
| 5 | Table Banking Explained, With a Worked Interest Example | `table-banking` | table banking | Loan tracking in `/how-it-works` | Not started |
| 6 | How to Collect Chama Contributions by M-Pesa | `collect-chama-contributions-mpesa` | chama paybill, chama M-Pesa | `/how-it-works` | Not started |
| 7 | Chama Loan Policy: Interest, Guarantors and Limits | `chama-loan-policy` | chama loan rules | `/how-it-works` | Not started |
| 8 | How to Handle Chama Defaulters Without Losing Members | `chama-defaulters` | chama fines, defaulters | `/chama-reminder` | Not started |
| 9 | Merry-Go-Round or Investment Chama: When to Switch | `merry-go-round-vs-investment-chama` | merry-go-round vs investment group | `/products` | Not started |
| 10 | Chama Share-Out: How to Calculate Year-End Payouts | `chama-share-out` | chama share-out, dividends | `/bookkeeper` | Not started |

Guide 1 carries a dated legal note: the Act stays in force until
**10 February 2027** unless Parliament re-enacts it. Set a review reminder
for that date and update the guide either way — `reviewedOn` on the Sanity
document tracks this.

## How every guide is built

The same rules for all 10, so each one is indexable, citable by AI search,
and linked into the product.

| Element | Rule |
|---|---|
| Title tag | Main search first, under 60 characters, ends "— Kitabu Yetu" only if it fits |
| Meta description | 140–155 characters; states the answer, not a teaser |
| Opening | First 2 sentences answer the question directly (what Google and ChatGPT quote) |
| Length | 1,200–2,000 words; longer than the current top result, never padded |
| Structure | H2 per step or question; one table or worked example in KES per guide |
| FAQ | 4–6 real questions at the end, marked up as `FAQPage` |
| Structured data | `BlogPosting` (author, `datePublished`, `dateModified`) + `BreadcrumbList`; `HowTo` on guides 1–3 |
| Internal links | 2–3 links to other guides + 1 product link from the plan table; never more than one sales block |
| Local detail | KES amounts, M-Pesa steps, county offices, real Kenyan group types |
| Legal claims | Link the primary source (Kenya Law, the ruling, the regulator); set `reviewedOn` |
| Author | Named person with a short bio; builds E-E-A-T for finance content |
| Images | 1 hero + screenshots of the matching Kitabu Yetu screen; descriptive alt text |

Do not publish AI-generated text unedited, and never copy competitor
structure line by line. Each guide needs one thing no ranking page has: a
worked example, a template, or a current legal update.

## How a guide actually gets published (Sanity, not MDX)

`/resources` and `/resources/[slug]` already exist, are in the sitemap, and
read from Sanity — this was live before this SEO plan started (Phase 10).
What Phase 3 added on top, to make a guide-quality article possible:

- **Sanity schema** (`kitabuyetu-studio/schemaTypes/post.ts`): added
  `mainQuery`, `productLink`, `reviewedOn`, `relatedSlugs`, `faq[]` and
  `howToSteps[]`. A new `table` object type
  (`kitabuyetu-studio/schemaTypes/table.ts`) supports the "one table per
  guide" rule — plain rows of string cells, not rich text.
- **Structured data** (`app/resources/[slug]/page.tsx`): emits
  `BlogPosting` (with `dateModified` from Sanity's `_updatedAt`),
  `BreadcrumbList` always, `FAQPage` when `faq[]` is set, and `HowTo` when
  `howToSteps[]` is set.
- **On-page additions**: a "Last reviewed" date line (from `reviewedOn`),
  one product CTA block (from `productLink`), a visible FAQ section, and a
  "Read next" related-guides section (from `relatedSlugs` — plain slug
  strings, not Sanity references, since a guide can point at one that
  isn't written yet without failing validation).
- **Publishing tooling** (`kitabuyetu-studio/scripts/`):
  `publish-document.mjs` and `verify-document.mjs`, run via
  `npx sanity exec --with-user-token` so they use the CLI's own logged-in
  session — no `SANITY_API_TOKEN` needed, unlike the older
  `publish-content.js`. See the `publish-seo-guide` Claude Code skill
  (`.claude/skills/publish-seo-guide/`) for the full repeatable process —
  that's what guides 2–10 should use.

**Local dev note:** `.env.local` (as pulled by `vercel env pull`) had a
stale `NEXT_PUBLIC_SANITY_PROJECT_ID`/`NEXT_PUBLIC_SANITY_DATASET` that
didn't match the real project (`4xd2qzin` / `production`, the one
`kitabuyetu-studio` and production actually use) — fixed locally on
2026-09-25. If a future `vercel env pull` reintroduces the wrong value,
production is unaffected (it already has the correct one), but local
`/resources` pages will 404 until it's corrected again.

## Schedule

One guide every Friday from 2 October, finishing 4 December. After
publishing, request indexing for the new URL in Search Console the same
day.

| Publish | Guide |
|---|---|
| 2026-10-02 | Guide 1 — published early (2026-09-25) |
| 2026-10-09 | 2 — How to start a chama |
| 2026-10-16 | 3 — Constitution template |
| 2026-10-23 | 4 — Chama records |
| 2026-10-30 | 5 — Table banking |
| 2026-11-06 | 6 — M-Pesa contributions |
| 2026-11-13 | 7 — Loan policy |
| 2026-11-20 | 8 — Defaulters |
| 2026-11-27 | 9 — Merry-go-round vs investment |
| 2026-12-04 | 10 — Share-out |

Review guide 1 on **10 February 2027**, when the court's cure period ends.

**Targets by 4 December:** all 10 guides indexed; at least 3 on page 1 for
their main search; guides account for 30%+ of organic impressions. Track
in the Monday check on
[phase-2-indexing-checklist.md](./phase-2-indexing-checklist.md), under
Search Console → Performance, filtered to `/resources/`.

## Sources

- [Community Groups Registration Act, No. 30 of 2022](https://new.kenyalaw.org/akn/ke/act/2022/30/eng@2022-12-31) — Kenya Law (s.9 minimum 10 members, or 5 for special interest groups; s.31 records kept 7 years; s.33 report every two years)
- [High Court declares the Act unconstitutional, September 2026](https://streamlinefeed.co.ke/news/court-declares-community-groups-registration-act-unconstitutional) — Streamline Feed
- [Self-Help Groups in Kenya: registration requirements](https://www.amgadvocates.com/post/self-help-groups-in-kenya) — AMG Advocates
- [How to Start a Chama in Kenya](https://mychama.app/blog/how-to-start-a-chama-in-kenya/) — MyChama
- [Table Banking: the concept](https://blog.chamasoft.com/table-banking-the-concept-of-table-banking/) — Chamasoft
