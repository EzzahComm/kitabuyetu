# Ukoo Yetu Quickstart (Phase 0)

## Overview

Ukoo Yetu is a family tree and genealogy platform built in the kitabuyetu monorepo. It uses a separate Supabase project (sqmtmxqadfernkpndjhr, eu-central-1) and integrates with Kitabu Yetu services in Mode A.

## Setup

### 1. Environment Variables

Copy `.env.ukoo.example` to `.env.local` and fill in:

```bash
NEXT_PUBLIC_UKOO_SUPABASE_URL=https://sqmtmxqadfernkpndjhr.supabase.co
NEXT_PUBLIC_UKOO_SUPABASE_ANON_KEY=<your-anon-key>
UKOO_SUPABASE_SERVICE_ROLE_KEY=<your-service-key>
UKOO_MODE=integrated
NEXT_PUBLIC_UKOO_LOCALES=en,sw
NEXT_PUBLIC_UKOO_DEFAULT_LOCALE=en
```

### 2. Dependencies

```bash
npm install
```

The repo uses npm workspaces. Ukoo packages:
- `packages/ukoo-core` — domain logic, types, utilities
- `packages/ukoo-ports` — service port interfaces
- `apps/ukoo` — Next.js app with routes + admin UI

### 3. Database Setup

Apply migrations to sqmtmxqadfernkpndjhr:

```bash
cd supabase
supabase link --project-ref sqmtmxqadfernkpndjhr
supabase db push
```

Migrations (Phase 0):
- `ukoo_001`: Types, extensions, helpers
- `ukoo_002`: Person, places, life events
- `ukoo_003`: Parentage, unions, ancestry closure
- `ukoo_004`: Spaces, members, invites
- `ukoo_005`: Billing catalog (products, plans, entitlements)
- `ukoo_006`: RLS policies

### 4. Local Development

```bash
# Start Next.js dev server
npm run dev

# TypeScript check
npm run typecheck --workspace=@ukoo/core

# ESLint (boundary checks)
cd apps/ukoo
npx eslint . --config eslint.config.mjs

# Run core tests
npm run test --workspace=@ukoo/core
```

Visit:
- `http://localhost:3000/en/` — Ukoo home (en locale)
- `http://localhost:3000/sw/` — Ukoo home (sw locale)
- `http://localhost:3000/admin/ukoo/products` — Admin: Products CRUD

## Architecture

### Mode A (Integrated, v1)

Ukoo runs alongside Kitabu Yetu in the same Next.js app:
- Separate Supabase project for Ukoo data
- Shared auth (eventual; currently independent)
- Calls Kitabu Yetu services via RPC for SMS, contributions, billing lookups

Route structure:
- `/[locale]/(ukoo)/tree` — Tree canvas (Phase 1)
- `/[locale]/(ukoo)/feed` — Social feed (Phase 5)
- `/admin/ukoo/products` — Billing admin

### Database-Driven Billing (Key Decision)

Products, plans, and entitlements live in the database, not as enums:
- `products`: ukoo, future products
- `plans`: free/premium/clan with pricing
- `plan_entitlements`: per-plan features (max_persons, storage, SMS, etc.)
- `space_billing`: links space to plan

Admin UI in `/admin/ukoo/products` allows custodians to manage products/plans without code deploys.

### i18n (Bilingual)

Routes are locale-prefixed: `/[locale]/...`
- Supported: `en`, `sw`
- Messages in `i18n/messages/{locale}.json`
- Server-side via next-intl + `getRequestConfig`

### Security

**RLS Policies** (Supabase):
- `can_view_person()` helper enforces privacy classes (living_private, living_family, deceased_family, deceased_public)
- Space members view family members only
- Custodians edit relationships

**ESLint Boundary**:
- No imports from `@kitabu/core`, `@kitabu/ports`, `@kitabu/services`
- Allows `@kitabu/ui` for shared components
- Enforced in CI via `eslint.config.mjs`

## Phase 0 Exit Gate

CI validation (`ukoo-phase-0.yml`):
- [ ] TypeScript zero-error (tsc --noEmit)
- [ ] ESLint boundary check (no forbidden @kitabu imports)
- [ ] Migration naming + syntax (ukoo_NNN_ pattern, contains DDL)
- [ ] No price literals in routes/pages/components (except seeded data)

## Next Steps (Phase 1)

- Tree canvas (D3 + ELK.js layout)
- Kinship core (relationship calculator, closure maintenance)
- Person sheet + URL state
- Accessibility (list alternative, keyboard nav)

## Troubleshooting

**Migrations won't apply?**
- Check project region is eu-central-1 (Kenya DPA compliance)
- Ensure service role key has DDL permissions
- Use `supabase db query --linked` not `supabase db push` (ledger may drift)

**i18n not working?**
- Verify `next.config.js` imports `createNextIntlPlugin`
- Check locale in URL: `/en/`, not `/`

**Admin UI 404?**
- Ensure `apps/ukoo/app/admin/ukoo/products/page.tsx` exists
- Restart dev server

## Documentation

- Spec: `docs/SPEC.md` (300+ lines, comprehensive)
- Plan: `.claude/plans/lexical-wibbling-wombat.md` (7 phases, ~29 weeks)
- Memory: `.claude/memory/project_ukoo_yetu_*.md` (session notes)

## References

- Supabase project: https://supabase.com/dashboard/project/sqmtmxqadfernkpndjhr
- Kitabu Yetu repo root: `docs/kitabu_yetu_rebuild_prompt_system.md` (authoritative system)
