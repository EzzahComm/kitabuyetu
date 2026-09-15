# KITABU YETU — DOCUMENTATION INDEX

> This file did not exist yet in the repo when PATCH 3 from `INTEGRATION-PATCHES.md` was
> applied, so it was created containing exactly the specified patch content below. If a
> fuller version of this document (indexing the rest of the repo's docs) exists elsewhere,
> merge that content above the section that follows rather than treating this file as the
> complete original.

---

## Optimize.ps1 Reference (PowerShell Script)

### Understanding the Five Engines

**For engineers who want to understand how the script works:**
1. Read **ULTIMATE-CONSOLIDATED-PROMPT-WITH-POWERSHELL.md** §3.1-3.10
   - Covers all five engines in detail
   - Explains state management, phase gating, classification
   - Describes automatic rollback mechanism

**For developers integrating with Claude Code:**
1. Read **ULTIMATE-CONSOLIDATED-PROMPT-WITH-POWERSHELL.md** §10 (Claude Code Integration)
   - Pre-phase setup code (JavaScript/Node.js)
   - How to invoke Optimize.ps1 as subprocess
   - How to read + parse state.json and reports
   - Example GitHub Actions workflow

### Running a Phase

**Quick reference:**

```powershell
# Dry-run (no changes, full audit)
./Optimize.ps1 -Phase 0

# Apply fixes to SAFE files
./Optimize.ps1 -Phase 0 -Apply

# Apply fixes to SAFE + CAUTION files (risky)
./Optimize.ps1 -Phase 0 -Apply -Force

# Check status of all phases
./Optimize.ps1 -Phase Status

# Run next pending phase
./Optimize.ps1 -Phase Next
```

**For detailed invocation guidance:**
→ FINAL-CONSOLIDATED-DELIVERY.md "Optimize.ps1 Orchestration"

### Interpreting Reports

**If you want to understand what Optimize.ps1 found:**

1. **phase{N}-discovery.json** — What's in the repo?
   - Routes count, components count, hooks, services, etc.
   - Detected UI libraries (shadcn, Flowbite, @kitabu/ui)
   - Detected package manager (npm, pnpm, yarn)

2. **phase{N}-classification.json** — Which files are SAFE/CAUTION/PROTECTED?
   - Use this to understand why certain files weren't auto-modified
   - PROTECTED files require manual review
   - CAUTION files require -Force flag

3. **phase{N}-optimization.json** — What design-system violations were found?
   - Hard-coded colors (#EF4444, rgb(...), rgba(...))
   - Hard-coded spacing (style={{ padding: 16px }})
   - Action: manually map to @kitabu/ui tokens

4. **phase{N}-validation.json** — Did the phase pass validation?
   - TypeScript compile check
   - ESLint linting check
   - Unit/integration tests
   - Production build
   - All must PASS for phase to exit PASSED

**For detailed interpretation:**
→ POWERSHELL-SCRIPT-ANALYSIS.md §3 (Reports Generated)

### File Safety Classification

**Understanding SAFE/CAUTION/PROTECTED:**

→ ULTIMATE-CONSOLIDATED-PROMPT-WITH-POWERSHELL.md §3.4 (Protection Engine)

| Level | Examples | Auto-fix Behavior |
|---|---|---|
| **PROTECTED** | ledger, payment, auth, RLS, migrations | Never (requires manual review) |
| **CAUTION** | middleware, config, routes, hooks | Only with -Apply -Force |
| **SAFE** | components/ui, layouts, styles, Flowbite | Whenever -Apply is set |

### Automatic Rollback

**How does rollback work?**

→ FINAL-CONSOLIDATED-DELIVERY.md "Failure Scenario (Automatic Recovery)"

If Validation Engine detects failure:
1. `git reset --hard <checkpoint-tag>` (instant rollback)
2. Phase status set to ROLLED_BACK
3. Validation report written to `phase{N}-validation.json`
4. Script exits (no further execution)

**Zero manual intervention needed.**

### Hard-Coded Value Detection

**Optimization Engine finds design-system violations:**

→ ULTIMATE-CONSOLIDATED-PROMPT-WITH-POWERSHELL.md §3.5 (Optimization Engine)

- Hard-coded colors: `#EF4444`, `rgb(...)`, `rgba(...)`
- Hard-coded spacing: `style={{ padding: 16px }}`

**Why these are flagged:**
- Violates R16–R18 (design system single source of truth)
- Require manual token migration (script reports, engineer maps)

### Cross-Phase Gating

**Rule: "DO NOT START A PHASE BEFORE PREVIOUS PHASE EXITS IN PRODUCTION"**

→ ULTIMATE-CONSOLIDATED-PROMPT-WITH-POWERSHELL.md §3.7 (State Management & Phase Gating)

Optimize.ps1 enforces this mechanically:
- Phase N cannot run unless Phase N-1 status = PASSED
- Read `.optimize/state.json` to check phase status
- Use `./Optimize.ps1 -Phase Status` to view all phases

### Backup Strategy

**Three-layer protection:**

→ ULTIMATE-CONSOLIDATED-PROMPT-WITH-POWERSHELL.md §3.3 (Safety Engine)

1. **Git tag checkpoint** — Fast rollback if git available
2. **Filesystem backup** — Recovery if git corrupted
3. **Manifest snapshots** — Fast diffing before/after

All three layers created automatically before any changes made.

---

*See also: [POWERSHELL-SCAN-COMPLETE.md](POWERSHELL-SCAN-COMPLETE.md),
[POWERSHELL-SCRIPT-ANALYSIS.md](POWERSHELL-SCRIPT-ANALYSIS.md),
[ULTIMATE-CONSOLIDATED-PROMPT-WITH-POWERSHELL.md](ULTIMATE-CONSOLIDATED-PROMPT-WITH-POWERSHELL.md),
[DELIVERY-SUMMARY.md](DELIVERY-SUMMARY.md),
[FINAL-CONSOLIDATED-DELIVERY.md](FINAL-CONSOLIDATED-DELIVERY.md).*
