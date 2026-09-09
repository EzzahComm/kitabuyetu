# OPTIMIZATION-COMMAND-V1
#
# Scope: dependency-version fixes only (Finding #1 and #2 in OPTIMIZATION-PLAN.md).
# Everything else in the plan needs source-tree/DB access this evidence bundle
# doesn't have, and is intentionally NOT included here.
#
# What this does:
#   1. Confirms npm/package.json are present.
#   2. Records the exact `npm audit` state before touching anything (on top of
#      Optimize.ps1's own git checkpoint + tracked-file backup).
#   3. Runs `npm audit fix` WITHOUT --force, so npm will only apply fixes that
#      do not require a semver-major bump. `sharp` and `csv-parse` (both
#      flagged isSemVerMajor: true in the evidence) are deliberately left
#      untouched — see Finding #3 in the plan for why.
#   4. Records the `npm audit` state after, so the before/after is provable
#      rather than asserted.
#
# Nothing here modifies application source code, .env files, secrets,
# certificates, or SSH keys.

$ErrorActionPreference = "Stop"

$ProjectRoot = (Get-Location).Path
$LogDir = Join-Path $ProjectRoot ".optimization\command-run-logs"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

Write-Host "Applying approved optimization changes (dependency fixes only)..." -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $ProjectRoot "package.json"))) {
    Write-Host "package.json not found at $ProjectRoot — aborting." -ForegroundColor Red
    exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "npm is not available on PATH — aborting." -ForegroundColor Red
    exit 1
}

Write-Host "Recording pre-fix npm audit state..." -ForegroundColor Green
npm audit --json 2>&1 | Out-File -LiteralPath (Join-Path $LogDir "npm-audit-before.json") -Encoding UTF8

Write-Host "Running npm audit fix (no --force; major-version bumps like sharp/csv-parse are skipped by design)..." -ForegroundColor Green
npm audit fix 2>&1 | Tee-Object -FilePath (Join-Path $LogDir "npm-audit-fix-output.txt")
$fixExitCode = $LASTEXITCODE

Write-Host "Recording post-fix npm audit state..." -ForegroundColor Green
npm audit --json 2>&1 | Out-File -LiteralPath (Join-Path $LogDir "npm-audit-after.json") -Encoding UTF8

if ($fixExitCode -ne 0) {
    Write-Host "npm audit fix exited with code $fixExitCode — review $LogDir before proceeding." -ForegroundColor Yellow
}
else {
    Write-Host "npm audit fix completed." -ForegroundColor Green
}

Write-Host ""
Write-Host "Before/after audit snapshots saved to:" -ForegroundColor Cyan
Write-Host "  $LogDir\npm-audit-before.json"
Write-Host "  $LogDir\npm-audit-after.json"
Write-Host ""
Write-Host "Remaining known findings NOT touched by this command file (see OPTIMIZATION-PLAN.md):" -ForegroundColor Yellow
Write-Host "  - sharp (0.34.5 -> 0.35.4, major bump)"
Write-Host "  - csv-parse (major bump)"
Write-Host "  - ESLint errors/warnings (52/38) including next.config.js no-require-imports"
Write-Host "  - CSV loan importer defects (HARDENING_AUDIT_2026-08-16)"
Write-Host "  - RLS policy drift on 4 tables (DB_PERFORMANCE_ADVISOR_AUDIT_2026-08)"
Write-Host "  - SMS opt-out UI, reconciliation alert routing, unwired endpoints (SMS-REAUDIT-2026-09-02)"
Write-Host ""
Write-Host "Optimization command completed." -ForegroundColor Green
