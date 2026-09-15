# INTEGRATION PATCHES FOR DOCUMENTATION FILES

## 📋 How to use this document

This document contains **copy-paste sections** to integrate into three existing files:
1. DELIVERY-SUMMARY.md
2. FINAL-CONSOLIDATED-DELIVERY.md
3. DOCUMENTATION-INDEX.md

Each section is marked with the **target file name** and **insertion point**.

---

## 🔧 PATCH 1: DELIVERY-SUMMARY.md

### Insertion point: After the "Executive Summary" section

**Add this new section:**

```markdown
---

## PowerShell Script Integration (Optimize.ps1 v3.0.1)

The Kitabu Yetu optimization process is orchestrated by **Optimize.ps1** — an autonomous 
five-engine PowerShell script that ensures zero-downtime phase progression.

### Five Engines

1. **Discovery Engine** — Inventories routes, components, services, migrations
   - Output: `phase{N}-discovery.json`
   
2. **Safety Engine** — Creates git checkpoint + filesystem backup + manifest snapshots
   - Output: checkpoint tag, backup zip, manifest snapshots
   
3. **Protection Engine** — Classifies files as SAFE/CAUTION/PROTECTED
   - Output: `phase{N}-classification.json`
   
4. **Optimization Engine** — Finds hard-coded colors/spacing, applies safe fixes
   - Output: `phase{N}-optimization.json`
   
5. **Validation Engine** — TypeScript, ESLint, tests, production build
   - Output: `phase{N}-validation.json`

### State Management

**State file:** `.optimize/state.json`

Each phase has a status: `PENDING` | `RUNNING` | `PASSED` | `FAILED` | `ROLLED_BACK`

**Core rule:** Phase N cannot start unless phase N-1 is PASSED. (Optimize.ps1 enforces this mechanically.)

### File Classification

```
PROTECTED (R1-R9.5 territory):
  - *ledger*, *payment*, *daraja*, *auth*, *rls*, *policies.sql*
  - NEVER auto-modified, even with -Apply -Force
  
CAUTION (risky to auto-fix):
  - *hooks*, *middleware*, *route.ts*, *config*, *env*
  - Auto-modified only if -Apply -Force both set
  
SAFE (always safe to auto-fix):
  - */components/ui/*, *presentation*, *styles*, *flowbite*, *shadcn*
  - Auto-modified whenever -Apply is set
```

### Invocation

```powershell
# Dry-run: discover, checkpoint, classify, report (zero changes)
./Optimize.ps1 -Phase 0

# Apply fixes to SAFE files + validate
./Optimize.ps1 -Phase 0 -Apply

# Apply fixes to SAFE + CAUTION files (risky)
./Optimize.ps1 -Phase 0 -Apply -Force

# Check status of all phases
./Optimize.ps1 -Phase Status

# Run next pending phase
./Optimize.ps1 -Phase Next
```

### Automatic Rollback

If validation fails, Optimize.ps1 automatically:
1. Rolls back to checkpoint: `git reset --hard <tag>`
2. Marks phase as ROLLED_BACK
3. Writes failure report to `phase{N}-validation.json`
4. **Stops** (no continued execution)

Zero manual recovery needed — code is restored to pre-phase state instantly.

---
```

---

## 🔧 PATCH 2: FINAL-CONSOLIDATED-DELIVERY.md

### Insertion point: Under "Next Steps" section, before "Phase 1+ (Backend)" heading

**Add this new section:**

```markdown
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
const state = JSON.parse(fs.readFileSync('.optimize/state.json', 'utf8'));
if (previousPhaseStatus !== 'PASSED') {
  console.error('GATE BLOCKED: Previous phase not PASSED');
  process.exit(1);
}

// Verify git working tree is clean
const gitStatus = execSync('git status --porcelain').toString();
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
const discovery = JSON.parse(fs.readFileSync('.optimize/reports/phase0-discovery.json', 'utf8'));
console.log(`Routes: ${discovery.routes.length}`);

// Read classification to see file safety
const classified = JSON.parse(fs.readFileSync('.optimize/reports/phase0-classification.json', 'utf8'));
console.log(`PROTECTED: ${classified.PROTECTED.length}, CAUTION: ${classified.CAUTION.length}, SAFE: ${classified.SAFE.length}`);

// Read optimization to find hard-coded violations
const violations = JSON.parse(fs.readFileSync('.optimize/reports/phase0-optimization.json', 'utf8'));
violations.forEach(v => console.log(`${v.file}:${v.line} - ${v.type}`));
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
const state = JSON.parse(fs.readFileSync('.optimize/state.json', 'utf8'));
if (state.phases['0'].status === 'PASSED') {
  console.log('✅ Phase 0 PASSED. Safe to proceed to Phase 1.');
} else if (state.phases['0'].status === 'ROLLED_BACK') {
  // Read validation to see why
  const validation = JSON.parse(fs.readFileSync('.optimize/reports/phase0-validation.json', 'utf8'));
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
```

---

## 🔧 PATCH 3: DOCUMENTATION-INDEX.md

### Insertion point: At the end of the file, as a new main section

**Add this new section:**

```markdown

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
```

---

## 📋 SUMMARY OF CHANGES

### DELIVERY-SUMMARY.md
- **Addition:** "PowerShell Script Integration" section (300 words)
- **Location:** After Executive Summary
- **Content:** Five engines, state management, file classification, invocation examples

### FINAL-CONSOLIDATED-DELIVERY.md
- **Addition:** "Optimize.ps1 Orchestration" section (700 words)
- **Location:** Under "Next Steps", before "Phase 1+ (Backend)"
- **Content:** Typical execution flow, failure scenario, classification, reports, state structure

### DOCUMENTATION-INDEX.md
- **Addition:** "Optimize.ps1 Reference" section (800 words)
- **Location:** End of file, new main section
- **Content:** Quick reference, navigation links, detailed tables for SAFE/CAUTION/PROTECTED

### ULTIMATE-CONSOLIDATED-PROMPT.md
- **Status:** Replaced with **ULTIMATE-CONSOLIDATED-PROMPT-WITH-POWERSHELL.md** (new file)
- **Changes:** Added §3 (Five-Engine Architecture), updated §4-9 with Optimize.ps1 context, added §10 (Claude Code Integration)
- **Size:** ~12,000 words (was ~6,500)

---

## ✅ INTEGRATION CHECKLIST

- [ ] Copy PATCH 1 into DELIVERY-SUMMARY.md (after Executive Summary)
- [ ] Copy PATCH 2 into FINAL-CONSOLIDATED-DELIVERY.md (under Next Steps)
- [ ] Copy PATCH 3 into DOCUMENTATION-INDEX.md (end of file)
- [ ] Replace ULTIMATE-CONSOLIDATED-PROMPT.md with ULTIMATE-CONSOLIDATED-PROMPT-WITH-POWERSHELL.md
- [ ] Verify all cross-references work (navigate between docs)
- [ ] Update file index (16 documents → 17 with POWERSHELL-SCRIPT-ANALYSIS.md)

---

**Status:** ✅ Integration patches ready. Can be applied immediately.
