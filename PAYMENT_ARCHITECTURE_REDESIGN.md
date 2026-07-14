# Payment Architecture Redesign — Multi-Group Isolation

**Date:** 2026-07-13 (v3 — final gap-closure revision)
**Status:** Design specification — enterprise-hardened; all known gaps closed
**Companions:** `MULTI_GROUP_TRANSACTIONS_AUDIT.md` (audit findings C-1…L-3), `PAYMENT_ARCHITECTURE_REVIEW.md` (review findings W-1…W-8, R-1…R-9, I-1…I-5)

---

## Executive Summary

This document specifies the payment architecture for strict multi-group financial isolation. It preserves every core decision of v1/v2 — membership-scoped payment accounts, an immutable Active Membership Context, unified membership status, centralized validation, database-enforced ownership — and, in v3, closes the remaining enterprise gaps: identifier governance, a fully specified membership state machine, a deterministic allocation engine, versioned authentication context, a payment lifecycle state machine, transactional-outbox eventing, API standards, operational resilience, a security architecture, and production observability.

Core v2 decisions (unchanged):

1. **Membership Number** — fixed 8-character `PP DDDDD C` with Damm check digit; the **only public payment identity**.
2. **Payment prefix decoupled from group name** — an immutable routing code, like a bank branch code.
3. Single **payment-identifier registry** (`payment_accounts`) for all routable identifiers, legacy and future.
4. **C2B Validation active** — bad/inactive accounts rejected *before money moves* (fail-open on internal error).
5. **Payment spine** (`allocation_status` state machine + `payment_reallocations`) — exactly-once allocation, queryable orphans, contra-entry corrections; financial rows never mutated.
6. **Single three-column composite FK** binding every transaction to exactly one membership row.
7. **Payment requests are an optimization, never a dependency** — spontaneous deposits always allocate.
8. **Display aliases** — cosmetic, never routable.

New in v3 (traceability in the Gap Closure Matrix, §17):

1. **Identifier governance & lifecycle** (§1.8): ownership, reservation, exhaustion, disaster recovery.
2. **Membership state machine** (§4): per-state payment/auth/reporting behaviour, incl. obligations-only inbound during suspension.
3. **Deterministic routing & allocation decision tables** (§3.3, §3.5) — no routing or allocation decision ever guesses.
4. **Versioned auth context** (§2.5): `authVersion`/`sessionVersion` claims kill silent role/permission drift.
5. **Payment lifecycle state machine** (§11) covering duplicates, delays, out-of-order callbacks, reversals, chargebacks.
6. **Transactional outbox** (§12) — event-driven side effects without dual-write risk; bus deferred deliberately.
7. **API standards** (§13): idempotency keys, optimistic concurrency, error envelope, versioning.
8. **Resilience matrix** (§14) incl. ack-after-durable-audit for callbacks.
9. **Security architecture** (§15): replay, spoofing, enumeration, insider abuse (maker-checker), token rotation.
10. **Observability** (§16): metrics, thresholds, dashboards, paging rules.

Phase 0 (pure code, no migrations) remains unchanged and ships first. Roadmap and cutover strategy in §19; production-readiness checklist in §22.

---

## Part I — Core Architecture

## 1. The Membership Number (Membership Payment Account)

### 1.1 What it is — and the only thing members ever see

Every **membership** (a `group_members` row — not a member, not a person) receives one permanent, platform-unique Membership Number at creation. It is the member's PayBill **Account Number**, and the **only payment identifier that ever appears on any member-facing surface**:

```
Business Number : 222111          (platform PayBill, constant)
Account Number  : BG 10253 4      (this membership — stored as BG102534)
```

Members must never interact with: internal UUIDs, `members.id`, `group_members.id`, `member_code`, or the retired `mpesa_ref`. `member_code` (`KY############`) is demoted to an **internal/regulatory identifier** — permitted in regulator exports and internal audit screens, prohibited on membership cards, receipts, statements, SMS, payment instructions, QR codes, and the member profile's payment section. A UI sweep of these surfaces is part of Phase 1 (§19), and a CI check asserts that no member-facing template references `member_code` or raw UUIDs (§2 of the sweep — Gap 2).

The same person in three groups holds three numbers:

| Person | Group | Membership Number |
| --- | --- | --- |
| Jane Wanjiku | Bungoma Women's VSLA | `BG 10253 4` |
| Jane Wanjiku | Dairy Farmers Group | `DF 04182 9` |
| Jane Wanjiku | School Welfare Group | `SW 07821 3` |

The internal routing chain is always:

```
Membership Number → Membership → Member → Group → Organization(s) → Accounts → Ledgers
```

### 1.2 Format

```
^[A-Z]{2}[0-9]{6}$      fixed 8 characters:  PP DDDDD C
                        PP    = payment prefix (2 letters)
                        DDDDD = 5-digit sequence, zero-padded
                        C     = Damm check digit over the full identifier
```

- **Fixed length, forever** (Gap 1: maximum length). Entry validation is trivial; appended/dropped-digit typos are caught structurally. Any future format need (a longer space, a new scheme) is introduced as a **new registry `kind`** (§3.1), never by mutating this format.
- **Damm check digit**, computed over the full identifier (prefix letters mapped `A=0…Z=25`, each taken mod 10, prepended to the 5 digits). Catches **all** single-character errors and all adjacent transpositions. A mistyped number fails the check and is rejected at validation (§3.2) instead of paying a stranger in another group.
- **Capacity:** 99,999 accounts per prefix × ~670 assignable prefixes ≈ 67M memberships, with governed exhaustion strategy in §1.8.
- **Why not a shorter variable format:** dense sequential short numbers make distance-1 typos land on *live accounts in other groups* — a cross-group contamination vector. Check digit + fixed length removes it for two extra characters; display grouping `BG 10253 4` keeps it readable.

**Verdict on prefix + sequence:** retained. Simple, allocation locks off the payment hot path, human-communicable; the check digit addresses the sole weakness. Sequential enumerability is an accepted low risk (§15.4).

### 1.3 The payment prefix is a branch code, not a name

`groups.payment_prefix` is an **immutable routing identifier**, treated exactly like a bank branch code:

- Generated **once**, at group creation. The group's name initials merely *seed a suggestion* (Bungoma Group → try `BG`); if saturated or reserved, the allocator assigns the nearest free variant or draws from the unused-pair pool.
- **Never regenerated. Never recomputed.** Group renames, rebrandings, language changes, organization renames, mergers, and platform migrations have **zero effect** on the prefix or any issued number.
- The prefix carries **no semantic guarantee**. Two unrelated groups may share `BG`. UI copy must never promise the prefix "stands for" the group name.
- **Reserved pairs** (never assigned to production groups): `KY` (legacy code collision) and `ZZ` (sandbox/test allocations — test memberships get `ZZ…` numbers so test traffic is structurally identifiable end-to-end; pairs with the existing `is_test` flags).
- **Group mergers/transfers:** memberships are never re-parented. Transfer = exit old membership + create new membership (new number). The old number stays bound to the closed membership forever.

```sql
ALTER TABLE groups ADD COLUMN payment_prefix CHAR(2)
  CHECK (payment_prefix ~ '^[A-Z]{2}$');
-- Immutable after first membership: BEFORE UPDATE trigger rejects changes
-- once any group_members row exists for the group.
```

### 1.4 Schema & allocation

```sql
CREATE TABLE membership_no_counters (
  prefix    CHAR(2) PRIMARY KEY,
  last_seq  INTEGER NOT NULL DEFAULT 0 CHECK (last_seq BETWEEN 0 AND 99999)
);

ALTER TABLE group_members ADD COLUMN membership_no CHAR(8);
CREATE UNIQUE INDEX uq_group_members_membership_no ON group_members (membership_no);
ALTER TABLE group_members ADD CONSTRAINT chk_membership_no_format
  CHECK (membership_no ~ '^[A-Z]{2}[0-9]{6}$' AND damm_valid(membership_no));
-- damm_valid(): IMMUTABLE SQL function implementing the Damm table check.
-- NOT NULL enforced after backfill (§19).

-- Immutability: BEFORE UPDATE trigger rejects any change to membership_no
-- once set. Numbers are never recycled, including after exit/blacklist/archive.
```

Allocation happens **only** inside `linkMemberToGroup` (`lib/services/group-membership.ts`) and the `register_group` RPC, using the lock-the-counter-row pattern (`INSERT … ON CONFLICT DO NOTHING` then `UPDATE … RETURNING last_seq`). Concurrent allocations serialise on the counter row; the unique index is the final arbiter (a conflict aborts the membership transaction — no partial state).

### 1.5 Display aliases

Optional, member-friendly, cosmetic only:

```sql
ALTER TABLE group_members ADD COLUMN display_alias VARCHAR(30);
-- e.g. 'Lucas-25'. UNIQUE (group_id, display_alias); NOT a payment identifier.
```

- **Never routable.** Aliases never appear in `payment_accounts`, are never accepted as a BillRef, and never substitute for the Membership Number. Routable identifiers live in exactly one table; aliases are not in it.
- May appear alongside (never instead of) the Membership Number on card, receipts, statements, profile.
- Freely editable precisely *because* nothing financial depends on it.

### 1.6 Relationship to existing identifiers

| Identifier | Fate |
| --- | --- |
| `group_members.member_code` | **Kept, internal only** — regulator exports, audit screens. Registry `legacy_code` alias keeps old printed materials routing. |
| `group_members.mpesa_ref` | **Dropped.** No duplicate routing mechanism may exist. |
| `KYT-…` BillRef grammar | Legacy input via registry aliases; nothing new prints it. |
| `groups.group_code` | Kept for group-level billing (`KYT-SUB-…`); never member-facing in payment contexts. |
| Display alias | Cosmetic only (§1.5). |
| Phone number | Metadata + third-party flagging only; **never routes** (§3.3). |

### 1.7 Where it appears

Membership card, member profile, "Lipia" payment-instructions screen (copy button), every payment SMS/receipt, statements, QR codes (`paybill=222111;account=BG102534`), the STK `AccountReference`, the group switcher. Display always grouped `BG 10253 4`; input normalisation strips spaces/dashes. Forgot-my-number: SMS keyword `ACC` from a registered phone returns that phone's membership numbers and group names.

### 1.8 Governance & lifecycle *(Gap 1)*

| Concern | Rule |
| --- | --- |
| **Ownership** | Numbers are issued and owned by the **platform** (issuer of record); a number is *assigned to* exactly one membership for that membership's lifetime. Not transferable, not sellable, not member-choosable. |
| **Generation** | Only by the allocator inside the membership-creation transaction. No manual assignment, no admin override, no import path that supplies its own numbers (imports call the same allocator). |
| **Immutability** | DB trigger–enforced (§1.4). No UPDATE path exists in application code. |
| **Reservation** | Prefixes `KY`, `ZZ` reserved (§1.3). No number ranges are pre-reserved for marketing or VIPs — uniformity is the integrity guarantee. |
| **Recycling** | **Never.** Exited/blacklisted/archived memberships keep their numbers permanently; the unrouted queue (not reissuance) handles payments to them. |
| **Collision handling** | Impossible by unique index; a race aborts the enclosing transaction and the caller retries the allocation. |
| **Maximum length** | Fixed 8 characters, permanent. Format evolution = new registry `kind`, never mutation. |
| **Exhaustion** | Per-prefix: allocator moves the group to a variant prefix for *new* memberships (existing numbers untouched). Platform-wide (~67M): introduce a 3-letter-prefix scheme as a **new registry kind** — documented escape hatch, no silent drift. Alert at 80% prefix saturation (§16). |
| **Disaster recovery** | Numbers live on `group_members` (backed up with the database). Counters are derivable: `last_seq = MAX(substr(membership_no,3,5)::int)` per prefix. The registry is **rebuildable idempotently** from `group_members` + `invoices` — a maintenance script exists from Phase 1 and is part of DR runbooks. |
| **Lifecycle** | Issued at membership creation → routable while membership `active` (obligations-only during `suspended`, §4) → non-routable but permanently bound in all other states → survives archival forever (statements/history reference it indefinitely). |

---

## 2. Active Membership Context *(Gap 7)*

### 2.1 Session shape

```ts
interface ActiveMembershipContext {
  memberId:       string;   // members.id            (JWT sub)
  membershipId:   string;   // group_members.id      — anchoring claim
  membershipNo:   string;   // e.g. BG102534
  groupId:        string;
  organizationId: string | null;  // §2.4
  role:           MemberRole;     // role in THIS membership
  personId:       string;
  groupStatus:    string;
  authVersion:    number;   // §2.5 — membership auth epoch
  sessionVersion: number;   // §2.5 — member-level session epoch
}
```

### 2.2 Rules

1. The context is fixed at login (or group-switch) and **inherited verbatim on every token refresh**.
2. The refresh endpoint must **never derive** a group from `joined_at`, "latest", "first", or any default. The current `ORDER BY gm.joined_at DESC LIMIT 1` in `app/api/v1/auth/refresh/route.ts` is removed.
3. Refresh **re-validates** rather than re-selects: load the membership by `membershipId`, require `gm.status = 'active'` and group status not in (`suspended`,`archived`). Invalid → `403 NO_ACTIVE_GROUP` with `needsGroupSelection`. Role is re-read from the membership row.

### 2.3 Mechanics

Persist the chosen `membership_id` with the refresh token (column on `refresh_tokens` + alongside the Redis hash). Refresh reads it, revalidates, and mints an access token with the identical context. The edge proxy stamps `x-membership-id`/`x-membership-no`; `TenantContext` gains both; `withDb` sets `app.current_membership_id`.

**Refresh tokens rotate on use** (§15.3): each refresh consumes the token and issues a new one; presenting a consumed token is treated as replay → the whole session lineage is revoked.

**Sessions are independent lineages:** `switch-group` mints a **new** session bound to the new membership and leaves existing sessions untouched. No revoke-on-switch; revocation is for logout and security events.

### 2.4 Organization ID

Organizations↔groups is **many-to-many** (`organization_group_access`), so `organizationId` is set only for organization-portal sessions and transaction rows carry no `NOT NULL organization_id` — attribution is derivable. If ownership later becomes 1:N, add `groups.organization_id` and denormalise then.

### 2.5 Context versioning — no silent drift *(Gap 7)*

Two monotonic epochs make every form of drift detectable:

```sql
ALTER TABLE group_members ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1;
-- trigger: bumped on any change to role or status
ALTER TABLE members       ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
-- bumped on password change, "log out everywhere", account lock
```

- Both are embedded in every access token (`authVersion`, `sessionVersion`).
- **Refresh** compares both against the database; mismatch → context re-derived from current truth (new role) or session terminated (member-level bump). This bounds *any* drift to one access-token lifetime.
- **Sensitive operations** (loan approval/disbursement, B2C, reallocation, member-status changes, switch-group) re-check both versions server-side at execution time — drift on these paths is bounded to zero, not fifteen minutes.
- Blacklist/security events bump `session_version` → every outstanding session dies at its next request to a version-checked endpoint or refresh.

This closes: silent permission drift, role drift, membership drift, and context drift after refresh. No further claims are needed — a single epoch per scope subsumes separate "role version / permissions version / tenant version" counters.

---

## 3. Payment Routing *(Gaps 2, 3, 5)*

### 3.1 The payment-identifier registry — single routing index

```sql
CREATE TABLE payment_accounts (
  identifier     TEXT PRIMARY KEY,      -- 'BG102534', legacy member_code, 'INV-2026-000123', future bank VA…
  kind           TEXT NOT NULL,         -- membership_no | legacy_code | invoice | bank_va | qr | api_alias
  membership_id  UUID REFERENCES group_members (id),   -- NULL for kind='invoice'
  invoice_id     UUID REFERENCES invoices (id),        -- kind='invoice' only
  status         TEXT NOT NULL DEFAULT 'active',       -- active | suspended
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((kind = 'invoice') = (invoice_id IS NOT NULL))
);
```

Routing is **normalise → one indexed lookup → destination**. Legacy `member_code`s backfill as `legacy_code` aliases (old posters route forever, no grammar parsing in the hot path); invoices share the lookup but keep their lifecycle; every future channel is a new `kind`. Display aliases are deliberately absent — that absence *is* the "aliases never route" guarantee.

**Payment-identity sweep (Gap 2):** with the registry live, no module may route or attribute payments by phone, `member_code`, or UUID. Sweep targets: STK fulfilment (uses the request's `membership_id`), C2B (registry only), the STK-failure fallback SMS (quotes the membership number), import pipelines (allocator + guard), QR generation, receipts/statements/reports (display membership number). Enforced by integration tests + the CI template check (§1.1).

### 3.2 C2B Validation — reject before money moves

The registered Safaricom validation URL (currently accept-all in `app/api/v1/mpesa/c2b/route.ts`) becomes real:

```
Validation request → normalise BillRef →
  malformed / check digit invalid  → REJECT (bad_account)
  registry lookup:
    not found                      → REJECT (unknown_account)
    membership not payment-eligible→ REJECT (membership_inactive)   [see §4 per-state rules]
    found + eligible               → ACCEPT
  internal error/timeout           → ACCEPT (fail-open — never lose a payment to our
                                     latency; confirmation handling + unrouted queue backstop)
```

One indexed query, p99-monitored (§16), rate-limited per MSISDN/IP (§15.4).

### 3.3 Routing decision table — deterministic *(Gap 3)*

Same input + same state → same outcome, always. No ordering dependence, no heuristics:

| # | Input condition | Outcome |
| --- | --- | --- |
| R1 | Valid `membership_no`, membership payment-eligible (§4) | Route to membership → product resolution (§3.5) |
| R2 | Valid `membership_no`, membership **not** eligible | Validation: REJECT. Confirmation (fail-open path): spine row + `unrouted (membership_inactive)` |
| R3 | Check-digit failure / malformed | Validation: REJECT. Confirmation: `unrouted (bad_account)` |
| R4 | `legacy_code` alias match | As R1/R2 for the bound membership |
| R5 | `invoice` match | Invoice payment lifecycle (unchanged) |
| R6 | Legacy `KYT-…` grammar (transition window only) | member_code suffix → membership; group-only ref → group-scoped unrouted for treasurer allocation. Never phone-resolved |
| R7 | No registry match, no legacy match | `unrouted (unknown_account)` |
| R8 | Duplicate receipt (any path, any timing) | Spine no-op (§11) |
| R9 | Payer phone ≠ member's registered phone | Route unchanged; transaction flagged `is_third_party` (third-party routing = normal routing + flag; never a different destination) |
| R10 | Group-name match, phone-only match | **Do not exist.** Deleted; never reintroduced |

Failure routing (processing crash after receipt) is handled by the spine + DLQ (§11, §14) — never by re-guessing.

### 3.4 The payment spine

Every inbound shilling first lands on the `payments` row — the **spine** — before any domain effect:

```sql
ALTER TABLE payments ADD COLUMN allocation_status TEXT NOT NULL DEFAULT 'received';
  -- received | allocated | unrouted | reallocated | reversed
ALTER TABLE payments ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'KES';
-- audit attribution (Gap 10): channel, initiated_by, session/request correlation — §7
ALTER TABLE contributions ADD COLUMN payment_id UUID REFERENCES payments (id);
-- same for loan_repayments, welfare_pool_contributions, share_transactions, …
-- plus UNIQUE(payment_id) per domain table (Gap 8): one payment can never
-- allocate twice into the same product table.
```

- **Exactly-once allocation** enforced once, on the spine (`UNIQUE(mpesa_receipt_number)` + status transitions), backstopped per-table by `UNIQUE(payment_id)`.
- **Orphans queryable**: `allocation_status='received'` older than N minutes = alert + DLQ replay.
- **Corrections never mutate financial rows**: `payment_reallocations` records original allocation → contra journals → new allocation → new journals, with actor, approver, reason, timestamps (maker-checker, §15.5).
- **Reconciliation as a control**: nightly Safaricom statement diff against the spine by receipt; alert on one-sided receipts (§16).

### 3.5 Product allocation engine — deterministic *(Gap 5)*

**Payment requests are an optimization, never a dependency.** A payment with a valid, eligible Membership Number **always allocates** — the engine never guesses and never parks a routable payment for want of a request.

Decision table (evaluated top-down; first match wins):

| # | Condition | Allocation |
| --- | --- | --- |
| A1 | Suffix present and **invalid** (unknown letter) | Treated as malformed account → R3 (rejected at validation; never "closest guess") |
| A2 | Open, unexpired request exists with **exact amount match** | That request's product; request → `fulfilled` |
| A3 | Suffix present and valid (`-L`, `-W`, `-S`) | Suffix product (suffix never overrides A2) |
| A4 | Exactly one open unexpired request | That request's product; `amount_variance` tagged if amounts differ |
| A5 | Multiple open requests, no exact amount match | **Oldest** open request (deterministic); `amount_variance` tagged |
| A6 | Request(s) exist but all **expired** | Ignored entirely (expiry job transitions `open → expired`; expired requests never influence allocation) |
| A7 | No request, no suffix, membership has a default product set | Member default product |
| A8 | Otherwise | Group default product (default: savings), or the group's configured allocation waterfall (arrears → loan due → savings) |
| A9 | Resolved product has no registered handler (future-product misconfiguration) | Spine `unrouted (config_error)` + page (§16) — never a silent fallback to savings |

Amount semantics (all products):

- **Partial payment** — never completes an obligation: installment → `partially_paid`, running `amount_paid`; only full satisfaction → `completed`. (Fixes the current defect where any amount completes an installment.)
- **Overpayment** — excess flows to the next waterfall tier (default: savings); never a negative receivable.
- **Underpayment against a request** — allocates with `amount_variance` tag; request stays `open` with remaining balance.

Dispatch is per product to the owning service/table — never a blanket insert into `contributions`:

| Product | Destination | Ledger mapping |
| --- | --- | --- |
| Savings | `contributions` | DR 1001 / CR 4001 (split engine) |
| Loan repayment | `loan_repayments` | DR 1001 / CR 1101 |
| Welfare | `welfare_pool_contributions` | DR 1001 / CR welfare liability |
| Shares | `share_transactions` | DR 1001 / CR share capital |
| Investment | investment subscription | DR 1001 / CR investment |
| Registration / subscription | billing pipeline | respective income |
| Fine/penalty | fines ledger (future module) | fine income |

### 3.6 Payment requests table

```sql
CREATE TABLE payment_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id             UUID NOT NULL REFERENCES groups (id),
  group_membership_id  UUID NOT NULL REFERENCES group_members (id),
  member_id            UUID NOT NULL REFERENCES members (id),
  product              payment_product NOT NULL,
  entity_id            UUID,
  amount               NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  status               TEXT NOT NULL DEFAULT 'open',   -- open|fulfilled|expired|cancelled
  expires_at           TIMESTAMPTZ,
  created_by           UUID REFERENCES members (id),
  fulfilled_by_payment UUID REFERENCES payments (id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Fulfilment takes FOR UPDATE on the request row; UNIQUE(fulfilled_by_payment)
-- prevents one payment fulfilling two requests under concurrent callbacks.
-- Scheduled job transitions open → expired at expires_at (feeds rule A6).
```

STK initiation always creates one. Recurring/standing-order flows are future producers of the same table.

### 3.7 STK Push changes

- `AccountReference` = the Membership Number.
- Fulfilment resolves the membership from the STK request's `membership_id` — never by phone-within-group.
- The failure-fallback SMS quotes PayBill + Membership Number verbatim.

---

## 4. Membership Lifecycle — Single Status, Full State Machine *(Gap 4; audit C-2)*

`group_members.status` is the **only** liveness signal. Every `gm.is_active = true` predicate is replaced with status logic; after a one-time sync the `is_active` column is **dropped**. (`members.is_active` — platform account lock — is unaffected.)

### 4.1 States, transitions, and behaviour

| State | Allowed transitions → | Inbound payments | Authentication (this membership) | Reporting | Audit on entry |
| --- | --- | --- | --- | --- | --- |
| `pending_verification` | active, rejected | **Reject** at validation (not yet payment-eligible) | No sessions | Counted as pipeline, not membership | created_by |
| `active` | suspended, inactive, archived, blacklisted, exited | **Accept** — fully eligible | Full | Full | — |
| `inactive` (dormancy) | active, archived | Reject new savings; **accept obligation products** (loan repayments against existing loans) | No new sessions; existing sessions fail next refresh | Shown as dormant | actor + timestamp |
| `suspended` | active *(reinstatement)*, archived | **Obligations-only**: loan repayments accepted; savings/welfare/shares rejected (`membership_inactive`) | Blocked for this membership; other memberships unaffected | Flagged | actor + reason (required) |
| `rejected` | archived | Reject | Never had sessions | Excluded | reason (required) |
| `exited` | archived | Reject all (incl. obligations — arrears collected via treasurer-managed flows, not auto-routing) | Blocked | Historical only | actor + reason (required) |
| `blacklisted` | archived | Reject all | Blocked **and** `session_version` bumped → immediate platform-wide session kill for this member if platform-level; membership-level bumps `auth_version` | Flagged for governance | actor + reason (required) |
| `archived` | active *(reinstatement)* | Reject all | Blocked | Soft-deleted | actor + timestamp |

- **Reinstatement** is not a distinct state: it is the audited transition `suspended|archived → active`, recording actor, reason, and timestamp. The membership number, history, and balances are untouched — continuity is the point.
- **Forbidden transitions:** anything not listed (e.g. `exited → active` — a returning member gets a *new* membership and number; `blacklisted → active` directly — must pass governance review via archived → active with reason).
- Every transition writes the per-status audit columns (existing pattern) **and bumps `auth_version`** (§2.5), so payment eligibility and session validity react within one token lifetime — or immediately on version-checked endpoints.
- Payment eligibility per state is enforced in **both** the validation hook (§3.2) and inside the allocation transaction (status re-read under lock), so a status change racing a payment can't slip through.

---

## 5. Centralized Membership Validation *(audit H-1, M-6)*

```ts
// lib/services/membership-guard.ts
export async function assertActiveMembership(
  client: PoolClient, groupId: string, memberId: string,
  opts?: { allowStatuses?: MemberStatus[] },   // e.g. dividends to 'exited' members during share-out
): Promise<{ membershipId: string; membershipNo: string }>
```

Mandatory on every financial write path: contributions.create, welfare.recordPoolContribution, loans.apply (guarantor too), shares (replacing the status-blind check), dividends, resolveUnrouted allocate, imports, manual journal attribution, investments, future fines. The returned `membershipId` is what gets written to the row (§6) — validation and attribution are the same act.

---

## 6. Database Integrity *(Gap 8)*

**(a) One three-column composite FK** — transaction ownership provably bound to exactly one membership row:

```sql
CREATE UNIQUE INDEX uq_gm_id_group_member ON group_members (id, group_id, member_id);

ALTER TABLE contributions
  ADD COLUMN group_membership_id UUID,
  ADD CONSTRAINT fk_contrib_membership
    FOREIGN KEY (group_membership_id, group_id, member_id)
    REFERENCES group_members (id, group_id, member_id);
-- likewise: loans (guarantor via two-column FK), loan_repayments,
-- welfare_pool_contributions, welfare_requests, share_transactions,
-- share_holdings, dividend_allocations, payment_requests.
-- Backfill → SET NOT NULL. Applied NOT VALID → VALIDATE CONSTRAINT (§19).
```

A row referencing a membership from another group, or a member not in the row's group, is **unrepresentable** regardless of any future application bug.

**(b) Immutability triggers:** `membership_no` (§1.4); `groups.payment_prefix` after first membership (§1.3); `mpesa_receipt_number` and `amount` on the spine once set (corrections go through reallocations, never UPDATE); financial rows never DELETEd.

**(c) Idempotency constraints:** `UNIQUE(mpesa_receipt_number)` on the spine; `UNIQUE(payment_id)` on each domain table (one payment → at most one row per product table); `UNIQUE(fulfilled_by_payment)` on requests.

**(d) Value constraints:** `amount > 0` CHECKs on every money column (present on most tables — sweep the rest); journal balance guard (exists, mig 027); `damm_valid` CHECK on `membership_no`; counter range CHECK (§1.4).

**(e) Ledger attribution:** `journal_entries` gains nullable `group_membership_id` + `member_id` from the source document; callback-posted entries record a designated **system actor** instead of NULL. Batch entries (dividend declarations) leave entry-level fields NULL and rely on per-member source documents.

**(f) Pre-constraint data repair:** rows whose `(group_id, member_id)` has no membership are the audit's cross-group pollution — report, back-date a membership (if historically legitimate) or quarantine, *before* `VALIDATE CONSTRAINT`.

---

## 7. Transaction Attribution & Auditability *(Gap 10)*

The spine gains permanent audit columns:

```sql
ALTER TABLE payments ADD COLUMN channel      TEXT;      -- stk | paybill | import | manual | api | bank_va…
ALTER TABLE payments ADD COLUMN initiated_by UUID;      -- member/staff; NULL only for pure C2B walk-ins
ALTER TABLE payments ADD COLUMN session_id   UUID;      -- initiating session, when one exists
ALTER TABLE payments ADD COLUMN request_id   TEXT;      -- correlation id from the API layer
ALTER TABLE payments ADD COLUMN client_ip    INET;
```

And an append-only event trail (INSERT-only; no UPDATE/DELETE grants):

```sql
CREATE TABLE payment_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id  UUID NOT NULL REFERENCES payments (id),
  event       TEXT NOT NULL,          -- received|validated|allocated|journal_posted|unrouted|
                                      -- reallocated|reversed|refunded|charged_back|replayed
  actor       UUID,                   -- member/staff, or the system actor
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Every money row therefore permanently answers: who initiated, who approved (domain columns + reallocation approver), who/what processed (system actor + `payment_events`), source channel/device/IP/session, membership + group (+ derivable organizations), product + ledger (`journal_entry_id`), original request (`payment_requests`/`mpesa_stk_requests`), raw callback (`mpesa_callbacks`), and the full correction history (`payment_reallocations` + events). **Nothing affecting money is untraceable**; audit-write failure on the money path fails the transaction (audit is not best-effort — §14).

---

## 8. Group Switcher & Member Experience *(audit M-5)*

**API:** `POST /api/v1/auth/switch-group { membershipId | groupCode }` — authenticated by the current refresh token (no password); validates target membership `status='active'` and group not suspended/archived; issues a **new session** bound to the new membership, leaving other sessions untouched; returns the login response shape.

**UI:** the sidebar group block becomes a switcher listing all active memberships — group name, role, Membership Number, lazy-loaded balance snapshot. Active group name + Membership Number pinned in the header; alias shown beside the number when set.

**Notifications** (audit M-2): every payment SMS/email names group, number, product, balance:

```
KitabuYetu: KES 1,000 savings received for Bungoma Women's VSLA (A/C BG 10253 4).
Receipt XYZ123. Savings balance: KES 26,000.
```

Template variables `{{group_name}} {{membership_no}} {{product}} {{balance}}`; the dead receipt-email query (audit M-1) is fixed in the same change.

---

## 9. Multi-Group Isolation — Workflow Stress Test *(Gap 6)*

Every workflow, checked for cross-membership effects:

| Workflow | Isolation mechanism |
| --- | --- |
| STK Push | Request pinned to `membership_id` at initiation; fulfilment reads it back; prompted phone may be third-party without affecting destination |
| PayBill | Registry → single membership; check digit + validation kill typo cross-posting |
| Savings / Loans / Shares / Welfare / Investments | Guard (§5) + three-column FK (§6) on every write; product dispatch to owning tables |
| Fines (future) | Same guard + FK pattern mandated at module creation |
| Notifications | Rendered from the transaction's membership row — group name + number in every message; a multi-group member always knows which membership fired |
| Reports / Statements | All queries `ctx.groupId`-scoped (verified in audit); statements are per membership; cross-group portfolio views are explicit, member-initiated queries only |
| Dashboard metrics | Computed per `groupId` from the session context; no cross-group aggregation exists server-side |
| Authentication / refresh | Pinned `membershipId` + version epochs (§2) |
| Switch group | New session; old sessions unaffected; each token immutable |
| Ledger posting | `journal_entries.group_id` NOT NULL + RLS; posting helpers receive group from the source document, never from ambient state |
| Treasurer unrouted resolution | Guard on allocate; candidate-group scoping; FK backstop |
| Group rename / merger / transfer | Immutable prefix + numbers; transfer = exit + join |
| Shared members across organizations | Membership is group-scoped; orgs aggregate via `organization_group_access` read policies, never own member transactions |
| Federations / SACCOs | Organization-layer constructs over group-scoped memberships; the transaction layer never merges; `person` (national-id) is the future KYC join point |
| Concurrent payments to two groups | Independent memberships, numbers, spine rows — no shared state |

**Remaining accepted risks:** sequential-number enumerability (low; §15.4); stale role in an access token ≤ its lifetime on non-version-checked endpoints (§2.5); org attribution derivable rather than denormalised (§2.4).

---

## 10. Future Integrations *(Gap 15)*

The registry (§3.1) + spine (§3.4) + outbox (§12) are the extension points; **no payment-architecture redesign is needed** for:

| Integration | How it lands |
| --- | --- |
| Banking APIs / Open Banking | Bank virtual account numbers = registry rows (`kind='bank_va'`); inbound credits enter the spine like C2B |
| Visa / Mastercard | Tokenised card refs as registry rows; card payment = spine entry (`channel='card'`); chargebacks = `payment_reallocations` type `charged_back` with card-network evidence in `payment_events.detail` |
| Airtel Money | New collector adapter → spine; same registry lookup |
| QR Payments | QR encodes PayBill + Membership Number today; richer QR = registry `kind='qr'` |
| Standing orders / Recurring | Scheduler emitting `payment_requests` on cadence |
| Open Banking / **ISO 20022** | Membership Number maps to `EndToEndId`/structured remittance (`RmtInf/Strd/CdtrRefInf`); spine fields align with pacs.008 semantics (debtor = payer phone/account, creditor ref = membership number, settlement = receipt). An ISO adapter is a translator into the same spine — no schema change |
| API partners | Partner-scoped aliases (`kind='api_alias'`) + idempotency keys (§13) |
| Multi-currency | `payments.currency` exists from Phase 1.5; product tables follow when a second currency ships |
| Member wallets | One more allocation target + registry kind; the spine already separates receipt from allocation |

---

## Part II — Enterprise Hardening

## 11. Payment Lifecycle State Machine *(Gap 9)*

Two coordinated machines. **Collection state** (STK request / spine payment):

| State | Entered when | Exits to |
| --- | --- | --- |
| `pending` | STK initiated / C2B expected | `processing`, `failed`, `cancelled`, `expired`, `timed_out` |
| `processing` | Callback received, allocation in flight | `completed`, `failed` |
| `completed` | Funds confirmed + spine written | terminal for collection; allocation machine takes over |
| `failed` | Daraja failure code | terminal (fallback SMS; member may retry via PayBill) |
| `cancelled` | Member cancelled STK (1032) | terminal |
| `expired` / `timed_out` | No callback; STK-Query reconciliation confirms no charge | terminal |

**Allocation state** (spine `allocation_status`): `received → allocated | unrouted`, then `allocated → reallocated | reversed` (corrections), with `refunded` and `charged_back` recorded as reallocation types (outbound leg via B2C/refund rails when applicable). All transitions append `payment_events` rows.

Callback anomalies — defined behaviour for each:

| Anomaly | Behaviour |
| --- | --- |
| **Duplicate callback** (same receipt, any path, any count) | Spine `UNIQUE(receipt)` + status latch → no-op; `payment_events: replayed` logged |
| **Delayed callback** | `pending` rows older than threshold reconciled via STK-Query (existing job); if money moved, reconciliation completes the spine + allocation; a later real callback then no-ops |
| **Out-of-order** (failure callback after success, or vice versa) | `completed` is terminal — a late failure for a completed checkout is logged and ignored; a late success for a `failed` checkout is impossible from Daraja, but if received it is treated as a new receipt through validation (reconciliation arbitrates) |
| **Retry** | Member-initiated retries are new checkouts (duplicate-prompt lock exists); platform never auto-retries STK |
| **Reversal / Refund** | Contra journals + reallocation record; outbound leg (B2C/M-Pesa reversal API) linked via `payment_events.detail` |
| **Chargeback** (card rails, future) | Reallocation type `charged_back`; funds movement mirrors refund; evidence retained in event detail |

## 12. Event Architecture — Transactional Outbox *(Gap 11)*

**Decision: outbox now, event bus deferred.** Payment side effects (SMS receipt, email, dashboard cache invalidation, credit-score update, webhooks) must not run inside the money transaction, but publishing to an external broker from inside a transaction creates dual-write inconsistency. The standard resolution:

```sql
CREATE TABLE event_outbox (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type   TEXT NOT NULL,        -- payment.received | payment.allocated | ledger.posted |
                                     -- receipt.generated | notification.queued | loan.updated |
                                     -- balance.updated | audit.recorded …
  aggregate_id UUID NOT NULL,        -- payment_id / loan_id / membership_id
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
```

- Written **in the same transaction** as the money change — an event exists iff the change committed.
- Dispatched by the existing job-queue/pg_cron workers (the SMS trigger engine already consumes business events; it becomes an outbox consumer). At-least-once delivery + idempotent consumers (keyed on `(event_type, aggregate_id)` — the trigger engine already dedupes this way).
- **A dedicated broker (Kafka/SNS) is deliberately deferred** until there is more than one consuming *service*. The outbox schema is broker-ready: introducing a bus later means pointing a relay at this table — zero producer changes. This is the simplicity/integrity trade the design principles demand.

## 13. API Standards *(Gap 12)*

Mandatory for all payment-affecting endpoints:

| Standard | Specification |
| --- | --- |
| **Idempotency** | `Idempotency-Key` header required on every money-moving POST (stk-push, manual contribution, reallocation, B2C). Key + response stored 24h; replay returns the original response, never re-executes |
| **Optimistic concurrency** | Mutations of stateful rows (requests, memberships) carry the row's `updated_at`/version; stale writes → `409 CONFLICT` |
| **Versioning** | `/api/v1` retained; breaking changes only via `/api/v2`; additive changes within v1 |
| **Error envelope** | Existing `{ error: { code, message } }` with a **closed catalogue** of machine-readable codes (`INVALID_ACCOUNT`, `MEMBERSHIP_INACTIVE`, `DUPLICATE_RECEIPT`, `AMOUNT_VARIANCE`, `NO_ACTIVE_GROUP`, `STALE_VERSION`, …) |
| **Retry safety** | Idempotency keys + spine uniqueness make every documented retry safe; 5xx responses are always retryable, 4xx never |
| **Pagination** | Existing `page/limit` + totals pattern, mandatory on all list endpoints |
| **Authorization** | `withRole`/`withOneOf` + version-epoch re-check (§2.5) on sensitive operations |
| **Validation** | Zod schemas on every input (existing pattern); membership numbers validated with `damm_valid` at the edge |
| **Backward compatibility** | Legacy identifiers accepted via registry aliases indefinitely; response shapes only extended, never repurposed |

## 14. Operational Resilience *(Gap 13)*

| Failure | Behaviour | Recovery |
| --- | --- | --- |
| **Database unavailable during callback** | **Ack-after-durable-audit:** if the raw-callback audit insert fails, return **non-200** so Safaricom retries (currently the platform acks unconditionally and can lose the callback — this changes). | Safaricom retry → audit lands → DLQ processes |
| Database unavailable during processing (post-audit) | Audit row persisted, processing marked errored | DLQ replay job (exists) re-runs idempotent handlers |
| **M-Pesa/Daraja unavailable** | STK initiation fails fast with a clear error; PayBill unaffected (Safaricom-side); B2C queued with backoff | Circuit-break Daraja calls; queued retries |
| **Redis unavailable** | Refresh falls back to `refresh_tokens` table (exists); STK duplicate-prompt lock degrades — receipt uniqueness still guarantees no double-posting; rate limits degrade to conservative defaults | Self-heals on reconnect |
| Delayed callback | §11 — STK-Query reconciliation | Existing job |
| Duplicate callback / retry storm | Idempotent by construction (spine + per-table uniques + idempotency keys); DLQ uses exponential backoff | None needed |
| Worker/queue failure | Outbox + DLQ rows persist; nothing is lost, only delayed | Workers resume; depth alerting (§16) |
| Network partition mid-allocation | Single DB transaction — allocation is all-or-nothing; spine `received` state catches the "receipt landed, allocation didn't" case | Orphan monitor + replay |
| **Clock skew** | All financial timestamps are DB server time (`NOW()`); client/device clocks never touch money; token expiry validated server-side with standard JWT leeway | N/A |
| Validation endpoint slow/down | Fail-open ACCEPT (§3.2) — payments proceed to confirmation handling | p99 alerting |

## 15. Security Architecture *(Gap 14)*

### 15.1 Callback integrity (spoofing, tampering, replay)

- Callback URLs carry an **unguessable path token** (URL secret registered with Safaricom); requests without it are dropped before parsing. IP allow-listing stays advisory (Vercel edge realities) but mismatches alert.
- STK callbacks only act on **platform-initiated** `checkout_request_id`s; C2B only on registry-validated accounts. A fabricated callback for an unknown checkout/receipt writes nothing.
- Replay: receipt uniqueness + terminal states (§11) make replays no-ops; the raw-callback audit log preserves evidence.
- **Reconciliation is the source of truth**: the nightly Safaricom statement diff (§16) catches anything injected or missed regardless of callback-layer integrity.

### 15.2 Request integrity

- All money-POSTs behind auth + Zod validation + idempotency keys; amounts re-validated server-side; no client-supplied routing identifiers are trusted without registry lookup + check digit.

### 15.3 Tokens & sessions

- **Refresh rotation with reuse detection** (§2.3): a consumed refresh token presented again revokes the whole lineage — stolen-token replay dies on first legitimate refresh.
- Version epochs (§2.5) kill sessions on blacklist/password change; sensitive endpoints re-check epochs, closing the stale-access-token window where it matters.
- Refresh tokens stored hashed (existing); IP/user-agent recorded per session for anomaly review.

### 15.4 Enumeration & abuse

- Check digit makes blind membership-number guessing ~10× harder; **rate limiting** on the validation endpoint and `ACC` SMS keyword per MSISDN/IP (Redis, conservative defaults on Redis loss); repeated `unknown_account` rejections from one source alert (§16).
- Login brute force: existing lockout mechanism retained.
- Accepted residual: valid-number discovery lets an attacker *donate* to a stranger — no confidentiality or integrity impact.

### 15.5 Insider abuse

- **Maker-checker on corrections**: `payment_reallocations` above a group-configurable threshold require a second approver (distinct member, officer role); recorded as actor + approver.
- Manual transactions always record `initiated_by` + channel `manual`; treasurer activity is visible in `payment_events`; immutable audit (§7) means insider actions cannot be erased, only appended to.
- Privilege escalation: roles live on the membership row, re-read at refresh, epoch-checked on sensitive ops; no client-supplied role is ever trusted (header stamping is proxy-only).

### 15.6 Secrets

- Daraja credentials, JWT keys, URL tokens in the managed secret store (env/Vercel), never in the repo; rotation procedure documented per secret; JWT key rotation supported via `kid` header with a two-key overlap window.

## 16. Monitoring & Observability *(Gap 17)*

| Metric | Threshold → Alert | Page? |
| --- | --- | --- |
| Payment success rate (completed / initiated, 15-min window) | < 98% | Yes |
| Unrouted payments | > 5/day or any single > KES 10,000 | Business hours |
| Spine orphans (`received` > 15 min) | > 0 | Yes |
| Callback processing lag (received → allocated p95) | > 2 min | Yes |
| C2B validation p99 latency | > 2 s (Safaricom timeout risk) | Yes |
| Validation fail-open rate | > 1% of validations | Yes |
| DLQ / outbox depth | > 0 for 10 min | Yes |
| Duplicate-callback rate | Spike > 3× baseline | Business hours |
| Ledger posting failures (journal skipped) | > 0 | Yes |
| Reconciliation diff (nightly) | Any one-sided receipt | Yes |
| Auth: refresh failures / NO_ACTIVE_GROUP rate | Spike > 3× baseline | Business hours |
| Switch-group failures | Spike | Business hours |
| Audit-write failures (`payment_events`) | > 0 (audit failure fails the tx — this alerts on the tx failures) | Yes |
| Prefix saturation | Any prefix > 80% | Weekly review |
| Rate-limit triggers (validation/ACC) | Sustained from one source | Business hours |

**Dashboards:** (1) Payments Ops — volumes, success rate, states, unrouted queue age; (2) Routing Health — registry hit rates by kind, validation accept/reject breakdown, legacy-grammar usage (drives print-material retirement); (3) Financial Integrity — reconciliation results, reallocation volume, maker-checker queue; (4) Auth Health — refresh outcomes, session lineages, epoch bumps. All metrics tagged `is_test`/`ZZ`-prefix so sandbox traffic never pollutes production signals.

---

## Part III — Governance & Delivery

## 17. Gap Closure Matrix

| Gap | Closed in | Key change | DB change | Migration impact |
| --- | --- | --- | --- | --- |
| 1 Number governance | §1.8 | Ownership/reservation/exhaustion/DR rules | `ZZ` reservation; DR rebuild script | None beyond Phase 1 |
| 2 Payment-identity governance | §1.1, §3.1 | Single public identity + module sweep + CI template check | — | Phase 1 UI sweep |
| 3 Routing engine | §3.3 | Deterministic decision table R1–R10 | — | Phase 1 |
| 4 Membership state machine | §4.1 | Per-state payment/auth/reporting/audit; obligations-only suspension; reinstatement | `auth_version` trigger | Phase 0 (status sweep) + Phase 2 (eligibility rules) |
| 5 Allocation engine | §3.5 | Decision table A1–A9; expired requests inert; invalid suffix rejected; config-error alarm | Request expiry job | Phase 2 |
| 6 Multi-group isolation | §9 | Workflow-by-workflow verification incl. notifications/statements/dashboards | — | Continuous (tests) |
| 7 Auth context | §2.5 | `authVersion` + `sessionVersion` epochs; sensitive-op re-check | 2 columns + triggers | Phase 3 |
| 8 DB constraints | §6 | Three-column FK; immutability triggers; `UNIQUE(payment_id)`; value CHECKs | As listed | Phase 3 (`NOT VALID`→`VALIDATE`) |
| 9 Payment lifecycle | §11 | Full state machines; duplicate/delayed/out-of-order/reversal/chargeback behaviour | Spine states | Phase 1.5 |
| 10 Auditability | §7 | Spine audit columns + append-only `payment_events`; audit failure fails the tx | 2 tables/columns | Phase 1.5 |
| 11 Events | §12 | Transactional outbox; bus deferred (ADR-17) | `event_outbox` | Phase 1.5 |
| 12 API design | §13 | Idempotency keys, optimistic locking, error catalogue, versioning | Idempotency store | Phase 1.5–2 |
| 13 Resilience | §14 | Failure matrix; **ack-after-durable-audit** | — | Phase 0 (ack change) |
| 14 Security | §15 | URL tokens, refresh rotation + reuse detection, rate limits, maker-checker | Reallocation approver | Phases 1–3 |
| 15 Future integrations | §10 | ISO 20022/card mapping via registry + spine | — | None |
| 16 Migration | §19 | Shadow-mode cutover, success/failure criteria, validation queries | — | — |
| 17 Observability | §16 | Metrics, thresholds, dashboards, paging | — | From Phase 1 |

## 18. Architectural Decisions Log (ADR)

| # | Decision | Status | Rationale / supersedes |
| --- | --- | --- | --- |
| ADR-1 | Payment account is **membership**-scoped, not member-scoped | Accepted (v1) | Isolation falls out of the identifier |
| ADR-2 | Fixed 8-char `PP DDDDD C` with Damm check digit | Accepted (v2) | Supersedes variable format; kills typo-pays-a-stranger |
| ADR-3 | Prefix = immutable branch-code; name only seeds a suggestion | Accepted (v2) | Renames/mergers can never disturb payment identity |
| ADR-4 | Membership Number is the **only** public payment identifier | Accepted (v2, CI-enforced v3) | Gap 2 |
| ADR-5 | Display aliases: cosmetic, never routable, absent from registry | Accepted (v2) | — |
| ADR-6 | Single `payment_accounts` registry as sole routing index | Accepted (v2) | Absorbs legacy + all future kinds |
| ADR-7 | C2B Validation actively rejects; fail-open on internal error | Accepted (v2) | Ships with Phase 1, never after the short number |
| ADR-8 | Payment spine + `payment_reallocations` contra-entry corrections | Accepted (v2) | Exactly-once, orphans queryable, chargeback-ready |
| ADR-9 | One three-column composite FK | Accepted (v2) | Supersedes dual mechanism |
| ADR-10 | Product resolution: request → suffix → member default → group default; requests optional | Accepted (v2); tables hardened v3 (A1–A9) | Retains member-default tier (explicit product requirement) |
| ADR-11 | Sessions are independent lineages; switch-group mints a new session | Accepted (v2) | — |
| ADR-12 | Organization attribution derivable, not denormalised | Accepted (v1, reaffirmed) | Many-to-many schema reality |
| ADR-13 | `currency` on the spine now | Accepted (v2) | Cheap now, brutal later |
| ADR-14 | Numbers immutable, never recycled; transfer = exit + join | Accepted (v1, DB-enforced v2) | — |
| ADR-15 | Partial payments never complete obligations | Accepted (v2) | Fixes pre-existing defect |
| ADR-16 | Phone is metadata; third-party flagged, never re-routed | Accepted (v1, reaffirmed) | — |
| ADR-17 | **Transactional outbox now; event bus deferred** until >1 consuming service | Accepted (v3) | Dual-write safety without broker complexity; broker-ready schema |
| ADR-18 | `authVersion` + `sessionVersion` epochs; sensitive ops re-check | Accepted (v3) | Kills silent drift; two epochs subsume finer-grained version counters |
| ADR-19 | **Ack-after-durable-audit** for callbacks (non-200 if audit write fails) | Accepted (v3) | Supersedes unconditional 200-ack; Safaricom retry becomes the durability mechanism |
| ADR-20 | Maker-checker on reallocations above group threshold | Accepted (v3) | Insider-abuse control |
| ADR-21 | Suspended memberships: obligations-only inbound (loan repayments yes, savings no) | Accepted (v3) | Members can always reduce debt; group controls new exposure |
| ADR-22 | `Idempotency-Key` mandatory on money-moving POSTs | Accepted (v3) | Retry safety end-to-end |
| ADR-23 | Shadow-mode routing cutover with quantified success criteria | Accepted (v3) | §19 |
| ADR-24 | `ZZ` prefix reserved for test/sandbox allocations | Accepted (v3) | Test traffic structurally identifiable |
| ADR-25 | Refresh-token rotation with reuse detection → lineage revocation | Accepted (v3) | Stolen-token replay dies on first legitimate refresh |

## 19. Roadmap, Migration & Cutover *(Gaps 13, 16)*

**Phase 0 — stop the bleeding. No DB migrations, ship now.**

1. Refresh-route rewrite: persist + revalidate membership context (audit C-1).
2. `is_active` → `status='active'` sweep (audit C-2).
3. `assertActiveMembership` on contributions / welfare / unrouted writes (audit H-1).
4. Delete group-name BillRef fallback (audit H-4).
5. Callback ack-after-durable-audit (ADR-19) — a config-flagged behaviour change, no schema.

*Rollback: code revert.*

**Phase 1 — Membership Number + registry + validation (one release, inseparable):**

1. Migrations: `payment_prefix` (+ trigger), `membership_no_counters`, `membership_no` (+ Damm CHECK, unique, trigger) → backfill → NOT NULL; `display_alias`; drop `mpesa_ref`; `payment_accounts` + backfill (membership numbers, legacy codes, invoices); DR rebuild script.
2. Allocation wired into `linkMemberToGroup` + `register_group`.
3. Routing via registry; **C2B validation active** + rate limiting; third-party flagging.
4. UI sweep (only-public-identity) + CI template check; SMS `ACC` keyword; monitoring dashboards live.

*Rollback: additive — stop printing, validation to accept-all via flag; legacy routing unaffected.*

**Phase 1.5 — payment spine + audit + outbox:**

1. `allocation_status`, `currency`, audit columns, `payment_id` (+ `UNIQUE`) on domain tables, `payment_reallocations`, `payment_events`, `event_outbox`; idempotency-key store; orphan monitor + nightly reconciliation.

*Rollback: additive columns; dispatch works without reading them.*

**Phase 2 — product-aware allocation:**

1. `payment_requests` + expiry job; allocation engine A1–A9; suffix hints; per-state payment eligibility (§4.1).
2. Product dispatch to owning services; `partially_paid` semantics.

*Rollback: dispatch behind a feature flag; flag off restores savings-default.*

**Phase 3 — DB integrity + context hardening:**

1. Pollution audit → repair/quarantine → composite FKs `NOT VALID` → `VALIDATE` → `group_membership_id` NOT NULL; immutability triggers; value-CHECK sweep.
2. JWT claims (`membershipId`, `membershipNo`, epochs) + proxy + `TenantContext`; sensitive-op version checks; refresh rotation + reuse detection; maker-checker on reallocations; ledger attribution + system actor.

*Rollback: `DROP CONSTRAINT` / claim-check flags; no data loss.*

**Phase 4 — UX:**

1. switch-group endpoint + sidebar switcher + balance snapshots.
2. Notification templates; receipt-email fix; retire legacy refs from printed materials.

*Rollback: UI-only.*

**Cutover strategy (routing):** the registry router runs in **shadow mode** for ≥2 weeks before it takes over — both old and new routers evaluate every inbound payment; the old router's decision executes; divergences are logged and reviewed daily.
**Success criteria to flip:** ≥ 99.5% decision agreement (divergences explained and in the new router's favour), zero new unrouted regressions, validation p99 < 2s, dashboards green for 7 consecutive days.
**Failure criteria (abort/rollback):** any cross-group misroute by the new router in shadow analysis; validation fail-open rate > 5%; reconciliation diffs attributable to the new path.
**Data validation:** pre-flip queries — every active membership has a valid `membership_no` and registry row; `damm_valid` holds for 100%; registry rebuild script output matches live table; zero composite-FK violations remaining.
**Monitoring through migration:** §16 dashboards plus a temporary shadow-divergence metric.

## 20. Acceptance Criteria

| Scenario | Required behaviour |
| --- | --- |
| Multi-group member's token refreshes | Same membership, group, role (re-read); re-validated, never re-chosen |
| Role changed by admin | New role at next refresh; sensitive ops see it immediately (epoch check) |
| Member blacklisted | `session_version`/`auth_version` bump → sessions die at next request/refresh; payments rejected per §4.1 |
| Typo'd account number (single-digit error / adjacent transposition) | Fails Damm check → rejected at validation; on fail-open, unrouted — never posted |
| Payment to an exited membership's number | Rejected at validation; on fail-open, unrouted (`membership_inactive`); number never reissued |
| Suspended member pays loan installment | **Accepted** (obligations-only rule); savings payment from same member rejected |
| Spouse pays `BG 10253 4` from own phone | Posts to Jane's Bungoma membership; flagged third-party |
| Spontaneous deposit, no request open | Allocates via member default → group default; never rejected, never parked |
| Two open requests, one exact amount match | Exact-amount request wins |
| Two open requests, no amount match | Oldest wins; `amount_variance` tagged |
| Expired request exists | Ignored entirely (A6) |
| Invalid suffix (`-X`) | Rejected as malformed (A1); never a guess |
| Partial loan installment | `partially_paid`, running total; never `completed` short |
| Overpaid final installment | Excess to next tier; never negative receivable |
| Welfare payment `BG102534-W` | Welfare table + welfare ledger, not savings |
| Duplicate callback (any path, any timing) | Spine no-op; `replayed` event logged |
| Out-of-order failure-after-success | Ignored + logged; `completed` is terminal |
| Callback arrives while DB is down | Non-200 → Safaricom retries → audited → processed |
| Payment received, allocation crashes | `received` orphan visible in ≤15 min; DLQ replay completes |
| Posted to wrong membership/product | Maker-checker reallocation + contra journals; originals immutable; full event chain |
| Treasurer allocates unrouted receipt to a non-member | Guard rejects; composite FK backstops |
| Same idempotency key replayed to stk-push | Original response returned; no second prompt |
| Consumed refresh token replayed | Session lineage revoked |
| Fabricated callback for unknown checkout/receipt | Writes nothing; URL-token failure drops it earlier |
| Group renamed / merged / org renamed / platform migrated | Prefix and all numbers unchanged; transfer = exit + join |
| Alias typed as a PayBill account | Not in registry → rejected (aliases never route) |
| Legacy `KYT-CONTR-…` ref from an old poster | Registry alias resolves; posts normally |
| Member removed from group A, active in B | A: rejected/parked; B: unaffected; switcher/refresh list only B |
| Test payment (sandbox) | `ZZ` prefix + `is_test` — never in production metrics or ledgers |
| Bank / card / Airtel / QR / ISO 20022 integration added | New registry kind + spine entry path; no routing redesign |

## 21. Reviews

**Security Review (summary):** Callback surface protected by URL tokens + platform-initiated-only actions + registry validation + reconciliation as ultimate arbiter; replay-safe by uniqueness and terminal states; token theft contained by rotation-with-reuse-detection and version epochs; enumeration bounded by check digit + rate limits; insider actions dual-controlled (maker-checker) and immutably audited; secrets managed and rotatable. Residual: sequential-number discoverability (donation-only impact), ≤1 access-token-lifetime role staleness on non-sensitive endpoints. **Pass with residuals accepted.**

**Scalability Review (summary):** Number space ~67M with governed overflow; allocation contention confined to membership creation; routing is one indexed lookup; spine/journal growth linear with volume — partition plan (by group hash or entry date) required before ~10⁸ rows, indexes already group-prefixed; outbox prevents synchronous fan-out in the money path; multi-currency and new channels land without schema redesign. **Pass; partitioning is the one scheduled follow-up.**

**Operational Readiness Review (summary):** Every failure mode has defined behaviour + recovery (§14); durability anchored on ack-after-durable-audit + DLQ + reconciliation; observability with paging thresholds (§16); runbooks required at Phase 1: unrouted-queue handling, reallocation with maker-checker, DR registry rebuild, validation flag flip, shadow-divergence review. **Pass, conditional on runbooks shipping with Phase 1.**

## 22. Production Readiness Checklist

| # | Item | Gate |
| --- | --- | --- |
| 1 | Phase 0 deployed (context pinning, status unification, guards, no name-routing, durable-ack) | Before anything else |
| 2 | Damm implementation property-tested (all single-digit errors + adjacent transpositions caught) | Phase 1 code review |
| 3 | C2B validation live, rate-limited, p99 < 2s, fail-open verified by chaos test | Phase 1 launch |
| 4 | Registry backfill verified: 100% active memberships have valid numbers + registry rows; rebuild script output matches | Phase 1 launch |
| 5 | UI sweep + CI template check green (no member_code/UUID on payment surfaces) | Phase 1 launch |
| 6 | Spine + events + outbox live; orphan monitor firing in staging test | Phase 1.5 |
| 7 | Nightly reconciliation running; one induced diff detected in staging | Phase 1.5 |
| 8 | Allocation engine A1–A9 covered by integration tests incl. expiry, invalid suffix, config-error | Phase 2 |
| 9 | `partially_paid` semantics verified against real installment data | Phase 2 |
| 10 | Pollution repair complete; composite FKs VALIDATEd; zero violations | Phase 3 |
| 11 | Epoch claims + sensitive-op checks live; blacklist kill-switch tested | Phase 3 |
| 12 | Refresh rotation + reuse detection tested (replay revokes lineage) | Phase 3 |
| 13 | Maker-checker flow exercised end-to-end with a real reallocation | Phase 3 |
| 14 | Shadow-mode cutover criteria met (≥99.5% agreement, 7 green days) | Routing flip |
| 15 | Dashboards + paging live; on-call runbooks published | Phase 1 onward |
| 16 | DR drill: registry + counters rebuilt from backup in staging | Before GA |

**Final verdict: with this v3 specification implemented in the stated order, the architecture eliminates every known source of cross-group contamination, makes incorrect routing and invalid financial records unrepresentable by design, requires no manual reconciliation in normal operation, scales to millions of memberships across thousands of organizations, and keeps the member experience to exactly two things: a Business Number and a Membership Number.**
