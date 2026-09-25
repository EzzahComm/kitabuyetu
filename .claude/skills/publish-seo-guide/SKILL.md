---
name: publish-seo-guide
description: Turn a drafted SEO guide (title, meta, body, FAQ, worked example) into a live post at /resources/<slug> — Sanity document, structured data, verification and Search Console follow-up. Use when asked to "publish guide N", "post the next SEO guide", "ship the chama guide", or to continue the Phase 3 guide schedule in docs/seo/phase-3-guide-plan.md.
---

# Publish an SEO guide

One guide = one Sanity `post` document, published the same way every time,
so `/resources` articles stay consistent without re-deriving the rules per
guide. Background: `docs/seo/phase-3-guide-plan.md` (the 10-guide plan and
the "How every guide is built" rules table) and
`docs/seo/phase-2-indexing-checklist.md` (why this matters for search).

`/resources` is Sanity-backed, **not** MDX — `app/resources/[slug]/page.tsx`
in `kitabuyetu` reads from `lib/cms/sanity.ts`; the schema lives in
`kitabuyetu-studio/schemaTypes/`. If a plan or brief says "MDX file" or
`content/resources/*.mdx`, that's stale — use this process instead.

## 0. Preconditions

- You need the next unpublished guide from the plan table in
  `docs/seo/phase-3-guide-plan.md` (title, slug, main search, product link,
  related slugs) — or a fully drafted brief the user hands you directly.
- Check the Sanity CLI is logged in: `cd kitabuyetu-studio && npx sanity
  debug --secrets` should print a `User:` block. If not, tell the user to
  run `npx sanity login` there first — don't try to work around it with a
  `SANITY_API_TOKEN` (see step 4 for why).
- Local preview needs `kitabuyetu/.env.local`'s
  `NEXT_PUBLIC_SANITY_PROJECT_ID`/`NEXT_PUBLIC_SANITY_DATASET` to match the
  real project (`4xd2qzin` / `production` as of 2026-09-25 — confirm
  against `kitabuyetu-studio/.env`'s `SANITY_STUDIO_PROJECT_ID`, since a
  stale `vercel env pull` can silently point local dev at the wrong
  project while production stays correct).

## 1. Write the guide

Follow the rules table in `docs/seo/phase-3-guide-plan.md` §"How every guide
is built": title tag <60 chars, meta description 140–155 chars, opening
answers the question in the first two sentences, 1,200–2,000 words, one
worked example/table in KES, 4–6 real FAQ questions, 2–3 internal links to
other guides plus exactly one product link, KES/M-Pesa/Kenyan-specific
detail, and a linked primary source for any legal or regulatory claim. Do
not publish AI-generated text unedited — read it as a treasurer would and
cut anything that doesn't answer the search.

## 2. Convert to a Sanity document

Create `kitabuyetu-studio/content/posts/<slug>.json` with a **stable `_id`**
of `post-<slug>` (re-running step 4 later then updates the same document
instead of duplicating it). Fields, matching
`kitabuyetu-studio/schemaTypes/post.ts`:

- `title`, `slug` (`{"_type":"slug","current":"<slug>"}`), `category:
  "guide"`, `excerpt`, `seoDescription`, `authorName`, `publishedAt` (ISO
  datetime — the plan's schedule date, or now if publishing ahead of
  schedule).
- `mainQuery` — the exact target search phrase (SEO-only, never rendered).
- `productLink` — one relative path from the plan's "Ends at" column, e.g.
  `/bookkeeper`. Rendered as the page's one CTA block
  (`PRODUCT_LINK_LABEL` in `app/resources/[slug]/page.tsx` — add an entry
  there if the path isn't one of the existing product pages).
- `reviewedOn` — an ISO date, only when the guide states law, fees or
  regulations that can change. Renders as "Last reviewed: …" and is the
  reminder to recheck it.
- `relatedSlugs` — 2–3 plain slug strings (not references) from the plan's
  guide list. A slug for a guide that isn't published yet is fine — the
  read side (`getRelatedPosts`) silently drops slugs with no matching
  post, so the "Read next" section just grows as later guides ship.
- `faq` — array of `{"_key": "...", "question": "...", "answer": "..."}`.
  Drives the visible FAQ section and `FAQPage` structured data.
- `howToSteps` — same shape with `name`/`text`, **only** for a genuinely
  step-by-step guide (numbered instructions, not just "H2 per section").
  Drives `HowTo` structured data. Leave the field out entirely otherwise —
  an empty `HowTo` for a non-procedural guide is inaccurate markup.
- `content` — Portable Text blocks. Headings: `{"_type":"block","style":"h2",...}`.
  Bullet/numbered lists: `listItem: "bullet"` or `"number"`, `level: 1`.
  Bold: a span with `"marks":["strong"]`. **Tables** (the one-per-guide
  worked example) use the custom `table` type, not Markdown table syntax —
  see `kitabuyetu-studio/schemaTypes/table.ts` and the JSON shape in
  `kitabuyetu-studio/content/posts/register-a-chama-kenya.json` (guide 1)
  for a working example of every block type above. Every block, span, row
  and FAQ/step item needs a unique `_key` string within its own array
  (short is fine — `"c001"`, `"c001s"` — they just can't collide).

Validate the JSON parses before publishing:
`node -e "JSON.parse(require('fs').readFileSync('kitabuyetu-studio/content/posts/<slug>.json','utf8'))"`.

## 3. If the guide needs a schema field that doesn't exist yet

Add it to `kitabuyetu-studio/schemaTypes/post.ts` (or a new object type
next to `table.ts` for something structurally new), add it to
`POST_FIELDS`/the `Post` interface in `kitabuyetu/lib/cms/sanity.ts`, and
render/emit it in `app/resources/[slug]/page.tsx`. This is a schemaless
dataset — a document can use a new field immediately (step 4 works before
the Studio is redeployed); redeploying (`cd kitabuyetu-studio && npm run
deploy`) only affects whether a *human* can edit that field through the
Studio UI, and is a production deploy — ask before running it, don't run it
as a matter of course for every guide.

## 4. Publish

```bash
cd kitabuyetu-studio
npx sanity exec scripts/publish-document.mjs --with-user-token -- content/posts/<slug>.json
```

Uses the CLI's own logged-in session (`--with-user-token`) — no
`SANITY_API_TOKEN` needed. `content/jobs/*.json` documents (careers
postings) go through the same script, same flag.

## 5. Verify

```bash
npx sanity exec scripts/verify-document.mjs --with-user-token -- post-<slug>
```

Confirms the document actually landed with the fields you meant, straight
from the dataset — don't trust the publish script's own success line alone
(see `feedback_verify_fixes_against_live_execution_not_just_code` in
memory: code-looks-right isn't the same as live-and-correct).

Then check the rendered page, locally (`npm run dev` in `kitabuyetu`, then
`curl localhost:3000/resources/<slug>`) or on production once deployed:

- All expected tables render (`grep -o '<table' `).
- FAQ section and `"@type":"FAQPage"` present if `faq` was set.
- `"@type":"HowTo"` present if `howToSteps` was set.
- `"@type":"BreadcrumbList"` and `"@type":"BlogPosting"` always present.
- The product CTA links where `productLink` says.
- `/resources` (the index) lists the new guide.

## 6. After publishing

- Update the guide's row in `docs/seo/phase-3-guide-plan.md`'s plan table
  to "Published — `post-<slug>`, <date>".
- Request indexing for `https://kitabuyetu.co.ke/resources/<slug>` in
  Google Search Console the same day (manual — no API access to Search
  Console from here).
- If this guide was in another guide's `relatedSlugs` before it existed,
  no action needed — the "Read next" section picks it up automatically on
  next render.
