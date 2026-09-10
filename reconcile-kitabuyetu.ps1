#requires -Version 5.1

<#
=============================================================
 KITABU YETU - APPLICATION TREE RECONCILIATION
=============================================================

GOAL
----
Preserve the existing production Next.js application under:

    .\app\

while integrating reusable UI/template code currently under:

    .\src\components
    .\src\lib
    .\src\types
    .\src\hooks

The template application tree:

    .\src\app

is quarantined rather than deleted.

IMPORTANT
---------
This script deliberately does NOT:
    - delete the production app\
    - overwrite existing production files
    - rewrite thousands of imports
    - modify node_modules
    - modify .next
    - touch archived migration directories
    - modify authentication credentials
    - modify database configuration

It creates a reconciliation log and stops on dangerous
case-collision conditions.
#>

$ErrorActionPreference = "Stop"

$Project = (Get-Location).Path

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Cyan
Write-Host " KITABU YETU - APPLICATION TREE RECONCILIATION" -ForegroundColor Cyan
Write-Host "=============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Project root:" -ForegroundColor Yellow
Write-Host $Project
Write-Host ""

# ------------------------------------------------------------
# 1. Verify project root
# ------------------------------------------------------------

if (-not (Test-Path ".\package.json")) {
    throw "package.json was not found. Run this script from the Kitabu Yetu application root."
}

if (-not (Test-Path ".\app")) {
    throw "Production .\app directory was not found. Script will not continue."
}

Write-Host "[OK] Production app\ exists." -ForegroundColor Green

# ------------------------------------------------------------
# 2. Timestamp/log
# ------------------------------------------------------------

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogDir = ".\.migration-reconciliation"
$LogFile = "$LogDir\reconciliation-$Stamp.log"

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

function Log {
    param([string]$Message)

    $Message | Tee-Object -FilePath $LogFile -Append
}

Log ""
Log "============================================================="
Log "KITABU YETU APPLICATION RECONCILIATION"
Log "Started: $(Get-Date)"
Log "Project: $Project"
Log "============================================================="
Log ""

# ------------------------------------------------------------
# 3. Verify canonical production tree
# ------------------------------------------------------------

$ProductionApp = Join-Path $Project "app"
$TemplateApp   = Join-Path $Project "src\app"

$SourceComponents = Join-Path $Project "src\components"
$SourceLib        = Join-Path $Project "src\lib"
$SourceTypes      = Join-Path $Project "src\types"
$SourceHooks      = Join-Path $Project "src\hooks"

$DestComponents = Join-Path $Project "components"
$DestLib        = Join-Path $Project "lib"
$DestTypes      = Join-Path $Project "types"
$DestHooks      = Join-Path $Project "hooks"

Log "Production application tree:"
Log "  $ProductionApp"

Log ""
Log "Template application tree:"
Log "  $TemplateApp"

# ------------------------------------------------------------
# 4. Show production architecture before changes
# ------------------------------------------------------------

Log ""
Log "Production app route directories:"

Get-ChildItem $ProductionApp -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name |
    ForEach-Object {
        Log "  app\$($_.Name)"
    }

# ------------------------------------------------------------
# 5. NEVER merge src\app into production app
# ------------------------------------------------------------

if (Test-Path $TemplateApp) {

    $QuarantineRoot = Join-Path $Project ".migration-quarantine"
    $QuarantineApp  = Join-Path $QuarantineRoot "src-app-$Stamp"

    New-Item -ItemType Directory -Path $QuarantineRoot -Force | Out-Null

    Log ""
    Log "src\app exists."
    Log "It will NOT be merged into production app\."
    Log "Quarantine destination:"
    Log "  $QuarantineApp"

    Move-Item `
        -Path $TemplateApp `
        -Destination $QuarantineApp

    Log "[MOVED] src\app -> $QuarantineApp"

    Write-Host ""
    Write-Host "[QUARANTINED] src\app" -ForegroundColor Yellow
    Write-Host "             $QuarantineApp" -ForegroundColor Gray
}

# ------------------------------------------------------------
# 6. Function: compare files
# ------------------------------------------------------------

function Get-FileHashSafe {
    param([string]$Path)

    if (-not (Test-Path $Path -PathType Leaf)) {
        return $null
    }

    return (Get-FileHash -Algorithm SHA256 -Path $Path).Hash
}

# ------------------------------------------------------------
# 7. Function: merge directory safely
# ------------------------------------------------------------

function Merge-TreeSafely {
    param(
        [string]$Source,
        [string]$Destination,
        [string]$Label
    )

    if (-not (Test-Path $Source)) {
        Log ""
        Log "[SKIP] $Label source does not exist:"
        Log "       $Source"
        return
    }

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null

    Log ""
    Log "-------------------------------------------------------------"
    Log "MERGING: $Label"
    Log "SOURCE:  $Source"
    Log "TARGET:  $Destination"
    Log "-------------------------------------------------------------"

    $Files = Get-ChildItem `
        -Path $Source `
        -File `
        -Recurse `
        -ErrorAction Stop

    foreach ($File in $Files) {

        $Relative = $File.FullName.Substring($Source.Length).TrimStart("\")
        $Target = Join-Path $Destination $Relative
        $TargetDir = Split-Path $Target -Parent

        New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null

        if (-not (Test-Path $Target)) {

            Copy-Item `
                -LiteralPath $File.FullName `
                -Destination $Target `
                -Force

            Log "[COPIED] $Relative"
            continue
        }

        $SourceHash = Get-FileHashSafe $File.FullName
        $TargetHash = Get-FileHashSafe $Target

        if ($SourceHash -eq $TargetHash) {

            Log "[IDENTICAL] $Relative"
            continue
        }

        # Existing production file wins.
        Log "[CONFLICT - PRESERVED TARGET] $Relative"
        Log "    Source: $($File.FullName)"
        Log "    Target: $Target"
    }
}

# ------------------------------------------------------------
# 8. Detect dangerous case collisions BEFORE merging
# ------------------------------------------------------------

function Find-CaseCollisions {
    param(
        [string]$Root,
        [string]$Label
    )

    if (-not (Test-Path $Root)) {
        return
    }

    $Files = Get-ChildItem $Root -File -Recurse |
        ForEach-Object {
            $_.FullName.Substring($Root.Length).TrimStart("\").ToLowerInvariant()
        }

    $Groups = $Files |
        Group-Object |
        Where-Object { $_.Count -gt 1 }

    if ($Groups.Count -gt 0) {

        Log ""
        Log "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
        Log "CASE COLLISION DETECTED: $Label"
        Log "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"

        foreach ($Group in $Groups) {
            Log "Collision: $($Group.Name)"

            foreach ($Item in $Group.Group) {
                Log "  $Item"
            }
        }

        throw @"
Case-sensitive filename collision detected in $Label.

This is dangerous on Windows and must be resolved before
TypeScript/build validation.

See:
$LogFile
"@
    }
}

Log ""
Log "Checking source tree for filename case collisions..."

Find-CaseCollisions -Root $SourceComponents -Label "src\components"
Find-CaseCollisions -Root $SourceLib        -Label "src\lib"
Find-CaseCollisions -Root $SourceTypes      -Label "src\types"
Find-CaseCollisions -Root $SourceHooks      -Label "src\hooks"

Log "[OK] No source-side case collisions detected."

# ------------------------------------------------------------
# 9. Merge reusable template code into production tree
# ------------------------------------------------------------

Merge-TreeSafely `
    -Source $SourceComponents `
    -Destination $DestComponents `
    -Label "components"

Merge-TreeSafely `
    -Source $SourceLib `
    -Destination $DestLib `
    -Label "lib"

Merge-TreeSafely `
    -Source $SourceTypes `
    -Destination $DestTypes `
    -Label "types"

Merge-TreeSafely `
    -Source $SourceHooks `
    -Destination $DestHooks `
    -Label "hooks"

# ------------------------------------------------------------
# 10. Normalize tsconfig around ROOT production architecture
# ------------------------------------------------------------

$TsConfigPath = Join-Path $Project "tsconfig.json"

if (-not (Test-Path $TsConfigPath)) {
    throw "tsconfig.json was not found."
}

$TsConfig = Get-Content $TsConfigPath -Raw | ConvertFrom-Json

# Ensure baseUrl exists.
$TsConfig.compilerOptions | Add-Member `
    -NotePropertyName "baseUrl" `
    -NotePropertyValue "." `
    -Force

# Canonical aliases point to ROOT production directories.
$Paths = [ordered]@{
    "@/*"            = @("./*")
    "@/components/*" = @("./components/*")
    "@/lib/*"        = @("./lib/*")
    "@/types/*"      = @("./types/*")
    "@/hooks/*"      = @("./hooks/*")
}

$TsConfig.compilerOptions.paths = $Paths

# ------------------------------------------------------------
# 11. Rebuild include/exclude safely
# ------------------------------------------------------------

$TsConfig.include = @(
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts"
)

$TsConfig.exclude = @(
    "node_modules",
    ".migration-quarantine",
    ".migration-backup-*",
    ".optimization",
    ".claude"
)

$TsConfig | ConvertTo-Json -Depth 20 |
    Set-Content -Path $TsConfigPath -Encoding UTF8

Log ""
Log "tsconfig.json rewritten."
Log "Canonical aliases:"
Log "  @/*             -> ./*"
Log "  @/components/*  -> ./components/*"
Log "  @/lib/*         -> ./lib/*"
Log "  @/types/*       -> ./types/*"
Log "  @/hooks/*       -> ./hooks/*"

# ------------------------------------------------------------
# 12. Ensure canonical production URL in env
# ------------------------------------------------------------

$EnvExample = Join-Path $Project ".env.example"

if (Test-Path $EnvExample) {

    $EnvText = Get-Content $EnvExample -Raw

    if ($EnvText -notmatch "(?m)^NEXT_PUBLIC_APP_URL=") {

        Add-Content `
            -Path $EnvExample `
            -Value "`r`nNEXT_PUBLIC_APP_URL=https://kitabuyetu.vercel.app"

        Log ""
        Log "[ADDED] NEXT_PUBLIC_APP_URL to .env.example"
    }
    else {

        Log ""
        Log "[INFO] NEXT_PUBLIC_APP_URL already exists in .env.example"
    }
}

# ------------------------------------------------------------
# 13. Check canonical URL references in live code
# ------------------------------------------------------------

Log ""
Log "Checking live source for non-canonical app URLs..."

$SearchRoots = @(
    $ProductionApp,
    $DestComponents,
    $DestLib,
    $DestTypes,
    $DestHooks
)

$UrlMatches = @()

foreach ($Root in $SearchRoots) {

    if (-not (Test-Path $Root)) {
        continue
    }

    $UrlMatches += Get-ChildItem `
        -Path $Root `
        -File `
        -Recurse `
        -Include *.ts,*.tsx,*.js,*.jsx,*.mjs,*.cjs `
        -ErrorAction SilentlyContinue |
        Select-String `
            -Pattern 'https?://[^"''\s)`]+'
}

if ($UrlMatches.Count -gt 0) {

    Log ""
    Log "URL references found in live source:"
    
    foreach ($Match in $UrlMatches) {
        Log "$($Match.Path):$($Match.LineNumber) $($Match.Line.Trim())"
    }

    Log ""
    Log "IMPORTANT: URLs were NOT automatically rewritten."
    Log "Review authentication callback/redirect URLs separately."
}

# ------------------------------------------------------------
# 14. Verify production app survived
# ------------------------------------------------------------

if (-not (Test-Path $ProductionApp)) {
    throw "FATAL: production app\ disappeared."
}

Log ""
Log "[OK] Production app\ still exists."

# ------------------------------------------------------------
# 15. Clear TypeScript incremental cache
# ------------------------------------------------------------

$TsBuildInfo = Get-ChildItem `
    -Path $Project `
    -Filter "*.tsbuildinfo" `
    -File `
    -ErrorAction SilentlyContinue

foreach ($Item in $TsBuildInfo) {
    Remove-Item $Item.FullName -Force
    Log "[REMOVED] TypeScript cache: $($Item.Name)"
}

# ------------------------------------------------------------
# 16. Final summary
# ------------------------------------------------------------

Log ""
Log "============================================================="
Log "RECONCILIATION COMPLETE"
Log "============================================================="
Log ""
Log "Production application:"
Log "  $ProductionApp"
Log ""
Log "Template app quarantined:"
Log "  $QuarantineApp"
Log ""
Log "Canonical shared code:"
Log "  $DestComponents"
Log "  $DestLib"
Log "  $DestTypes"
Log "  $DestHooks"
Log ""
Log "Log:"
Log "  $LogFile"
Log ""

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Green
Write-Host " RECONCILIATION COMPLETE" -ForegroundColor Green
Write-Host "=============================================================" -ForegroundColor Green
Write-Host ""

Write-Host "Production app preserved:" -ForegroundColor Green
Write-Host "  $ProductionApp"

Write-Host ""
Write-Host "Template src\app quarantined:" -ForegroundColor Yellow
Write-Host "  $QuarantineApp"

Write-Host ""
Write-Host "Shared code merged into:" -ForegroundColor Cyan
Write-Host "  $DestComponents"
Write-Host "  $DestLib"
Write-Host "  $DestTypes"
Write-Host "  $DestHooks"

Write-Host ""
Write-Host "Reconciliation log:" -ForegroundColor Cyan
Write-Host "  $LogFile"

Write-Host ""
Write-Host "DO NOT DEPLOY YET." -ForegroundColor Red
Write-Host "Run the validation procedure below first." -ForegroundColor Yellow