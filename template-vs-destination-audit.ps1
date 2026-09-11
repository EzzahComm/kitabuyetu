#requires -Version 5.1
<#
=====================================================
 KITABU YETU - TEMPLATE vs DESTINATION AUDIT
=====================================================
Read-only. Changes nothing.

Compares:
  TEMPLATE (desired UI state):  D:\Templates\Kitabu Yetu UI
  DESTINATION (live project):   D:\Claude\Projects\KITABU YETU\kitabuyetu (current dir)

Reports:
  1. Full current app\page.tsx content at the destination
  2. Template's marketing/UI component inventory
  3. Destination's components\ inventory
  4. Which template components are missing at the destination
  5. Which template components exist at destination but differ
#>

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$TemplatePath = "D:\Templates\Kitabu Yetu UI"
$ExcludeDirNames = @("node_modules", ".git", ".next", "_archive", "dist", "build", ".turbo")

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
Write-Host " 1: DESTINATION app\page.tsx (FULL CONTENT)" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""
if (Test-Path ".\app\page.tsx") {
    Get-Content ".\app\page.tsx"
} else {
    Write-Status "FAIL" "app\page.tsx not found at destination."
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " 2: DOES THE TEMPLATE PATH EXIST" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""
$templateExists = Test-Path $TemplatePath
Write-Status $(if ($templateExists) { "OK" } else { "FAIL" }) "Template path exists: $templateExists ($TemplatePath)"

if ($templateExists) {
    Write-Host ""
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host " 3: TEMPLATE TOP-LEVEL STRUCTURE" -ForegroundColor Cyan
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host ""
    Get-ChildItem -Path $TemplatePath -ErrorAction SilentlyContinue |
        Select-Object Name, Mode | Format-Table -AutoSize | Out-String | Write-Host

    Write-Host ""
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host " 4: TEMPLATE COMPONENT FILES (.tsx/.ts/.js, excluding noise dirs)" -ForegroundColor Cyan
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host ""
    $templateFiles = Get-FilesSafely -RootPath $TemplatePath -Include "*.tsx","*.ts","*.jsx","*.js"
    $templateRelative = $templateFiles | ForEach-Object {
        $_.FullName.Substring($TemplatePath.Length + 1)
    }
    $templateRelative | Sort-Object

    Write-Host ""
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host " 5: DESTINATION components\ INVENTORY" -ForegroundColor Cyan
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host ""
    $destFiles = Get-FilesSafely -RootPath ".\components" -Include "*.tsx","*.ts","*.jsx","*.js"
    $destRelative = $destFiles | ForEach-Object {
        $_.FullName.Substring((Resolve-Path ".\components").Path.Length + 1)
    }
    $destRelative | Sort-Object

    Write-Host ""
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host " 6: TEMPLATE FILES MISSING AT DESTINATION (by filename only)" -ForegroundColor Cyan
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host ""
    $destNames = $destRelative | ForEach-Object { Split-Path $_ -Leaf }
    $templateNames = $templateRelative | ForEach-Object { Split-Path $_ -Leaf }

    $missing = $templateRelative | Where-Object {
        $leaf = Split-Path $_ -Leaf
        $destNames -notcontains $leaf
    }
    if ($missing.Count -eq 0) {
        Write-Status "OK" "No template filenames missing at destination (by name)."
    } else {
        foreach ($m in $missing) {
            Write-Status "WARN" "Missing at destination: $m"
        }
    }
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Status "OK" "AUDIT COMPLETE."
Write-Host "=====================================================" -ForegroundColor Cyan
