#requires -Version 5.1

$ErrorActionPreference = "Stop"

$ProjectRoot = "D:\Claude\Projects\KITABU YETU\kitabuyetu"

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Project root not found: $ProjectRoot"
}

Set-Location -LiteralPath $ProjectRoot

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " KITABU YETU - RECOVERY FIRST" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# ------------------------------------------------------------
# 1. Locate migration backup
# ------------------------------------------------------------

$Backups = @(
    Get-ChildItem -LiteralPath $ProjectRoot -Directory -Force |
    Where-Object { $_.Name -like ".migration-backup-final-*" } |
    Sort-Object LastWriteTime -Descending
)

if ($Backups.Count -eq 0) {
    throw "No .migration-backup-final-* directory was found. STOP. Do not reconstruct files from the template yet."
}

$RecoverySource = $Backups[0].FullName

Write-Host "Recovery source:" -ForegroundColor Yellow
Write-Host "  $RecoverySource" -ForegroundColor White
Write-Host ""

# ------------------------------------------------------------
# 2. Emergency backup of CURRENT state
# ------------------------------------------------------------

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$EmergencyBackup = Join-Path $ProjectRoot (".recovery-before-restore-$Stamp")

Write-Host "Creating emergency backup:" -ForegroundColor Yellow
Write-Host "  $EmergencyBackup" -ForegroundColor White

New-Item -ItemType Directory -Path $EmergencyBackup -Force | Out-Null

$BackupItems = @(
    "app",
    "components",
    "hooks",
    "lib",
    "services",
    "emails",
    "providers",
    "types",
    "public",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "next.config.js",
    "next.config.mjs",
    "next.config.ts"
)

foreach ($Item in $BackupItems) {

    $Source = Join-Path $ProjectRoot $Item

    if (Test-Path -LiteralPath $Source) {

        $Destination = Join-Path $EmergencyBackup $Item

        if (Test-Path -LiteralPath $Source -PathType Container) {
            New-Item -ItemType Directory -Path $Destination -Force | Out-Null

            & robocopy `
                $Source `
                $Destination `
                /E `
                /COPY:DAT `
                /R:1 `
                /W:1 `
                /NFL `
                /NDL `
                /NJH `
                /NJS `
                /NP | Out-Null

            if ($LASTEXITCODE -ge 8) {
                throw "Emergency backup failed for $Item. STOP."
            }
        }
        else {
            $Parent = Split-Path -Parent $Destination

            if ($Parent) {
                New-Item -ItemType Directory -Path $Parent -Force | Out-Null
            }

            Copy-Item -LiteralPath $Source -Destination $Destination -Force
        }
    }
}

Write-Host "Emergency backup complete." -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------
# Helper: restore only files that are currently missing
# ------------------------------------------------------------

function Restore-MissingTree {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    $Source = Join-Path $RecoverySource $RelativePath
    $Destination = Join-Path $ProjectRoot $RelativePath

    if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
        Write-Host "  Backup does not contain: $RelativePath" -ForegroundColor DarkGray
        return
    }

    Write-Host "Recovering missing files under $RelativePath ..." -ForegroundColor Cyan

    $Files = Get-ChildItem -LiteralPath $Source -File -Recurse -Force

    $Restored = 0

    foreach ($File in $Files) {

        $RelativeFile = $File.FullName.Substring($Source.Length).TrimStart('\')
        $Target = Join-Path $Destination $RelativeFile

        if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) {

            $TargetParent = Split-Path -Parent $Target

            if ($TargetParent) {
                New-Item -ItemType Directory -Path $TargetParent -Force | Out-Null
            }

            Copy-Item -LiteralPath $File.FullName -Destination $Target -Force

            $Restored++
        }
    }

    Write-Host "  Restored missing files: $Restored" -ForegroundColor Green
}

# ------------------------------------------------------------
# 3. Recover structural application dependencies
# ------------------------------------------------------------

Write-Host "STEP 1 - Recovering structural dependencies" -ForegroundColor Magenta

Restore-MissingTree "providers"
Restore-MissingTree "services"
Restore-MissingTree "emails"
Restore-MissingTree "lib"
Restore-MissingTree "types"
Restore-MissingTree "hooks"

# Components are also recovered, but ONLY missing files are restored.
# Existing production component files are not overwritten.
Restore-MissingTree "components"

Write-Host ""

# ------------------------------------------------------------
# 4. Recover known marketing/branding dependencies
# ------------------------------------------------------------

Write-Host "STEP 2 - Recovering missing marketing/branding dependencies" -ForegroundColor Magenta

$SpecialPaths = @(
    "components\marketing",
    "components\branding",
    "components\shared"
)

foreach ($RelativePath in $SpecialPaths) {
    Restore-MissingTree $RelativePath
}

Write-Host ""

# ------------------------------------------------------------
# 5. UI casing recovery
#
# Windows is case-insensitive, therefore Button.tsx and
# button.tsx cannot safely coexist.
#
# Production imports overwhelmingly use lowercase:
#   @/components/ui/button
#   @/components/ui/input
#   @/components/ui/card
#   @/components/ui/badge
# ------------------------------------------------------------

Write-Host "STEP 3 - Normalizing canonical UI filenames" -ForegroundColor Magenta

$UiDir = Join-Path $ProjectRoot "components\ui"

if (-not (Test-Path -LiteralPath $UiDir -PathType Container)) {
    throw "Production components\ui directory is missing after structural recovery."
}

$CanonicalUi = @(
    "button.tsx",
    "input.tsx",
    "card.tsx",
    "badge.tsx"
)

foreach ($Name in $CanonicalUi) {

    $Lower = Join-Path $UiDir $Name

    $Stem = [System.IO.Path]::GetFileNameWithoutExtension($Name)
    $Ext  = [System.IO.Path]::GetExtension($Name)

    $UpperName = $Stem.Substring(0,1).ToUpperInvariant() +
                 $Stem.Substring(1) +
                 $Ext

    $Upper = Join-Path $UiDir $UpperName

    $LowerExists = Test-Path -LiteralPath $Lower -PathType Leaf
    $UpperExists = Test-Path -LiteralPath $Upper -PathType Leaf

    if (-not $LowerExists -and -not $UpperExists) {

        # Try backup using either casing.
        $BackupLower = Join-Path $RecoverySource ("components\ui\" + $Name)
        $BackupUpper = Join-Path $RecoverySource ("components\ui\" + $UpperName)

        if (Test-Path -LiteralPath $BackupLower -PathType Leaf) {
            Copy-Item -LiteralPath $BackupLower -Destination $Lower -Force
            Write-Host "  Restored $Name from backup." -ForegroundColor Green
        }
        elseif (Test-Path -LiteralPath $BackupUpper -PathType Leaf) {
            Copy-Item -LiteralPath $BackupUpper -Destination $Lower -Force
            Write-Host "  Restored $Name from backup." -ForegroundColor Green
        }
        else {
            Write-Host "  WARNING: backup has no $Name / $UpperName" -ForegroundColor Red
        }

        continue
    }

    if ($LowerExists -and $UpperExists) {

        # They are the same Windows path. Keep the existing production
        # implementation and force the visible filename to lowercase.
        $Temp = Join-Path $UiDir (".recovery-temp-$Name")

        if (Test-Path -LiteralPath $Temp) {
            Remove-Item -LiteralPath $Temp -Force
        }

        Move-Item -LiteralPath $Upper -Destination $Temp -Force
        Move-Item -LiteralPath $Temp -Destination $Lower -Force

        Write-Host "  Normalized $Name" -ForegroundColor Green

        continue
    }

    if ($UpperExists -and -not $LowerExists) {

        $Temp = Join-Path $UiDir (".recovery-temp-$Name")

        if (Test-Path -LiteralPath $Temp) {
            Remove-Item -LiteralPath $Temp -Force
        }

        Move-Item -LiteralPath $Upper -Destination $Temp -Force
        Move-Item -LiteralPath $Temp -Destination $Lower -Force

        Write-Host "  Renamed $UpperName -> $Name" -ForegroundColor Green
    }
}

Write-Host ""

# ------------------------------------------------------------
# 6. Normalize root production imports
# ------------------------------------------------------------

Write-Host "STEP 4 - Normalizing root production UI imports" -ForegroundColor Magenta

$SearchRoots = @(
    (Join-Path $ProjectRoot "app"),
    (Join-Path $ProjectRoot "components"),
    (Join-Path $ProjectRoot "hooks"),
    (Join-Path $ProjectRoot "lib"),
    (Join-Path $ProjectRoot "services")
)

$ImportFiles = @()

foreach ($Root in $SearchRoots) {

    if (Test-Path -LiteralPath $Root -PathType Container) {

        $ImportFiles += Get-ChildItem `
            -LiteralPath $Root `
            -Recurse `
            -File `
            -Include *.ts,*.tsx `
            -Force
    }
}

foreach ($File in $ImportFiles) {

    $Text = [System.IO.File]::ReadAllText($File.FullName)

    $Original = $Text

    $Text = $Text -replace "@/components/ui/Button", "@/components/ui/button"
    $Text = $Text -replace "@/components/ui/Input", "@/components/ui/input"
    $Text = $Text -replace "@/components/ui/Card", "@/components/ui/card"
    $Text = $Text -replace "@/components/ui/Badge", "@/components/ui/badge"

    $Text = $Text -replace '(["''])\./Button(["''])', '$1./button$2'
    $Text = $Text -replace '(["''])\./Input(["''])', '$1./input$2'
    $Text = $Text -replace '(["''])\./Card(["''])', '$1./card$2'
    $Text = $Text -replace '(["''])\./Badge(["''])', '$1./badge$2'

    if ($Text -ne $Original) {

        [System.IO.File]::WriteAllText(
            $File.FullName,
            $Text,
            (New-Object System.Text.UTF8Encoding($false))
        )

        Write-Host "  Updated $($File.FullName.Substring($ProjectRoot.Length + 1))" -ForegroundColor DarkGray
    }
}

Write-Host ""

# ------------------------------------------------------------
# 7. Repair UI barrel without inventing business logic
# ------------------------------------------------------------

Write-Host "STEP 5 - Repairing UI barrel" -ForegroundColor Magenta

$UiIndex = Join-Path $ProjectRoot "components\ui\index.ts"

if (Test-Path -LiteralPath $UiIndex -PathType Leaf) {

    $Text = [System.IO.File]::ReadAllText($UiIndex)

    $Text = $Text -replace 'from\s+["'']\.?/?Button["'']', 'from "./button"'
    $Text = $Text -replace 'from\s+["'']\.?/?Input["'']', 'from "./input"'
    $Text = $Text -replace 'from\s+["'']\.?/?Card["'']', 'from "./card"'
    $Text = $Text -replace 'from\s+["'']\.?/?Badge["'']', 'from "./badge"'

    [System.IO.File]::WriteAllText(
        $UiIndex,
        $Text,
        (New-Object System.Text.UTF8Encoding($false))
    )

    Write-Host "  UI barrel normalized." -ForegroundColor Green
}

Write-Host ""

# ------------------------------------------------------------
# 8. Repair root components barrel casing
# ------------------------------------------------------------

$ComponentsIndex = Join-Path $ProjectRoot "components\index.ts"

if (Test-Path -LiteralPath $ComponentsIndex -PathType Leaf) {

    Write-Host "STEP 6 - Normalizing components/index.ts" -ForegroundColor Magenta

    $Text = [System.IO.File]::ReadAllText($ComponentsIndex)

    $Text = $Text -replace '(["''])\./ui/Button(["''])', '$1./ui/button$2'
    $Text = $Text -replace '(["''])\./ui/Input(["''])', '$1./ui/input$2'
    $Text = $Text -replace '(["''])\./ui/Card(["''])', '$1./ui/card$2'
    $Text = $Text -replace '(["''])\./ui/Badge(["''])', '$1./ui/badge$2'

    [System.IO.File]::WriteAllText(
        $ComponentsIndex,
        $Text,
        (New-Object System.Text.UTF8Encoding($false))
    )
}

Write-Host ""

# ------------------------------------------------------------
# 9. Ensure tsconfig is root-authoritative
# ------------------------------------------------------------

Write-Host "STEP 7 - Checking tsconfig.json" -ForegroundColor Magenta

$TsConfigPath = Join-Path $ProjectRoot "tsconfig.json"

if (-not (Test-Path -LiteralPath $TsConfigPath -PathType Leaf)) {
    throw "tsconfig.json is missing."
}

$TsText = [System.IO.File]::ReadAllText($TsConfigPath)

# Remove src from explicit include if present.
$TsText = $TsText -replace '(?m)^\s*"src/\*\*"\s*,?\s*$', ''
$TsText = $TsText -replace '(?m)^\s*"src"\s*,?\s*$', ''

# Ensure root alias remains authoritative.
$TsText = $TsText -replace '"@\s*/\*"\s*:\s*\[\s*"[^"]*"\s*\]', '"@/*": ["./*"]'

[System.IO.File]::WriteAllText(
    $TsConfigPath,
    $TsText,
    (New-Object System.Text.UTF8Encoding($false))
)

Write-Host "  Root @ alias preserved." -ForegroundColor Green
Write-Host "  src is not promoted to the production alias root." -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------
# 10. Clear TypeScript / Next cache
# ------------------------------------------------------------

Write-Host "STEP 8 - Clearing generated caches" -ForegroundColor Magenta

$NextDir = Join-Path $ProjectRoot ".next"

if (Test-Path -LiteralPath $NextDir) {

    try {
        Remove-Item -LiteralPath $NextDir -Recurse -Force -ErrorAction Stop
        Write-Host "  .next removed." -ForegroundColor Green
    }
    catch {
        Write-Host "  WARNING: could not completely remove .next: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "  Continuing; this is a generated cache, not source." -ForegroundColor DarkGray
    }
}

Get-ChildItem -LiteralPath $ProjectRoot -Filter "*.tsbuildinfo" -File -Force -ErrorAction SilentlyContinue |
    ForEach-Object {
        try {
            Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop
            Write-Host "  Removed $($_.Name)" -ForegroundColor DarkGray
        }
        catch {
            Write-Host "  WARNING: could not remove $($_.Name)" -ForegroundColor Yellow
        }
    }

Write-Host ""

# ------------------------------------------------------------
# 11. Structural verification BEFORE TypeScript
# ------------------------------------------------------------

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " STRUCTURAL VERIFICATION" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$Required = @(
    "components\ui\button.tsx",
    "components\ui\input.tsx",
    "components\ui\card.tsx",
    "components\ui\badge.tsx",
    "providers",
    "services",
    "emails"
)

$Missing = @()

foreach ($Relative in $Required) {

    $Full = Join-Path $ProjectRoot $Relative

    if (Test-Path -LiteralPath $Full) {
        Write-Host "  PASS  $Relative" -ForegroundColor Green
    }
    else {
        Write-Host "  MISS  $Relative" -ForegroundColor Red
        $Missing += $Relative
    }
}

Write-Host ""

if ($Missing.Count -gt 0) {

    Write-Host "RECOVERY INCOMPLETE." -ForegroundColor Red
    Write-Host ""
    Write-Host "The following required structural paths are still missing:" -ForegroundColor Red

    foreach ($Item in $Missing) {
        Write-Host "  $Item" -ForegroundColor Red
    }

    Write-Host ""
    Write-Host "DO NOT DEPLOY." -ForegroundColor Red

    exit 2
}

# ------------------------------------------------------------
# 12. TypeScript gate
# ------------------------------------------------------------

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " TYPESCRIPT RECOVERY GATE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

npx tsc --noEmit

if ($LASTEXITCODE -ne 0) {

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host " TYPESCRIPT STILL FAILS" -ForegroundColor Red
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "DO NOT RUN THE BUILD." -ForegroundColor Red
    Write-Host "DO NOT DEPLOY." -ForegroundColor Red
    Write-Host ""
    Write-Host "Emergency backup:" -ForegroundColor Yellow
    Write-Host "  $EmergencyBackup" -ForegroundColor White

    exit 3
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " TYPESCRIPT RECOVERY PASSED" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "The application has passed the recovery TypeScript gate." -ForegroundColor Green
Write-Host ""
Write-Host "Next step is NOT another migration." -ForegroundColor Yellow
Write-Host "Run lint/build only after reviewing the recovered tree." -ForegroundColor Yellow
Write-Host ""
Write-Host "Emergency backup:" -ForegroundColor DarkGray
Write-Host "  $EmergencyBackup" -ForegroundColor White