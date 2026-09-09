# Kitabu Yetu — Client/Server Payload Contract Audit (2026-08-04)

**Trigger:** while fixing `UX_UI_OPTIMIZATION_AUDIT_2026-08.md`'s M3, the welfare "Approve" button turned out to send `amountApproved: 0` against a `z.number().positive()` schema — meaning it did not record a wrong value, it **400'd on every click and had never approved anything**. That is a bug class, not a one-off: a client payload that the route's Zod schema rejects outright is invisible to `tsc`, `eslint`, and every test in the suite. This pass swept for others.

**Method:** enumerate the Zod schemas behind `app/api/v1/**` routes, extract required fields and constraints (`.positive()`, `.min()`, `.enum()`, required-vs-optional), then compare against what each client call site actually posts. Prioritised money paths and "quick action" flows, since those send fixed payloads assembled in code rather than from a validated form.

---

## 1. Summary

**Three broken flows found, all now fixed.** Two were previously unknown; the third was M3.

| # | Flow | Sent | Schema requires | Result |
|---|---|---|---|---|
| 1 | Welfare → Quick review → **Approve** | `amountApproved: 0` | `.positive()` | 400 on every click |
| 2 | Accounting → **Post journal** | `{ memo, lines }` | `entryDate`, `description` (min 3), `lines.min(2)` | 400 on every click |
| 3 | Billing → **Pay with M-Pesa** | `{ phone, amount, purpose: "Growth plan subscription" }` | + `accountReference` (≤12), `description` (≤20), `purpose` as **enum** | 400 on every click |

All three are core features: recording a welfare approval, posting a manual journal entry, and **paying for a subscription**. #3 is the revenue path.

**Common root cause:** every one of these went through an API helper declared as `(body: unknown)`. That signature switches off the only check that would have caught them. `lib/api/endpoints.ts` has **24** such helpers; the three above are now typed, leaving **21 still untyped** (see §4).

**What the fix does not depend on:** no schema was loosened to accommodate a client. In all three cases the server was right and the client was wrong.

---

## 2. Findings and fixes

### F1. Accounting "Post journal" — manual journal entry has never worked from the UI

`app/(dashboard)/accounting/page.tsx` posted `{ memo, lines: lines.filter(l => l.accountId) }`. `CreateJournalSchema` (`lib/validators/accounting.schema.ts:27`) requires `entryDate: z.string().date()` and `description: z.string().min(3)`, and knows nothing about `memo`. Three independent failures:

1. **`entryDate` never sent** — required, no default.
2. **`description` never sent** — the form's only text field was bound to `memo`, which is not in the schema.
3. **`lines` could fall below the `.min(2)` floor** two ways: the row-remove button had no guard, and `.filter(l => l.accountId)` silently drops rows where no account was picked — so a visually-complete two-row form could post a single line.

Fixed: added an **Entry date** field (defaulting to today), renamed the text field to **Description** and bound it to the schema's field, guarded the remove button at 2 rows, and added a pre-submit check on the *filtered* line count. The submit button is now disabled unless the payload would actually validate.

### F2. Billing "Pay with M-Pesa" — the subscription payment path

`app/(dashboard)/billing/page.tsx:66` posted `{ phone, amount: plan.price, purpose: \`${plan.label} plan subscription\` }` against `StkPushSchema`, violating it three ways at once: `accountReference` (required, ≤12 chars) and `description` (required, ≤20) were absent, and `purpose` is `z.enum(['registration','subscription','sms_topup','contribution'])` — `"Growth plan subscription"` is not a member of it.

The correct shape was already visible two files away: `components/mpesa/stk-prompt-dialog.tsx` posts `accountReference: 'CONTRIB'`, `description: 'Contribution'`, `purpose: 'contribution'` and works. The billing page simply never matched it.

Fixed: sends `accountReference: 'SUBSCRIPT'`, `description: \`${plan.label} plan\`` (truncated to the 20-char M-Pesa limit), `purpose: 'subscription'`.

### F3. Welfare approve/reject — see `UX_UI_OPTIMIZATION_AUDIT_2026-08.md` §"M3"

Fixed in that audit's Phase 6. Recorded here because it is the same class and the reason this pass exists.

---

## 3. Structural fixes (so this class stops being invisible)

- **`StkPushSchema` moved** from a private `const` inside `app/api/v1/mpesa/stk-push/route.ts` to `lib/validators/mpesa.schema.ts`. It could not be shared before: a route file may only export HTTP handlers and route config, so the client had no way to be typed against it. The route now imports it — one definition, both sides.
- **Three helpers typed**: `accountingApi.createJournal`, `mpesaApi.stkPush`, and their hooks (`useCreateJournal`, `useStkPush`) now take `CreateJournalInput` / `StkPushInput`, both derived from the schemas with `z.infer`. A drifting payload is now a compile error.
- **`__tests__/unit/validators/client-payload-contracts.test.ts`** (11 cases) pins the exact payload each screen builds *and* asserts the three shapes that shipped are rejected. Those negative cases are the evidence the bugs were real rather than a misreading — they fail if anyone restores the old payloads.

---

## 4. Remaining exposure — closed out (2026-08-04, follow-up pass)

The 21-helper follow-up this section originally called for turned out to be **partially done already** by the time this pass resumed: every `body: unknown` in `lib/api/endpoints.ts` had already been replaced with a real payload type in the uncommitted work this session inherited (`grep -n 'body: unknown' lib/api/endpoints.ts` returns nothing). What remained was the second-order version of the same bug — call sites typed with a **wider, hand-written shape** instead of one derived from the actual Zod schema, which defeats the compiler exactly like `unknown` did, just less obviously:

- `accountingApi.setPolicy` / `organizationApi.setPolicy` took `{ key: string; threshold: number }` against a schema whose `key` is a 3-value enum (`SetApprovalPolicySchema`) — a typo in `key` would have 400'd on every click, same as the three bugs in §2.
- `membersApi.updateRole` / `transitionStatus` and `billingApi.upgradePlan` took plain `string` against enum fields (`UpdateMemberRoleSchema`, `MemberStatusTransitionSchema`, `UpgradePlanSchema`).
- `organizationApi.createProgram`, `disburse`, `disbursementAction`, `setBranding` were typed with inline object literals hand-copied from four **route-private** schemas (`app/api/v1/organization/{programs,disbursements,disbursements/[id],branding}/route.ts`) — nothing enforced the copies stayed in sync, and they hadn't: `DISBURSEMENT_TYPES`/`PROGRAM_TYPES` existed as **five independent copies** across three route files and two page files, one of which (`app/(dashboard)/organization/page.tsx`) was missing `insurance`/`investment` — a coordinator using the dashboard Funding Portal could not create those two program types even though the server, and the *other* portal's equivalent dialog, both already supported them. Live product gap, not just a typing exercise.
- `organizationApi.deposit` didn't exist as a client helper at all — `app/(dashboard)/organization/page.tsx`'s deposit dialog called `api.post('/organization/wallet', ...)` directly with an untyped body, bypassing `endpoints.ts` entirely and reintroducing the exact pattern this whole audit exists to close.

Fixed:

- New `lib/validators/organization.schema.ts` — single source for `PROGRAM_TYPES`, `DISBURSEMENT_TYPES`, and the `Deposit`/`CreateProgram`/`Disburse`/`DisbursementAction`/`Branding` schemas, replacing the route-private copies in all four organization routes and the five duplicated constant arrays (two enterprise-portal pages now import the shared arrays directly; the dashboard Funding Portal's value/label pairs are hand-mirrored like `members/page.tsx`'s precedent, but now complete).
- `lib/api/endpoints.ts`: `setPolicy` (both accounting and organization), `updateRole`, `transitionStatus`, `upgradePlan`, `createProgram`, `disburse`, `disbursementAction`, `setBranding` all now take the schema-derived type instead of a hand-widened one; added `organizationApi.deposit`.
- `app/(dashboard)/organization/page.tsx`'s deposit/create-program/disburse dialogs now call the typed `organizationApi` helpers instead of raw `api.post`; a page-local `OrgPolicy` interface that had independently re-widened `key` back to `string` (masking the fix at the call site) was deleted in favor of importing the service's real `EffectiveThreshold` type.
- Retyping surfaced two real compile-time catches, not just style: `app/(dashboard)/members/[id]/page.tsx`'s status-change dialog and the policy-editor above were both passing a plain `string` into a now-enum-typed parameter — both were live call sites with valid runtime values today, but the widening meant a future typo in either file would not have been caught until a 400 in production, same failure mode as F1-F3.

**Not changed, deliberately**: `finesApi.setPolicy` (its schema is a free-form `Record<string, number>`, not an enum, so the original inline type already matched); simple-string PATCH/POST bodies with no enum or multi-field shape (e.g. `organization/programs/[id]`'s pause/reactivate `status` toggle) — no drift risk to close there.

Verified green: `tsc --noEmit` clean, `eslint .` clean, `jest --ci` 384/384 across 45 suites, `next build` succeeds.

**Caveat, unchanged from the original pass**: none of this — the three original fixes or this follow-up — has been exercised against a running server. All evidence remains static (types, lint, unit/schema tests, a successful build). A manual pass through Welfare approve, Accounting → Post journal, Billing → Pay with M-Pesa, and the organization dashboard's deposit/create-program/disburse dialogs is still the right next step before calling any of this closed end-to-end.

**Live-verification attempt (2026-08-05)**: tried to close this caveat for Welfare approve + Accounting → Post journal against production (real account, real group — THE FIONA'S, KY0000004). Blocked by environment issues, not app issues: `next dev` bound to the host's LAN IP, which the sandboxed browser driving the session reached only intermittently; server-side logs also showed genuine but transient production DB latency (`tenantPool.connect()` taking 12–34s, some timing out) during the same window. Confirmed directly via `/api/health/deep` over loopback (with `WORKER_SECRET`) that DB (1.45s) and Redis (262ms) were healthy once the network path was isolated as the actual problem, not Supabase. Stopped before any write: the one attempted action (clicking "Submit Request" on `/welfare`) never reached the server — the page had already navigated away to a connection-error screen before the click registered, confirmed via the client tool's own stale-element error. **Nothing was written to THE FIONA'S or any other group's data.** This caveat therefore still stands, now for an environmental reason rather than by omission — worth a retry from a session with stable routing to the dev server (or one running against `.env.test`'s disposable local Postgres instead of production, sidestepping the stakes entirely).
