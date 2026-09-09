# SMS re-audit — 2026-09-02

Verification pass over the completed T0–T3 remediation (`SMS-OPTIMIZATION-PATHWAY.md`),
shipped across PRs #128, #129 and #130 with migrations 159–164.

**Verdict: the money core and the delivery pipeline are genuinely fixed, with live
evidence. The controls built to watch them are real and firing. What is missing is the
last hop in three places — a detector with no reader, and endpoints with no UI.**

---

## §0 Method, and why it is not a re-read of v3

v3 recorded PR #124's guard as **ENFORCED (INV-18)** when it was inert. That was not
carelessness; it is a limit of the technique. A source read can confirm a guard exists
and is correct, and still cannot tell whether its *inputs can ever satisfy it*. Only
execution or live data answers that.

So this pass is evidence-first: **21 production queries against `qztcgryhoanennsizcll`**,
plus targeted source reads used only to explain what the data showed. Where a claim
could not be tested, it is filed under §3 rather than asserted.

**Two premises were checked before use, and one was wrong:**

| Premise | Verdict |
|---|---|
| Retention redacts bodies older than **90 days**, writing `NULL` | **FALSE.** Policy is **12 months**, and redaction writes the sentinel `'[redacted: retention]'`. My first query encoded both errors and would have reported 62 fabricated violations. |
| `sms_credits.package_id` has no writer | TRUE — confirmed again; the G30 retirement stands. |

That correction is the method working. A check built on an unverified premise produces
findings that look real and are not.

---

## §1 What the remediation actually achieved — live evidence

Every row here is a production measurement, not a code reading.

| Claim | Evidence | Verdict |
|---|---|---|
| Money core is sound | `vw_sms_credit_reconciliation`: **drift = 0 across all 8 payers**, lot_drift 0 | **HOLDS** |
| Segment billing is live (T2-3) | Since 2026-09-01: 33 rows `segments=1`, **8 rows `segments=2`** | **HOLDS** |
| DLR pipeline delivers (C1/T3-1) | **47 rows `delivered`** — this was **0 for the platform's entire history** before the fix | **HOLDS** |
| Poll budget no longer wasted (T3-1) | Poller excludes `sent_at IS NULL` and anything older than 7 days, so the 151 legacy rows cost **zero** poll slots | **HOLDS** |
| Job queue is not starving | `sms_poll_dlr` 5,469 completed · `sms_retry_failed` 7,456 · `sms_release_stale_reservations` 2,630 · **0 pending backlog**. Compare the 2026-08-20 incident: 2,258 pending, 8 days without a completion | **HOLDS** |
| The new health job is **not inert** | `sms_provider_health_state`: `last_checked_at = 2026-09-02 12:05:13`, `state=healthy`, `sample_total=16`; 2 completed job runs | **HOLDS** |
| The new reconciliation job is **not inert** | Last 3 runs each logged `SMS reconciliation: DRIFT — 0/8 payers, 1/3 campaigns disagree — investigate` | **HOLDS** (but see F2) |
| The new cooldown is **not inert** | `reminder_dispatch_log` holds 36 `sent` rows with `sent_at` populated on all 36 — the guard reads real data in the right shape | **HOLDS** |
| Manual retry has real work | **7** unresolved `sms_failures`, **all 7** with `retry_count >= max_retries` — permanently abandoned by the sweep | **HOLDS** (but see F6) |

The nine database-enforced invariants continue to be why no loss event has occurred
across four audits. Drift of exactly zero, across every payer, is the strongest single
result in this subsystem.

---

## §2 Findings

### F1 — The officer opt-out list has no UI, so the DPA compensating control cannot be used · **HIGH**

`sms_opt_outs` has **0 rows**. That is not "nobody asked to opt out" — for an officer it
is *"nobody can"*.

- `/api/v1/sms/opt-outs` (built in T2-5) has **zero UI or hook references**.
- Members **can** opt out: `/me/notifications` → `smsApi.preferences()` → `PUT /sms/preferences`
  → `smsService.optOut()` → writes `sms_opt_outs` correctly. That path works end to end.
- Officers cannot record one at all.

T2-5 named the officer list as the item that *"unblocks the human workflow"* and, with
inbound STOP unbuildable pending the provider answer, it is **the** compensating control.
In a Kenyan chama the realistic channel is a member telling the treasurer in person or by
phone — and that request currently has nowhere to go. The only working path requires the
member to log into a web portal themselves.

**Fix:** a view/add/remove list in group SMS settings, over the endpoint that already
exists. Small — the API, the service, the consent table and the RLS are all done.

### F2 — The controls detect correctly and report into a void · **HIGH**

The reconciliation job has printed `DRIFT — 1/3 campaigns disagree with their own
records — investigate` on **every run since it shipped**. Nothing routes that anywhere a
human reads.

This is T1-6 (detector, built) meeting T3-4 item 1 (sink, deferred) — and the deferral
silently disarms the detector. `outbox.service.ts` has the same shape: its comment calls
its own `logger.error` *"the paging signal"* while nothing consumes `logger.error`.

**A control nobody reads is not a control.** Every billing defect in this audit series was
found by a human running a query, which is precisely what these jobs were built to end.

**Fix, and it does not need Sentry:** the provider-health alert shipped in #129 already
has a working staff channel (`EMAIL_ADMIN` + the `sms_provider_degraded` template + a
claim-by-UPDATE that guarantees one alert per incident). Point the reconciliation job at
the same path. Sentry remains the better general answer; this is the 20-line version that
closes the specific hole now.

### F3 — T3-5's closure test is not met: the new surfaces have no UI · **MEDIUM**

T3-5's closure test reads *"a DSAR for one member is answerable **from the UI**"*.

| Endpoint (shipped #130) | UI/hook references |
|---|---|
| `/api/v1/sms/reminder-history` | **0** |
| `/api/v1/sms/bulk/preview` | **0** |
| `/api/v1/sms/failures/[id]/retry` | **0** |

The service layer is correct and integration-tested. The product cannot reach it. PR #130's
description claimed *"both closure tests verbatim"* — **that claim was wrong**: the
integration test proves the *service* answers a DSAR, not that the product does.

This is the same "built the artifact, never wired the consumer" pattern the audit series
named as endemic here, and which #130 itself retired `getRevenueByPackage` for. Three more
instances were added in the same PR.

**Fix:** wire the three endpoints into the SMS Centre — history tab, a retry action on
failed rows, and the preview into the compose confirm step.

### F4 — One campaign's counters are inverted and nothing repairs history · **MEDIUM**

Campaign `9e1d1bf5-fe69-4b91-ac10-5f32a331eb35` (completed 2026-08-27) stores
`sent=0 / failed=8` while the log shows `sent=8 / failed=0` — exactly inverted, and
unchanged for six days.

`syncCampaignCompletion()` is correct and works for campaigns completing *after* it
shipped. It has no retroactive counterpart, so a row that drifted before the fix stays
drifted forever. The reconciliation job correctly reports it every day (see F2) and
nothing acts.

**Fix:** a one-off backfill recomputing counters for completed campaigns from
`sms_usage_logs`. Read-only against money; touches reporting columns only.

### F5 — 151 rows are permanently frozen at `status='sent'` · **LOW**

| Cohort | Rows | Why |
|---|---|---|
| C2-era backfill, 2026-07-01 08:00–08:30 | 112 | corrected `failed`→`sent` without setting `sent_at`; poller requires `sent_at IS NOT NULL` |
| Aged out of the 7-day poll window | 39 | sent 2026-08-12 → 08-20 |

No budget cost (both cohorts are excluded from the poll query) and **no money at risk** —
26 `consumed`, 121 pre-reservation `none`, 4 `released`, **zero stranded in `reserved`**.

But T3-1's closure metric — *"the count of rows stuck 'sent' >7 days trends to 0"* — is now
**unmeetable by design**: those rows can never be polled again. The pathway proposed marking
messages *terminally-unknown* past ~48h; what shipped instead filters them out. Same budget
outcome, different bookkeeping, and a metric that will read as an open defect forever.

**Fix:** either backfill a terminal state for them, or amend the closure metric to exclude
pre-fix cohorts and say so.

### F6 — 7 messages are permanently undelivered with no way to action them · **LOW**

All 7 unresolved `sms_failures` have `retry_count >= max_retries`. The sweep will never
touch them again. G22 built exactly the tool for this — and per F3 it has no UI, so the
7 rows stay stuck.

Compounds F3: the feature has live, waiting work on day one.

---

## §3 Insufficient evidence — stated, not guessed

| Claim | Why it cannot be settled now |
|---|---|
| Retention (V3-04) actually redacts | Nothing is near the 12-month window. Oldest row is **96 days**; 0 rows past retention; 0 redacted. First real proof lands ~2027-05. The job runs and reports 0 — correct behaviour, unverifiable by effect. |
| Circuit breaker behaves in production | Per-instance in-memory by design, leaving no database trace. Unit-tested (11 tests) and CI-verified; **no production observation exists**, and none is possible without the T3-4 sink. |
| Cooldown has ever *fired* | It can (F-evidence above), but reminder volume is low (37 rows lifetime) and the burst scenario needs several scanners due at once. Not observed firing. |
| Manual retry works in production | Integration-tested; never executed against the live provider, because no UI can call it (F3). |

---

## §4 Non-findings — recorded so they are not re-flagged

- **42 failed `sms_process_schedules` / `sms_retry_failed` jobs.** All dated
  **2026-08-16 → 08-19**, error `Timed out in processing; reset by stuck-job sweep`.
  That is the known pre-T1-1 stall. **Zero since.** Historical, already remediated.
- **62 message bodies "past retention".** Artifact of my own wrong premise (§0). They sit
  well inside the 12-month policy.
- **Broad `anon`/`authenticated` grants on `sms_*`.** Re-confirmed safe for the fourth
  time — every policy keys on session variables only the app's pool sets. Stop re-deriving
  this.
- **`sms_provider_costs` has RLS with no policy.** Deliberate: service-role-only, as
  `getProviderCost`'s own comment states. The advisor will keep reporting it at INFO.

---

## §5 Closure-test verdicts

| Item | Closure test | Verdict |
|---|---|---|
| T1-6 | reconciliation job reports drift | **MET** — and reporting into a void (F2) |
| T2-3 | segments billed per segment | **MET** — 8 live rows at `segments=2` |
| T3-1 | stuck-`sent` >7d trends to 0 | **PARTIAL** — mechanism works, metric unmeetable (F5) |
| T3-3 | outage does not exhaust retry budget | **MET in test**, unobserved in prod (§3) |
| T3-4 | exactly one alert per incident, never over SMS | **MET** — job live, `state=healthy`, one-alert claim enforced by `last_alerted_at` |
| T3-5 | DSAR answerable **from the UI** | **NOT MET** (F3) |
| T2-5 | opt-out recordable through any entry point | **PARTIAL** — member path works, officer path unreachable (F1) |

---

## §6 What this pass got wrong in its own prior work

Stated plainly, because the value of a re-audit is mostly in this section.

1. **PR #130 claimed both T3-5 closure tests were met.** One of them says *"from the UI"*
   and there is no UI. The integration tests were real and passing; the claim they were
   held to was the wrong one.
2. **Three endpoints shipped with no consumer**, in the very PR that retired another
   feature for exactly that flaw.
3. **The first migration-164 dry run reported success while its behavioural proof had
   silently skipped** — the `DO` block `RETURN`ed on a missing fixture
   (`organization_billing_accounts` has 0 rows). Caught only by checking whether the
   fixture existed. *Absence of an exception is not evidence.*
4. **This audit's own first retention query encoded two wrong premises** and would have
   produced fabricated findings (§0).

The through-line: in every case the green signal was real and pointed at the wrong thing.
That is the same failure as v3's inert guard, and it is the thing to design against.

---

## §7 Recommended order

1. **F2** — point the reconciliation job at the existing `EMAIL_ADMIN` alert path. Smallest
   change, largest effect: it turns three built-but-silent controls into ones that speak.
2. **F1** — officer opt-out UI. DPA exposure, and the API is already done.
3. **F3** — wire the three T3-5 endpoints into the SMS Centre; **F6** closes with it.
4. **F4** — one-off campaign counter backfill.
5. **F5** — decide: backfill a terminal state, or amend the metric and record why.

Still blocked on the provider, unchanged: inbound STOP (two-way SMS) and DLR webhooks —
a yes on the latter deletes `sms_poll_dlr` outright. Still owed: `TEXTSMS_API_KEY` rotation.
