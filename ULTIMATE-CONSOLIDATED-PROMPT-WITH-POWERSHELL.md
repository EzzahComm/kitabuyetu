# 🚀 KITABU YETU — ULTIMATE CONSOLIDATED EXECUTION PROMPT (Updated for Optimize.ps1)

**Status:** ✅ PRODUCTION-READY | **Version:** FINAL CONSOLIDATED + POWERSHELL INTEGRATION | **Date:** September 14, 2026

---

## TABLE OF CONTENTS

1. **EXECUTIVE SUMMARY** — What, why, how
2. **CRITICAL SUCCESS FACTORS** — Failure prevention
3. **OPTIMIZE.PS1 FIVE-ENGINE ARCHITECTURE** ⭐ NEW
4. **PHASE 0 EXECUTION BLUEPRINT** — Start here
5. **CORE CONTEXT (LAYERS 1-3)** — All technical specs
6. **FAILURE POINT MITIGATION** — Risk matrix
7. **UI/UX OPTIMIZATION PLAYBOOK** — Component-by-component
8. **PHASE ROADMAP** — All 13 phases with gates
9. **QUALITY ASSURANCE CHECKLIST** — Exit gates
10. **CLAUDE CODE INTEGRATION** ⭐ NEW

---

# EXECUTIVE SUMMARY

## What

Kitabu Yetu is a multi-tenant SaaS fintech platform for Kenyan community organizations. Positioning: **"Build Vibrant Communities."**

**Orchestration:** Optimize.ps1 (v3.0.1) runs five engines per phase:

- **Discovery** → Inventory code (routes, components, services)
- **Safety** → Create checkpoint + backup before changes
- **Protection** → Classify files (SAFE/CAUTION/PROTECTED)
- **Optimization** → Find violations, apply safe fixes
- **Validation** → TypeScript, ESLint, tests, production build

If validation fails, automatic rollback (zero manual recovery).

---

# CRITICAL SUCCESS FACTORS (FAILURE PREVENTION)

1. **Content Preservation** ✅ Protected by Safety Engine (checkpoint)
2. **Mobile UX** ✅ R19–R23, tested xs/md/lg
3. **Design System** ✅ ESLint catches hard-coded values (Optimization Engine)
4. **Backward Compatibility** ✅ R24–R27 enforced
5. **Image Sourcing** ✅ Unsplash Week 1, Shutterstock Week 2
6. **Responsive Design** ✅ Validation tests at 3 breakpoints
7. **DPA Compliance** ✅ Legal gates before Phase 1
8. **Optimize.ps1 Execution** ✅ State gating prevents phase skips (NEW)

---

# OPTIMIZE.PS1 FIVE-ENGINE ARCHITECTURE ⭐

## 3.1 Overview

**Script:** `Optimize.ps1` (v3.0.1) — Autonomous main-repo optimization engine

**Each phase executes ALL five engines:**

```
Phase N Execution Flow:

1. Discovery Engine     → Inventory routes, components, hooks, services, migrations
                          Output: phase{N}-discovery.json

2. Safety Engine       → Create git checkpoint + filesystem backup + manifest snapshots
                          Output: checkpoint tag, backup zip, manifest dir

3. Protection Engine   → Classify all tracked files as SAFE/CAUTION/PROTECTED
                          Output: phase{N}-classification.json

4. Optimization Engine → Scan for hard-coded colors/spacing, apply safe fixes
                          Output: phase{N}-optimization.json
                          Fixes applied only if -Apply flag set (dry-run otherwise)

5. Validation Engine   → TypeScript check, ESLint, unit tests, build
                          Output: phase{N}-validation.json
                          If FAIL: automatic rollback to checkpoint tag

Result: Phase marked PASSED (safe to next) or ROLLED_BACK (engineer fixes, re-runs)
```

## 3.2 Discovery Engine

**What it does:**

- Scans repository for all TypeScript/JavaScript/route files
- Excludes: node_modules, .git, .next, dist, build, .optimize, .turbo, coverage
- Catalogs: routes (page.tsx), components, hooks, services, API routes, migrations
- Detects: UI libraries (shadcn, Flowbite, Tabler, @kitabu/ui)
- Detects: package manager (npm, pnpm, yarn)
- Detects: environment files (.env\*)

**Output:** `.optimize/reports/phase{N}-discovery.json`

```json
{
  "routes": ["/app/page.tsx", "/app/bookkeeper/page.tsx", ...],
  "components": ["/app/components/ui/Button.tsx", ...],
  "hooks": ["/app/hooks/useAuth.ts", ...],
  "services": ["/app/services/authService.ts", ...],
  "apiRoutes": ["/app/api/auth/route.ts", ...],
  "migrations": ["/supabase/migrations/001-init.sql", ...],
  "uiLibraries": {
    "shadcn": true,
    "flowbite": true,
    "tabler": true,
    "kitabuUi": true
  },
  "packageManager": "pnpm"
}
```

## 3.3 Safety Engine

**What it does:**

1. **Git checkpoint:** Creates annotated tag `optimize-checkpoint-phase{N}-{timestamp}`
2. **Filesystem backup:** Zips entire working tree (excludes excluded dirs) → `.optimize/backups/phase{N}-{timestamp}.zip`
3. **Manifest snapshots:** Copies critical files (package.json, tsconfig.json, tailwind.config.\*, .env.example, routes.txt) → `.optimize/backups/phase{N}-manifests/`

**Before proceeding:** Ensures git working tree is clean (or uses -Force)

**Why three layers:**

- Git tag: fast rollback if git is available
- Filesystem backup: recovery if git history corrupted
- Manifest snapshots: fast diffing before/after validation

**Rollback mechanism (automatic on validation failure):**

```
IF Validation Engine detects failure:
  1. git reset --hard <checkpoint-tag>
  2. git clean -fd (remove untracked files)
  3. Set phase status to ROLLED_BACK
  4. STOP (script exits, no recovery loop)

Result: Zero code changes if validation fails
```

## 3.4 Protection Engine

**What it does:**

- Classifies every discovered file as SAFE, CAUTION, or PROTECTED
- Determines which files are eligible for auto-modification

**Three classifications:**

```
PROTECTED (R1-R9.5 territory, NEVER auto-modified):
  *ledger*, *payment*, *daraja*, *mpesa*, *m-pesa*, *callback*
  */auth/*, *auth.*, *authoriz*, *rls*, *row-level-security*
  *policies.sql*, *migrations*, *tenant*, *billing*, *reconcil*, *idempot*

  Example: /app/api/ledger/route.ts → PROTECTED
  Script: Reported, never touched (even with -Apply -Force)

CAUTION (risky, auto-modified ONLY if -Apply -Force):
  *hooks*, *api*client*, *route.ts, *route.tsx*, *middleware*
  *auth-ui*, *config*, *env*, .env files

  Example: /app/middleware.ts → CAUTION
  Script: Reported only (dry-run), or modified if -Apply -Force

SAFE (always auto-safe):
  */components/ui/*, *presentation*, *styles*, *.css, *.scss
  */layouts*, */navigation*, */app/(public)*, */app/(marketing)*
  *public-site*, *flowbite*, *shadcn*, *kitabu-ui*, *@kitabu/ui*

  Example: /app/components/ui/Button.tsx → SAFE
  Script: Always eligible for auto-fix (if -Apply set)
```

**Output:** `.optimize/reports/phase{N}-classification.json`

```json
{
  "SAFE": ["/app/components/ui/Button.tsx", "/app/layouts/RootLayout.tsx"],
  "CAUTION": ["/app/middleware.ts", "/app/api/auth/route.ts"],
  "PROTECTED": ["/app/api/ledger/route.ts", "/supabase/migrations/001-init.sql"]
}
```

## 3.5 Optimization Engine

**What it does:**

1. Scans SAFE + (CAUTION if -Force) files for hard-coded violations
2. Detects: hard-coded colors (#EF4444, rgb(...), rgba(...))
3. Detects: hard-coded spacing (style={{ padding: 16px }})
4. Reports: file, line number, match text, violation type
5. (If -Apply) Runs: eslint --fix, prettier --write (on SAFE files)
6. (Manual) Engineer: maps violations to @kitabu/ui tokens

**Hard-coded color detection:**

```
Regex: #(?:[0-9a-fA-F]{3}){1,2}\b|rgb\(|rgba\(
Matches: #EF4444, #fff, rgb(100, 50, 200), rgba(...)
```

**Hard-coded spacing detection:**

```
Regex: \bstyle=\{\{[^}]*(margin|padding)[^}]*:\s*[0-9]+px
Matches: style={{ margin: 16px }}, style={{ padding: 24px }}
```

**Why not auto-rewrite colors/spacing:**

- Multiple formats (#hex, rgb, hsl) → semantic ambiguity
- Impossible to safely map px values to Tailwind scale without engineer input
- Script reports; engineer maps to token

**Output:** `.optimize/reports/phase{N}-optimization.json`

```json
[
  {
    "file": "/app/components/Card.tsx",
    "line": 15,
    "type": "hard-coded-color",
    "text": "color: #EF4444;"
  },
  {
    "file": "/app/components/Button.tsx",
    "line": 23,
    "type": "hard-coded-spacing",
    "text": "style={{ padding: 16px }}"
  }
]
```

**Auto-fixes applied (if -Apply):**

- `npx eslint --fix` (formatting, unused vars, import organization)
- `npx prettier --write` (code formatting)
- Token substitution (only hardcoded colors → variables, manual semantic review)

## 3.6 Validation Engine

**What it does:**

1. Runs TypeScript compiler (tsc --noEmit)
2. Runs ESLint (npx eslint . --ext .ts,.tsx,.js,.jsx)
3. Runs unit/integration tests (npm test --ci)
4. Phase 0 specific: checks page.tsx count >= 15
5. Runs production build (npm run build)

**All must PASS for phase to exit PASSED**

**Output:** `.optimize/reports/phase{N}-validation.json`

```json
{
  "TypeScript (tsc --noEmit)": {
    "passed": true,
    "output": "Successfully compiled all TypeScript..."
  },
  "ESLint": {
    "passed": true,
    "output": "0 errors, 0 warnings..."
  },
  "Unit/Integration tests": {
    "passed": true,
    "output": "All tests passed: 145 tests, 0 failures..."
  },
  "Production build": {
    "passed": true,
    "output": "Build complete: 145.2 KB (gzipped)..."
  }
}
```

## 3.7 State Management & Phase Gating

**State file:** `.optimize/state.json`

**Structure:**

```json
{
  "engineVersion": "3.0.1",
  "phases": {
    "0": {
      "status": "PASSED",
      "detail": "Checkpoint: optimize-checkpoint-phase0-20260914-140000",
      "updatedAt": "2026-09-14T14:00:00Z"
    },
    "1": { "status": "PENDING", "detail": "", "updatedAt": "..." },
    "2": { "status": "PENDING", "detail": "", "updatedAt": "..." }
  },
  "createdAt": "2026-09-14T12:00:00Z"
}
```

**Phase statuses:**

- `PENDING` — not yet run
- `RUNNING` — currently executing
- `PASSED` — validation passed, safe to proceed to next phase
- `FAILED` — validation failed (phase was rolled back)
- `ROLLED_BACK` — rolled back after failure

**Core rule enforced mechanically:**

```
Assert-PreviousPhasePassed:
  IF current phase is NOT "0"
    THEN check previous phase status
    IF previous phase status != "PASSED"
      THEN throw error "GATE BLOCKED"
      EXPLAIN: "DO NOT START A PHASE BEFORE PREVIOUS PHASE EXITS IN PRODUCTION"
```

**Never manually edit state.json** — it's the contract between Optimize.ps1 and orchestration layer (Claude Code or CI/CD)

## 3.8 Excluded Directories (Build artifacts, never scanned)

**8 directories never scanned, backed up, or classified:**

```
node_modules    — npm dependencies (too large, auto-generated)
.git            — git internal (managed by checkpoint mechanism)
.next           — Next.js build cache (regenerated on npm run build)
dist            — legacy build output (not used)
build           — legacy build output (not used)
.optimize       — this script's own backups/reports/state (prevent meta-recursion)
.turbo          — Turbo cache (auto-generated)
coverage        — test coverage reports (auto-generated)
```

**Impact:**

- Backup size: 10–50 MB (source only), not 500+ MB (with node_modules)
- Scan time: ~30 seconds (depends on repo size), not 5+ minutes
- No build artifacts in classification reports
- No duplicate file entries in discovery

## 3.9 Cross-Platform Path Normalization

**Problem:** Windows PowerShell gives backslash paths; Linux/Mac PowerShell gives forward slashes

**Solution implemented:**

```powershell
function ConvertTo-NormalizedRelativePath {
  # Input: full path (any separator, any OS)
  # Output: "/app/components/Button.tsx" (always forward-slash, leading /)

  # Converts: "C:\repo\app\components\Button.tsx" → "/app/components/Button.tsx"
  # Converts: "/home/user/repo/app/components/Button.tsx" → "/app/components/Button.tsx"
}
```

**Why both functions:**

- `ConvertTo-NormalizedRelativePath` — converts full path to normalized relative
- `Test-ExcludedPath` — checks if any segment is in excluded dirs list

**All classification patterns use forward slashes:**

```
PROTECTED: '*ledger*', '*payment*', '*/auth/*'  # forward slashes only
CAUTION:   '*hooks*', '*api*client*', '*route.ts'
SAFE:      '*/components/ui/*', '*presentation*'
```

**Result:** Patterns work the same on Windows and non-Windows PowerShell

## 3.10 Dry-Run vs Apply Mode

**Mode 1: Dry-Run (no -Apply flag)**

All five engines run, zero code changes:

```
Discovery     ✓ Inventory created
Safety        ✓ Checkpoint + backup created
Protection    ✓ Files classified
Optimization  ✓ Violations REPORTED (no fixes written)
Validation    ✓ Full build/test run (original code)

Result: Full audit + reports + checkpoint, zero code changes
        Engineer reviews reports, decides next step
```

**Invocation:**

```powershell
./Optimize.ps1 -Phase 0
# Dry-run: reports on violations, doesn't fix them
```

**Mode 2: Apply Mode (-Apply flag)**

All five engines run, safe fixes applied:

```
Discovery     ✓ Inventory created
Safety        ✓ Checkpoint + backup created
Protection    ✓ Files classified
Optimization  ✓ Violations reported + fixes APPLIED to SAFE files
              → eslint --fix, prettier, token substitution
Validation    ✓ Full build/test run (fixed code)

If Validation PASSES:    Phase marked PASSED
If Validation FAILS:     Automatic rollback, phase marked ROLLED_BACK
```

**Invocation:**

```powershell
./Optimize.ps1 -Phase 0 -Apply
# Apply fixes to SAFE files only, validate, rollback if needed
```

**Mode 3: Force CAUTION (-Apply -Force flags)**

Enables auto-fix on CAUTION files too (risky):

```
Default: Only SAFE files are auto-fixed
-Force:  SAFE + CAUTION files are auto-fixed (with -Apply)
NEVER:   PROTECTED files are auto-fixed (no flag combo changes this)
```

**Invocation:**

```powershell
./Optimize.ps1 -Phase 0 -Apply -Force
# WARNING: This enables auto-fix on auth/config/middleware code
# Use only if you trust the fixes (they should pass validation anyway)
```

---

# PHASE 0 EXECUTION BLUEPRINT (START HERE)

## Week 1: Preparation & Content Audit

### Day 1–2: Content Preservation + Optimize.ps1 Setup

```
TASK: Backup existing marketing content + initialize Optimize.ps1
- [ ] Export all 15 current pages (screenshot + HTML)
- [ ] Create markdown version of all copy
- [ ] Create GitHub backup branch: pre-phase-0-backup
- [ ] Clone/download Optimize.ps1 to repo root
- [ ] Verify PowerShell 7+ installed (pwsh --version)
- [ ] Test git: git status (must be clean or use -Force)
OWNER: Content lead + DevOps
TIME: 4 hours
GATE: Backup verified, Optimize.ps1 ready, git clean
```

### Day 3–5: Design System Setup

```
TASK: Create shared design system foundation
- [ ] Create @kitabu/ui package (monorepo structure)
- [ ] Extract Tailwind tokens (colors, spacing, type, shadows)
- [ ] Set up Figma design system file (Flowbite as base)
OWNER: Design lead
TIME: 8 hours
GATE: @kitabu/ui compiles, tokens match Figma
```

### Day 5–7: Image Sourcing + Optimize.ps1 Dry-Run

```
TASK: Source Phase 0 images + validate repo structure
- [ ] Search Unsplash (queries: "African VSLA", "women savings")
- [ ] Download 50–100 free images
- [ ] Request Shutterstock quote
- [ ] Create image inventory spreadsheet
- [ ] Run: ./Optimize.ps1 -Phase 0
          (dry-run: discovery, safety checkpoint, classification, reports)
- [ ] Review phase0-discovery.json (routes, components, services)
- [ ] Review phase0-classification.json (file safety levels)
OWNER: Design lead + tech lead
TIME: 6 hours
GATE: 50+ free images, Optimize.ps1 reports generated, state.json shows PENDING
```

## Weeks 2–4: Design System Build + Optimize.ps1 Apply

### Days 8–14: Token Extraction & Component Library

```
TASK: Build primitive component library
- [ ] Extract all tokens to Tailwind config
- [ ] Build primitive components (Button, Input, Card, Modal, Table, Alert)
- [ ] Run: ./Optimize.ps1 -Phase 0 -Apply
          (applies eslint --fix, prettier, reports hard-coded violations)
- [ ] Review phase0-optimization.json (hard-coded colors/spacing)
- [ ] Manually map violations to @kitabu/ui tokens
OWNER: Design + frontend lead
TIME: 20 hours
GATE: All primitives built, phase0-optimization.json reviewed, violations mapped
```

### Days 15–21: Public Site Integration

```
TASK: Integrate Flowbite, build public pages
- [ ] Set up Flowbite in Next.js
- [ ] Import tokens from @kitabu/ui (no local overrides)
- [ ] Build home page + product pages + secondary pages + legal pages
- [ ] Run: ./Optimize.ps1 -Phase 0 -Apply
          (validates all changes)
- [ ] Check state.json: phase 0 status (PASSED or ROLLED_BACK?)
- [ ] If ROLLED_BACK: read phase0-validation.json, fix issues, re-run
OWNER: Frontend lead + content
TIME: 30 hours
GATE: All 15 pages render, state shows "0": "PASSED"
```

### Days 22–28: Image Optimization & Exit Gates

```
TASK: Optimize images, verify exit gates
- [ ] Resize, compress, optimize all images (<150KB)
- [ ] Write alt text (WCAG 2.1 AA, ≥10 words)
- [ ] Upload to Supabase Storage
- [ ] Integrate lazy loading
- [ ] Run: ./Optimize.ps1 -Phase 0 (final dry-run validation)
- [ ] Verify 40+ QA gates (see section 9)
- [ ] Content owner sign-off (word-count audit)
OWNER: Design + QA
TIME: 12 hours
GATE: All images <150KB, alt text verified, all 40+ gates passed, state.json shows PASSED
```

---

# CORE CONTEXT (LAYERS 1-3)

[Sections 1-3 from previous version, unchanged — see ULTIMATE-CONSOLIDATED-PROMPT.md §1-3]

---

# FAILURE POINT MITIGATION MATRIX

[Section 5 from previous version, updated]

| Risk                     | Failure Mode                         | Prevention                                             | Owner    | Verification                       |
| ------------------------ | ------------------------------------ | ------------------------------------------------------ | -------- | ---------------------------------- |
| **Content Loss**         | Marketing copy deleted               | Week 1 backup, markdown export, GitHub branch          | Content  | Word-count audit                   |
| **Phase Skip**           | Phase N started before N-1 passed    | Optimize.ps1 state gating (Assert-PreviousPhasePassed) | Ops      | state.json verified                |
| **Checkpoint Failure**   | Git dirty tree, backup fails         | -Force flag or clean working tree first                | Engineer | Safety Engine logs                 |
| **Validation Failure**   | Build fails but code not rolled back | Automatic rollback (Optimize.ps1)                      | Script   | phase{N}-validation.json checked   |
| **Rollback Failure**     | Cannot restore to checkpoint         | 3-layer backup (git + zip + manifests)                 | Script   | Filesystem backup verified         |
| **Mobile UX Broken**     | 320px device unusable                | R19–R23 rules, test xs/md/lg                           | Frontend | Screenshot comparison              |
| **Design Fragmentation** | Button styles inconsistent           | @kitabu/ui single source, ESLint enforces              | Design   | phase{N}-optimization.json checked |
| **Image Delays**         | Phase 0 blocked                      | Unsplash search Week 1, Shutterstock Week 2            | Design   | Sourcing spreadsheet               |
| **DPA Non-Compliance**   | Daraja blocked, fines                | Legal review mandatory                                 | Legal    | Sign-off document                  |

---

# UI/UX OPTIMIZATION PLAYBOOK

[Section 7 from previous version, updated]

Every component tested against R19–R23 + hard-coded value checks:

**Before commit:**

1. Designer: verify responsive (xs/md/lg)
2. Run: ./Optimize.ps1 -Phase {N} (dry-run: check for hard-coded violations)
3. Review: phase{N}-optimization.json
4. Manual: map violations to @kitabu/ui tokens
5. ESLint: npx eslint . --fix (if needed)
6. Final: commit + push

---

# PHASE ROADMAP

[Section 8 from previous version, with Optimize.ps1 context]

**Core rule:** DO NOT START A PHASE BEFORE PREVIOUS PHASE EXITS IN PRODUCTION.

Optimize.ps1 enforces this mechanically via Assert-PreviousPhasePassed.

---

# QUALITY ASSURANCE CHECKLIST

[Section 9 from previous version, updated to reference Optimize.ps1 reports]

### Phase 0 Exit Gates (MANDATORY)

Before Phase 1 starts, verify ALL of these:

```
OPTIMIZE.PS1 STATE:
- [ ] state.json shows phase "0": "PASSED" (not PENDING, FAILED, or ROLLED_BACK)
- [ ] Checkpoint tag exists (git tag -l | grep optimize-checkpoint-phase0)
- [ ] Backup zip exists (.optimize/backups/phase0-*.zip)
- [ ] All four reports exist (discovery, classification, optimization, validation)

DISCOVERY REPORT (phase0-discovery.json):
- [ ] routes.count >= 15 (Phase 0 requires ≥15 pages)
- [ ] components.count > 50 (at least 50 UI components)
- [ ] uiLibraries show shadcn=true, flowbite=true, tabler=true

CLASSIFICATION REPORT (phase0-classification.json):
- [ ] SAFE files include all components/ui, layouts, presentation
- [ ] CAUTION files include middleware, config, env
- [ ] PROTECTED files count = 0 for Phase 0 (no ledger/payment code yet)

OPTIMIZATION REPORT (phase0-optimization.json):
- [ ] All hard-coded colors identified and documented
- [ ] All hard-coded spacing identified and documented
- [ ] Engineer has manually mapped violations to @kitabu/ui tokens

VALIDATION REPORT (phase0-validation.json):
- [ ] TypeScript (tsc --noEmit) = PASSED
- [ ] ESLint = PASSED
- [ ] Unit/integration tests = PASSED
- [ ] Production build = PASSED

CONTENT:
- [ ] All 15 pages live (audit against discovery.routes)
- [ ] All copy unchanged (word-for-word audit against backup)
- [ ] All links working (no 404s)

DESIGN SYSTEM:
- [ ] @kitabu/ui package exists and exports all tokens
- [ ] All pages use shared tokens (zero hard-coded values in code)
- [ ] ESLint + pre-commit active (new hard-coded values prevented)

RESPONSIVE DESIGN:
- [ ] All pages tested at xs (320px), md (768px), lg (1024px)
- [ ] Lighthouse ≥90 (mobile + desktop)
- [ ] No horizontal scroll at 320px

LEGAL:
- [ ] Privacy page legally reviewed (DPA 2019)
- [ ] Terms page legally reviewed

All gates MUST be signed off before Phase 1 starts.
```

---

# CLAUDE CODE INTEGRATION ⭐

## 10.1 Pre-Phase Setup (Claude Code / Engineer)

**Before invoking Optimize.ps1:**

```javascript
// Read current state
const fs = require("fs");
const state = JSON.parse(fs.readFileSync(".optimize/state.json", "utf8"));

// Check previous phase passed (or phase 0)
const currentPhase = 0; // or whatever phase you're running
if (currentPhase > 0) {
  const prevPhase = (currentPhase - 1).toString();
  if (!state.phases[prevPhase] || state.phases[prevPhase].status !== "PASSED") {
    console.error(
      `GATE BLOCKED: Phase ${prevPhase} is ${state.phases[prevPhase]?.status || "PENDING"}`,
    );
    process.exit(1);
  }
}

// Verify git working tree is clean
const { execSync } = require("child_process");
const gitStatus = execSync("git status --porcelain").toString();
if (gitStatus.trim()) {
  console.warn(
    "Working tree is dirty. Commit changes before running Optimize.ps1.",
  );
  console.warn("Or run with -Force flag to auto-commit WIP.");
  // Either commit or pass -Force to Optimize.ps1
}

// Verify npm packages installed
if (!fs.existsSync("node_modules")) {
  console.error("node_modules not found. Run npm install first.");
  process.exit(1);
}
```

## 10.2 Invoke Optimize.ps1 (Three modes)

**Mode 1: Dry-run (audit only, no changes)**

```javascript
// Run full audit, generate reports, create checkpoint, zero code changes
const { spawn } = require("child_process");
const ps1 = spawn("pwsh", ["-Command", "./Optimize.ps1 -Phase 0"]);
ps1.on("exit", (code) => {
  if (code === 0) {
    console.log("Phase 0 audit complete. Review phase0-*.json reports.");
  } else {
    console.error("Phase 0 audit failed.");
    process.exit(code);
  }
});
```

**Mode 2: Apply (audit + fixes + validate)**

```javascript
// Discover → Safety → Protection → Optimization (apply fixes) → Validation
const ps1 = spawn("pwsh", ["-Command", "./Optimize.ps1 -Phase 0 -Apply"]);
ps1.on("exit", (code) => {
  if (code === 0) {
    console.log("Phase 0 passed validation. Proceeding to phase 1.");
  } else {
    console.warn("Phase 0 failed validation. Rolled back automatically.");
    // Read phase0-validation.json to see why
  }
});
```

**Mode 3: Force CAUTION files (-Apply -Force)**

```javascript
// Apply fixes to SAFE + CAUTION files (auth/config/middleware code)
const ps1 = spawn("pwsh", [
  "-Command",
  "./Optimize.ps1 -Phase 0 -Apply -Force",
]);
ps1.on("exit", (code) => {
  if (code === 0) {
    console.log("Phase 0 passed (CAUTION files modified).");
  } else {
    console.warn("Phase 0 failed. Rolled back automatically.");
  }
});
```

## 10.3 Post-Phase Analysis (Claude Code / Engineer)

```javascript
// Read state to determine phase result
const state = JSON.parse(fs.readFileSync(".optimize/state.json", "utf8"));
const phase0Status = state.phases["0"].status;

if (phase0Status === "PASSED") {
  console.log("✅ Phase 0 PASSED. Safe to proceed to Phase 1.");

  // Read discovery to understand what was found
  const discovery = JSON.parse(
    fs.readFileSync(".optimize/reports/phase0-discovery.json", "utf8"),
  );
  console.log(
    `Routes: ${discovery.routes.length}, Components: ${discovery.components.length}`,
  );

  // Read classification to verify no PROTECTED files in Phase 0
  const classified = JSON.parse(
    fs.readFileSync(".optimize/reports/phase0-classification.json", "utf8"),
  );
  console.log(
    `PROTECTED files: ${classified.PROTECTED.length} (expected 0 for Phase 0)`,
  );

  // Read optimization to see hard-coded violations (manual fix needed)
  const violations = JSON.parse(
    fs.readFileSync(".optimize/reports/phase0-optimization.json", "utf8"),
  );
  violations.forEach((v) => console.log(`${v.file}:${v.line} - ${v.type}`));
} else if (phase0Status === "ROLLED_BACK") {
  console.log("❌ Phase 0 failed and was rolled back.");

  // Read validation to see why it failed
  const validation = JSON.parse(
    fs.readFileSync(".optimize/reports/phase0-validation.json", "utf8"),
  );
  Object.entries(validation).forEach(([check, result]) => {
    if (!result.passed) {
      console.error(`FAILED: ${check}`);
      console.error(result.output.slice(0, 500)); // first 500 chars
    }
  });

  console.log(
    "Fix the issues above, then re-run: ./Optimize.ps1 -Phase 0 -Apply",
  );
} else {
  console.warn(
    `Phase 0 status: ${phase0Status} (expected PASSED or ROLLED_BACK)`,
  );
}
```

## 10.4 Next Phase Decision

```javascript
// Determine which phase to run next
function getNextPhase() {
  const state = JSON.parse(fs.readFileSync(".optimize/state.json", "utf8"));

  for (let i = 0; i <= 12; i++) {
    const phaseId = i.toString();
    const phaseStatus = state.phases[phaseId]?.status || "PENDING";
    if (phaseStatus !== "PASSED") {
      return phaseId; // first non-PASSED phase
    }
  }
  return null; // all phases PASSED
}

// Or just invoke Optimize.ps1 with -Phase Next
const ps1 = spawn("pwsh", ["-Command", "./Optimize.ps1 -Phase Next"]);
```

## 10.5 Example: Full CI/CD workflow

```yaml
# Example GitHub Actions or similar CI/CD

name: Kitabu Yetu Phase Progression

on: workflow_dispatch

jobs:
  run-phase:
    runs-on: windows-latest # or ubuntu-latest (PowerShell 7 cross-platform)
    steps:
      - uses: actions/checkout@v3

      - name: Set up PowerShell 7+
        run: |
          $PSVersionTable.PSVersion

      - name: Set up Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Install dependencies
        run: npm install

      - name: Check phase status
        run: ./Optimize.ps1 -Phase Status

      - name: Run next phase (dry-run first)
        run: ./Optimize.ps1 -Phase Next
        # Reads state.json, finds next PENDING phase, runs dry-run

      - name: Review reports
        if: success()
        run: |
          Write-Output "Discovery:"
          Get-Content .optimize/reports/phase*-discovery.json | ConvertFrom-Json
          Write-Output "Violations:"
          Get-Content .optimize/reports/phase*-optimization.json | ConvertFrom-Json

      - name: Apply fixes (if approved)
        if: success()
        run: ./Optimize.ps1 -Phase Next -Apply
        # If dry-run passed, apply fixes, validate, auto-rollback if needed

      - name: Check final state
        run: ./Optimize.ps1 -Phase Status
        # Print all phase statuses
```

---

## FINAL SUMMARY

**Optimize.ps1 (v3.0.1) is production-ready and integrates seamlessly with:**

- ✅ Five-engine architecture (discovery → safety → protection → optimization → validation)
- ✅ Automatic phase gating (previous phase must be PASSED)
- ✅ Automatic rollback (zero manual recovery on validation failure)
- ✅ File classification (SAFE/CAUTION/PROTECTED prevents risky auto-modifications)
- ✅ Hard-coded value detection (design-system governance)
- ✅ State management (state.json as contract)
- ✅ Reports (JSON schemas for all four report types)
- ✅ Claude Code integration (read state, invoke script, parse reports)

**Status:** ✅ READY FOR EXECUTION

---

_Document prepared: September 14, 2026_
_Consolidated + PowerShell Optimize.ps1 Integration_
_Ready for production execution — minimal failure points, optimized outcomes_
