# 01 — Inventory & Mapping

**Date:** 2026-07-27
**Scope:** Kitabu Yetu (`kitabuyetu` repo), full-codebase audit per the user's 7-phase brief.

## 0. Stack correction (read this before Phases 2-5)

The brief's assumptions don't match this codebase on three points. Every later phase in this
audit is written against the **actual** stack below, not the brief's assumptions:

| Brief assumes | Actual |
|---|---|
| Stack Auth for auth | Custom JWT (access + refresh, `jsonwebtoken` + `bcryptjs`), two independent audiences: `tenant` (member/officer) and `backoffice` (admin/platform staff/organization coordinator). No third-party auth provider. |
| Supabase Edge Functions / RPCs as the API layer | **None exist.** All business logic lives in 167 Next.js API routes (`app/api/**/route.ts`) using a raw `pg` `Pool`/`PoolClient` (`lib/db`). Supabase is used purely as a hosted Postgres instance (+ pg_cron for scheduling) — not as a BaaS. |
| Anon-key / PostgREST write paths | `@supabase/ssr` is an installed dependency and `lib/supabase/client.ts` + `lib/supabase/server.ts` exist (anon-key and service-role clients), but **grep confirms zero importers anywhere in `app/`, `components/`, `hooks/`, or the rest of `lib/`.** This is dead code from an earlier architecture phase — flagged in §5 below, not re-litigated per-route in Phase 2. |
| RLS as an active gate for app traffic | RLS is broadly *defined* (99 tables have `ENABLE ROW LEVEL SECURITY`, 17 have `FORCE`), but the app's Postgres role has `BYPASSRLS` — documented in the codebase's own migration comments (058, 096, 097) as a known, already-tracked architectural debt, not a new discovery. Full detail in `02-security-findings.md` §2.2. |

Everywhere below, "RLS" means "defined in schema," not "enforced for app traffic" — that distinction is the single most important fact for interpreting every other finding in this audit.

## 1. Routes

- **167** API routes under `app/api/` (mix of `app/api/v1/*` — the primary versioned API — and `app/api/admin/*` — a second, platform-staff-only tree used exclusively by the `(admin)` backoffice; both are live, not a stale duplicate).
- **67** pages across 6 route groups:
  - `(auth)` — login/register/verify, pre-session
  - `(dashboard)` — tenant/group officer portal (~40 pages: accounting, loans, contributions, members, meetings, welfare, shares, dividends, investments, credit-scores, sms/whatsapp/email, treasury, mpesa, organization/Funding-Portal, settings)
  - `(admin)` — platform backoffice (groups, organizations, users, billing, risk, monitoring, support, audit-logs, feature-flags)
  - `(enterprise)` — B2B partner portal (portfolio, branches, api-keys) — wired to real data as of this session (see [[project-kitabu-yetu-audits]])
  - `(member)` — consumer-facing member self-service (`/me`)
  - `design-system`, `pricing` — marketing/internal, no auth
- No Supabase Edge Functions or RPC-based routes — confirmed above.

## 2. Database

- **103** tables (`CREATE TABLE` across 117 migrations, `supabase/migrations/`, applied via raw `execute_sql` for migrations ≥081 rather than the Supabase CLI migration tracker — see [[project-kitabu-yetu-audits]] for why).
- **99** tables have `ENABLE ROW LEVEL SECURITY`; **17** additionally have `FORCE ROW LEVEL SECURITY` (migration 097, scoped to tenant-path tables as prep for a future non-BYPASSRLS role).
- **Confirmed RLS gaps** (tables that exist but have no `ENABLE ROW LEVEL SECURITY` anywhere in the migration history): `refresh_tokens`, `invoice_sequences`.
- **Correction (post-publication)**: an earlier draft of this section also listed `mpesa_b2c_transactions`, `mpesa_b2b_transactions`, and `mpesa_b2c_charge_tiers` as lacking RLS. That was wrong — all three have `ENABLE ROW LEVEL SECURITY` **and** a real policy (migration 012 for the first two, via a `DO $$ ... EXECUTE format(...) $$` loop that computes policy/table names at runtime — a pattern a literal-text `CREATE POLICY` grep cannot see; migration 047 for the charge-tiers table, via a plain literal policy). Migration 097's own comment explicitly warns that an "earlier audit grep... missed" exactly this dynamic-policy pattern — that warning was read during this pass and still not applied before the finding was written up. Left here rather than silently deleted, since the mistake and its root cause (grep-based schema auditing without accounting for dynamic SQL, plus extending one truncated regex match across three table names without checking each individually) are worth recording for future audits of this repo.
- **21 `SECURITY DEFINER` functions** — mostly small, narrowly-scoped helpers (`app_current_*` GUC readers, `mask_*` PII helpers, `damm_*` check-digit validators, `allocate_membership_no`/`allocate_share_certificate_serial` sequence generators, audit/immutability triggers). None found that take arbitrary caller-supplied identifiers and skip authorization — sampled 8 of the 21 directly.
- No Supabase Edge Functions. Scheduled work runs via Supabase pg_cron → `POST /api/cron` (5-min tick) → `lib/jobs` (DB-backed queue, `FOR UPDATE SKIP LOCKED`), not pg_cron calling SQL directly.

## 3. Third-party integrations (env-schema-driven, `lib/env.ts`)

- **M-Pesa (Safaricom Daraja)** — STK Push, C2B (PayBill), B2C (disbursement), B2B, reversal/reconciliation. 8 shortcode env vars (working/utility/loan-disbursement/charges/settlement/airtime) — reflects a genuinely multi-purpose Daraja integration, not one paybill.
- **SMS** — TextSMS (Kenya-local gateway), own credit-ledger system (`sms_credits`, `organization_sms_credits`).
- **WhatsApp** — Meta Cloud API, webhook + outbound send.
- **Email** — dual-provider (Resend primary, SendGrid fallback/alt), both webhook-verified (svix HMAC / SendGrid verification key).
- **Redis** — job-adjacent caching (`lib/redis`) and used to have a queue role, now fully folded into `lib/jobs` (this session's `lib/queue` deletion, see [[project-kitabu-yetu-audits]]).
- No Canva/Zapier/other marketing-automation hooks found.

## 4. Environment variables

- Centralized Zod-validated schema in `lib/env.ts` (49 keys) — this is the actual source of truth, not a separate `.env.example` (none exists in the repo; `.env`/`.env.local` are git-ignored, confirmed via `git check-ignore`).
- 39 direct `process.env.*` reads exist outside `lib/env.ts` (mostly in the M-Pesa/webhook routes reading a single flag like `MPESA_DURABLE_ACK` inline) — none found reading a *secret* outside the schema; all secret reads go through `env.*`.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`/`NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are declared in the schema and read only by the two dead `lib/supabase/*` files noted above — i.e., the schema currently validates env vars for code that never runs.

## 5. Dead code found during this pass

- **`lib/supabase/client.ts` + `lib/supabase/server.ts`** — zero importers repo-wide. Candidate for deletion (or, if a future feature genuinely needs Supabase Storage/Realtime, keep but comment as intentionally-unused today).
- Everything else flagged in the prior `OPTIMIZATION_CLEANUP_AUDIT.md` pass (unused deps, orphaned service files, root-level markdown clutter) was already remediated in that audit's implementation commits — re-verified spot-checks below in later phases rather than re-run wholesale here.

## 6. Multi-tenant isolation model (as it actually works today)

1. Every mutating/reading service function takes a `TenantContext { userId, groupId, role, organizationId? }`.
2. `withDb`/`withTransaction` (in `lib/db`) open a transaction, call `set_config('app.current_group_id', ctx.groupId, true)` (+ user/role/org) via parameterized `set_config()` calls (not string interpolation — no injection risk there), then run the caller's queries.
3. RLS policies read those same GUCs (`app_current_group_id()` etc.) — this is a real, correctly-designed defense-in-depth layer **in schema**.
4. **However**: the connection pool used by `withDb`/`withTransaction` (`tenantPool`) falls back to the same `BYPASSRLS`-privileged pool as `withAdminDb()` whenever `TENANT_DATABASE_URL` is unset (`lib/db/index.ts:53-56`, the code's own comment: *"a no-op until that role exists"*). Whether `TENANT_DATABASE_URL` is actually provisioned in the live Vercel/Supabase production environment **cannot be determined from the repo** — this is the single most important open question for Phase 2.
5. Actual tenant isolation enforcement today, for **100% of app traffic regardless of that env var**, is: explicit `WHERE group_id = $1` / `WHERE organization_id = $1` clauses hand-written in every service function, plus the existing real-Postgres tenant-isolation integration test suite (`__tests__/integration`, CI job "Tenant Isolation (integration)" — ran and passed on every commit this session).

## 7. What's genuinely new in this pass vs. already-audited

Everything above except §5 (dead Supabase files) was previously surfaced in `OPTIMIZATION_CLEANUP_AUDIT.md` or the accounting-audit series (see [[project-kitabu-yetu-audits]]) — this phase re-verified current state rather than assuming the old findings still hold, and confirms most of the previously-shipped remediation is still in place, unregressed. Phase 2 focuses on what's changed, what's newly found, and what remains genuinely open. (The mpesa_b2c/b2b RLS item this section originally listed as "new" was itself a false positive — see the correction two paragraphs up.)
