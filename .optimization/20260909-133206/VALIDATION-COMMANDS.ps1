# VALIDATION-COMMANDS-V1
#
# Run this after OPTIMIZATION-COMMAND.ps1 has been applied, to confirm the
# project is still healthy and to measure (not assume) the effect of the
# dependency fixes.
#
# Usage:
#   .\VALIDATION-COMMANDS.ps1
#
# This script does not modify anything — it only runs checks and reports.

$ErrorActionPreference = "Continue"
$ProjectRoot = (Get-Location).Path
$LogDir = Join-Path $ProjectRoot ".optimization\validation-run-logs"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

function Run-Check {
    param(
        [string]$Name,
        [string]$Command,
        [string[]]$Arguments,
        [string]$LogFile
    )
    Write-Host ""
    Write-Host "=== $Name ===" -ForegroundColor Cyan
    $logPath = Join-Path $LogDir $LogFile
    & $Command @Arguments 2>&1 | Tee-Object -FilePath $logPath
    $code = $LASTEXITCODE
    if ($code -eq 0) {
        Write-Host "[PASS] $Name (exit $code)" -ForegroundColor Green
    }
    else {
        Write-Host "[FAIL] $Name (exit $code) — see $logPath" -ForegroundColor Red
    }
    return $code
}

$results = [ordered]@{}

if (Test-Path (Join-Path $ProjectRoot "tsconfig.json")) {
    $results.TypeScript = Run-Check -Name "TypeScript (tsc --noEmit)" -Command "npx" -Arguments @("tsc","--noEmit") -LogFile "typescript.txt"
}

$results.Lint = Run-Check -Name "ESLint" -Command "npm" -Arguments @("run","lint") -LogFile "lint.txt"

$results.Build = Run-Check -Name "Production build" -Command "npm" -Arguments @("run","build") -LogFile "build.txt"

$results.Audit = Run-Check -Name "npm audit" -Command "npm" -Arguments @("audit","--json") -LogFile "npm-audit.json"

if (Test-Path (Join-Path $ProjectRoot "package.json")) {
    $pkg = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
    if ($pkg.scripts.PSObject.Properties.Name -contains "test") {
        $results.Test = Run-Check -Name "Test suite" -Command "npm" -Arguments @("test") -LogFile "test.txt"
    }
    else {
        Write-Host ""
        Write-Host "No 'test' script found in package.json — skipping test suite run." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "=== SUMMARY ===" -ForegroundColor Cyan
foreach ($key in $results.Keys) {
    $status = if ($results[$key] -eq 0) { "PASS" } else { "FAIL (exit $($results[$key]))" }
    Write-Host ("  {0,-12} {1}" -f $key, $status)
}

Write-Host ""
Write-Host "Full logs: $LogDir" -ForegroundColor Cyan
Write-Host ""
Write-Host "Reminder: compare $LogDir\npm-audit.json against the pre-fix snapshot" -ForegroundColor Yellow
Write-Host "in .optimization\command-run-logs\npm-audit-before.json to confirm what" -ForegroundColor Yellow
Write-Host "actually changed — don't assume the fix worked without this comparison." -ForegroundColor Yellow
