# Open items — workplan (2026-08-20)

**Scope:** everything currently sitting open across the codebase and prior audits that isn't already merged — financial reconciliation actions, one unresolved production-reliability fix, and three unscoped feature proposals. Ranked by urgency × complexity, not by when it was found.

**How to read this:** *Urgency* = cost of leaving it as-is. *Complexity* = work to close it. Two axes because they don't move together here — the most urgent item (the KES 15,000 payment) is also the *least* complex (one factual answer), while the least urgent item (Chama Reminder Phases 5-6) is the most complex.

---

## At a glance

| # | Item | Urgency | Complexity | Blocked on |
|---|---|---|---|---|
| 1 | KES 15,000 unrouted payment — test or real? | 🔴 High | 🟢 Trivial | **You** — one factual answer |
| 2 | CYRIL (430) / ANTHONY (100) unrouted payments | 🔴 High | 🟢 Low | Member ID lookup, then admin UI |
| 3 | PR #106 job-queue fix — recheck the backlog | 🔴 High | 🟢 Low to verify / 🟡 Medium if a 5th fix is needed | Nothing — just needs re-querying |
| 4 | Approve EZZAHCOMM's KES 1,470,000 disbursement | 🟡 Medium-High | 🟢 Trivial | **You** — Approve button in enterprise portal |
| 5 | Disbursement SMS to the 4 Fiona's borrowers | 🟡 Medium | 🟡 Medium | Your go-ahead (correction that was blocking it already shipped) |
| 6 | `organization_disbursements` payment-method column | 🟢 Low | 🟢 Low | Nothing — pure migration |
| 7 | Daraja sandbox smoke test (B2B/B2C settlements) | 🟡 Medium | 🟢 Low to run / blocked without creds | **You** — sandbox credentials |
| 8 | Group constitution config (fees, fines, dividends, meetings) | 🟢 Low | 🟡 Medium (scoping first, then build) | Nothing — needs a scoping pass |
| 9 | Per-product loan terms (`loan_products` table) | 🟢 Low | 🔴 High | A real product that needs it — none yet |
| 10 | Chama Reminder Phases 5-6 (reminder types + admin/reporting) | 🟢 Low | 🔴 High | Your call on scheduling |

---

## Tier 1 — High urgency, act now

### 1. KES 15,000 unrouted payment
Paid by you (POLYCAP), ref `KITABU`, resolves to nothing. Real money sitting uncredited since 2026-07-12. **Zero code work** — I genuinely cannot tell test from real from the data, and was told explicitly not to guess. One sentence from you closes this.

### 2. CYRIL (KES 430) and ANTHONY (KES 100)
Two other members' real payments, uncredited since early July. Once you (or I, searching by first name) confirm which `group_members` row each is, assignment is a couple of clicks in the existing admin Unrouted screen — no new code.

### 3. PR #106 job-queue fix — verify or fix again
Deployed 2026-08-20 ~12:30 UTC. A 15-minute check showed **zero movement** on the two worst-stuck job types (`sms_poll_dlr`, `sms_release_stale_reservations`), but the fix's own math needs up to 90 minutes to even give them a turn — so that result proves nothing either way yet. This is the reason officers see reminders stuck at "Sent." **Next action:** re-query `job_queue` (pending count + oldest timestamp for both types); if unmoved, this needs a genuinely different approach (the first three attempts all shared the same "reorder who goes first" shape and all needed a follow-up).

---

## Tier 2 — Real money, lower time-pressure

### 4. Approve EZZAHCOMM's KES 1,470,000 disbursement
`pending_approval` since 2026-08-16 (`ODB-5614DFFA45B9`). This is a one-click Approve in the enterprise portal — deliberately not something to script directly in SQL, since settlement posts real org-ledger and group-journal entries together. Until approved, the 4 Fiona's loans keep showing "Internal savings" as their funding source instead of the real EZZAHCOMM allocation.

### 5. Disbursement SMS to the 4 Fiona's borrowers
You asked for this explicitly *after* the interest-rate correction, so members are never texted numbers about to change. That correction (migration 148, 10%/month flat) shipped and is live 2026-08-16 — this is now unblocked. Needs building (mirror `sendSubscriptionConfirmation`'s pattern) and your confirmation of channel wording (all 4 were paid in cash, so the message should say so, plus first-instalment amount + due date).

---

## Tier 3 — Low-effort cleanup, no urgency

### 6. `organization_disbursements` has no payment-method column
Member loans already record cash/cheque/mpesa; the org side doesn't, so the 1.47M cash disbursement has no record of how it was paid. Single migration, reuse the existing `payment_method` enum — do not invent a second one.

---

## Tier 4 — Blocked on you, not on code

### 7. Daraja sandbox smoke test
Settlement sweeps and vendor payments (B2B/B2C) are fully unit-tested (464/464) but never proven against Safaricom's real sandbox — request/response shapes, error codes, and whether B2B's credentials resolve correctly are all unverified. Needs sandbox credentials from you before this is safe to trust for real settlement money.

---

## Tier 5 — Unscoped feature proposals (no live urgency)

None of these are broken today — they're things you've floated as future direction. Ordered by how much scoping work is needed before a build could even start.

### 8. Group constitution config
Registration fees, fines/penalties, dividend cycles, meeting frequency — self-service per group. Likely fits the existing Configuration Service (`LoanPolicy`/`FinePolicy`/`ApprovalPolicy`/`SavingsPolicy` pattern) rather than new infrastructure, but nobody's checked which of the four pieces already have partial support. **First step is a half-day scoping pass, not a build.**

### 9. Per-product loan terms
Today only loan *term length* varies per group/org (`termOptions`); a deliberate decision was made **not** to build a `loan_products` table because rate/method/limits were identical across products. That condition is expected to break eventually. The pattern to copy when it does (snapshot terms onto the loan at creation, mirroring `funding_programs`) is already documented — this is ready to scope the moment a real product needs it, but building it speculatively now would be guessing at a schema nobody's validated yet.

### 10. Chama Reminder Phases 5-6
Phases 1-4 shipped (portal, standalone signup, entitlement gating). Phase 5 (actual reminder types — meeting/event/custom) and Phase 6 (admin/reporting + the upgrade path to full Kitabu Yetu) are unstarted; the portal currently shows "Reminders: soon" as a placeholder. This is the largest remaining item on the list — a multi-week feature, not a fix. Worth scheduling deliberately rather than picking up piecemeal.

---

## Suggested sequence

1. **Today, if you have 2 minutes:** answer #1 (KES 15,000) and identify #2's two members — closes the cheapest, highest-urgency items outright.
2. **Recheck #3** (job queue) — costs nothing but a query; tells us whether Tier 1 has one item left or is fully closed.
3. **Your portal click on #4**, then I build #5 right after — these two are sequenced together by your own stated ordering.
4. **#6** whenever convenient — a 10-minute migration, no dependencies.
5. **#7** whenever you can get Daraja sandbox access — flag it to me and I'll run the smoke test same day.
6. **Tier 5** — pick one when you're ready to commit real build time; #8 needs the least new design, #10 needs the most.
