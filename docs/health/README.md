# Continuous optimization loop

A weekly measure → improve → verify cycle aimed at two things: **correct
behaviour** (tests, type safety, known-bug classes) and **efficient resource
use** (client bundle, server work, dependency weight). Every change still goes
through the normal PR + CI gate. Nothing here merges on its own.

```
 Mon 02:00 EAT        Mon 05:00 EAT           weekly Routine (Claude Code)
┌──────────────┐    ┌─────────────────┐    ┌──────────────────────────────────┐
│ Health       │    │ Dependabot      │    │ /optimize skill                  │
│ workflow     │    │ grouped minor/  │    │ measure → pick ONE target →      │
│ (report-only)│    │ patch PR        │    │ fix → verify → draft PR with     │
└──────┬───────┘    └────────┬────────┘    │ before/after numbers             │
       │ trend               │ deps        └───────────────┬──────────────────┘
       ▼                     ▼                             ▼
             CI/CD gate: lint · format · typecheck · jest · build ·
             gitleaks · CodeQL · tenant-isolation (RLS) suite
                                   ▼
                          human review → merge
                                   ▼
                baseline.json ratchets forward with each merged pass
```

## Pieces

| File                               | Role                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `scripts/health/report.mjs`        | Collects the metrics (no dependencies). Writes `.health/report.{md,json}` (gitignored).                |
| `docs/health/baseline.json`        | Last accepted numbers. Optimize PRs update it, so the bar only moves up.                               |
| `.github/workflows/health.yml`     | Weekly and on-demand report in the Actions run summary, plus a `health-report` artifact. Never blocks. |
| `.github/dependabot.yml`           | Weekly grouped minor/patch npm and Actions updates. Majors arrive as separate PRs.                     |
| `.claude/skills/optimize/SKILL.md` | The agent playbook: priority order, verification steps and hard limits.                                |

## Metrics

| Area       | Metric                                                                            | Source                                                                          | Better |
| ---------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| Accuracy   | line / branch / function coverage                                                 | jest `coverage-summary.json` (scope: `collectCoverageFrom` in `jest.config.ts`) | ↑      |
| Efficiency | client JS total, largest client chunk                                             | `.next/static/**/*.js`                                                          | ↓      |
| Efficiency | server output                                                                     | `.next/server/**/*.js`                                                          | ↓      |
| Security   | prod vulnerabilities by severity                                                  | `npm audit --omit=dev`                                                          | ↓      |
| Hygiene    | explicit `any`, `@ts-*`, `eslint-disable`, `console.log`, TODO, files > 600 lines | source scan of `app components lib hooks providers types`                       | ↓      |

A metric whose input is missing (no build, offline audit) reports as
_not measured_ and is left out of comparisons. It is never counted as zero.
Tolerances (0.5 pp coverage, 5 KB per bundle metric, 50 KB server) absorb
build noise.

## Commands

```bash
npm run test:coverage:summary   # coverage without the 50% gate (measure, don't block)
npm run build                   # needed for bundle metrics
npm run health                  # report + deltas vs baseline
npm run health -- --strict      # exit 1 on any regression (what optimize passes use)
node scripts/health/report.mjs --write-baseline docs/health/baseline.json
```

`npm run build` needs the placeholder env from `ci.yml`. The optimize skill
shows a one-line `yq` loader for it.

## Known gap

`jest.config.ts` sets a 50% global coverage threshold, but `lib/` is at about
27%. CI runs `jest --ci` without `--coverage`, so the threshold is never
enforced. It only fails local `npm run test:coverage`. The optimize loop
raises coverage over time, with money-handling services first. Once coverage
passes 50%, CI can switch to `--coverage` and the threshold becomes a real gate.
