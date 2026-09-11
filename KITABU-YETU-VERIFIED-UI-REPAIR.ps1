#requires -Version 5.1
<#
KITABU YETU - VERIFIED FOUR UI PRIMITIVE REPAIR
This script is intentionally narrow.

SOURCE:
D:\Templates\Kitabu Yetu UI\src\components\ui

DESTINATION:
D:\Claude\Projects\KITABU YETU\kitabuyetu\components\ui

It copies ONLY:
  button.tsx
  input.tsx
  card.tsx
  badge.tsx

It does NOT copy app, lib, services, providers, emails, or src.

It stops after TypeScript. Lint/build/deployment are manual next steps.
#>

$ErrorActionPreference = "Stop"

$Project = "D:\Claude\Projects\KITABU YETU\kitabuyetu"
$Template = "D:\Templates\Kitabu Yetu UI"
$SourceUi = Join-Path $Template "src\components\ui"
$DestUi = Join-Path $Project "components\ui"
$TsConfig = Join-Path $Project "tsconfig.json"

$Files = @("button.tsx","input.tsx","card.tsx","badge.tsx")
$UpperFiles = @("Button.tsx","Input.tsx","Card.tsx","Badge.tsx")

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host " KITABU YETU - VERIFIED UI REPAIR" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "SOURCE:"
Write-Host "  $SourceUi"
Write-Host ""
Write-Host "DESTINATION:"
Write-Host "  $DestUi"
Write-Host ""
Write-Host "TSCONFIG:"
Write-Host "  $TsConfig"
Write-Host ""

# ---------------------------------------------------------------
# 0. PRE-FLIGHT: prove source and destination
# ---------------------------------------------------------------

if (-not (Test-Path -LiteralPath $Project -PathType Container)) {
    throw "Production project does not exist: $Project"
}

if (-not (Test-Path -LiteralPath $SourceUi -PathType Container)) {
    throw "TEMPLATE SOURCE DIRECTORY DOES NOT EXIST: $SourceUi"
}

if (-not (Test-Path -LiteralPath $DestUi -PathType Container)) {
    [System.IO.Directory]::CreateDirectory($DestUi) | Out-Null
}

if (-not (Test-Path -LiteralPath $TsConfig -PathType Leaf)) {
    throw "tsconfig.json does not exist: $TsConfig"
}

Write-Host "[0] SOURCE FILE VERIFICATION" -ForegroundColor Yellow

foreach ($Name in $Files) {
    $Source = Join-Path $SourceUi $Name

    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        throw "MISSING TEMPLATE SOURCE: $Source"
    }

    $Info = Get-Item -LiteralPath $Source
    $Hash = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash

    Write-Host "  SOURCE OK: $Name | $($Info.Length) bytes | SHA256 $Hash" -ForegroundColor Green
}

Write-Host ""

# ---------------------------------------------------------------
# 1. BACK UP TARGETS + TSCONFIG
# ---------------------------------------------------------------

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $Project ".repair-backup-ui-$Stamp"
$BackupUi = Join-Path $BackupRoot "components\ui"

[System.IO.Directory]::CreateDirectory($BackupUi) | Out-Null

Write-Host "[1] BACKUP" -ForegroundColor Yellow
Write-Host "  Backup: $BackupRoot"

foreach ($Name in ($Files + $UpperFiles)) {
    $Path = Join-Path $DestUi $Name

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        Copy-Item -LiteralPath $Path -Destination (Join-Path $BackupUi $Name) -Force
        Write-Host "  BACKED UP: $Name" -ForegroundColor Green
    }
    else {
        Write-Host "  ABSENT: $Name" -ForegroundColor DarkGray
    }
}

Copy-Item -LiteralPath $TsConfig -Destination (Join-Path $BackupRoot "tsconfig.json") -Force
Write-Host "  BACKED UP: tsconfig.json" -ForegroundColor Green
Write-Host ""

# ---------------------------------------------------------------
# 2. REMOVE CASE-DUPLICATE UPPERCASE TARGETS
#    Windows is case-insensitive, so this must happen BEFORE copy.
# ---------------------------------------------------------------

Write-Host "[2] ENSURE LOWERCASE TARGET NAMES" -ForegroundColor Yellow

foreach ($Name in $UpperFiles) {
    $Path = Join-Path $DestUi $Name

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        Remove-Item -LiteralPath $Path -Force
        Write-Host "  REMOVED UPPERCASE TARGET: $Name" -ForegroundColor DarkGray
    }
}

Write-Host ""

# ---------------------------------------------------------------
# 3. COPY CLEAN TEMPLATE FILES THROUGH TEMP NAMES
#    Temp names avoid Windows case-insensitive collisions.
# ---------------------------------------------------------------

Write-Host "[3] COPY FOUR CLEAN TEMPLATE FILES" -ForegroundColor Yellow

foreach ($Name in $Files) {
    $Source = Join-Path $SourceUi $Name
    $Destination = Join-Path $DestUi $Name

    $TempName = ".repair-$Name"
    $Temp = Join-Path $DestUi $TempName

    if (Test-Path -LiteralPath $Temp -PathType Leaf) {
        Remove-Item -LiteralPath $Temp -Force
    }

    Copy-Item -LiteralPath $Source -Destination $Temp -Force
    Move-Item -LiteralPath $Temp -Destination $Destination -Force

    Write-Host "  COPIED: $Source" -ForegroundColor Green
    Write-Host "      -> $Destination" -ForegroundColor Green
}

Write-Host ""

# ---------------------------------------------------------------
# 4. VERIFY DESTINATION CONTENTS + HASHES
# ---------------------------------------------------------------

Write-Host "[4] DESTINATION VERIFICATION" -ForegroundColor Yellow

foreach ($Name in $Files) {
    $Source = Join-Path $SourceUi $Name
    $Destination = Join-Path $DestUi $Name

    if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) {
        throw "DESTINATION FILE MISSING AFTER COPY: $Destination"
    }

    $SourceHash = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash
    $DestHash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash

    if ($SourceHash -ne $DestHash) {
        throw "HASH MISMATCH: $Name`nSOURCE: $SourceHash`nDEST:   $DestHash"
    }

    Write-Host "  VERIFIED: $Name | SHA256 MATCH" -ForegroundColor Green
}

Write-Host ""

# ---------------------------------------------------------------
# 5. REPAIR TSCONFIG
# ---------------------------------------------------------------

Write-Host "[5] REPAIR TSCONFIG" -ForegroundColor Yellow

$Ts = Get-Content -LiteralPath $TsConfig -Raw -Encoding UTF8 | ConvertFrom-Json

if ($null -eq $Ts.compilerOptions) {
    $Ts | Add-Member -MemberType NoteProperty -Name compilerOptions -Value ([pscustomobject]@{})
}

$Paths = [ordered]@{
    "@/*"            = @("./*")
    "@/components/*" = @("./components/*")
    "@/lib/*"        = @("./lib/*")
    "@/types/*"      = @("./types/*")
    "@/hooks/*"      = @("./hooks/*")
}

$Ts.compilerOptions.paths = [pscustomobject]$Paths
$Ts.compilerOptions.baseUrl = "."

$Exclude = @()
if ($null -ne $Ts.exclude) {
    foreach ($Item in $Ts.exclude) {
        if ($Exclude -notcontains [string]$Item) {
            $Exclude += [string]$Item
        }
    }
}

if ($Exclude -notcontains "src") {
    $Exclude += "src"
}

$Ts.exclude = $Exclude

$Json = $Ts | ConvertTo-Json -Depth 30
[System.IO.File]::WriteAllText(
    $TsConfig,
    $Json,
    (New-Object System.Text.UTF8Encoding($false))
)

Write-Host "  PASS: @/* -> ./*" -ForegroundColor Green
Write-Host "  PASS: @/components/* -> ./components/*" -ForegroundColor Green
Write-Host "  PASS: @/lib/* -> ./lib/*" -ForegroundColor Green
Write-Host "  PASS: @/types/* -> ./types/*" -ForegroundColor Green
Write-Host "  PASS: @/hooks/* -> ./hooks/*" -ForegroundColor Green
Write-Host "  PASS: src excluded" -ForegroundColor Green
Write-Host ""

# ---------------------------------------------------------------
# 6. CACHE CLEANUP
#    These are generated caches only; source/business files untouched.
# ---------------------------------------------------------------

Write-Host "[6] CACHE CHECK" -ForegroundColor Yellow

$TsBuildInfo = Join-Path $Project "tsconfig.tsbuildinfo"
$NextDir = Join-Path $Project ".next"

if (Test-Path -LiteralPath $TsBuildInfo -PathType Leaf) {
    Remove-Item -LiteralPath $TsBuildInfo -Force
    Write-Host "  REMOVED: tsconfig.tsbuildinfo" -ForegroundColor DarkGray
}

if (Test-Path -LiteralPath $NextDir -PathType Container) {
    try {
        Remove-Item -LiteralPath $NextDir -Recurse -Force -ErrorAction Stop
        Write-Host "  REMOVED: .next" -ForegroundColor DarkGray
    }
    catch {
        Write-Warning "Could not remove .next. Continuing; it is only a generated cache."
    }
}

Write-Host ""

# ---------------------------------------------------------------
# 7. FINAL STRUCTURAL PROOF BEFORE TSC
# ---------------------------------------------------------------

Write-Host "[7] FINAL STRUCTURAL PROOF" -ForegroundColor Yellow

foreach ($Name in $Files) {
    $Path = Join-Path $DestUi $Name

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "FINAL STRUCTURE FAILURE: $Path"
    }

    Write-Host "  PASS: components\ui\$Name" -ForegroundColor Green
}

foreach ($Name in $UpperFiles) {
    $Path = Join-Path $DestUi $Name

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        throw "FINAL CASE FAILURE: uppercase duplicate still exists: $Path"
    }
}

Write-Host "  PASS: no uppercase Button/Input/Card/Badge duplicates" -ForegroundColor Green
Write-Host ""

# ---------------------------------------------------------------
# 8. TYPESCRIPT ONLY
# ---------------------------------------------------------------

Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "[8] RUNNING npx tsc --noEmit" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host ""

Push-Location $Project
try {
    & npx tsc --noEmit
    $ExitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan

if ($ExitCode -eq 0) {
    Write-Host "TYPESCRIPT CLEAN" -ForegroundColor Green
    Write-Host "==============================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "STOP HERE. Do not deploy."
    Write-Host ""
    Write-Host "Next manual checkpoint:"
    Write-Host "  npm run lint"
    Write-Host ""
    Write-Host "Only if lint passes:"
    Write-Host "  npm run build"
}
else {
    Write-Host "TYPESCRIPT FAILED - STOP" -ForegroundColor Red
    Write-Host "==============================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Exit code: $ExitCode" -ForegroundColor Red
    Write-Host ""
    Write-Host "DO NOT run lint."
    Write-Host "DO NOT run build."
    Write-Host "DO NOT deploy."
    Write-Host ""
    Write-Host "Repair backup:"
    Write-Host "  $BackupRoot"
}

Write-Host ""
Write-Host "NO DEPLOYMENT WAS PERFORMED."
Write-Host ""
