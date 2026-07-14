# Architectural Review — Payment Architecture Redesign

**Date:** 2026-07-13
**Reviewed artifact:** `PAYMENT_ARCHITECTURE_REDESIGN.md`
**Review posture:** Principal software / payments / database architect. Target operating envelope: thousands of organizations, hundreds of thousands of groups, millions of members, multi-group and cross-organization membership, M-Pesa STK + PayBill today, wallets/banks/cards/Airtel/QR/standing orders within the decade.

---

## 1. Executive Summary

The redesign is directionally correct and fixes every audit finding it targets. Membership-scoped payment accounts, an immutable Active Membership Context, centralized membership validation, and composite FK integrity are the right foundations, and the Phase 0 ordering (fix the two critical bugs with zero migrations) is exactly right.

However, the design as written is **not yet production-ready for Phase 1+** because it introduces one new financial risk and leaves three structural gaps:

1. **The short Membership Number has no check digit.** A single-digit typo (`BG1025` → `BG1052`) is likely to hit *another valid membership in a different group* — a brand-new cross-group contamination vector created by the very feature meant to eliminate contamination. Long ugly references were accidentally typo-resistant; short dense sequential ones are not.
2. **C2B Validation is currently a rubber stamp.** The platform already registers a Safaricom validation URL and unconditionally returns `ResultCode: 0` (`app/api/v1/mpesa/c2b/route.ts:22-34`). This is the single highest-leverage safeguard available — reject a bad account number *before money moves* — and the design doesn't use it.
3. **Allocation happens directly inside the callback with no payment spine.** Once product-aware dispatch spreads incoming money across five destination tables, the platform needs a single receipt-of-funds record with an allocation state machine, or reallocation, reversal, and orphan detection remain impossible (the audit's L-3 stays unfixed).
4. **The two DB integrity mechanisms can disagree.** The composite FK validates `(group_id, member_id)` while `group_membership_id` is an independent FK to `group_members(id)` — a row can carry a membership id from a *different* group and both constraints pass. One three-column FK closes this.

All four are cheap to fix at design time and expensive to fix after launch. With them incorporated (see §6), the architecture is sound for a ten-year horizon.

**Verdict: APPROVE WITH REQUIRED CHANGES** — Phase 0 ships as-is immediately; Phase 1 is blocked on the check digit + real validation + unified FK; the payment spine must land before Phase 2's product dispatch.

---

## 2. Strengths (preserve these)

- **Membership (not member) as the payment account.** Exactly right. One human, N groups, N accounts — isolation falls out of the identifier itself.
- **Immutable Active Membership Context, revalidated-not-reselected on refresh.** Correctly eliminates audit C-1, including the role-drift subtlety (role re-read at refresh).
- **Validation and attribution as one act** (`assertActiveMembership` returns the `membershipId` that gets written). This is the pattern that keeps application-layer and DB-layer integrity from drifting apart.
- **Phone demoted to metadata + explicit third-party flagging.** Solves the spouse/employer/donor class of problems structurally instead of heuristically.
- **Numbers never recycled; inactive memberships park rather than post.** Correct for a financial identifier.
- **Group-name matching deleted, no phone guessing.** Both audit contamination vectors closed with no replacement heuristics.
- **Phase 0 as pure-code, independently shippable, most-critical-first.** Correct triage.
- **Organization attribution deferred honestly** rather than inventing a fake one-to-one relationship over a many-to-many schema.

---

## 3. Weaknesses

### W-1. No check digit (CRITICAL for Phase 1)
Sequential allocation makes the number space *dense*: after modest growth, most 4-digit values under popular prefixes are live accounts. M-Pesa's PayBill UI has no name-confirmation step for the payer — a mistyped account either bounces (good) or silently pays a stranger (catastrophic, and cross-group by construction since prefixes are shared across groups). Industry practice for human-typed account numbers is a check digit; the **Damm algorithm** (single table lookup, digits-only, catches 100% of single-digit errors and adjacent transpositions) is the right fit.

### W-2. Variable length + name-derived prefixes create skew and weak validation
- Kenyan group names cluster hard (Umoja, Upendo, Baraka, Bidii, Amani, Neema…): prefixes `UM`, `BA`, `NE` will be oversubscribed while most of the 676 space sits empty. A hot prefix exhausts 4 digits quickly and marches to 6, so members in *popular-named* groups get longer numbers over time — arbitrary and confusing.
- `[0-9]{4,6}` means length can't be validated at entry, and appended-digit typos (`BG1025` → `BG10255`) still parse.
**Fix:** fixed format from day one — `2 letters + 5 digits + 1 Damm check digit` = 8 chars (`BG102534`), ~100k accounts per prefix, uniform length, well inside every channel limit. Keep prefix name-derived for warmth, but treat it as cosmetic (uniqueness never depends on it), and overflow a saturated prefix to a variant letter pair rather than growing digits.

### W-3. C2B Validation unused
Everything in the design happens at *confirmation* time — after the member's money has left their phone. Wrong numbers become unrouted-queue toil, member frustration, and manual refunds. The validation hook can reject: unknown account, inactive membership, malformed check digit — before the transaction completes. (Caveat to engineer around: Safaricom requires validation responses within a tight timeout and the feature must be enabled on the short code; keep the lookup to one indexed query and fail-open to *accept* on timeout so payments are never lost to a slow lookup — unrouted queue remains the backstop.)

### W-4. No payment spine / allocation state machine
`payments` and `mpesa_transactions` already exist as receipt records, but domain rows (contribution / welfare / share / repayment) are inserted directly by the callback with idempotency enforced per-table via `UNIQUE(mpesa_receipt_number)`. With product dispatch across five tables:
- Exactly-once allocation is enforced five separate times instead of once.
- "Money received but not yet allocated" is not a queryable state → orphan detection is log-diving.
- Reallocation (posted to wrong membership/product) has no home — completed contributions are immutable and the audit's L-3 gap persists.
**Fix:** make the existing `payments` row the spine: `allocation_status ∈ (received, allocated, unrouted, reallocated, reversed)`, every domain row carries `payment_id`, and a `payment_reallocations` table records corrections as contra journal entries + a new allocation, never UPDATE/DELETE of financial rows. This is the standard receipt-vs-allocation split and it future-proofs reversals, chargebacks (cards later), and reconciliation.

### W-5. Composite FK and `group_membership_id` can disagree
As specified: `FOREIGN KEY (group_id, member_id) REFERENCES group_members(group_id, member_id)` plus an independent `group_membership_id REFERENCES group_members(id)`. Nothing stops `group_membership_id` from pointing at the same member's membership *in another group*.
**Fix:** one constraint that binds all three:
```sql
CREATE UNIQUE INDEX uq_gm_id_group_member ON group_members (id, group_id, member_id);
ALTER TABLE contributions ADD CONSTRAINT fk_contrib_membership
  FOREIGN KEY (group_membership_id, group_id, member_id)
  REFERENCES group_members (id, group_id, member_id);
```
Now a transaction row *is* provably one membership row. Drop the two-column variant.

### W-6. Product resolution ambiguity with multiple open payment requests
A member can simultaneously have an open loan-installment request and a monthly-savings request. "Open payment request" (priority 1) is then non-deterministic. Suffix hints add grammar the member must learn — the thing the short number was supposed to remove — and a mistyped suffix silently changes product.
**Fix:** deterministic resolution: (1) exact-amount match against open requests; (2) if none, a per-group **allocation waterfall** — the microfinance-standard ordering (arrears/fines → overdue loan interest → overdue principal → current installment → savings), configurable, defaulting to savings-only for simple chamas. Keep suffixes as an optional power-user feature, but never let a suffix override an exact-amount request match. Drop "member default payment preference" (a fourth mechanism with marginal value and support burden).

### W-7. Partial payments complete loan installments (pre-existing, folded in here)
`applyLoanRepayment` flips an installment to `completed` with whatever amount arrived (`mpesa.service.ts:460-471`). KES 500 against a 1,000 installment closes it and understates the receivable. The redesign's `amount_variance` tag is observability, not correctness. Installments need `partially_paid` semantics with running `amount_paid` before product-aware dispatch sends more money at this code path.

### W-8. Switch-group revokes the previous refresh token
Revoke-on-switch forcibly desynchronizes other tabs/devices mid-session (tab A dies when tab B switches). Sessions should be independent lineages: switch-group mints a *new* session (access+refresh) and leaves existing sessions untouched to expire naturally. Two deliberate parallel sessions in two groups is legitimate (a platform accountant serving two groups) — the per-token immutable context already makes this safe. Revocation stays for logout and security events.

---

## 4. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R-1 | Typo'd membership number pays a stranger in another group | **Critical** | W-1 check digit + W-3 validation rejection |
| R-2 | Sequential numbers are enumerable (competitive intel: growth rates; social engineering: valid-account guessing) | Low–Med | Accept for MVP (paying a guessed account only donates money); check digit makes blind enumeration 10× harder; revisit random-within-prefix allocation if abuse observed |
| R-3 | Allocation crash after receipt row but before domain row leaves invisible orphans | Med | W-4 spine: `allocation_status='received'` is queryable; DLQ replay already exists |
| R-4 | Validation endpoint latency causes Safaricom to drop payments | Med | Fail-open (accept) on any internal error/timeout; single indexed lookup; monitor p99 |
| R-5 | Prefix counter contention on hot prefixes | Low | Row-lock per prefix only on membership *creation* (rare); non-issue at stated scale |
| R-6 | Composite-FK migration fails on existing cross-group pollution | Med | Audit query first (`LEFT JOIN group_members … WHERE gm.id IS NULL`), repair/quarantine before constraint, `NOT VALID` + `VALIDATE CONSTRAINT` to avoid long locks on big tables |
| R-7 | Ten-year row volumes (journal_lines, contributions at millions of members) | Med | Plan partitioning (by group_id hash or entry_date) before ~10⁸ rows; keep all new indexes group-prefixed (already the codebase convention) |
| R-8 | KES-only schema meets multi-currency future | Low now, high later | Add `currency CHAR(3) DEFAULT 'KES'` to the payment spine **now** — one column, zero behaviour change, avoids a brutal retrofit |
| R-9 | Group "transfer" implemented as membership mutation would corrupt history | Med | Define transfer = exit old membership + create new one (new number); never re-parent a membership. State this as an invariant |

---

## 5. Recommended Improvements (beyond the fixes above)

**I-1. A payment-identifier registry instead of a column.**
Route *all* inbound identifiers through one table:
```sql
CREATE TABLE payment_accounts (
  identifier     TEXT PRIMARY KEY,          -- 'BG102534', legacy member_code, future bank VA no…
  kind           TEXT NOT NULL,             -- membership_no | legacy_code | bank_va | qr | api_alias
  membership_id  UUID NOT NULL REFERENCES group_members (id),
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
The membership number becomes one row; legacy `member_code`s are backfilled as alias rows (making legacy routing a plain lookup instead of grammar parsing); future bank virtual accounts, Airtel references, card tokens, and QR ids become new rows with **zero routing changes**. This is the concrete answer to review area 9 (future integrations) — the routing pipeline collapses to "normalise → one indexed lookup → membership", forever. `group_members.membership_no` stays as the canonical display value; the registry is the routing index.

**I-2. Wallet-readiness note.** With the spine (W-4) + registry (I-1), a future member wallet is just another allocation target and another identifier kind — no redesign. Worth a paragraph in the design doc so nobody builds wallets as a parallel system.

**I-3. Reconciliation.** Nightly job: Safaricom statement pull (transaction-status API already integrated) diffed against the spine by receipt; alert on receipts present on either side only. The audit's "reconciliation as source of truth" comment becomes an enforced control rather than a comment.

**I-4. UX polish.** Display grouped (`BG 1025 34`) everywhere, accept any spacing/dashes on input (normaliser already does this); "Lipia" screen in-app pre-fills PayBill + account with a copy button; SMS keyword (`ACC` → replies with all the sender's membership numbers by registered phone) for the forgot-my-number case; QR on the membership card. No member training needed beyond "Business number + your account number" — the KCB/utility-bill mental model Kenyans already have.

**I-5. Keep invoices separate.** `INV-YYYY-NNNNNN` is org-level billing with its own lifecycle; folding it into membership routing would conflate tenant-pays-platform with member-pays-group. Current separation is correct — just register invoice numbers in the identifier registry too (kind `invoice`) so routing stays one lookup.

---

## 6. Revised Architecture (delta only)

1. **Number format:** `PP DDDDD C` — 2-letter prefix, 5 digits, 1 Damm check digit; fixed 8 chars; validated at entry and in C2B validation.
2. **Routing:** normalise → `payment_accounts` lookup (covers membership numbers, legacy codes, invoices, future aliases) → membership → product resolution. Grammar parsing survives only inside the legacy-code backfill, not in the hot path.
3. **Validation hook:** implement accept/reject in the existing endpoint; reject `unknown_account`, `bad_check_digit`, `membership_inactive`; fail-open on internal error.
4. **Spine:** `payments.allocation_status` state machine; domain rows carry `payment_id`; `payment_reallocations` + contra journals for corrections/reversals.
5. **Integrity:** single three-column FK `(group_membership_id, group_id, member_id) → group_members(id, group_id, member_id)`.
6. **Product resolution:** exact-amount request match → per-group allocation waterfall → group default. Suffixes optional; member-preference tier dropped.
7. **Sessions:** switch-group creates a new session; no revoke-on-switch.
8. **Spine gets `currency` now.**

Everything else in the design doc stands.

---

## 7. Additional Edge Cases (add to §10 acceptance table)

| Scenario | Required behaviour |
|---|---|
| Typo'd account differing by one digit from a live account | Rejected at validation (check digit); if validation unavailable, confirmation-side check-digit failure → unrouted, never posted |
| Payment during the seconds between membership suspension and cache/state propagation | Confirmation re-checks status inside the allocation transaction (status read is row-locked with the membership) |
| Two open payment requests, neither amount matches | Waterfall allocation; both requests remain open; treasurer sees `amount_variance` |
| Overpayment of final loan installment | Excess flows to next waterfall tier (savings), never negative receivable |
| Same receipt delivered to STK callback AND C2B confirmation (Safaricom anomaly) | Spine `UNIQUE(receipt)` makes the second a no-op regardless of entry path |
| Membership number of a *pending_verification* membership | Validation rejects (`membership_inactive` class) — no money before verification |
| Group renamed after prefix assignment | Prefix is cosmetic and permanent; no re-issuance; document that prefix ≠ current name |
| Legacy `KYT-CONTR-…` ref arriving years later (old poster) | Registry alias still resolves it; posts normally |
| Member disputes allocation ("that was welfare, not savings") | `payment_reallocations` moves it with contra journals; original rows immutable; full audit chain |
| Bank/Airtel integration goes live | New `payment_accounts.kind`; zero routing changes (I-1) |

---

## 8. Production Readiness Assessment

| Area | Status |
|---|---|
| Multi-group isolation (auth, routing, DB) | ✅ Ready once W-5 FK variant used |
| Membership Number scheme | ⚠️ Blocked on W-1 (check digit) + W-2 (fixed length) |
| Incoming payment safety | ⚠️ Blocked on W-3 (real validation) |
| Financial correction/reversal capability | ⚠️ Blocked on W-4 (spine) — required before product dispatch multiplies destinations |
| Scale (stated envelope) | ✅ with R-7 partitioning noted for later; no architectural ceiling found |
| Future integrations | ✅ with I-1 registry; ⚠️ add currency now (R-8) |
| Migration/rollback | ✅ additive-first phasing; use `NOT VALID`+`VALIDATE` for FKs; feature-flag routing order |

**Overall: conditionally production-ready.** No finding invalidates the architecture; every blocker is a bounded addition to it.

---

## 9. Updated Rollout Recommendations

- **Phase 0 — unchanged, ship now.** (Refresh context, status unification, membership guard, delete name-matching.)
- **Phase 1 — Membership Number, amended:** check-digit format (W-1/W-2) and the **C2B validation implementation (W-3) ship in the same release** as the numbers — launching typo-prone short numbers without rejection capability is the one sequencing that must not happen. Add `payment_accounts` registry here (I-1) so legacy codes route via lookup from day one.
- **Phase 1.5 — payment spine (W-4) + currency column (R-8):** pulled forward from "later"; must precede product dispatch.
- **Phase 2 — product-aware allocation:** as designed, plus waterfall (W-6) and partial-installment fix (W-7).
- **Phase 3 — DB integrity:** three-column FK variant (W-5); pollution audit → repair → `NOT VALID` → `VALIDATE`.
- **Phase 4 — UX:** as designed, with I-4 additions; switch-group without revoke (W-8).
- **Rollback strategy per phase:** Phase 0 = code revert. Phase 1 = numbers are additive; stop printing, legacy routing unaffected. Validation = flip to fail-open accept-all (config flag). Spine = status column is additive; dispatch reads behind a feature flag. FKs = `DROP CONSTRAINT` restores prior behaviour without data loss.

---

## 10. Final Verdict

**Approve with required changes.** The core decisions — membership-scoped accounts, immutable session context, unified status, guard-plus-FK integrity, phone-as-metadata — are correct and should not be relitigated. The design's one genuine self-inflicted risk is the unguarded short identifier (W-1/W-3); its one structural debt is allocating without a spine (W-4); its one latent inconsistency is the dual FK mechanism (W-5). All three have precise, bounded fixes specified above. With those incorporated, this architecture will safely carry the platform through the stated ten-year envelope, and Phase 0 should be implemented today.
