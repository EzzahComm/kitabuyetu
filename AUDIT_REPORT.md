# Kitabu Yetu — Full Technical Audit Report
**Date:** 2026-05-22 (original) · **Re-audit:** 2026-07-12
**Auditor:** Claude Code (Senior Full-Stack & Security Audit)  
**Scope:** Complete codebase, database schema, security posture, financial integrity, CI/CD  

---

## 0. Re-Audit — 2026-07-12

Follow-up pass covering dependency hygiene, a security spot-review of code added
since the original audit (SMS trigger engine, org rename, landing page), and
verification that the original open items were closed. Branch: `chore/audit-update-2026-07`.

### Verification gates (all green after updates)
| Gate | Result |
|------|--------|
| `tsc --noEmit` (typecheck) | ✅ Pass |
| `eslint .` (lint) | ✅ Pass |
| `jest` (125 tests, 15 suites) | ✅ Pass |

### Dependencies updated
- Applied `npm audit fix` + in-range `npm update` across the tree.
- **npm audit: 10 → 3 vulnerabilities.** All 5 high-severity issues resolved:
  - `nodemailer` 8.0.7 → **9.x** (CRLF header injection, jsonTransport / raw-option file-read & SSRF). Used by the SES + SMTP email adapters. `createTransport` API unchanged; typecheck + tests pass.
  - `form-data`, `ws` (engine.io/socket.io transitive), `@babel/core`, `js-yaml` — all patched in-range via `audit fix`.
- **Remaining 3 (accepted, not fixable without breaking or false positives):**
  - `esbuild` (low) — dev-server-only arbitrary file read on Windows; reaches us via `react-email` / `tsx` dev tooling, not production runtime.
  - `postcss` (moderate) — flagged inside **Next.js's bundled copy**; the "fix" downgrades `next` to 9.3.3. False positive — do not force.
  - (one moderate rolls up from the same bundled-postcss chain.)
- **Major bumps deliberately NOT applied** (breaking, need a dedicated migration): React 18→19, Tailwind 3→4, `zod` 3→4, `date-fns` 3→4, `jose` 5→6, `@hookform/resolvers` 3→5, `csv-parse` 5→7, `bcryptjs` 2→3, `lucide-react` 0.4x→1.x, `eslint` 9→10, `typescript` 5→7. Tracked as future work.

### Original open items — status now
| Item | Prior status | Now |
|------|--------------|-----|
| M-4 Prisma installed but unused | ⚠️ Open | ✅ Removed from `package.json` |
| M-5 `SKIP_ENV_VALIDATION=1` in build | ⚠️ Open | ✅ Gone — `vercel.json` is now just `{ "buildCommand": "npm run build" }` |
| C-1 middleware entry point | ✅ Fixed (was `middleware.ts`) | ✅ Now `proxy.ts` (Next.js 16 renamed middleware→proxy); still does JWT + audience + rate limit |
| Secrets committed to `.env` in git | ⚠️ Review | ✅ `.env`/`.env.local` untracked and absent from git history; `.gitignore` correct |

> Still open (unchanged, product/ops decisions): M-2 balance reconciliation job, M-3 starter-plan member cap, L-2 SMS top-up text matching, L-3 STK idempotency key. **Credential rotation (Section C) remains a launch prerequisite** — the original `.env` values were exposed on the local machine and should be rotated regardless of git status.

### Security spot-review — code since original audit
| Check | Result |
|-------|--------|
| Dynamic SQL (`${where}` / `${col}`) | ✅ Safe — placeholders parameterized (`$idx`), column names are hardcoded literals/whitelisted, no user input concatenated |
| `dangerouslySetInnerHTML` / `eval` / `new Function` | ✅ None in source |
| Hardcoded secrets in source | ✅ None (all via `process.env`) |
| SMS trigger engine (`lib/sms/trigger-engine.ts`) | ✅ Solid — claim-before-send idempotency (`UNIQUE(rule_id,event_id)`), fail-open emit, exactly-once terminal transitions |
| Auth context (`lib/auth/middleware.ts` + `proxy.ts`) | ✅ Sound — proxy overwrites `x-*` claim headers from the verified JWT for all authenticated routes; audience enforced per URL prefix |
| Stray `console.log` / TODO / FIXME in source | ✅ Effectively zero (2 `console.log` are the logger impl itself) |

**Low / defense-in-depth note:** `proxy.ts` copies request headers before stamping and overwrites `x-user-id`/`x-role`/etc. for authenticated routes, so client spoofing can't reach `getAuthContext`. For the intentionally-unauthenticated fall-through routes (auth, webhooks, M-Pesa callbacks) client-supplied `x-*` headers pass through untouched — harmless today since those handlers don't read auth context, but stripping inbound `x-user-id`/`x-role`/`x-aud`/`x-group-id` on **every** request would be a cheap belt-and-suspenders hardening.

---

## A. Executive Summary

Kitabu Yetu is a well-structured, production-capable fintech platform for East African community savings groups. The codebase demonstrates sound multi-tenant architecture, comprehensive RLS policies, and solid API design. However, the audit uncovered **one breaking security gap**, **one critical financial calculation bug**, and several high-priority issues that must be resolved before scaling.

### Platform Health: 71 / 100

| Area           | Score | Status     |
|----------------|-------|------------|
| Architecture   | 82    | Good       |
| Security       | 65    | Needs Work |
| Financial Logic| 70    | Bug Fixed  |
| Database       | 85    | Good       |
| Performance    | 75    | Acceptable |
| UX/Reliability | 68    | Acceptable |
| Maintainability| 72    | Good       |

### Top 3 Risks (Before This Audit)
1. **Missing `middleware.ts`** — JWT validation was completely inactive; all authenticated routes were accessible without tokens.
2. **P&L expense calculation bug** — Net profit was overstated (expenses added instead of subtracted).
3. **Welfare module FK failure** — `welfare_requests` referenced non-existent `public.users` table, preventing welfare feature deployment.

---

## B. Audit Findings

### CRITICAL

#### C-1. Missing Next.js Middleware Entry Point
- **File:** Root directory (missing `middleware.ts`)  
- **Impact:** `proxy.ts` defines JWT verification logic but Next.js never loads it — ALL authenticated API routes were accessible without a valid Bearer token. Any caller could hit `/api/v1/loans`, `/api/v1/members`, `/api/v1/accounting`, etc. without authentication.
- **Root Cause:** Next.js App Router requires middleware at `middleware.ts` in the project root. `proxy.ts` was written as a module but never imported/exported as the middleware entry point.
- **Fix Applied:** Created `middleware.ts` that imports `proxy.ts` and adds global per-IP rate limiting via Upstash REST API.
- **Status:** ✅ Fixed

#### C-2. P&L Expense Calculation — Net Profit Overstated
- **File:** `lib/services/accounting.service.ts` → `getProfitAndLoss()`
- **Impact:** For all expense accounts (debit-normal), `SUM(credit) - SUM(debit)` yields a negative number. `netProfit = totalIncome - totalExpenses` then subtracts a negative, adding expenses to income. A group with KES 100,000 income and KES 30,000 expenses would show KES 130,000 net profit instead of KES 70,000.
- **Fix Applied:** SQL changed to `CASE WHEN type='expense' THEN SUM(debit)-SUM(credit) ELSE SUM(credit)-SUM(debit) END`. Balance sheet also fixed to negate liability/equity balances for correct positive presentation. Trial balance `netBalance` corrected likewise.
- **Status:** ✅ Fixed

#### C-3. Welfare Module — FK Constraint References Non-Existent Table
- **File:** `supabase/migrations/20260101000021_021_welfare_module.sql`
- **Impact:** `welfare_requests` and `welfare_pool_contributions` reference `public.users(id)`. The platform has no `public.users` table (it uses `public.members`). Migration would fail on a fresh Supabase deployment, making the entire welfare module unusable.
- **Fix Applied:** Replaced all `REFERENCES public.users(id)` with `REFERENCES public.members(id)` in the source migration. Created compensating migration `026_fix_welfare_fk_members.sql` for already-deployed databases.
- **Status:** ✅ Fixed

---

### HIGH

#### H-1. Contributions Hard-Delete — Violates Fintech Immutability
- **File:** `lib/services/contributions.service.ts` → `delete()`
- **Impact:** Pending contributions were permanently `DELETE`d from the database, erasing the audit trail and violating fintech record-keeping standards. Cancelled contributions should remain visible for reconciliation.
- **Fix Applied:** Changed to soft-delete (`UPDATE contributions SET status = 'cancelled'`). Pending contributions are now cancelled, never physically removed.
- **Status:** ✅ Fixed

#### H-2. CSP Allows `unsafe-eval` in Production
- **File:** `next.config.js`
- **Impact:** `script-src 'unsafe-eval'` was applied globally (including production). This enables JavaScript `eval()` — a prerequisite for many XSS payloads and code injection attacks.
- **Fix Applied:** `unsafe-eval` now only included when `NODE_ENV !== 'production'`.
- **Status:** ✅ Fixed

#### H-3. Same JWT Secret for Access and Refresh Tokens
- **File:** `lib/auth/jwt.ts`
- **Impact:** Both access and refresh tokens were signed with the same `JWT_SECRET`. A leaked access token could theoretically be used in the refresh endpoint if the `type` claim check were bypassed.
- **Fix Applied:** Added `JWT_REFRESH_SECRET` env var (optional, falls back to `JWT_SECRET` for backwards-compatibility). When set, access and refresh tokens use different signing secrets.
- **Status:** ✅ Fixed (requires adding `JWT_REFRESH_SECRET` to production env)

#### H-4. No Global API Rate Limiting
- **Impact:** Only the login endpoint had rate limiting (via Redis). All other API endpoints (loans, contributions, members, accounting) could be abused without throttling — enumeration, scraping, brute-force of IDs.
- **Fix Applied:** `middleware.ts` now applies a sliding-window rate limit (120 req/60s per IP) to all API routes via Upstash REST API (Edge-compatible). M-Pesa callback endpoints are excluded to prevent Safaricom retry issues.
- **Status:** ✅ Fixed

#### H-5. Journal Balance Validation Bypass on Direct INSERT
- **File:** `migrations/009_functions_triggers.sql`
- **Impact:** The `validate_journal_balance` trigger only fires on `BEFORE UPDATE`. System journal posting functions (disbursement, repayment, contribution) INSERT entries directly with `status='posted'`, bypassing the DB-level balance check.
- **Fix Applied:** Created migration `027_journal_balance_insert_guard.sql` adding a `DEFERRABLE INITIALLY DEFERRED` constraint trigger on `journal_lines`. It fires at transaction COMMIT (when all lines are visible) and validates balance for posted entries.
- **Status:** ✅ Fixed

---

### MEDIUM

#### M-1. Balance Sheet Sign Convention Incorrect
- **File:** `lib/services/accounting.service.ts` → `getBalanceSheet()`
- **Impact:** `accounts.balance` is stored as `debit - credit` for all account types. Liabilities and equity (credit-normal) had negative stored balances, causing the balance sheet to show negative liability/equity values and break the `Assets = Liabilities + Equity` identity.
- **Fix Applied:** SQL uses `CASE WHEN type='asset' THEN balance ELSE -balance END` to present natural positive balances for each account type.
- **Status:** ✅ Fixed (included in C-2 fix)

#### M-2. `accounts.balance` Denormalized — Drift Risk
- **File:** `migrations/004_accounting.sql`, `migrations/009_functions_triggers.sql`
- **Impact:** Account balances are stored denormalized and updated by triggers. If a trigger fails silently or lines are modified outside the ORM, balances can drift from actual journal totals. Trial balance shows `a.balance` (denormalized) alongside computed `SUM(debit)/SUM(credit)` which can diverge.
- **Recommendation:** Add a scheduled reconciliation job that compares `accounts.balance` against `SUM(debit) - SUM(credit)` from journal_lines and alerts on drift. No code change implemented — requires product decision on remediation flow.
- **Status:** ⚠️ Open (monitoring recommendation)

#### M-3. `PLAN_FEATURES.starter.maxMembers = null` (Unlimited)
- **File:** `types/enums.ts`
- **Impact:** Starter plan (free tier) has unlimited members while Growth plan (KES 1,000/month) is capped at 30. This is counterintuitive and may drive users away from paid plans. Appears to be inverted or `null` means "not enforced at DB level".
- **Recommendation:** Clarify the plan model — if starter is a freemium with feature limits (no loans, no analytics), the unlimited member cap may be intentional. Document explicitly.
- **Status:** ⚠️ Open (product decision)

#### M-4. Prisma Installed but Unused
- **File:** `package.json`, `prisma/schema.prisma`
- **Impact:** Prisma v7 is a dev dependency adding ~45MB to node_modules and `prisma generate` to potential CI pipelines. The platform uses raw `pg` driver exclusively.
- **Recommendation:** Remove `prisma` from devDependencies and delete `prisma/` and `prisma.config.ts`.
- **Status:** ⚠️ Open (low risk, tech debt cleanup)

#### M-5. `SKIP_ENV_VALIDATION=1` in Vercel Build
- **File:** `vercel.json`
- **Impact:** The Vercel build command (`SKIP_ENV_VALIDATION=1 npm run build`) bypasses Zod environment validation during the build phase. A missing required secret would only surface at runtime (cold start), not during the build — delaying failure detection.
- **Recommendation:** Configure all required secrets in the Vercel dashboard so `SKIP_ENV_VALIDATION` is not needed. Validate runtime secrets via a health check endpoint.
- **Status:** ⚠️ Open

---

### LOW

#### L-1. `ngo_coordinator` ROLE_HIERARCHY Below `member`
- **File:** `types/enums.ts`
- **Impact:** `ngo_coordinator` has hierarchy level 10, `member` has 20. Any `requireRole(role, 'member')` check would reject ngo_coordinators. This is likely intentional (NGO coordinators have read-only cross-tenant access, not member-level group access) but can surprise developers.
- **Status:** ⚠️ Documented (intentional design, no fix needed)

#### L-2. M-Pesa `processFulfillment` SMS Top-Up Detection is Fragile
- **File:** `app/api/v1/mpesa/callback/route.ts`
- **Impact:** SMS top-up detection uses `description ILIKE '%sms%'` on `invoice_items`. If invoice descriptions change (e.g., "SMS Credits" → "Text Credits"), the detection silently fails and SMS credits are not added after payment.
- **Recommendation:** Use a dedicated `invoice_type` column on `invoices` table with enum values (`sms_topup`, `subscription`, etc.) rather than text matching.
- **Status:** ⚠️ Open

#### L-3. M-Pesa No Idempotency Key on STK Push
- **File:** `lib/services/mpesa.service.ts`
- **Impact:** If a user submits the STK push form twice quickly, two separate M-Pesa prompts are sent. The M-Pesa receipt deduplication on contributions prevents double-posting, but the user experience is poor.
- **Recommendation:** Cache pending STK requests in Redis with a 30-second TTL keyed by `(userId, amount, purpose)`.
- **Status:** ⚠️ Open

#### L-4. Temporary Debug File Removed
- **File:** `tmp-mpesa-search.txt` (32KB)
- **Impact:** Large temporary search output file left in repo root. May contain M-Pesa transaction data or search patterns.
- **Status:** ✅ Fixed (file deleted)

---

## C. Security Audit Summary

| Check | Result |
|-------|--------|
| JWT algorithm pinned (HS256 only) | ✅ Pass |
| JWT secret minimum length enforced | ✅ Pass |
| Refresh token stored as SHA-256 hash | ✅ Pass |
| Account lockout after failed logins | ✅ Pass |
| M-Pesa callback IP validation | ✅ Pass |
| RLS enabled + FORCE on all tables | ✅ Pass |
| `members_insert` OR true removed (migration 018) | ✅ Pass |
| Function search paths hardened (migration 016-017) | ✅ Pass |
| Schema CREATE revoked from PUBLIC | ✅ Pass |
| Password hashing with bcrypt | ✅ Pass |
| SQL injection — parameterized queries throughout | ✅ Pass |
| Audit logs on all sensitive tables | ✅ Pass |
| HSTS in production | ✅ Pass |
| X-Frame-Options, X-Content-Type-Options | ✅ Pass |
| Permissions-Policy (camera/mic/geo restricted) | ✅ Pass |
| `unsafe-eval` in production CSP | ✅ Fixed |
| JWT middleware active | ✅ Fixed |
| Global rate limiting | ✅ Fixed |
| Refresh secret separate from access secret | ✅ Fixed |
| Secrets in `.env` committed to git | ⚠️ Review `.gitignore` history |
| `unsafe-inline` in CSP | ⚠️ Required by Next.js; nonce-based CSP recommended long-term |

### Critical Action Required Before Launch
Rotate ALL credentials that may have been exposed in `.env`/`.env.local`:
- Database password (`Bungoma@2026` visible in DATABASE_URL)
- JWT_SECRET and ENCRYPTION_KEY
- M-Pesa consumer key/secret/passkey
- Resend API key (`re_TB7vqLnE_*`)
- TextSMS API key
- Redis auth token

---

## D. Financial Integrity Audit

| Check | Result |
|-------|--------|
| M-Pesa receipt UNIQUE constraint | ✅ Pass |
| Loan repayment duplicate receipt check | ✅ Pass |
| Contribution duplicate receipt check | ✅ Pass |
| `withTransaction` wraps all writes | ✅ Pass |
| `FOR UPDATE` lock on repayment row | ✅ Pass |
| Reducing balance EMI formula | ✅ Pass (DB trigger) |
| Journal balance DB trigger (UPDATE) | ✅ Pass |
| Journal balance INSERT protection | ✅ Fixed |
| Double-entry: DR = CR enforced at DB | ✅ Pass |
| Audit trigger on contributions/loans/payments | ✅ Pass |
| P&L expense sign convention | ✅ Fixed |
| Balance sheet sign convention | ✅ Fixed |
| Contributions hard-delete | ✅ Fixed → soft-delete |
| SMS credit deduction uses advisory lock | ✅ Pass |
| Loan active-loan check before new application | ✅ Pass |

---

## E. Database Schema Audit

| Check | Result |
|-------|--------|
| Primary keys: UUID with gen_random_uuid() | ✅ Pass |
| Foreign keys with appropriate ON DELETE | ✅ Pass |
| NUMERIC(15,2) for all monetary values | ✅ Pass |
| Timestamptz for all timestamps | ✅ Pass |
| updated_at trigger on all tables | ✅ Pass |
| Composite indexes on query-hot columns | ✅ Pass (migration 024) |
| RLS policies on all tenant tables | ✅ Pass |
| `FORCE ROW LEVEL SECURITY` on all tables | ✅ Pass |
| Welfare FK references (`public.users`) | ✅ Fixed |
| Journal balance deferred guard | ✅ Fixed |
| Loan schedule generator (trigger on disburse) | ✅ Pass |
| Overdue marker (cron/scheduler) | ✅ Pass |
| Subscription expiry detection | ✅ Pass |

---

## F. Production Readiness Score

| Category        | Score | Notes |
|-----------------|-------|-------|
| Security        | 78/100 | After fixes. Rotate credentials. |
| Financial Integrity | 88/100 | After fixes. |
| Scalability     | 80/100 | Serverless + Supabase + Redis. |
| Reliability     | 75/100 | No error tracking configured. |
| Maintainability | 80/100 | Good service separation. Remove Prisma. |
| UX              | 70/100 | Core flows work. Missing error states. |
| **Overall**     | **79/100** | Ready after credential rotation + fixes |

---

## G. Deployment Checklist

### Pre-Deployment (Required)

- [ ] **Rotate all credentials** exposed in `.env`/`.env.local` files (see Section C above)
- [ ] Verify `JWT_REFRESH_SECRET` is set separately from `JWT_SECRET` in Vercel dashboard
- [ ] Verify `MPESA_ENV=production` and production Daraja credentials in Vercel
- [ ] Run `supabase db push` to apply migrations 026 and 027
- [ ] Confirm `welfare_requests` table FK constraints now reference `members`
- [ ] Test M-Pesa STK push in production sandbox before go-live
- [ ] Set `NEXT_PUBLIC_APP_URL` to production domain
- [ ] Verify `MPESA_CALLBACK_BASE_URL` points to production HTTPS URL (no trailing slash)

### Pre-Deployment (Recommended)

- [ ] Remove `prisma` from devDependencies and delete `prisma/`, `prisma.config.ts`
- [ ] Set up error tracking (Sentry recommended) — add `SENTRY_DSN` env var
- [ ] Configure uptime monitoring for `/api/health`
- [ ] Remove `SKIP_ENV_VALIDATION=1` from `vercel.json` build command
- [ ] Add `JWT_REFRESH_SECRET` as a separate secret (`openssl rand -hex 32`)
- [ ] Review all Vercel environment variables match `.env.example`
- [ ] Enable Vercel Web Analytics and Speed Insights

### Post-Launch

- [ ] Monitor Supabase database advisor for new warnings weekly
- [ ] Review Redis rate limiting hit rates — adjust `RL_LIMIT` if legitimate users are blocked
- [ ] Set up scheduled account balance reconciliation job
- [ ] Add `invoice_type` column to `invoices` table (fixes SMS top-up detection fragility)
- [ ] Implement idempotency key for STK push (prevent duplicate payment prompts)

---

## H. Files Changed in This Audit

| File | Change |
|------|--------|
| `middleware.ts` | **Created** — Next.js middleware entry point + global rate limiting |
| `lib/services/accounting.service.ts` | Fixed P&L expense sign, balance sheet negation, trial balance netBalance |
| `lib/services/contributions.service.ts` | Hard-delete → soft-delete (status = 'cancelled') |
| `next.config.js` | CSP: `unsafe-eval` restricted to development only |
| `lib/env.ts` | Added `JWT_REFRESH_SECRET` optional env var |
| `lib/auth/jwt.ts` | Refresh tokens use dedicated `JWT_REFRESH_SECRET` |
| `supabase/migrations/20260101000021_021_welfare_module.sql` | Fixed `public.users` → `public.members` FK references |
| `supabase/migrations/20260101000026_026_fix_welfare_fk_members.sql` | **Created** — compensating migration for deployed databases |
| `supabase/migrations/20260101000027_027_journal_balance_insert_guard.sql` | **Created** — deferred trigger: journal balance on posted entry lines |
| `tmp-mpesa-search.txt` | **Deleted** — temporary debug file |

---

*This audit was performed on the local codebase as of 2026-05-22. Supabase remote state was not directly queried — apply migrations and verify against live environment.*
