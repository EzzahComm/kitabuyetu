# Audit — Transactions for Members in More Than One Group

**Date:** 2026-07-13
**Scope:** How the platform records, processes, requests, displays, and reports transactions for members belonging to multiple groups, per the multi-group isolation audit spec.

---

## 1. Current Implementation (What Exists Today)

### Identity model
- `members` — platform-wide account, unique on phone / email / national_id (`supabase/migrations/20260101000001_002_core_tables.sql:33`). One login per human.
- `group_members` — membership join table: `(group_id, member_id)` UNIQUE, per-group `role`, `status`, `member_code` (`KY…` 14-char), `person_id`, and a **generated, globally-unique `mpesa_ref`** column built in migration 030 specifically to route payments to one (group, member) tuple (`20260101000030_030_group_workflow_foundation.sql:264-270`).
- `person` — cross-group KYC identity keyed on `national_id` (placeholder `TEMP-<uuid>` when absent).

So the recommended `Member → Membership → Group` chain **exists in the schema**. However:

- **Every transaction table references the global `members.id`, not `group_members.id`**: `contributions`, `loans`, `loan_repayments` (`003_contributions_loans.sql`), `welfare_pool_contributions`, `share_transactions`, `dividend_allocations`. Group isolation is achieved by also carrying `group_id` on each row — the DB never *proves* the member belongs to that group.

### Group context & auth
- Login (`app/api/v1/auth/login/route.ts`): multi-group users get `needsGroupSelection` and must re-submit with a `groupCode`; the access token is scoped to exactly one `groupId`. ✅ correct design.
- All tenant API routes derive `TenantContext { userId, groupId, role }` from the JWT headers; queries run inside a transaction with `SET LOCAL app.current_group_id` and RLS policies scope every table by `group_id` (`lib/db/index.ts`, `010_rls_policies.sql`). ✅
- There is **no group-switch endpoint**; switching = logout + re-login. The client caches the login payload (group name, role) in `localStorage` (`lib/auth/context.tsx`).

### Payment request (M-Pesa STK)
- `POST /api/v1/mpesa/stk-push` takes group from the JWT (`auth.groupId`) — the member/treasurer never types a group, so the destination group is the one selected at login. Purpose enum (`contribution`, …) is stored on `mpesa_stk_requests` and is authoritative at fulfilment.
- On callback success, a `contribution` purpose is fulfilled by resolving the member **by paying phone number within the request's group** (`lib/services/mpesa.service.ts:390-450`). No match → `mpesa_unrouted` queue.

### Incoming PayBill (C2B)
- Account-number grammar `KYT-CONTR-<group_code>[-<member_code>]`, `KYT-LOAN-<id>`, `KYT-WELF-…`, `KYT-SHARE-…`, `INV-…` (`lib/utils/mpesa-bill-ref.ts`).
- Group resolution (`mpesa.service.ts:824-875`): group code → entity FK (loan/invoice) → **legacy case-insensitive group-name match** → phone-only fallback **only when the phone maps to exactly one active membership** (correctly refuses to guess for multi-group members ✅) → otherwise unrouted queue.
- Member resolution within the group is **by phone only** — the `member_code` suffix from the account number is parsed but never used (see finding H-2).

### Ledger
- `journal_entries` / `journal_lines` both carry `NOT NULL group_id` with RLS. ✅ No entry can exist without a group.
- No member or membership attribution on journal lines; member linkage is only via the source document's `journal_entry_id` back-pointer. M-Pesa-originated entries have `created_by = NULL` (relaxed in migration 047).

### Reports, dashboard, notifications
- All report queries are `ctx.groupId`-scoped (`lib/services/reports.service.ts`). ✅
- Sidebar shows the active group name from the cached login payload (`components/layout/sidebar.tsx:109`); no switcher, no cross-group aggregation anywhere. Per-group statements only.
- Email contribution receipt includes group name; SMS receipt does not (see M-2/M-3).

### What is verifiably correct today
- One person, many groups: supported; per-group role, code, status. ✅
- JWT locked to one group at issue time; RLS backstops `group_id` on every table. ✅
- C2B phone-only fallback refuses ambiguity for multi-group phones. ✅
- Duplicate callbacks are idempotent (`UNIQUE(mpesa_receipt_number)` on contributions, payments, mpesa_transactions; status-guarded UPDATE latches). ✅
- Balances (loan limits, contribution totals, welfare pool, share holdings) are computed per `(group_id, member_id)` — never merged across groups. ✅

---

## 2. Findings

### CRITICAL

**C-1. Token refresh silently switches the active group.**
`app/api/v1/auth/refresh/route.ts:27-41` re-derives group context as
`JOIN group_members … ORDER BY gm.joined_at DESC LIMIT 1` — the *most recently joined* membership, ignoring the group the user selected at login. For a multi-group user, the first refresh (~15 min in) can silently re-scope the token to a different group **with that group's role**, while the UI (localStorage payload) still displays the original group. Every subsequent write — recording contributions, initiating STK pushes, approving loans — posts to the wrong group. This is the single most direct path to cross-group transaction contamination in the codebase.
Also: it filters on `gm.is_active` (see C-2) instead of `gm.status`, doesn't exclude suspended/archived groups (login does), and drops the `personId`/`groupStatus` claims that login sets.
**Fix:** carry `groupId` in the refresh token (or require it in the refresh request), re-validate that membership is still `status='active'`, and reject with a "re-select group" error if not.

**C-2. `group_members.is_active` and `group_members.status` have diverged — payment routing and refresh use the dead column.**
Migration 030 added `status member_status` as the lifecycle field; `membersService.transitionStatus` (`lib/services/members.service.ts:256-330`) updates only `status` and **never touches `is_active`**, so `is_active` stays `true` forever. But `is_active = true` is the filter used by:
- refresh-token group selection (`auth/refresh/route.ts:35`),
- STK contribution member resolution (`mpesa.service.ts:402`),
- C2B member resolution (`mpesa.service.ts:964`),
- C2B phone-only group fallback (`mpesa.service.ts:869`),
- the STK-failure fallback SMS member lookup (`mpesa.service.ts:564`).

Consequences for the spec's edge case "member removed from one group while remaining active in another": the exited membership still counts. A member exited/blacklisted from group A still has M-Pesa payments auto-posted as *completed contributions to group A*; the phone-only fallback sees two "active" rows and unroutes payments that should route cleanly to the one remaining group; refresh can mint a token for a group the member was removed from.
**Fix:** pick `status` as the single source of truth; replace every `gm.is_active` predicate with `gm.status = 'active'`; either drop `is_active` or maintain it via trigger.

### HIGH

**H-1. Transaction recording endpoints do not verify the target member belongs to the group.**
- `contributionsService.create` (`lib/services/contributions.service.ts:87-123`) inserts `(ctx.groupId, data.memberId)` with **no membership check**.
- `welfareService.recordPoolContribution` (`lib/services/welfare.service.ts:217-231`) — same.
- `resolveUnrouted` allocate (`mpesa.service.ts:1298-1367`) — treasurer supplies any `memberId`, no check.
- RLS INSERT policies check only `group_id` + caller role — never `member_id` membership (`010_rls_policies.sql:198-203`).

A treasurer (or a buggy client) can post a contribution in group A against a member who only belongs to group B — any platform member UUID is accepted. The row then surfaces in group A's lists/reports under the stranger's name (list queries `JOIN members` unconditionally). `sharesService` already has the right pattern — `assertGroupMembership` (`shares.service.ts:654-660`) — but even that accepts *any* membership status.
**Fix:** shared `assertActiveGroupMembership(client, groupId, memberId)` called by every write path; longer-term see DB-1.

**H-2. The PayBill member code is parsed but ignored — members are resolved by paying phone only.**
`fulfilC2B` (`mpesa.service.ts:906-914`) routes `contribution`/`welfare`/`share` payments via `resolveMemberInGroup(phone, groupId)`; `route.memberCode` is never consulted, and the purpose-built globally-unique `group_members.mpesa_ref` column is referenced **nowhere in application code** (grep confirms only the migration mentions it). So:
- Third-party payments (spouse pays for member using the member's account number `KYT-CONTR-KY1234567-MEM00045` from their own phone) either post to the *payer's* membership (if the payer happens to be in the group — wrong member credited) or fall to unrouted — despite the account number identifying the member exactly.
- The documented deterministic routing design (mig 030 §0B comment) was never wired up.
**Fix:** resolution order should be `member_code`/`mpesa_ref` first, phone second; mismatch between the two → unrouted with reason `ambiguous_member`.

**H-3. Welfare and share PayBill payments are booked as ordinary savings contributions.**
`fulfilC2B` treats `kind === 'welfare'` and `kind === 'share'` identically to `contribution` (`mpesa.service.ts:906`): the money lands in `contributions` and is journalled to income 4001, not in `welfare_pool_contributions` / `share_transactions`. Right group, wrong product and wrong ledger line — welfare pool balances and share registers understate, savings overstate, and the member's statement misclassifies the payment.
**Fix:** dispatch by kind to the welfare/shares services (or park in unrouted with a distinct reason until those flows exist).

**H-4. Legacy BillRef fallback matches groups by name — names are not unique.**
`resolveC2BGroupId` step 3 (`mpesa.service.ts:854-861`): `WHERE UPPER(name) = UPPER($1) … LIMIT 1`. `groups.name` has no uniqueness constraint, so two groups named "UMOJA" resolve by arbitrary pick and real money posts `status='completed'` into the wrong group. It also runs *before* the safe phone-only fallback, so a typo'd account number that happens to equal some group's name is captured by that group.
**Fix:** drop the name fallback (or require it to match exactly one group AND the payer phone to be a member of it).

### MEDIUM

**M-1. Contribution receipt email is dead code — query references a column that doesn't exist.**
`notifyReceipt` (`contributions.service.ts:143`) filters `WHERE m.id = $1 AND m.group_id = $2`, but `members` has no `group_id` column. The query throws on every call; the catch-all swallows it, so the group-labelled email receipt (the one notification that *does* name the group) never sends.

**M-2. SMS payment receipt does not identify the group.**
Seeded template: `"KitabuYetu: Payment of KES {{amount}} received. Receipt: {{receipt}}. Thank you."` (`20260710020000_052_sms_trigger_engine.sql:159`). A member in two groups cannot tell which group received the money, nor the contribution type, nor an updated balance (spec §8).

**M-3. STK fallback/account references are truncated to 12 chars.**
`mpesa_stk_requests.account_reference` is stored as `.slice(0, 12)` (`mpesa.service.ts:130`; Daraja hard limit `daraja.service.ts:237`). The documented long refs (`KYT-CONTR-KY1234567-MEM00045` = 28 chars) can't fit; the failure-fallback SMS then tells the member to pay PayBill with a truncated account number that the parser may not route. The 12-digit `mpesa_ref` was designed to fit this limit exactly — another reason to wire it up (H-2).

**M-4. Journal lines carry no member/membership attribution; M-Pesa journals have `created_by = NULL`.**
Spec §5 asks for Group + Membership + Member + initiator on every ledger entry. Today: `group_id` ✅ (NOT NULL + RLS), initiator partially (NULL for callback-posted entries since migration 047), member only indirectly via the source document back-pointer. Per-member ledger reporting requires joining back through `contributions`/`loan_repayments`.

**M-5. No in-app group switching; stale client cache.**
Switching groups requires logout + full re-login (password again). The active group lives in `localStorage` and is never re-validated against the token — combined with C-1, the UI label and the token's group can disagree indefinitely. A `POST /auth/switch-group` that re-issues the access token from the *existing* session (re-checking `group_members.status`) plus a visible group switcher in the sidebar closes both.

**M-6. Membership assertions that do exist ignore status.**
`assertGroupMembership` (shares) passes for `exited`/`blacklisted`/`rejected` rows. Loan `apply` relies solely on the JWT group. Consistent "active membership" semantics needed everywhere.

### LOW

**L-1. Person identity dedupe fails without national ID.** Each no-ID onboarding synthesises a fresh `TEMP-<uuid>` person (`lib/services/group-membership.ts:74-82`), so the same human in two groups = two `person` rows; cross-group KYC linkage silently degrades. Acceptable for MVP, but worth surfacing in admin tooling.

**L-2. C2B loan-repayment routing trusts the loan id globally.** Group is derived *from* the loan (consistent), but there's no cross-check that the payer has any relationship to the loan; any phone paying `KYT-LOAN-<uuid>` marks the installment paid. Arguably a feature (guarantor pays), but should be logged as third-party.

**L-3. `contributions_mpesa_receipt_unique` is a single global UNIQUE** — fine for idempotency, but it means a receipt manually recorded in the wrong group *blocks* later correct routing; wrong-group corrections require a reversal flow, which doesn't exist for contributions (only `cancelled` for `pending` rows; completed rows are immutable by design).

---

## 3. Answers to Specific Audit Questions

| Spec question | Verdict |
|---|---|
| Member can belong to multiple groups | ✅ Yes (`group_members`, UNIQUE (group_id, member_id)) |
| Transactions reference Membership vs Member ID | ⚠️ Global member ID + group_id; membership row never referenced by FK |
| Can transactions accidentally post to another group? | ❌ Yes — via C-1 (refresh group swap), H-1 (unvalidated memberId), H-4 (name-match fallback) |
| Balances isolated per group | ✅ All balance queries are (group_id, member_id)-scoped |
| Member selects group before payment | ✅ At login (JWT-scoped); undermined by C-1 after refresh |
| System never guesses destination group | ⚠️ Mostly — phone fallback requires exactly one membership ✅, but group-name fallback guesses (H-4) |
| PayBill account number uniquely maps to one membership | ⚠️ Format exists (`KYT-CONTR-<group>-<member>`, `mpesa_ref`) but member part is ignored (H-2) |
| Duplicate callbacks | ✅ Idempotent via UNIQUE receipt + status latches |
| Ledger entries always have Group ID | ✅ NOT NULL + RLS; member attribution missing (M-4) |
| Dashboard group switching | ❌ None — logout/login only (M-5) |
| Reports filter by group | ✅ All reviewed report queries are group-scoped |
| Notifications identify the group | ❌ SMS receipt has no group name (M-2); the email that does is broken (M-1) |
| Member removed from one group, active in another | ❌ Broken — is_active/status drift (C-2) |
| Simultaneous payments to different groups | ✅ Safe (per-group STK locks, per-receipt idempotency) |

---

## 4. Prioritized Remediation Plan

### Critical (do first — active wrong-group posting risk)
1. **Fix refresh group affinity** (C-1): persist chosen `groupId` with the refresh token; re-validate `group_members.status='active'` and group status on refresh; 403 with `NO_ACTIVE_GROUP`/re-select signal otherwise.
2. **Unify membership liveness on `status`** (C-2): migration to backfill/drop or trigger-sync `is_active`; sweep all `gm.is_active` predicates (refresh, mpesa.service ×4) to `gm.status = 'active'`.

### High
3. **Enforce membership on every transaction write** (H-1, M-6): shared `assertActiveGroupMembership`; apply to contributions.create, welfare.recordPoolContribution, resolveUnrouted, shares (tighten to active), loan guarantor.
4. **Use the member code / `mpesa_ref` in C2B & STK routing** (H-2, M-3): resolve by `mpesa_ref`/`member_code` first, phone second; flag payer≠member as third-party; emit `ambiguous_member` on conflict.
5. **Route welfare/share PayBill payments to their own tables** (H-3).
6. **Remove or harden the group-name BillRef fallback** (H-4).

### Medium
7. **DB-level integrity** (DB-1): add `group_membership_id UUID REFERENCES group_members(id)` to `contributions`, `loans`, `loan_repayments`, `welfare_pool_contributions`, `share_transactions`, backfill via `(group_id, member_id)`, then either make it NOT NULL or add composite FK `(group_id, member_id) REFERENCES group_members (group_id, member_id)` — the UNIQUE constraint already supports it. This makes wrong-group member references *unrepresentable*.
8. **Fix the receipt email query** (M-1) and **add group name + type + balance to the SMS receipt template** (M-2).
9. **In-app group switcher** (M-5): `POST /api/v1/auth/switch-group`, sidebar dropdown listing active memberships, re-issue access token without password.
10. **Ledger attribution** (M-4): add nullable `member_id`/`group_membership_id` to `journal_entries` (or lines), populate from source documents; record `created_by` as a system actor instead of NULL.

### Low
11. Reversal/reallocation flow for completed contributions posted to the wrong group (L-3).
12. Person-identity dedupe tooling for TEMP national IDs (L-1).
13. Mark third-party loan repayments (L-2).

---

*Files most cited:* `app/api/v1/auth/refresh/route.ts`, `lib/services/mpesa.service.ts`, `lib/services/contributions.service.ts`, `lib/services/members.service.ts`, `lib/services/welfare.service.ts`, `lib/utils/mpesa-bill-ref.ts`, `supabase/migrations/20260101000030_030_group_workflow_foundation.sql`, `supabase/migrations/20260101000009_010_rls_policies.sql`.
