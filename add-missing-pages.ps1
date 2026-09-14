#requires -Version 5.1
<#
=====================================================
 KITABU YETU - ADD MISSING MARKETING PAGES
=====================================================
Copies exactly two genuinely-missing pages from the
template into the destination:

  1. app\careers\page.tsx        (no changes needed)
  2. app\how-it-works\page.tsx   (image import paths
                                   corrected: template is
                                   3 levels deep from its
                                   root, destination is 2)

Everything else in the earlier "MISSING" list (dashboard\*,
legal, enterprise, components-demo, types.ts, utils\*) is
intentionally NOT copied -- destination has already
superseded those with a more complete implementation.

USAGE:
  .\add-missing-pages.ps1            # asks to confirm
  .\add-missing-pages.ps1 -DryRun    # show what would happen
#>

param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$TemplateSrc = "D:\Templates\Kitabu Yetu UI\src"

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
Write-Host " KITABU YETU - ADD MISSING MARKETING PAGES" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $TemplateSrc)) {
    Write-Status "FAIL" "Template src not found at $TemplateSrc"
    exit 1
}

# --- File 1: careers/page.tsx -- copied as-is, no path depth issue ---
$careersSrc  = Join-Path $TemplateSrc "app\careers\page.tsx"
$careersDest = ".\app\careers\page.tsx"

# --- File 2: how-it-works/page.tsx -- image paths need one fewer "../" ---
$howItWorksSrc  = Join-Path $TemplateSrc "app\how-it-works\page.tsx"
$howItWorksDest = ".\app\how-it-works\page.tsx"

if (-not (Test-Path $careersSrc)) {
    Write-Status "FAIL" "Template careers page not found at $careersSrc"
    exit 1
}
if (-not (Test-Path $howItWorksSrc)) {
    Write-Status "FAIL" "Template how-it-works page not found at $howItWorksSrc"
    exit 1
}

if (Test-Path $careersDest) {
    Write-Status "WARN" "$careersDest already exists -- skipping to avoid overwrite."
    $careersSrc = $null
}
if (Test-Path $howItWorksDest) {
    Write-Status "WARN" "$howItWorksDest already exists -- skipping to avoid overwrite."
    $howItWorksSrc = $null
}

$howItWorksContent = $null
if ($howItWorksSrc) {
    $raw = Get-Content $howItWorksSrc -Raw
    # Template path is 3 levels deep (src\app\how-it-works\page.tsx -> "../../../public")
    # Destination path is 2 levels deep (app\how-it-works\page.tsx -> "../../public")
    $howItWorksContent = $raw -replace '\.\./\.\./\.\./public/', '../../public/'
}

Write-Host "Planned actions:" -ForegroundColor Cyan
if ($careersSrc) {
    Write-Host "  1. Create $careersDest (copied as-is from template)"
}
if ($howItWorksSrc) {
    Write-Host "  2. Create $howItWorksDest (image paths corrected: ../../../public -> ../../public)"
}
if (-not $careersSrc -and -not $howItWorksSrc) {
    Write-Status "OK" "Both files already exist at destination. Nothing to do."
    exit 0
}
Write-Host ""

if ($DryRun) {
    if ($howItWorksSrc) {
        Write-Host "--- Preview of corrected how-it-works imports ---" -ForegroundColor Cyan
        ($howItWorksContent -split "`r?`n") | Select-Object -First 20
    }
    Write-Status "OK" "Dry run complete. No files were changed."
    exit 0
}

$confirm = Read-Host "Create these new page(s)? (y/N)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Status "FAIL" "Cancelled by user. No files were changed."
    exit 1
}

if ($careersSrc) {
    $careersDir = Split-Path $careersDest -Parent
    if (-not (Test-Path $careersDir)) { New-Item -ItemType Directory -Path $careersDir -Force | Out-Null }
    Copy-Item $careersSrc $careersDest
    Write-Status "OK" "Created $careersDest"
}

if ($howItWorksSrc) {
    $hiwDir = Split-Path $howItWorksDest -Parent
    if (-not (Test-Path $hiwDir)) { New-Item -ItemType Directory -Path $hiwDir -Force | Out-Null }
    Set-Content -Path $howItWorksDest -Value $howItWorksContent -NoNewline
    Write-Status "OK" "Created $howItWorksDest (image paths corrected)"
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Status "OK" "DONE. Run 'npm run dev' and visit /careers and /how-it-works to verify."
Write-Host "=====================================================" -ForegroundColor Cyan
