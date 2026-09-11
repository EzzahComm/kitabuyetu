#requires -Version 5.1
<#
=====================================================
 KITABU YETU - FIX RELATIVE PUBLIC/ IMPORT DEPTH
=====================================================
Root cause: these files were written for the template's
src\components\*.tsx location (2 levels deep from project
root), using "../../public/...". Your destination's
components\*.tsx is flat (1 level deep), so the correct
path is "../public/...". Since the byte-identical copy was
promoted to canonical, the bug came with it.

Scoped ONLY to the known flat marketing files directly
under components\ (not components\dashboard\, admin\, etc.,
which sit at different depths and may legitimately need
"../../public/...").

USAGE:
  .\fix-public-image-depth.ps1            # asks to confirm
  .\fix-public-image-depth.ps1 -DryRun    # show findings only
#>

param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# Flat files directly under components\ -- one level deep from project root.
$FlatMarketingFiles = @(
    "Hero.tsx", "Navbar.tsx", "Footer.tsx", "Cta.tsx", "Faq.tsx",
    "Pricing.tsx", "Testimonials.tsx", "Video.tsx", "SectionTitle.tsx",
    "Benefits.tsx", "Container.tsx", "BrandLogo.tsx", "navigation.ts",
    "data.js", "ProductGrid.tsx"
)

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
Write-Host " KITABU YETU - FIX RELATIVE PUBLIC/ IMPORT DEPTH" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

$toFix = @()

foreach ($name in $FlatMarketingFiles) {
    $path = Join-Path ".\components" $name
    if (-not (Test-Path $path)) { continue }

    $content = Get-Content $path -Raw
    if ($content -match '\.\./\.\./public/') {
        $matchLines = ($content -split "`r?`n") | Select-String -Pattern '\.\./\.\./public/'
        $toFix += [PSCustomObject]@{ Path = $path; Content = $content; Lines = $matchLines }
    }
}

if ($toFix.Count -eq 0) {
    Write-Status "OK" "No '../../public/' references found in flat marketing components. Nothing to fix."
    exit 0
}

Write-Host "Files needing correction:" -ForegroundColor Cyan
foreach ($f in $toFix) {
    Write-Status "WARN" "$($f.Path)"
    foreach ($line in $f.Lines) {
        Write-Host "           $($line.Line.Trim())" -ForegroundColor DarkYellow
    }
}
Write-Host ""

if ($DryRun) {
    Write-Status "OK" "Dry run complete. No files were changed."
    exit 0
}

$confirm = Read-Host "Fix these $($toFix.Count) file(s) -- change '../../public/' to '../public/'? (y/N)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Status "FAIL" "Cancelled by user. No files were changed."
    exit 1
}

foreach ($f in $toFix) {
    $backupPath = "$($f.Path).bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $f.Path $backupPath
    $fixed = $f.Content -replace '\.\./\.\./public/', '../public/'
    Set-Content -Path $f.Path -Value $fixed -NoNewline
    Write-Status "OK" "Fixed $($f.Path) (backup: $backupPath)"
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Status "OK" "DONE. Run 'npm run dev' again to verify."
Write-Host "=====================================================" -ForegroundColor Cyan
