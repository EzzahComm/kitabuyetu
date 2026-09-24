---
name: optimize
description: Run one pass of the continuous-optimization loop on this repo — measure codebase health, pick the single highest-value improvement (correctness first, then resource efficiency), implement it with proof, and open a draft PR with before/after numbers. Use when asked to "optimize", "run the optimize pass", "improve the codebase", or when fired by the weekly optimize Routine.
---

# Optimize pass

One pass = **one focused, verified PR**. Small and provably better beats broad
and plausible. The loop is described in `docs/health/README.md`.

## 0. Preconditions

1. Start from a fresh `main`: `git fetch origin main && git checkout -B optimize/<YYYY-MM-DD>-<slug> origin/main`
   (pick the slug after step 2).
2. Install: `npm ci --include=dev`.
3. Load the build placeholder env (same values CI uses — never real secrets).
   Works with both the jq-style (Python) and mikefarah `yq`:
   ```bash
   eval "$(yq -r '.env | to_entries | .[] | "export " + .key + "=" + (.value | tostring | @sh)' .github/workflows/ci.yml)"
   ```
4. **Pile-up guard.** List open PRs whose head branch starts with `optimize/`.
   If there are **2 or more**, do not open another: report their numbers and
   what blocks them, then stop. If there is 1, do not pick a target in the same
   file or area as it.

## 1. Measure (before)

```bash
npm run test:coverage:summary     # coverage/coverage-summary.json
npm run build                     # .next/ for bundle metrics
npm run health                    # .health/report.{md,json}, deltas vs docs/health/baseline.json
cp .health/report.json /tmp/health-before.json
```

Also run `npm run lint` and `npm run typecheck`. Read `.health/report.md`.

## 2. Pick ONE target — first match wins

| # | Signal | Target |
|---|---|---|
| 1 | `main` is red: a test, lint, typecheck or build failure | Root-cause and fix it. Nothing else this pass. |
| 2 | `audit.critical` or `audit.high` > 0 | Patch/minor bump that clears it (`npm audit fix`, **never** `--force`). |
| 3 | Money or tenant-safety code with low coverage (`lib/services/*mpesa*`, `*ledger*`, `*loan*`, `*finance*`, `*accounting*`, `*b2c*`, `*c2b*`) | Add unit tests for untested branches. **Tests only**: if a test exposes a bug, fix it in the same PR and say so up front. |
| 4 | Other `lib/` coverage gaps | Tests for the most-called uncovered service functions. |
| 5 | Server efficiency in `lib/services` or `app/api`: N+1 loops, unbounded `SELECT`s, missing pagination, sequential awaits that could run in parallel, repeated identical queries per request | Fix it, following `.agents/skills/supabase-postgres-best-practices`. Needs a test that pins the behaviour. |
| 6 | Client bundle: `bundle.largestChunkKb`, or top chunks in the report | Dynamic-import heavy client-only libraries, move work to server components, drop unused imports. |
| 7 | Hygiene counters: `explicitAny`, `consoleLog`, `eslintSuppressions` | Replace with real types, the project logger, or a proper fix. |
| 8 | Files over 600 lines | Split **only** when the file already has tests covering what moves. |

Check the git log and open PRs so you don't redo recent work. The
`docs/audits/` reports list known issues and what has already been fixed.

## 3. Implement

- Keep the diff under ~300 changed lines, excluding new test files. A bigger
  target gets a partial fix plus a note on what remains.
- Match surrounding code: naming, comment density, error handling, and the
  `lib/` service-layer boundaries.
- Next.js here is newer than your training data (see `AGENTS.md`). Read
  `node_modules/next/dist/docs/` before touching routing, caching or config.

## 4. Verify (after): all of it, every time

```bash
npm run lint && npm run format:check && npm run typecheck
npm run test:coverage:summary
npm run build
npm run health -- --strict        # exit 1 if anything regressed vs baseline
```

- Any failure: fix it, or abandon the pass (see step 6). Never push red.
- `--strict` regression on a metric you didn't mean to touch: understand why
  before continuing. Bundle KB drift within tolerance is fine.
- Re-read your own diff adversarially: what would a reviewer or CI reject?

## 5. Ship

1. Promote the new numbers so the trend ratchets once this merges:
   `node scripts/health/report.mjs --write-baseline docs/health/baseline.json`
   (only after a full build + coverage run, or bundle and coverage numbers are lost).
2. Commit with a conventional message (`test(…)`, `perf(…)`, `fix(…)`, `chore(…)`).
3. Push the `optimize/…` branch and open a **draft** PR against `main` titled
   `optimize: <what changed>`. The body must include:
   - **Target and why**: which row of the table above, and the evidence.
   - **Change**: what and where.
   - **Proof**: the "Change vs baseline" table from `.health/report.md` plus
     the commands you ran.
   - **Risk**: what could break, and why the tests say it doesn't.

## 6. Hard rules

Never:
- push to `main`, force-push, or rewrite history on a branch you didn't create
- skip, delete, `.only`, or loosen a test; lower coverage thresholds; weaken
  lint rules or add `eslint-disable` / `@ts-ignore` to get green
- add, edit or apply SQL migrations, RLS policies, or anything under `supabase/`
  (schema changes go through the audited migration process, not a bot pass)
- edit `.github/workflows/ci.yml`, `.gitleaks.toml`, or auth/tenant-isolation
  logic (`proxy.ts`, `lib/auth*`, `lib/db` role handling)
- do major-version dependency upgrades, or add new dependencies
- touch `.env*` or anything containing credentials

If no target can be completed safely, open **no PR**. Report what you measured,
which target you tried, and what blocked it. A clean "nothing safe to do this
week" is a valid outcome.
