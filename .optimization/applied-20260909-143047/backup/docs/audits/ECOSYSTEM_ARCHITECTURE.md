# Kitabu Yetu — Organization Financial Ecosystem Architecture

**Status:** Phase 1 implemented (migration 055) · **Date:** 2026-07-12

## Vision

Kitabu Yetu evolves from a VSLA management system into a multi-tenant financial
ecosystem. An **Organization** (donor, NGO, MFI, SACCO, bank, insurer, county
government, CSR program, investment fund…) is **not a group** — it is an
external participant that funds, monitors, lends to, insures, or supports many
groups **without joining their internal governance**.

```
Platform
├── Super Admin (backoffice)
├── Organizations
│     ├── Wallet (money position)          ← 055
│     ├── Organization Ledger (append-only) ← 055
│     ├── Funding Programs                  ← 055
│     ├── Disbursements → Groups            ← 055
│     ├── Staff (organization_coordinator)  ← existing
│     ├── SMS billing account               ← existing (051)
│     ├── Loan Products                     ← Phase 2
│     ├── Grant workflows (milestones)      ← Phase 2
│     ├── Insurance Products                ← Phase 3
│     └── Investment Portfolios             ← Phase 3
└── Groups (autonomous — own members, savings, loans, welfare, shares, books)
```

## Core principles

1. **Groups stay sovereign.** An organization's money lands in the group's own
   double-entry books as a posted journal entry (DR `1001 Cash` / CR
   `4005 External Funding`). Organizations never write into group tables
   directly and never see groups they aren't linked to.
2. **The link table is the trust boundary.** `organization_group_access`
   (many-to-many, per-relationship `is_active`) gates *everything*: visibility,
   SMS funding (051), and now disbursement eligibility (055). One group can
   simultaneously hold a grant relationship with Donor A, a loan relationship
   with MFI B, and an insurance relationship with Insurer C — each independent.
3. **Every shilling has a ledger row.** The organization wallet is only a
   materialized position; `organization_ledger` is append-only and carries
   `balance_after`, so the balance is reconstructible and auditable from the
   ledger alone. Disbursements are dual-ledger and atomic (org ledger + group
   journal in one transaction), cross-linked by ids for reconciliation.
4. **Defense in depth on permissions.** Route-level role assertion
   (`organization_coordinator`), service-level org-context requirement, and
   Postgres RLS (`app_current_organization_id()`) on every ecosystem table.
   Group officers can read disbursements addressed to their group — never the
   organization's wallet or ledger.
5. **Extensible by data, not migrations.** Program/disbursement types are
   CHECK-constrained TEXT; eligibility criteria and geographic coverage are
   JSONB; currency is carried per row (KES default) for future multi-currency.

## Phase 1 — shipped (migration 055)

| Piece | Where |
|---|---|
| `organization_wallets` (available/committed/lifetime counters, per-currency) | migration 055 |
| `organization_ledger` (8 entry types, append-only, balance_after) | migration 055 |
| `funding_programs` (10 types, budget ceiling enforced by CHECK + service) | migration 055 |
| `organization_disbursements` (7 types, unique replay-safe reference) | migration 055 |
| Group chart account `4005 External Funding` (seeded for all groups) | migration 055 + accounting.service |
| Service layer: deposit, ledger, programs CRUD, atomic dual-ledger disburse, dashboard metrics | `lib/services/organization-finance.service.ts` |
| APIs: `/organization/wallet`, `/programs`, `/programs/:id`, `/disbursements`, `/dashboard` | `app/api/v1/organization/*` |
| Ecosystem dashboard (wallet, programs, disburse dialog, portfolio metrics, linked groups) | `app/(dashboard)/organization/page.tsx` |

### Disbursement flow (atomic, single transaction)

1. Assert coordinator role + org context (route + service).
2. Verify active `organization_group_access` link (eligibility).
3. Lock wallet (`FOR UPDATE`), require sufficient available balance.
4. If program-funded: lock program, enforce remaining budget, bump `disbursed_total`.
5. Debit wallet; append org ledger row with `balance_after`.
6. Post balanced group journal entry (DR 1001 / CR 4005, fallback 4004).
7. Insert disbursement row with unique `ODB-…` reference, cross-linked to both ledger sides.

Any failure rolls the whole movement back — no partial money states.

## Phase 2 — loan ecosystem & grant workflows (next)

- `organization_loan_products` (rates, terms, grace, penalties, collateral rules,
  eligibility JSONB) + group/member applications + approval workflow.
- Portfolio monitoring: PAR buckets, defaults, recoveries, interest income —
  computed from existing `loans` / `loan_repayments`, scoped by the link table.
- Grants as stateful workflows on top of `funding_programs`: applications,
  approvals, milestone tracking, utilization reports, document attachments.
- Wallet `commitment`/`release` ledger types are already reserved for
  approval-gated disbursements (earmark on approve, settle on pay).

## Phase 3 — insurance & investments

- `insurance_products`, `policies` (group/member enrollment), premium
  collection via existing M-Pesa rails, claims workflow.
- `investment_positions` per group with returns/dividends fed from the group's
  share-out and dividend modules; portfolio performance and risk indicators.

## Phase 4 — scale & compliance

- Multi-currency wallets (schema already keyed by currency).
- Country/regulatory packs (jurisdiction tables already exist).
- Read-replicas / partitioning for ledgers as volume grows; all money tables
  use UUID PKs + created_at DESC indexes to shard cleanly.

## Reporting

Phase 1 exposes wallet, ledger, disbursement and portfolio aggregates via the
dashboard API. The existing group-side reports (trial balance, P&L, balance
sheet, cashbook) automatically include external funding through account 4005,
so organization money is visible — and separately identifiable — in every
group financial statement from day one.
