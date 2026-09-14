#requires -Version 5.1
<#
=====================================================
 KITABU YETU - FULL PARITY AUDIT (READ-ONLY)
=====================================================
Changes nothing. Produces the accurate map needed before
any copy/reconcile script is written:

  1. Template's own tsconfig.json path aliases
     (determines whether copied files need import rewriting)
  2. A correct comparison of TEMPLATE (src\...) vs DESTINATION
     (root-level equivalent) across every relevant directory:
     app, components, lib, hooks, services, utils, types,
     plus root config files -- categorized as:
       MISSING    - exists in template, not at destination
       IDENTICAL  - exists in both, byte-identical
       DIVERGED   - exists in both, different content
                    (destination may have improved on template --
                     these are flagged, never auto-copied)
#>

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$TemplateRoot = "D:\Templates\Kitabu Yetu UI"
$TemplateSrc  = Join-Path $TemplateRoot "src"
$ExcludeDirNames = @("node_modules", ".git", ".next", "_archive", "dist", "build", ".turbo", ".claude")

function Write-Status {
    param([string]$Status, [string]$Message)
    $color = switch ($Status) {
        "OK"    { "Green" }
        "WARN"  { "Yellow" }
        "FAIL"  { "Red" }
        "INFO"  { "Cyan" }
        default { "White" }
    }
    Write-Host ("  {0,-10}{1}" -f $Status, $Message) -ForegroundColor $color
}

function Get-FilesSafely {
    param([string]$RootPath, [string[]]$Include)
    $results = @()
    try {
        $items = Get-ChildItem -Path $RootPath -Recurse -File -Include $Include -ErrorAction SilentlyContinue -Force
        foreach ($item in $items) {
            $skip = $false
            foreach ($dirName in $ExcludeDirNames) {
                if ($item.FullName -match [regex]::Escape("\$dirName\")) { $skip = $true; break }
            }
            if (-not $skip) { $results += $item }
        }
    } catch {
        Write-Host "  (warning: partial scan of $RootPath -- $($_.Exception.Message))" -ForegroundColor DarkYellow
    }
    return $results
}

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " 1: TEMPLATE tsconfig.json PATH ALIASES" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""
$templateTsconfig = Join-Path $TemplateRoot "tsconfig.json"
if (Test-Path $templateTsconfig) {
    Get-Content $templateTsconfig -Raw | Select-String -Pattern '"paths"' -Context 0,10
} else {
    Write-Status "FAIL" "tsconfig.json not found at template root."
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " 2: BUILD FULL TEMPLATE FILE LIST (relative to src\, and root-level files)" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

# Files under template's src\ -- these map to DESTINATION ROOT (strip "src\" prefix)
$templateSrcFiles = Get-FilesSafely -RootPath $TemplateSrc -Include "*.ts","*.tsx","*.js","*.jsx"
$templateSrcRelative = $templateSrcFiles | ForEach-Object {
    $_.FullName.Substring($TemplateSrc.Length + 1)
}

Write-Status "INFO" "Template src\ files found: $($templateSrcRelative.Count)"

# Root-level template files worth checking (config files)
$rootConfigNames = @("tailwind.config.ts", "next-env.d.ts")

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " 3: THREE-WAY COMPARISON (MISSING / IDENTICAL / DIVERGED)" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

$missing = @()
$identical = @()
$diverged = @()

foreach ($rel in $templateSrcRelative) {
    $templateFile = Join-Path $TemplateSrc $rel
    $destFile = Join-Path "." $rel   # destination root == template's src\, path-for-path

    if (-not (Test-Path $destFile)) {
        $missing += $rel
    } else {
        $tHash = (Get-FileHash $templateFile -Algorithm SHA256 -ErrorAction SilentlyContinue).Hash
        $dHash = (Get-FileHash $destFile -Algorithm SHA256 -ErrorAction SilentlyContinue).Hash
        if ($tHash -eq $dHash) {
            $identical += $rel
        } else {
            $diverged += $rel
        }
    }
}

# Root config files
foreach ($name in $rootConfigNames) {
    $templateFile = Join-Path $TemplateRoot $name
    $destFile = Join-Path "." $name
    if (Test-Path $templateFile) {
        if (-not (Test-Path $destFile)) {
            $missing += $name
        } else {
            $tHash = (Get-FileHash $templateFile -Algorithm SHA256 -ErrorAction SilentlyContinue).Hash
            $dHash = (Get-FileHash $destFile -Algorithm SHA256 -ErrorAction SilentlyContinue).Hash
            if ($tHash -eq $dHash) { $identical += $name } else { $diverged += $name }
        }
    }
}

Write-Host "--- MISSING at destination ($($missing.Count)) ---" -ForegroundColor Red
$missing | Sort-Object | ForEach-Object { Write-Status "MISSING" $_ }

Write-Host ""
Write-Host "--- DIVERGED -- exists in both, content differs ($($diverged.Count)) ---" -ForegroundColor Yellow
$diverged | Sort-Object | ForEach-Object { Write-Status "DIVERGED" $_ }

Write-Host ""
Write-Host "--- IDENTICAL ($($identical.Count)) ---" -ForegroundColor Green
Write-Status "OK" "$($identical.Count) files already match exactly (list suppressed for brevity)"

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " 4: DESTINATION app\ DIRECTORY (routes actually present)" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""
if (Test-Path ".\app") {
    Get-ChildItem -Path ".\app" -Recurse -Filter "page.tsx" -ErrorAction SilentlyContinue |
        ForEach-Object { $_.FullName.Substring((Resolve-Path ".").Path.Length + 1) } |
        Sort-Object
} else {
    Write-Status "FAIL" "No app\ directory found at destination root."
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " 5: DESTINATION root-level dirs that might collide with template dirs" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""
foreach ($d in @("lib", "hooks", "services", "utils", "types")) {
    $exists = Test-Path ".\$d"
    Write-Status $(if ($exists) { "OK" } else { "WARN" }) "destination .\$d exists: $exists"
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Status "OK" "AUDIT COMPLETE. No files were changed."
Write-Host "=====================================================" -ForegroundColor Cyan
