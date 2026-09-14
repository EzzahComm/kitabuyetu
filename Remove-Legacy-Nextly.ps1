#requires -Version 5.1

[CmdletBinding()]
param(
    [ValidateSet("Plan","Apply")]
    [string]$Mode = "Plan"
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " KITABU YETU - LEGACY NEXTLY CHECK" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

$requiredComponents = @(
    ".\src\components\Hero.tsx",
    ".\src\components\Container.tsx",
    ".\src\components\SectionTitle.tsx",
    ".\src\components\Benefits.tsx",
    ".\src\components\ProductGrid.tsx",
    ".\src\components\Testimonials.tsx",
    ".\src\components\Cta.tsx"
)

Write-Host ""
Write-Host "Checking Kitabu Yetu components..." -ForegroundColor Yellow

$missing = @()

foreach ($file in $requiredComponents) {
    if (Test-Path $file) {
        Write-Host "  OK      $file" -ForegroundColor Green
    }
    else {
        Write-Host "  MISSING $file" -ForegroundColor Red
        $missing += $file
    }
}

if ($missing.Count -gt 0) {
    throw "Required Kitabu Yetu components are missing."
}

Write-Host ""
Write-Host "All required components exist." -ForegroundColor Green

$legacyNextly = ".\components\marketing\nextly"

Write-Host ""
Write-Host "Checking legacy Nextly directory..." -ForegroundColor Yellow

if (Test-Path $legacyNextly) {
    Write-Host "  FOUND: $legacyNextly" -ForegroundColor Yellow
}
else {
    Write-Host "  Legacy Nextly directory does not exist." -ForegroundColor Green
}

Write-Host ""
Write-Host "Mode: $Mode" -ForegroundColor Cyan

if ($Mode -eq "Plan") {
    Write-Host ""
    Write-Host "PLAN COMPLETE - NO FILES WERE CHANGED." -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "APPLY mode requested." -ForegroundColor Yellow
Write-Host "No files will be deleted by this test script." -ForegroundColor Yellow
