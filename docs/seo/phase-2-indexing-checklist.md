# SEO Phase 2 — Indexing & Visibility Checklist

Imported from the "SEO Phase 2" Claude Docs artifact (2026-09-24) and corrected
against the actual codebase on 2026-09-25. Two of the doc's own findings
turned out to be stale — see "Corrections" below — so verify anything here
against the code before acting on it again.

## Before you start

- [ ] **Confirm the production domain in Vercel.** Project → Settings →
      Environment Variables → Production: `NEXT_PUBLIC_APP_URL` must be
      `https://kitabuyetu.co.ke`. Canonical links, the sitemap and
      robots.txt are all built from it.
- [ ] **Redirect the Vercel address.** In Vercel → Settings → Domains, set
      `kitabuyetu.vercel.app` to redirect (308) to `kitabuyetu.co.ke`, so
      Google never indexes two copies of the site.
- [ ] **Decide the repo's visibility.** `EzzahComm/kitabuyetu` is public and
      currently outranks the website in search results for its own domain
      name. Making it private removes that, and also stops exposing client
      names.
- [ ] **Fix the GitHub website link.** Repo page → About (gear icon) →
      Website: change `kitabuyetu.vercel.app` to `https://kitabuyetu.co.ke`.

## Google Search Console

The site already carries a Google verification file
(`/google126ecba483f419c5.html`), so this should take about 15 minutes.

- [ ] Open [Search Console](https://search.google.com/search-console) and
      confirm the `https://kitabuyetu.co.ke` property shows as verified. If
      not, add a **Domain** property and verify with the DNS TXT record at
      your registrar — that covers `www` and every subdomain.
- [ ] **Sitemaps** → submit `https://kitabuyetu.co.ke/sitemap.xml`. Status
      should read "Success" with 25+ URLs discovered.
- [ ] **URL Inspection** → paste each URL below → **Request indexing**.
      Google allows ~10 requests a day.

| Priority | URL |
|---|---|
| 1 | `https://kitabuyetu.co.ke/` |
| 2 | `/bookkeeper` |
| 3 | `/pricing` |
| 4 | `/chama-reminder` |
| 5 | `/how-it-works` |
| 6 | `/products` |
| 7 | `/fundraise` |
| 8 | `/enterprise-solutions` |
| 9 | `/resources` |
| 10 | `/about` |

- [ ] Check **Settings → Crawl stats** after a week: requests should go to
      `kitabuyetu.co.ke`, not the Vercel address.
- [ ] Check **Pages** after 2 weeks for anything marked "Discovered –
      currently not indexed" or "Duplicate, Google chose different
      canonical".

## Bing Webmaster Tools

Bing also feeds DuckDuckGo, Yahoo and ChatGPT search. Setup reuses the
Google verification (~5 minutes).

- [ ] Sign in at [Bing Webmaster Tools](https://www.bing.com/webmasters) →
      **Import from Google Search Console**.
- [ ] Under **Sitemaps**, confirm `https://kitabuyetu.co.ke/sitemap.xml` is
      listed.

## Google Business Profile

Puts Kitabu Yetu on Google Maps and in the branded knowledge panel — the
fastest way to fix brand searches that currently return Swahili books.

- [ ] [Google Business Profile](https://business.google.com) → add business
      → **Kitabu Yetu**.
- [ ] Choose **"I deliver goods and services to my customers"** and hide the
      street address unless you want walk-in visitors. Service area:
      **Kenya**.
- [ ] Complete verification (video or postcard, 5–14 days).
- [ ] Add a logo (`/icons/icon-512.png`), a cover image and 3–5 product
      screenshots.
- [ ] Link the website: `https://kitabuyetu.co.ke`.

**Ready-to-paste fields**

| Field | Value |
|---|---|
| Primary category | Software company |
| Additional categories | Business management consultant · Accounting software (if offered) |
| Phone | +254 182 625 807 |
| Email | info@kitabuyetu.co.ke |
| Service area | Kenya |

**Business description** (679/750 characters)

> Kitabu Yetu is a chama management app built for Kenya. Chamas, welfare
> groups, table banking groups, SACCOs and investment clubs use it to
> collect contributions by M-Pesa, track loans and repayments, send SMS
> reminders, and give every member a clear, accurate statement. Every
> payment is recorded automatically in a proper double-entry book, so
> treasurers stop reconciling by hand and members can see exactly where the
> group's money is. Groups pay one monthly price for the whole group, not
> per member. Kitabu Yetu also offers Chama Reminder for bulk SMS,
> Changi$ha for community fundraising, and Enterprise tools for
> institutions and NGOs managing many groups. Based in Nairobi.

## Directories and roundup lists

Start with the Kenyan "chama app" roundups — they rank for the exact
searches Kitabu Yetu wants, and each listing is a relevant backlink. Aim
for 5 listings in the first month.

| Priority | Where | Type | How to get listed |
|---|---|---|---|
| 1 | [Kenyan Fix — List of Chama Management Apps](https://www.kenyanfix.com/list-of-chama-management-apps/) | Roundup (ranks for "chama management software Kenya") | Email the editor with the outreach template below |
| 2 | [Zenlipa — Best Chama App to Download](https://zenlipa.co.ke/blog/looking-for-the-best-chama-app-to-download-here-s-what-to-know-before-you-choose-one) | Roundup | Outreach email; Zenlipa is a partial competitor, expect a maybe |
| 3 | [Capterra](https://www.capterra.com/vendors/sign-up) (feeds GetApp, Software Advice) | Software directory | Free vendor listing; M-Changa already listed |
| 4 | [StartupBlink — Kenya](https://www.startupblink.com/top-startups/kenya) | Startup map | Add startup (free) |
| 5 | [Startup Map Africa — Kenya fintech](https://startupmapafrica.com/startups/fintech/kenya) | Startup map | Submit a listing |
| 6 | [Crunchbase](https://www.crunchbase.com) | Company database | Create an organization profile (free) |
| 7 | [ensun — Fintech in Kenya](https://ensun.io/search/fintech/kenya) | Company search | Claim or submit the company |

**Hold until Changi$ha launches publicly** — these fundraising roundups
list platforms donors and fundraisers can use today:

- [CrowdSpace — Fundraising platforms in Kenya](https://thecrowdspace.com/directory/fundraising-platforms-in-kenya/)
- [SenteMe — Best fundraising platforms in Kenya](https://senteme.com/en/best-fundraising-platforms/kenya)
- [Zenlipa — Best Fundraising Platforms in Kenya (2026)](https://zenlipa.co.ke/blog/best-fundraising-platforms-in-kenya-2025-review)

Use the same name, description and phone number everywhere — search
engines cross-check them, and mismatches weaken the brand signal.

### Outreach email to roundup authors

Keep it short, give the author something they can paste, and never offer
payment for a link — Google treats paid links as spam.

> **Subject:** A Kenyan chama app for your list: Kitabu Yetu
>
> Hi [name],
>
> I read your [article title]. It's one of the clearest comparisons of
> chama apps out there.
>
> I'd like to suggest Kitabu Yetu for the list. It's a Nairobi-built chama
> management app where members pay contributions by M-Pesa and every
> payment is posted automatically to a proper double-entry book, so
> treasurers stop reconciling by hand. Groups pay one monthly price for the
> whole group, not per member, and it includes SMS reminders and loan
> tracking.
>
> In one line for your list: *Kitabu Yetu: M-Pesa chama management with
> automatic bookkeeping and SMS reminders, priced per group rather than
> per member.* Website: https://kitabuyetu.co.ke
>
> I'm happy to set you up with a demo group so you can try it yourself.
>
> Thanks, [Your name]
> Kitabu Yetu · info@kitabuyetu.co.ke

- [ ] Send to Kenyan Fix and Zenlipa first.
- [ ] Follow up once after 7 days if there's no reply, then stop.

## Corrections found while importing this checklist (2026-09-25)

The original doc's "Code follow-ups" section flagged two bugs that **do
not exist** in the current codebase — don't re-fix them without checking
first:

- **Phone number / `tel:` links** — the doc claimed
  `app/contact/page.tsx:31` and `app/support/page.tsx:131` had a broken
  `tel:+254018262580` link (stray 0, missing final digit). The actual code
  already uses `telHref(CONTACT.phones[0])` from
  `components/marketing/routes.ts`, which correctly builds
  `tel:+254182625807` from the properly-formatted
  `phones: ['+254 182 625 807']` constant. No fix needed.
- **Social profile links** — still genuinely missing (no `sameAs` entries,
  no footer links), because the social accounts don't exist yet. Add them
  once Facebook/LinkedIn/X pages are created.

## Measuring progress

Indexing shows within 1–2 weeks; rankings for competitive terms take 4–8
weeks. Check every Monday.

| Week | What to check | Where | Target |
|---|---|---|---|
| 1 | Sitemap processed; all 10 main pages indexed | Search Console → Pages | 10/10 indexed |
| 2 | Brand search "Kitabu Yetu" returns kitabuyetu.co.ke first, above GitHub | Google search, signed out | Position 1 |
| 4 | Impressions for "chama app", "chama management", "chama software" | Search Console → Performance → Queries | Any impressions; they rise before clicks do |
| 4 | Listings live | The directory table above | 5 listings |
| 8 | Average position for chama queries | Search Console → Performance | Top 30, trending up |

Phase 3 (guides in `/resources` — see
[phase-3-guide-plan.md](./phase-3-guide-plan.md)) is what moves the week-8
numbers: roundups and titles get Kitabu Yetu found, but articles are what
rank for "how to start a chama"-style searches.
