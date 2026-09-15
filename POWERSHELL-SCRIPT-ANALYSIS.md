# POWERSHELL SCRIPT ANALYSIS & CLAUDE CODE INTEGRATION GUIDE

**Script:** `Optimize.ps1` (v3.0.1)
**Status:** ✅ Scanned | Unique attributes identified | Integration required

---

## 🔍 UNIQUE ATTRIBUTES FOUND (Must be integrated)

### 1. **Five-Engine Architecture** (Mechanically Enforced)

**Engines implemented in Optimize.ps1:**

```
Discovery Engine       → Inventory repo (routes, components, hooks, services, migrations)
     ↓
Safety Engine         → Git checkpoint + filesystem backup + manifest snapshots
     ↓
Protection Engine     → Classify files (SAFE/CAUTION/PROTECTED)
     ↓
Optimization Engine   → Find violations, apply fixes (eslint --fix, prettier, tokens)
     ↓
Validation Engine     → TypeScript, ESLint, unit tests, production build
```

**New context for documentation:**
- NOT sequential OR operations → each phase runs ALL five engines
- Discovery outputs file inventory → passed to Protection → passed to Optimization
- Safety creates checkpoint BEFORE any changes → Validation determines rollback
- Automatic rollback if Validation fails (no manual recovery needed)

**Impact on ULTIMATE-CONSOLIDATED-PROMPT.md:**
- Add §7.1: "Engine Orchestration" explaining five-engine flow
- Add diagram showing all five engines running per phase
- Clarify that "dry-run mode" uses all five engines but Optimization only reports

### 2. **State Management & Phase Gating** (Critical for Claude Code)

**State file location:** `.optimize/state.json`

**State structure:**
```json
{
  "engineVersion": "3.0.1",
  "phases": {
    "0": { "status": "PASSED", "detail": "...", "updatedAt": "2026-09-14T..." },
    "1": { "status": "PENDING", "detail": "", "updatedAt": "..." },
    ...
  },
  "createdAt": "2026-09-14T..."
}
```

**Phase statuses:**
- `PENDING` — has not been run
- `RUNNING` — currently executing
- `PASSED` — completed validation, safe to proceed to next phase
- `FAILED` — validation failed, was rolled back
- `ROLLED_BACK` — rolled back after failure

**Core rule enforced mechanically:**
```
Assert-PreviousPhasePassed: 
  IF current phase is NOT "0"
    THEN previous phase must be "PASSED" 
    ELSE throw "GATE BLOCKED"
```

**Impact on documentation:**
- Add §2 to ULTIMATE: "State Management & Phase Gating"
- Clarify that Optimize.ps1 is the single source of truth for phase status
- Add Claude Code integration: how to read state.json before invoking Optimize.ps1
- Add: "NEVER manually edit state.json" (is the contract with Optimize.ps1)

### 3. **Safety Engine: Checkpoint + Backup Architecture**

**Three-layer backup strategy:**

1. **Git tag checkpoint**
   - Tag name: `optimize-checkpoint-phase{N}-{timestamp}`
   - Commit message documents which phase created it
   - Used for rollback: `git reset --hard <tag>`

2. **Filesystem backup (zip)**
   - Location: `.optimize/backups/phase{N}-{timestamp}.zip`
   - Contents: entire working tree EXCEPT excluded dirs (node_modules, .git, .next, dist, build, .optimize, .turbo, coverage)
   - Purpose: fast restore if git history is corrupted or git is unavailable

3. **Manifest + route snapshots**
   - Location: `.optimize/backups/phase{N}-manifests/`
   - Files: package.json, tsconfig.json, tailwind.config.*, next.config.*, .env.example, routes-snapshot.txt
   - Purpose: fast diffing in validation phase (can compare before/after without inspecting entire backup)

**Rollback mechanism:**
```
IF Validation FAILS
  THEN Invoke-Rollback:
    1. git reset --hard <tag>
    2. git clean -fd (remove untracked files)
    3. Set phase status to ROLLED_BACK
    4. STOP (do not continue)
```

**New in spec:**
- Added belt-and-suspenders: each backup is verified by comparing manifest snapshots
- Explicit rollback means data loss prevention is enforced, not optional

**Impact on documentation:**
- Add §5.1: "Backup Strategy" in ULTIMATE-CONSOLIDATED-PROMPT.md
- Add diagram: how checkpoint works (before/after)
- Clarify: "This script cannot corrupt your code; if validation fails, it rewinds automatically"

### 4. **File Classification System (SAFE/CAUTION/PROTECTED)**

**Three classifications with automatic behavior:**

```
PROTECTED (R1-R9.5 territory):
  *ledger*, *payment*, *daraja*, *mpesa*, */auth/*, *routes*, *policies.sql*
  → NEVER auto-modified by script, even with -Apply -Force
  → Must be manually reviewed/updated by engineer
  → Examples: payment logic, tenancy auth, RLS policies, ledger posting

CAUTION (risky to auto-fix):
  *hooks*, *api/client*, *route.ts*, *middleware*, *auth-ui*, *config*, *env*
  → Auto-modified ONLY if -Apply -Force both set
  → Examples: API clients, auth middleware, environment configs
  → Without -Force: reported only (dry-run behavior)

SAFE (safe to auto-modify):
  */components/ui/*, *presentation*, *styles*, *flowbite*, *shadcn*, *kitabu-ui*
  → Auto-modified whenever -Apply is set (even without -Force)
  → Examples: UI components, layout components, styling
```

**Matching logic:**
1. All paths are normalized to forward-slashes (cross-platform)
2. All paths stored as repo-relative (leading '/')
3. Patterns use PowerShell `-like` operator (supports wildcards)
4. First match wins (order matters: check PROTECTED first, then CAUTION, then SAFE)
5. Default: unknown files are CAUTION (conservative posture)

**Key innovation:**
- Bug fix #1: Every recursive scan excludes excluded dirs (node_modules, .git, etc.)
- Bug fix #2: Every path is normalized to `/path/to/file` (forward slash) before classification
  - Ensures -like patterns work the same on Windows and non-Windows PowerShell
  - Stores relative paths consistently in reports

**Impact on documentation:**
- Add §4: "File Classification" in ULTIMATE-CONSOLIDATED-PROMPT.md
- Add table: PROTECTED/CAUTION/SAFE patterns with examples
- Add: "This classification prevents auto-modification of money/auth code"
- Add Claude Code workflow: "Read phase{N}-classification.json to see what was flagged"

### 5. **Hard-Coded Value Detection (R16-R18)**

**Two detection patterns:**

```powershell
# Pattern 1: Hard-coded colors
$HardCodedColorRegex = '#(?:[0-9a-fA-F]{3}){1,2}\b|rgb\(|rgba\('
  Matches: #EF4444, #fff, rgb(100, 50, 200), rgba(...)

# Pattern 2: Hard-coded spacing
$HardCodedSpacingRegex = '\bstyle=\{\{[^}]*(margin|padding)[^}]*:\s*[0-9]+px'
  Matches: style={{ margin: 16px }}, style={{ padding: 24px }}
```

**Detection flow:**
1. Scan all .tsx/.ts/.js/.jsx/.css files in SAFE + (CAUTION if -Force) targets
2. For each line: test regex patterns
3. Log violations (file, line number, matched text, type)
4. Report in JSON (phase{N}-optimization.json)
5. Manual token migration required (NOT auto-rewritten, semantic risk)

**Why not auto-rewrite hard-coded values:**
- Colors: multiple representation formats (#hex vs rgb vs hsl) → semantic ambiguity
- Spacing: can't safely map px values to Tailwind scale without domain knowledge
- Script reports violations; engineer maps to @kitabu/ui tokens

**Impact on documentation:**
- Add §6.2: "Hard-Coded Value Detection" in ULTIMATE-CONSOLIDATED-PROMPT.md
- Clarify: "Script reports design-token violations; you fix them"
- Add: "Use phase{N}-optimization.json to find violations"
- Add: Example mapping (16px margin → clamp-4, #EF4444 → tw-error)

### 6. **Cross-Platform Path Normalization** (Bug fixes #1 & #2)

**Problem solved:**
- Windows PowerShell gives backslash paths: `C:\repo\app\components\Button.tsx`
- Non-Windows PowerShell gives forward-slash paths: `/home/user/repo/app/components/Button.tsx`
- Patterns written with wildcards need consistent separator

**Solution implemented:**

```powershell
function ConvertTo-NormalizedRelativePath {
  # Input: full path (any separator)
  # Output: "/app/components/Button.tsx" (always forward-slash, leading /)
  
  # Strips repo prefix
  # Converts all backslashes to forward slashes
  # Ensures leading /
}

function Test-ExcludedPath {
  # True if any path segment matches excluded dir names
  # Used by Discovery/Protection/Optimization engines
  # Prevents node_modules, .git, .next, dist, build, .optimize, .turbo, coverage
  #   from being scanned, backed up, or classified
}
```

**Every recursive scan now:**
1. Excludes node_modules, .git, .next, dist, build, .optimize, .turbo, coverage
2. Normalizes output to `/path/to/file` before storing/classifying
3. Patterns in PROTECTED/CAUTION/SAFE lists use forward-slash-only notation

**Impact on documentation:**
- Add §3: "Excluded Directories" in ULTIMATE-CONSOLIDATED-PROMPT.md
- List all 8 excluded dirs + explain why each is excluded
- Add: "Build artifacts never appear in reports/backups/classification"

### 7. **Excluded Directories (8 total)**

**Directories never scanned, backed up, or classified:**

```
node_modules    — npm dependencies (too large, auto-generated)
.git            — git internal (managed by git checkpoint mechanism)
.next           — Next.js build cache (regenerated on npm run build)
dist            — legacy build output (not used in this project)
build           — legacy build output (not used in this project)
.optimize       — this script's own backups/reports/state (prevent meta-recursion)
.turbo          — Turbo cache (auto-generated)
coverage        — test coverage reports (auto-generated)
```

**Implementation:**
- `$Script:ExcludedDirNames` array in script
- `Test-ExcludedPath` function checks if any path segment is in that array
- Called BEFORE every recursive Get-ChildItem scan
- Called BEFORE every backup
- Called BEFORE every classification

**Impact on documentation:**
- Add to ULTIMATE: "These directories are systematically excluded from all engines"
- Clarify: "Backup size is 10-50MB (source only), not 500MB+ (with node_modules)"

### 8. **Dry-Run Architecture & -Apply Flag**

**Two modes of operation:**

**Mode 1: Dry-Run (default, no -Apply)**
```
ALL FIVE ENGINES RUN:
  Discovery     ✓ Inventory created
  Safety        ✓ Checkpoint + backup created
  Protection    ✓ Files classified
  Optimization  ✓ Violations REPORTED (no fixes written)
  Validation    ✓ Full build/test run (against original code)

Result: Full audit + report + checkpoint, zero code changes
```

**Mode 2: Apply Mode (-Apply)**
```
ALL FIVE ENGINES RUN:
  Discovery     ✓ Inventory created
  Safety        ✓ Checkpoint + backup created
  Protection    ✓ Files classified
  Optimization  ✓ Violations reported + fixes APPLIED to SAFE files
                  (eslint --fix, prettier, token substitution)
  Validation    ✓ Full build/test run (against FIXED code)

If Validation PASSES:  Phase marked PASSED in state.json
If Validation FAILS:   Automatic rollback to checkpoint, phase marked ROLLED_BACK
```

**-Force flag behavior:**
- Default: only SAFE files are auto-modified
- With -Force: CAUTION files also eligible for auto-modification
- PROTECTED files: NEVER auto-modified, even with -Force
  - Exception: requires manual review + git checkout/edit/commit by engineer

**Impact on documentation:**
- Add §2.1: "Dry-Run vs Apply Mode" in ULTIMATE-CONSOLIDATED-PROMPT.md
- Add table showing what happens in each mode
- Add: "Dry-run is safe: creates checkpoint but makes no changes"
- Add: "-Force is risky: enables auto-fixes on auth/config code"

### 9. **Validation Gate & Automatic Rollback**

**Validation checks run:**

```powershell
1. TypeScript compile check   (tsc --noEmit)
2. ESLint check               (eslint . --ext .ts,.tsx,.js,.jsx)
3. Unit/integration tests     (npm test --ci)
4. Phase 0 specific:          (page.tsx count >= 15)
5. Production build           (npm run build)
```

**If ALL pass:**
- Phase marked PASSED in state.json
- Phase can transition to next phase
- Report written with "PASSED" status

**If ANY fail:**
- Phase marked FAILED in state.json
- AUTOMATIC ROLLBACK triggered:
  1. `git reset --hard <checkpoint-tag>`
  2. `git clean -fd`
  3. Phase marked ROLLED_BACK
  4. Script STOPS (does not continue)
- Engineer reads failure report, fixes issues, re-runs phase

**Impact on documentation:**
- Add §7.2: "Validation Gate & Rollback" in ULTIMATE-CONSOLIDATED-PROMPT.md
- Add flowchart: Optimization → Validation → (PASS → next) or (FAIL → rollback)
- Add: "Script never leaves phase in broken state"

### 10. **Reports Generated (All JSON)**

**Reports created per phase in `.optimize/reports/`:**

```
phase{N}-discovery.json       → Full inventory (routes, components, services, etc.)
phase{N}-classification.json  → SAFE/CAUTION/PROTECTED file breakdown
phase{N}-optimization.json    → Hard-coded value violations + fix suggestions
phase{N}-validation.json      → TypeScript/ESLint/test/build results
```

**Usage by Claude Code:**
```javascript
// Read state to determine what phase to run
const state = JSON.parse(fs.readFileSync('.optimize/state.json', 'utf8'));
const phaseStatus = state.phases['0'].status;

// Read discovery to understand what was found
const discovery = JSON.parse(fs.readFileSync('.optimize/reports/phase0-discovery.json', 'utf8'));
console.log(`Routes: ${discovery.routes.length}, Components: ${discovery.components.length}`);

// Read classification to see file safety
const classified = JSON.parse(fs.readFileSync('.optimize/reports/phase0-classification.json', 'utf8'));
console.log(`PROTECTED files: ${classified.PROTECTED.length}`);

// Read optimization to see violations
const violations = JSON.parse(fs.readFileSync('.optimize/reports/phase0-optimization.json', 'utf8'));
violations.forEach(v => console.log(`${v.file}:${v.line} - ${v.type}`));
```

**Impact on documentation:**
- Add §8: "Reports & Claude Code Integration" in ULTIMATE-CONSOLIDATED-PROMPT.md
- Add JSON schema for each report type
- Add Claude Code example: reading reports

---

## 🚀 REQUIRED UPDATES TO EXISTING DOCUMENTATION FILES

### **1. ULTIMATE-CONSOLIDATED-PROMPT.md** (Primary document)

**Add new sections:**

```
§2.1 Five-Engine Architecture (new)
  - Discovery Engine workflow
  - Safety Engine workflow
  - Protection Engine workflow
  - Optimization Engine workflow
  - Validation Engine workflow
  - Diagram showing all five running per phase

§2.2 State Management & Phase Gating (new)
  - State file structure (state.json)
  - Phase statuses (PENDING/RUNNING/PASSED/FAILED/ROLLED_BACK)
  - Core rule: "DO NOT START A PHASE BEFORE PREVIOUS PHASE EXITS"
  - Assert-PreviousPhasePassed logic

§2.3 Backup Strategy (new)
  - Git tag checkpoint
  - Filesystem backup (zip)
  - Manifest snapshots
  - Rollback mechanism

§2.4 File Classification (new)
  - PROTECTED patterns (R1-R9.5)
  - CAUTION patterns
  - SAFE patterns
  - Matching logic (first match wins)
  - Default: CAUTION

§2.5 Hard-Coded Value Detection (new)
  - Color regex pattern
  - Spacing regex pattern
  - Violation reporting
  - Manual token migration

§2.6 Cross-Platform Path Normalization (new)
  - ConvertTo-NormalizedRelativePath
  - Test-ExcludedPath
  - Why both functions are necessary

§2.7 Excluded Directories (new)
  - 8 excluded dirs (node_modules, .git, .next, dist, build, .optimize, .turbo, coverage)
  - Why each is excluded
  - Impact on backup size + scan time

§2.8 Dry-Run vs Apply Mode (new)
  - Mode 1: Dry-run (all engines, no changes)
  - Mode 2: Apply (all engines + fixes)
  - -Force flag behavior
  - PROTECTED files never auto-modified

§2.9 Validation Gate & Automatic Rollback (new)
  - Validation checks (TypeScript, ESLint, tests, build)
  - Pass/Fail logic
  - Automatic rollback on failure
  - Engineer workflow

§2.10 Reports & JSON Outputs (new)
  - Four report types (discovery, classification, optimization, validation)
  - Schema for each
  - How to read/parse in Claude Code
```

**Modify existing sections:**

```
§1 Executive Summary
  - Add: "Engine orchestration is mechanical (five engines per phase)"
  - Add: "Rollback is automatic (no manual recovery)"

§3 PHASE 0 EXECUTION BLUEPRINT
  - Add: "Validate against Optimize.ps1 reports"
  - Add: "Check state.json after each phase"

§5 FAILURE POINT MITIGATION MATRIX
  - Add: "Automatic rollback" as mitigation for all validation failures
  - Add: "File classification prevents risky auto-modifications"

§6 UI/UX OPTIMIZATION PLAYBOOK
  - Add: "Hard-coded colors/spacing caught by Optimize.ps1"
  - Add: "Use phase{N}-optimization.json to find violations"
```

### **2. DELIVERY-SUMMARY.md** (Quick reference)

**Add new section: "PowerShell Script Integration"**

```
# PowerShell Script Integration

The Optimize.ps1 script (v3.0.1) implements five engines:

1. **Discovery** — Inventory routes, components, services, migrations
2. **Safety** — Git checkpoint + filesystem backup + manifest snapshots
3. **Protection** — Classify files (SAFE/CAUTION/PROTECTED)
4. **Optimization** — Find hard-coded values, apply safe fixes
5. **Validation** — TypeScript, ESLint, tests, production build

**State management:**
- State file: `.optimize/state.json`
- Phase status: PENDING | RUNNING | PASSED | FAILED | ROLLED_BACK
- Core rule: NEVER start phase N unless phase N-1 is PASSED

**Reports:**
- phase{N}-discovery.json
- phase{N}-classification.json
- phase{N}-optimization.json
- phase{N}-validation.json

**Invocation:**
```powershell
# Dry-run (no changes, full audit)
./Optimize.ps1 -Phase 0

# Apply fixes + validate
./Optimize.ps1 -Phase 0 -Apply

# Apply fixes to CAUTION files too
./Optimize.ps1 -Phase 0 -Apply -Force

# Check status of all phases
./Optimize.ps1 -Phase Status

# Run next pending phase
./Optimize.ps1 -Phase Next
```

**Claude Code integration:**
- Read state.json to determine phase status
- Read phase{N}-reports/*.json to understand violations
- Invoke Optimize.ps1 as subprocess
- Parse returned exit code + reports
```

### **3. FINAL-CONSOLIDATED-DELIVERY.md** (Execution guide)

**Add new section: "Optimize.ps1 Orchestration"**

```
# Optimize.ps1 Orchestration (PowerShell v7+)

**Script location:** `$RepoPath/Optimize.ps1`
**State file:** `$RepoPath/.optimize/state.json`
**Reports location:** `$RepoPath/.optimize/reports/`

**Typical phase execution:**

1. **Pre-phase** (Claude Code or engineer):
   - Read state.json
   - Verify previous phase is PASSED
   - Commit any uncommitted changes (or use -Force)

2. **Run phase** (Optimize.ps1):
   ```powershell
   ./Optimize.ps1 -Phase 0 -Apply
   ```
   - Safety: checkpoint created
   - Discovery: inventory generated
   - Protection: files classified
   - Optimization: violations reported + SAFE files fixed
   - Validation: TypeScript, ESLint, tests, build
   - If PASS: phase marked PASSED
   - If FAIL: auto-rollback to checkpoint, phase marked ROLLED_BACK

3. **Post-phase** (Claude Code):
   - Read state.json (confirm PASSED or ROLLED_BACK)
   - If PASSED: proceed to next phase
   - If ROLLED_BACK: read phase{N}-validation.json, fix issues, re-run

**Failure scenario (automatic recovery):**
```
1. Engineer runs: ./Optimize.ps1 -Phase 2 -Apply
2. Optimization engine applies fixes
3. Validation fails (TypeScript compile error)
4. Script automatically runs: git reset --hard optimize-checkpoint-phase2-...
5. Phase status set to ROLLED_BACK
6. Engineer reads validation.json, fixes issue in code, re-runs phase
```

**No manual recovery needed — script is fail-safe.**
```

### **4. DOCUMENTATION-INDEX.md** (File navigation)

**Add new entries:**

```
## Optimize.ps1 Specification

If you want to understand:
- How the five engines work → ULTIMATE-CONSOLIDATED-PROMPT.md §2.1-2.10
- File classification (SAFE/CAUTION/PROTECTED) → ULTIMATE-CONSOLIDATED-PROMPT.md §2.4
- Backup + rollback → ULTIMATE-CONSOLIDATED-PROMPT.md §2.3
- Hard-coded value detection → ULTIMATE-CONSOLIDATED-PROMPT.md §2.5
- Reports + JSON schemas → ULTIMATE-CONSOLIDATED-PROMPT.md §2.10

If you want to:
- Run Optimize.ps1 → FINAL-CONSOLIDATED-DELIVERY.md "Optimize.ps1 Orchestration"
- Read state.json → DELIVERY-SUMMARY.md "PowerShell Script Integration"
- Interpret phase{N}-reports → ULTIMATE-CONSOLIDATED-PROMPT.md §2.10
- Recover from a rolled-back phase → FINAL-CONSOLIDATED-DELIVERY.md failure scenario
```

---

## 📋 CLAUDE CODE INTEGRATION CHECKLIST

**Before invoking Optimize.ps1 from Claude Code:**

### Pre-Phase Checks
- [ ] Read `.optimize/state.json`
- [ ] Verify previous phase is PASSED (or phase is 0)
- [ ] Verify git working tree is clean (or engineer uses -Force)
- [ ] Verify npm packages installed (node_modules exists)

### Phase Execution
- [ ] Invoke Optimize.ps1 with appropriate flags
  - Dry-run: `-Phase {N}` (no -Apply)
  - Apply: `-Phase {N} -Apply`
  - Force CAUTION: `-Phase {N} -Apply -Force`
- [ ] Capture stdout/stderr
- [ ] Capture exit code (0 = success, nonzero = failure)

### Post-Phase Analysis
- [ ] Read `.optimize/state.json` (confirm status)
- [ ] If PASSED: read phase{N}-discovery.json (understand what was found)
- [ ] If PASSED: read phase{N}-classification.json (see PROTECTED/CAUTION/SAFE breakdown)
- [ ] If FAILED/ROLLED_BACK: read phase{N}-validation.json (see why it failed)
- [ ] If PASSED: read phase{N}-optimization.json (see hard-coded violations that need manual fixing)

### Next Phase Decision
- [ ] If all reports OK: proceed to next phase (Optimize.ps1 -Phase Next)
- [ ] If violations: prioritize manual fixes before next phase
- [ ] If PROTECTED violations: require engineer review (script cannot auto-fix)

---

## 🔗 INTEGRATION SUMMARY

**Unique attributes from Optimize.ps1:**

| Attribute | Location in Script | Impact on Docs |
|---|---|---|
| Five-engine orchestration | Lines 1-8 (SYNOPSIS), §7 (ORCHESTRATION) | Add §2.1 to ULTIMATE |
| State management (state.json) | Lines 65-120 (STATE MANAGEMENT) | Add §2.2 to ULTIMATE |
| Safety checkpoint + backup | Lines 213-261 (SAFETY ENGINE) | Add §2.3 to ULTIMATE |
| File classification (SAFE/CAUTION/PROTECTED) | Lines 90-110 (CONSTANTS), §5 (PROTECTION) | Add §2.4 to ULTIMATE |
| Hard-coded value detection | Lines 295-310 (OPTIMIZATION ENGINE) | Add §2.5 to ULTIMATE |
| Path normalization (cross-platform) | Lines 123-156 (PATH HELPERS) | Add §2.6 to ULTIMATE |
| Excluded directories (8 total) | Line 88 (ExcludedDirNames) | Add §2.7 to ULTIMATE |
| Dry-run vs Apply mode | Lines 305-320 (OPTIMIZATION ENGINE) | Add §2.8 to ULTIMATE |
| Validation + rollback | Lines 322-360 (VALIDATION ENGINE) | Add §2.9 to ULTIMATE |
| Reports (discovery/classification/optimization/validation) | Lines throughout (each engine) | Add §2.10 to ULTIMATE |

**All attributes are unique and non-redundant with existing documentation.**

---

## ✅ NEXT STEPS

1. **Update ULTIMATE-CONSOLIDATED-PROMPT.md:**
   - Add §2.1-2.10 (ten new subsections)
   - Modify §1, §3, §5, §6 (integrate Optimize.ps1 context)

2. **Update DELIVERY-SUMMARY.md:**
   - Add "PowerShell Script Integration" section

3. **Update FINAL-CONSOLIDATED-DELIVERY.md:**
   - Add "Optimize.ps1 Orchestration" section
   - Add failure scenario example

4. **Update DOCUMENTATION-INDEX.md:**
   - Add "Optimize.ps1 Specification" navigation section

5. **Create new file (OPTIONAL):**
   - `OPTIMIZE-PS1-SCHEMA.md` — detailed JSON schemas for all four reports
   - For Claude Code engineers implementing report parsing

---

**Status:** ✅ Analysis complete. Ready for documentation updates.

**Recommendation:** Proceed with updating all four files per checklist above.
