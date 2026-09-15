# KITABU YETU — FINAL CONSOLIDATED DELIVERY

> This file did not exist yet in the repo when PATCH 2 from `INTEGRATION-PATCHES.md` was
> applied, so it was created containing exactly the specified patch content below. If a
> fuller version of this document (with a "Next Steps" section and a "Phase 1+ (Backend)"
> heading this content was meant to sit between) exists elsewhere, merge accordingly rather
> than treating this file as the complete original.

---

## Optimize.ps1 Orchestration (PowerShell v7+)

### Prerequisites

- PowerShell 7+ installed (`pwsh --version`)
- Repository cloned locally
- git working tree clean (or use -Force flag)
- npm packages installed (`npm install`)

### Typical Phase Execution

**1. Pre-phase (Developer/Claude Code)**

```javascript
// Read state to check previous phase status
const state = JSON.parse(fs.readFileSync(".optimize/state.json", "utf8"));
if (previousPhaseStatus !== "PASSED") {
  console.error("GATE BLOCKED: Previous phase not PASSED");
  process.exit(1);
}

// Verify git working tree is clean
const gitStatus = execSync("git status --porcelain").toString();
if (gitStatus.trim()) {
  // Either commit changes or add -Force to Optimize.ps1
}
```

**2. Dry-Run (Optimize.ps1)**

```powershell
./Optimize.ps1 -Phase 0
# Discovers code, creates checkpoint, classifies files, reports violations
# Zero code changes. Reports written to .optimize/reports/phase0-*.json
```

**3. Review Reports**

```javascript
// Read discovery to understand what was found
const discovery = JSON.parse(
  fs.readFileSync(".optimize/reports/phase0-discovery.json", "utf8"),
);
console.log(`Routes: ${discovery.routes.length}`);

// Read classification to see file safety
const classified = JSON.parse(
  fs.readFileSync(".optimize/reports/phase0-classification.json", "utf8"),
);
console.log(
  `PROTECTED: ${classified.PROTECTED.length}, CAUTION: ${classified.CAUTION.length}, SAFE: ${classified.SAFE.length}`,
);

// Read optimization to find hard-coded violations
const violations = JSON.parse(
  fs.readFileSync(".optimize/reports/phase0-optimization.json", "utf8"),
);
violations.forEach((v) => console.log(`${v.file}:${v.line} - ${v.type}`));
```

**4. Apply Fixes (if approved)**

```powershell
./Optimize.ps1 -Phase 0 -Apply
# Applies eslint --fix, prettier, manual token substitution
# Runs full validation (TypeScript, ESLint, tests, build)
# If PASS: phase marked PASSED
# If FAIL: auto-rollback to checkpoint, phase marked ROLLED_BACK
```

**5. Post-Phase (Developer/Claude Code)**

```javascript
// Check final state
const state = JSON.parse(fs.readFileSync(".optimize/state.json", "utf8"));
if (state.phases["0"].status === "PASSED") {
  console.log("✅ Phase 0 PASSED. Safe to proceed to Phase 1.");
} else if (state.phases["0"].status === "ROLLED_BACK") {
  // Read validation to see why
  const validation = JSON.parse(
    fs.readFileSync(".optimize/reports/phase0-validation.json", "utf8"),
  );
  // Fix issues, re-run: ./Optimize.ps1 -Phase 0 -Apply
}
```

### Failure Scenario (Automatic Recovery)

**Situation:** Developer runs `./Optimize.ps1 -Phase 2 -Apply`

**What happens:**

```
1. Optimize.ps1 creates checkpoint: optimize-checkpoint-phase2-20260914-143000
2. Discovers files, classifies, applies fixes
3. Validation fails (ESLint error)
4. Script automatically executes: git reset --hard optimize-checkpoint-phase2-20260914-143000
5. Phase status set to ROLLED_BACK
6. Reports written to .optimize/reports/phase2-validation.json
7. Script exits (zero further execution)
```

**Developer response:**

```powershell
# Read validation report to understand failure
Get-Content .optimize/reports/phase2-validation.json | ConvertFrom-Json

# Fix the issue in code
# Commit the fix
git add -A
git commit -m "Fix ESLint error in phase 2"

# Re-run phase
./Optimize.ps1 -Phase 2 -Apply
```

**No manual rollback needed.** Code is restored automatically. All three backups (git, zip, manifests) available if needed.

### File Classification & Auto-Modification

**PROTECTED files (R1-R9.5 territory):**

- Examples: ledger, payment, auth, RLS policies
- Behavior: Reported, never touched (even with -Apply -Force)
- Engineer: Must manually review + edit

**CAUTION files (risky to auto-fix):**

- Examples: middleware, auth UI, config, environment
- Behavior: Reported (dry-run), or modified if -Apply -Force
- Risk: Without -Force, no changes; with -Force, proceed with caution

**SAFE files (always safe to auto-fix):**

- Examples: UI components, layouts, presentation, styling
- Behavior: Always eligible for auto-fix (whenever -Apply set)
- Risk: Minimal (these are not business logic)

### Hard-Coded Value Detection

Optimization Engine scans for design-system violations:

**Hard-coded colors detected:**

```
#EF4444, #fff, rgb(100, 50, 200), rgba(...)
```

**Hard-coded spacing detected:**

```
style={{ padding: 16px }}, style={{ margin: 24px }}
```

**Why not auto-rewritten:**

- Colors have multiple formats (#hex, rgb, hsl) → semantic ambiguity
- Spacing values can't be safely mapped to Tailwind scale without engineer input
- Script reports violations in `phase{N}-optimization.json`
- Engineer manually maps to @kitabu/ui tokens

### State File Structure

```json
{
  "engineVersion": "3.0.1",
  "phases": {
    "0": {
      "status": "PASSED",
      "detail": "Checkpoint: optimize-checkpoint-phase0-20260914-140000",
      "updatedAt": "2026-09-14T14:00:00Z"
    },
    "1": {
      "status": "PENDING",
      "detail": "",
      "updatedAt": "2026-09-14T12:00:00Z"
    }
  },
  "createdAt": "2026-09-14T12:00:00Z"
}
```

**Never manually edit state.json** — it's the contract between Optimize.ps1 and your orchestration layer.

### Reports Generated Per Phase

```
.optimize/reports/
├── phase0-discovery.json        # Routes, components, services, migrations
├── phase0-classification.json   # SAFE/CAUTION/PROTECTED breakdown
├── phase0-optimization.json     # Hard-coded value violations
└── phase0-validation.json       # TypeScript, ESLint, test, build results
```

Each report is JSON (machine-readable for Claude Code / CI/CD automation).

---

_See also: [POWERSHELL-SCAN-COMPLETE.md](POWERSHELL-SCAN-COMPLETE.md),
[POWERSHELL-SCRIPT-ANALYSIS.md](POWERSHELL-SCRIPT-ANALYSIS.md),
[ULTIMATE-CONSOLIDATED-PROMPT-WITH-POWERSHELL.md](ULTIMATE-CONSOLIDATED-PROMPT-WITH-POWERSHELL.md),
[DELIVERY-SUMMARY.md](DELIVERY-SUMMARY.md),
[DOCUMENTATION-INDEX.md](DOCUMENTATION-INDEX.md)._
