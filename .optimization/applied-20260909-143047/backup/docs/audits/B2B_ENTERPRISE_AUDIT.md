# B2B / Enterprise Architecture Audit — Kitabu Yetu

**Subject:** Business-to-Business (organization / enterprise) capability
**Scope:** Multi-tenancy, org management, enterprise RBAC, org finance, grants, portfolio, reporting, API & integration readiness, white-label, billing, compliance, scale
**Method:** Source-grounded static audit (codebase, schema, services, routes). No code modified.
**Date:** 2026-07-15

> Where evidence is insufficient, the finding says so explicitly rather than assuming.
> Findings cite `organizations`, `organization_group_access`, `organization_wallets`,
> `organization_ledger`, `funding_programs`, `organization_disbursements`,
> `lib/services/organization*.service.ts`, `app/(enterprise)/*`, `app/(dashboard)/organization/*`,
> `supabase/migrations/*`.

---

## Executive Summary

Kitabu Yetu has a **real but early organization layer** — genuine tables, RLS isolation, an org
wallet with an append-only ledger, funding programs, and (as of this week) super-admin onboarding
plus group assignment. That is a credible B2B *foundation*. But three structural facts cap its
enterprise readiness today:

1. **The "Enterprise" portal is entirely mock.** `app/(enterprise)/_data.ts` states it plainly —
   *"No enterprise/portfolio API yet."* Portfolio roll-ups, branches, regional analytics, impact
   metrics, API keys, and webhooks are all hardcoded sample data with no backend.
2. **The organization is not yet a commercial tenant.** Subscriptions and billing are
   **group-scoped only** (`subscriptions.group_id`, `billing_accounts.group_id`). There is no org
   subscription, seat/usage/per-group billing, invoicing, or revenue recognition at the org tier.
3. **The organization has one user and one role.** The only org role is a single
   `organization_coordinator` (`organizations.coordinator_member_id`). There are no org teams, no
   finance/compliance/project/field-officer roles, and custom roles are **group-scoped**, not org-scoped.

The org money path also inherits the B2C audit's central defect: `organizationFinanceService.disburse()`
enforces balance and budget but **posts ledger entries only — it never moves real money** (no Daraja
call). So "disbursement" at the org level is an internal book transfer, not a payout.

**None of this is a dead end.** The data model is clean and the isolation is real; the gap is breadth
(features) and depth (org as a first-class commercial, multi-user, API-exposed tenant), not a broken
core. The work is additive.

### Scorecard (0–100)

| Dimension | Score | One-line justification |
| --- | ---: | --- |
| **Overall B2B maturity** | **31** | Real org layer; mock enterprise portal; no org billing/RBAC/API |
| Enterprise readiness | 26 | No org teams, no white-label, no partner API, portfolio is mock |
| Security | 58 | Strong RLS + JWT epochs + MFA base; org-tier controls thin; no partner-API authz |
| Scalability | 46 | Serverless + RLS scale; unindexed cross-group roll-ups & no partitioning bite later |
| Multi-tenancy | 52 | Real org RLS isolation; but org ≠ full tenant (no billing, single user) |
| Compliance | 34 | RLS + audit logs; no SOC2/ISO/PCI posture, KYC/AML weak, retention unstated |
| API maturity | 15 | Internal REST v1 only; no public/partner API, OAuth, webhooks, SDK, or docs |

---

## Findings Table

| Area | Current State | Gap | Risk | Severity | Recommendation | Complexity | Business Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Multi-tenancy | Org RLS via `app_current_organization_id()`; `organization_group_access` M:N | Org isn't billed/owned as a tenant; single coordinator | Org can't operate independently | High | Promote org to full tenant (billing, teams, settings) | Large | Blocks selling to enterprises |
| Org management | Onboard + assign groups (new); wallet, programs, dashboard | No branches / departments / regions / field offices | Can't model real org hierarchy | High | Add org hierarchy (branch/region/dept) tables | Large | NGOs/MFIs need branch networks |
| Enterprise portal | `app/(enterprise)` renders mock `_data.ts` | Zero backend — portfolio, branches, keys, webhooks all fake | Demo-only; misleads buyers | Critical | Wire portal to real portfolio API | Large | Cannot go live for enterprise |
| Enterprise RBAC | `platform_role` enum + group-scoped custom `roles` | No org-level roles (finance/compliance/PM/field officer/auditor) | No separation of duties in org | High | Org role model + org-scoped custom roles | Large | Enterprise governance requirement |
| Org users | One `coordinator_member_id` per org | No multi-user org; no invitations | One person is the whole org | High | Org membership + invite flow + roles | Medium | Teams are table-stakes |
| Org wallet | Single wallet per org+currency; `committed_balance` unused | No project/department/grant sub-wallets; no reserved-funds enforcement | Can't ring-fence restricted funds | High | Sub-wallets + reservation accounting | Large | Donors demand fund restriction |
| Org disbursement | `disburse()` = wallet debit + group journal | **No real money movement** (no Daraja); approval statuses unenforced | "Disbursement" is book-only | Critical | Wire to reservation-based payout spine (see B2C audit §17) | Major | Grants can't actually pay out |
| Grant lifecycle | `funding_programs` (budget, status, dates, eligibility JSONB) | No milestones, utilization tracking, donor reports, fund expiry/recovery jobs | Can't service real donor programs | High | Grant lifecycle engine + donor reporting | Large | Core NGO/donor use-case |
| Loan portfolio (org) | Loans are group-level | No org portfolio, products config, PAR/provisioning, collections, loan officers | MFIs unserved | High | Org lending module | Major | Blocks MFI segment |
| Insurance | None (no tables/services) | Entire domain absent | Insurers unserved | Medium | Partner-API + policy/premium/claim model | Major | Future segment |
| Donor / impact | Impact metrics are mock (`_data.ts`) | No beneficiary/gender/youth/SDG/ESG tracking in DB | Can't report impact | High | Beneficiary + disaggregation model | Large | Donor reporting requirement |
| Reporting / BI | Real org dashboard + group summaries; admin analytics | No regional/county/project/grant dashboards; no scheduled reports/exports; no DW | Thin exec visibility | Medium | Report builder + scheduled exports + read models | Large | Enterprise expectation |
| Automation | Cron jobs + SMS trigger engine + outbox | No org approval chains, escalations, recurring disbursements | Manual org ops | Medium | Workflow/approval engine at org tier | Large | Efficiency at scale |
| API readiness | Internal REST `/api/v1` (JWT); per-IP rate limit | No public/partner API, OAuth client-creds, real webhooks, SDK, versioned public surface, docs, dev portal | Can't integrate partners | High | Partner API + OAuth + outbound webhooks + docs | Large | Blocks ecosystem/embedded finance |
| Integrations | M-Pesa (deep, real) | No banks, accounting, CRM/ERP, BI, SSO/IdP, gov systems | Islanded | Medium | Prioritize bank + accounting export + SSO | Large | Enterprise procurement gate |
| White-label | None (no custom_domain/logo/theme/sender-id) | Entire capability absent | No partner branding | Medium | Per-org branding + custom domain + sender IDs | Large | Reseller/white-label deals |
| Subscription / billing (B2B) | Group-scoped subs only | No org subscription, seat/usage billing, invoices, proration, coupons, revenue rec | No B2B monetization path | High | Org billing engine | Large | No enterprise revenue model |
| Security (org tier) | RLS, JWT epochs, refresh rotation, MFA admin, Zod, proxy claim-strip | No partner-API authz model; BOLA surface grows with API; no per-org rate limits | Breach blast radius | High | Extend authz to API + per-tenant limits | Medium | Trust / compliance |
| Compliance | Audit logs, RLS, DPA-partial | No SOC2/ISO/PCI posture; KYC/AML weak; retention/consent unstated | Fails enterprise/gov due-diligence | High | Compliance program + controls | Major | Procurement blocker |
| Scalability | Serverless + RLS + indexed core | Cross-group roll-ups unoptimized; no partitioning/read models; org dashboard N+1 risk | Slow at 10k+ groups | Medium | Materialized roll-ups + partitioning | Large | Degrades at scale |
| UX (enterprise) | Group switcher (new); org portal | No org switcher for multi-org users; limited bulk ops; mock enterprise UX | Operator friction | Low | Org switcher + bulk tooling | Medium | Retention at scale |

---

## Critical Issues (block serving enterprise customers)

1. **The enterprise portal has no backend.** `app/(enterprise)` is a UI shell over hardcoded
   `_data.ts`. Branches, portfolio, PAR, API keys, and webhooks are fictional. Any enterprise demo
   that navigates here is showing vapor. *Fix: build the portfolio/branches read API and wire it, or
   gate the portal behind a "preview" flag until real.*

2. **Org disbursement moves no money.** `organizationFinanceService.disburse()` debits the org
   wallet and posts a group journal but never calls Daraja — a grant "disbursement" never reaches a
   beneficiary's phone. Its schema has `pending_approval`/`approved` statuses that the code doesn't
   enforce. *Fix: route org payouts through the reservation-based payout spine (B2C audit §17).*

3. **No org-level commercial model.** Organizations cannot be subscribed, metered, or invoiced —
   billing is group-scoped. There is no way to charge an NGO/MFI for the platform. *Fix: org billing
   engine (seat/usage/per-group tiers).*

4. **No separation of duties inside an org.** One coordinator per org, no finance/compliance/approver
   roles, no maker-checker on org money. For regulated funders this is disqualifying. *Fix: org role
   model + dual control on org disbursement.*

5. **No partner/public API.** The only API is the internal JWT REST used by the app itself. There is
   no OAuth, no API keys (the ones shown are mock), no outbound webhooks, no SDK, no docs, no versioned
   public surface. Embedded-finance / ecosystem ambitions have no entry point. *Fix: partner API +
   OAuth client-credentials + signed outbound webhooks.*

---

## Quick Wins (≤ 2 weeks)

- **Gate or label the mock enterprise portal** so it isn't mistaken for live capability; point its
  data hooks at the *real* org dashboard/group-summary services that already exist.
- **Enforce the org-disbursement approval statuses that already exist** in the schema
  (`pending_approval → approved`) with a second-approver check, reusing the reallocation maker-checker
  pattern already in the codebase.
- **Expose the real org dashboard** (`organization-finance getDashboard`, `listGroupSummaries`) in the
  coordinator UI as the interim "portfolio" view instead of mock roll-ups.
- **Add org-scoped rate limits and an org-id assertion audit** across `/api/v1/organization/*` routes
  (they already call `assertOrganizationCoordinator` + access checks — add a test sweep to prove no BOLA).
- **Publish an API reference** for the existing `/api/v1` surface (even internal-only) — cheap
  groundwork for a future partner API.
- **Add `committed_balance` reservation to org deposits/disbursements** so restricted funds can't be
  double-spent — the column already exists, it's just unused.

---

## Medium-Term Improvements (1–3 months)

- **Org as a first-class tenant:** org membership table (many users per org), invitation flow, and an
  **org role model** (owner / admin / finance / compliance / viewer) distinct from group roles.
- **Real portfolio API:** materialized roll-ups across an org's linked groups (members, savings,
  loans, PAR) feeding the enterprise portal for real.
- **Org billing engine:** subscription plans at the org tier, usage metering (per group / per member /
  per SMS), invoices, and revenue recognition.
- **Grant lifecycle:** milestones, utilization tracking, fund expiry + unused-fund recovery jobs, and
  donor-facing reports over `funding_programs` + `organization_disbursements`.
- **Org sub-wallets:** project / department / grant wallets with reserved-funds enforcement over the
  existing `organization_wallets` + `organization_ledger`.
- **Wire org payouts to real money** via the reservation-based payout spine (shared with B2C
  remediation) so grants actually disburse.

---

## Long-Term Roadmap (12–24 months)

- **Partner & public API platform:** OAuth client-credentials, scoped API keys (real), signed outbound
  webhooks, versioned public REST (and optionally GraphQL), an SDK, and a developer portal with docs.
- **Org hierarchy:** branches, regions, departments, field offices; regional/county coordinators and
  field-officer roles; hierarchical reporting and roll-ups.
- **Enterprise lending (MFI) module:** loan products, credit scoring, PAR/provisioning, collections,
  restructuring, and a loan-officer role — at the org portfolio level.
- **Impact & donor suite:** beneficiary registry with gender/youth/vulnerability/SDG/ESG
  disaggregation, impact assessments, and donor dashboards + exports.
- **White-label:** per-org branding, custom domains, sender IDs, templated receipts/invoices/reports,
  and branded portals.
- **Integration fabric:** bank connectors, accounting exports (QuickBooks/Xero/ERP), BI connectors
  (Power BI/Tableau), and SSO/IdP (SAML/OIDC) for enterprise identity.
- **Insurance & embedded finance:** policy/premium/claim model, partner APIs, embedded lending &
  insurance, and a financial-services marketplace.

---

## Enterprise Readiness Roadmap (phased)

Each phase lists dependencies, rough effort, key risks, and business value.

### Phase 1 — Critical (make enterprise honest & safe)
- **Wire the enterprise portal to real data** (dep: org read-models · L · risk: query cost · value:
  removes vapor, enables real demos).
- **Dual control + real payout for org disbursements** (dep: payout spine from B2C remediation · L ·
  risk: money-movement correctness · value: grants can actually pay, safely).
- **Label/limit mock surfaces & prove no org-tier BOLA** (dep: tests · S · value: trust).

### Phase 2 — Foundation (org becomes a tenant)
- **Org membership + invitations + org role model** (dep: RBAC refactor · L · risk: authz regressions
  · value: teams, separation of duties).
- **Org billing engine** (dep: subscription refactor to org tier · L · value: B2B revenue).
- **Reserved-funds accounting** on the org wallet (dep: ledger · M · value: restricted-fund integrity).

### Phase 3 — Enterprise (depth for NGOs/MFIs/donors)
- **Grant lifecycle + donor reporting** (dep: Phase 2 · L · value: NGO/donor fit).
- **Org sub-wallets (project/department/grant)** (dep: wallet · L · value: fund ring-fencing).
- **Org hierarchy (branches/regions/departments)** (dep: tenant model · Major · value: MFI/NGO networks).
- **Impact & beneficiary suite** (dep: reporting · L · value: donor requirement).

### Phase 4 — Platform (open it up)
- **Partner/public API + OAuth + real API keys + outbound webhooks + docs/SDK** (dep: authz · Major ·
  risk: security surface · value: ecosystem, embedded finance).
- **Enterprise lending module** (dep: portfolio read-models · Major · value: MFI segment).
- **Integration fabric: bank, accounting, BI, SSO** (dep: API platform · Major · value: procurement).

### Phase 5 — Ecosystem (differentiation)
- **White-label + custom domains + branded portals** (dep: platform · L · value: reseller deals).
- **Insurance & embedded finance + marketplace** (dep: partner API · Major · value: new revenue lines).
- **AI: predictive PAR, fraud, credit scoring, benchmarking** (dep: data warehouse · Major · value:
  moat).

---

## Final Assessment — Readiness by Customer Segment

Ratings are grounded strictly in implemented functionality.

| Segment | Rating | Why |
| --- | :---: | --- |
| **Small community groups (VSLA/chama)** | ✅ Ready | The core product — group finance, contributions, loans, M-Pesa, roles — is real, deployed, and mature. This is where the platform is strong. |
| **SACCOs** | 🟡 Partially Ready | Group mechanics fit; but no SACCO-grade share/dividend depth at org tier, no org portfolio, no org billing. Usable for small SACCOs, not tiered ones. |
| **NGOs (local)** | 🟡 Partially Ready | Org onboarding, wallet, funding programs, and group federation are real — but disbursement moves no money, and there's no grant lifecycle, impact, or donor reporting. |
| **Microfinance institutions (MFI)** | 🔴 Not Ready | No org-level loan portfolio, products, PAR/provisioning, collections, or loan-officer roles. Lending is group-only. |
| **County governments** | 🔴 Not Ready | No hierarchy (regions/wards), no program disbursement that pays out, no beneficiary registry, no gov-grade reporting/compliance. |
| **National government programs** | 🔴 Not Ready | Same as county, at higher scale + compliance bar the platform hasn't met (KYC/AML, audit retention, SOC2/ISO). |
| **Banks** | 🔴 Not Ready | No bank integration, no partner API, no PCI posture, no enterprise SSO, no white-label. |
| **Insurance companies** | 🔴 Not Ready | Insurance domain is entirely absent (no policy/premium/claim model, no partner API). |
| **Development partners / donors** | 🔴 Not Ready | Impact/beneficiary/SDG tracking is mock; no donor dashboards or restricted-fund enforcement; disbursement doesn't pay out. |
| **International NGOs** | 🔴 Not Ready | Multi-country, multi-currency depth, white-label, SSO, and compliance posture are absent. |
| **Enterprise customers (general)** | 🔴 Not Ready | No org teams/roles, no org billing, no API platform, mock enterprise portal. |

### Verdict

Kitabu Yetu is **production-ready B2C for community groups** and has a **genuine, well-modeled B2B
foundation** — but it is **not yet an enterprise B2B platform**. The organization exists as a data
citizen (isolation, wallet, ledger, funding programs, federation) yet not as a *commercial, multi-user,
API-exposed, money-moving* tenant. The enterprise portal that would showcase B2B is currently a mock.

The path is additive and the order is clear: (1) make the org money path real and dual-controlled and
replace mock enterprise data with the real org read-models that already exist; (2) make the org a true
tenant — teams, roles, billing; (3) add the NGO/MFI/donor depth; (4) open the API platform; (5) layer
white-label and ecosystem. Nothing in the current architecture blocks this — the core is sound; the
enterprise surface is simply not built yet.

### Evidence gaps (stated, not assumed)

- **SOC2/ISO/PCI posture** cannot be assessed from code alone — no policy/controls artifacts in-repo;
  requires the org's compliance documentation.
- **Backup/restore & DR runbooks** are not in the codebase (Supabase-managed); operational readiness
  needs the ops runbooks, not source.
- **Penetration-test / threat-model results** are not present; BOLA/SSRF/mass-assignment risks were
  assessed by reading route authorization, not by dynamic testing.

---

*Source-grounded audit. No code was modified to produce this report.*
