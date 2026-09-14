#requires -Version 5.1
<#
=====================================================
 KITABU YETU - FIX PAGE.TSX TO USE CANONICAL TREE
=====================================================
Repoints app\page.tsx imports from the stale
'@/src/components/*' duplicate back to the canonical,
self-consistent '@/components/*' tree at the project root.

Root cause history:
  1. Original page.tsx used '@/components/marketing/nextly/*'
  2. We archived the legacy nextly folder
  3. We (incorrectly) repointed page.tsx at '@/src/components/*'
  4. A parallel session's diagnostic proved '@/components/*'
     (root) is the live, self-consistent tree, and
     'src/components' is a stale, unused duplicate.
This script corrects step 3.

USAGE:
  .\fix-page-canonical-tree.ps1            # asks to confirm
  .\fix-page-canonical-tree.ps1 -DryRun    # show diff only
#>

param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$TargetFile = ".\app\page.tsx"

function Write-Status {
    param([string]$Status, [string]$Message)
    $color = switch ($Status) {
        "OK"    { "Green" }
        "WARN"  { "Yellow" }
        "FAIL"  { "Red" }
        default { "White" }
    }
    Write-Host ("  {0,-8}{1}" -f $Status, $Message) -ForegroundColor $color
}

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " KITABU YETU - FIX PAGE.TSX TO USE CANONICAL TREE" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $TargetFile)) {
    Write-Status "FAIL" "Could not find $TargetFile. Run this from the project root."
    exit 1
}

$original = Get-Content $TargetFile -Raw
$replacement = $original -replace '@/src/components/', '@/components/'

if ($original -eq $replacement) {
    Write-Status "WARN" "No '@/src/components/*' imports found in $TargetFile. Nothing to change."
    exit 0
}

Write-Host "Affected lines:" -ForegroundColor Cyan
$oldLines = $original -split "`r?`n"
$newLines = $replacement -split "`r?`n"
for ($i = 0; $i -lt $oldLines.Count; $i++) {
    if ($oldLines[$i] -ne $newLines[$i]) {
        Write-Host ("  - {0}" -f $oldLines[$i]) -ForegroundColor Red
        Write-Host ("  + {0}" -f $newLines[$i]) -ForegroundColor Green
    }
}
Write-Host ""

if ($DryRun) {
    Write-Status "OK" "Dry run complete. No files were changed."
    exit 0
}

$confirm = Read-Host "Apply these changes to $TargetFile ? (y/N)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Status "FAIL" "Cancelled by user. No files were changed."
    exit 1
}

$backupPath = "$TargetFile.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $TargetFile $backupPath
Write-Status "OK" "Backed up original to $backupPath"

Set-Content -Path $TargetFile -Value $replacement -NoNewline
Write-Status "OK" "Updated $TargetFile to import from the canonical '@/components/*' tree."

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Status "OK" "DONE. Run 'npm run dev' to verify, then 'npm run build' and 'npm run lint'."
Write-Host "=====================================================" -ForegroundColor Cyan
