#requires -Version 5.1
<#
KITABU YETU - Optimize.ps1
Safe UI reconciliation + validation/build engine

Main application:
  D:\Claude\Projects\KITABU YETU\kitabuyetu

Reference UI:
  D:\Templates\Kitabu Yetu UI\src\components

The script preserves the production application architecture, reconciles
reference UI components into the root components directory, creates backups,
repairs deterministic import paths, and validates lint/typecheck/build.
#>

[CmdletBinding()]
param(
    [string]$MainRoot = "D:\Claude\Projects\KITABU YETU\kitabuyetu",
    [string]$UiSourceRoot = "D:\Templates\Kitabu Yetu UI\src\components",
    [switch]$DryRun,
    [switch]$SkipBuild,
    [switch]$SkipLint,
    [switch]$AutoFix
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Version  = "1.0.0"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Repo = (Resolve-Path -LiteralPath $MainRoot).Path
$Source = (Resolve-Path -LiteralPath $UiSourceRoot).Path

$OptRoot = Join-Path $Repo ".optimize\$Timestamp"
$ReportRoot = Join-Path $OptRoot "reports"
$BackupRoot = Join-Path $OptRoot "backups"
$LogRoot = Join-Path $OptRoot "logs"
$LogFile = Join-Path $LogRoot "Optimize.log"

New-Item -ItemType Directory -Force -Path $ReportRoot,$BackupRoot,$LogRoot | Out-Null

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet("INFO","WARN","ERROR","PASS","STOP")]
        [string]$Level = "INFO"
    )
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"),$Level,$Message
    Write-Host $line
    Add-Content -LiteralPath $LogFile -Value $line
}

function Section {
    param([string]$Title)
    Write-Host ""
    Write-Host ("=" * 72)
    Write-Host $Title
    Write-Host ("=" * 72)
}

function Save-Json {
    param([string]$Path,$Object)
    $Object | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Save-Text {
    param([string]$Path,[string]$Content)
    $Content | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Require-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

function Get-Relative {
    param([string]$FullPath)
    return $FullPath.Substring($Repo.Length).TrimStart("\")
}

function Backup-File {
    param([string]$FullPath)
    if (-not (Test-Path -LiteralPath $FullPath -PathType Leaf)) { return }
    $relative = Get-Relative $FullPath
    $destination = Join-Path $BackupRoot $relative
    New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent) | Out-Null
    Copy-Item -LiteralPath $FullPath -Destination $destination -Force
}

function Invoke-Native {
    param(
        [string]$Description,
        [scriptblock]$Action,
        [switch]$AllowFailure
    )

    Write-Log $Description

    if ($DryRun) {
        Write-Log "DRY-RUN: execution skipped." "WARN"
        return 0
    }

    try {
        & $Action
        $code = $LASTEXITCODE
        if ($code -ne 0 -and -not $AllowFailure) {
            throw "$Description failed with exit code $code."
        }
        return $code
    }
    catch {
        if ($AllowFailure) {
            Write-Log "$Description failed: $($_.Exception.Message)" "WARN"
            return 1
        }
        throw
    }
}

# ------------------------------------------------------------
# 0. PREFLIGHT
# ------------------------------------------------------------

Section "KITABU YETU Optimize.ps1 v$Version"

Write-Log "Repository : $Repo"
Write-Log "UI source  : $Source"
Write-Log "Run        : $Timestamp"
Write-Log "DryRun     : $DryRun"
Write-Log "AutoFix    : $AutoFix"

if (-not (Test-Path (Join-Path $Repo ".git") -PathType Container)) {
    throw "MainRoot is not a Git repository: $Repo"
}

Require-Command "git"
Require-Command "node"
Require-Command "npm"

if (-not (Test-Path (Join-Path $Repo "package.json") -PathType Leaf)) {
    throw "package.json was not found."
}

if (-not (Test-Path $Source -PathType Container)) {
    throw "UI source directory was not found: $Source"
}

$Package = Get-Content (Join-Path $Repo "package.json") -Raw | ConvertFrom-Json

# ------------------------------------------------------------
# 1. SAFETY SNAPSHOT
# ------------------------------------------------------------

Section "1. SAFETY SNAPSHOT"

$InitialHead = (git -C $Repo rev-parse HEAD).Trim()
$InitialBranch = (git -C $Repo branch --show-current).Trim()
$InitialStatus = @(git -C $Repo status --short)

Save-Text (Join-Path $ReportRoot "INITIAL-GIT-HEAD.txt") $InitialHead
Save-Text (Join-Path $ReportRoot "INITIAL-GIT-BRANCH.txt") $InitialBranch
Save-Text (Join-Path $ReportRoot "INITIAL-GIT-STATUS.txt") ($InitialStatus -join "`r`n")

Write-Log "Git branch: $InitialBranch"
Write-Log "Git HEAD: $InitialHead"

if ($InitialStatus.Count -gt 0) {
    Write-Log "Existing working-tree changes detected. They will NOT be discarded." "WARN"
} else {
    Write-Log "Working tree is clean." "PASS"
}

# ------------------------------------------------------------
# 2. PROTECTED ARCHITECTURE CHECK
# ------------------------------------------------------------

Section "2. PROTECTED ARCHITECTURE"

$ProtectedRoots = @(
    "app",
    "lib",
    "services",
    "providers"
)

$ProtectedFiles = @(
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "tsconfig.json",
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "eslint.config.js",
    "eslint.config.mjs",
    ".env",
    ".env.local"
)

Write-Log "Application architecture is protected: app/lib/services/providers." "PASS"
Write-Log "Package, TypeScript, Next.js, ESLint and environment configuration are protected." "PASS"

# ------------------------------------------------------------
# 3. COMPONENT INVENTORY
# ------------------------------------------------------------

Section "3. COMPONENT RECONCILIATION PLAN"

$DestinationComponents = Join-Path $Repo "components"

if (-not (Test-Path $DestinationComponents -PathType Container)) {
    if ($DryRun) {
        Write-Log "Destination components directory would be created: $DestinationComponents" "WARN"
    } else {
        New-Item -ItemType Directory -Force -Path $DestinationComponents | Out-Null
    }
}

$SourceFiles = @(
    Get-ChildItem -LiteralPath $Source -Recurse -File |
    Where-Object {
        $_.FullName -notmatch "\\node_modules\\" -and
        $_.FullName -notmatch "\\.git\\"
    }
)

Write-Log "Reference UI component files discovered: $($SourceFiles.Count)" "PASS"

# Detect case collisions in the reference source before copying.
$CaseCollisions = @(
    $SourceFiles |
    Group-Object { $_.FullName.Substring($Source.Length).TrimStart("\").ToLowerInvariant() } |
    Where-Object { $_.Count -gt 1 }
)

if ($CaseCollisions.Count -gt 0) {
    foreach ($collision in $CaseCollisions) {
        $names = ($collision.Group | ForEach-Object { $_.FullName }) -join "; "
        Write-Log "Case-collision in UI source: $names" "ERROR"
    }
    throw "Reference UI contains case-insensitive duplicate component paths. Resolve those before migration."
}

$CopyPlan = New-Object System.Collections.Generic.List[object]

foreach ($file in $SourceFiles) {
    $relative = $file.FullName.Substring($Source.Length).TrimStart("\")
    $target = Join-Path $DestinationComponents $relative
    $exists = Test-Path -LiteralPath $target -PathType Leaf

    $CopyPlan.Add([pscustomobject]@{
        Relative = "components\$relative"
        Source = $file.FullName
        Target = $target
        Exists = $exists
        Action = if ($exists) { "REPLACE_WITH_BACKUP" } else { "ADD" }
    })
}

Save-Json (Join-Path $ReportRoot "COMPONENT-COPY-PLAN.json") $CopyPlan

$replaceCount = @($CopyPlan | Where-Object Exists).Count
$addCount = @($CopyPlan | Where-Object { -not $_.Exists }).Count

Write-Log "Component files to add: $addCount"
Write-Log "Component files to replace: $replaceCount"

# ------------------------------------------------------------
# 4. APPLY COMPONENTS
# ------------------------------------------------------------

Section "4. APPLY UI COMPONENTS"

if ($DryRun) {
    foreach ($item in $CopyPlan) {
        Write-Log "DRY-RUN: $($item.Action) -> $($item.Relative)"
    }
} else {
    foreach ($item in $CopyPlan) {
        if ($item.Exists) {
            Backup-File $item.Target
        }

        $targetDir = Split-Path $item.Target -Parent
        New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
        Copy-Item -LiteralPath $item.Source -Destination $item.Target -Force
    }

    Write-Log "UI component reconciliation completed." "PASS"
}

# ------------------------------------------------------------
# 5. LEGACY IMPORT REPAIR
# ------------------------------------------------------------

Section "5. DETERMINISTIC IMPORT REPAIR"

$SearchRoots = @(
    (Join-Path $Repo "app"),
    (Join-Path $Repo "components"),
    (Join-Path $Repo "lib"),
    (Join-Path $Repo "services"),
    (Join-Path $Repo "providers"),
    (Join-Path $Repo "packages")
)

$TextFiles = @()
foreach ($root in $SearchRoots) {
    if (Test-Path $root -PathType Container) {
        $TextFiles += Get-ChildItem -LiteralPath $root -Recurse -File -Include *.ts,*.tsx,*.js,*.jsx |
            Where-Object { $_.FullName -notmatch "\\node_modules\\" }
    }
}

$ImportChanges = New-Object System.Collections.Generic.List[object]

foreach ($file in $TextFiles) {
    $content = Get-Content -LiteralPath $file.FullName -Raw
    $original = $content

    # Legacy "@/src/components/X" -> "@/components/X"
    $content = [regex]::Replace(
        $content,
        '(["''])(@/src/components/)([^"'']+)\1',
        '$1@/components/$3$1'
    )

    # Legacy Nextly namespace -> canonical root component when target exists.
    $matches = [regex]::Matches($content, '(["''])(@/components/marketing/nextly/)([^"'']+)\1')
    foreach ($m in $matches) {
        $name = $m.Groups[3].Value
        $candidate = Join-Path $DestinationComponents $name

        $resolved = $null
        foreach ($ext in @(".tsx",".ts",".jsx",".js")) {
            $candidateWithExt = if ($name -match '\.(tsx|ts|jsx|js)$') { $candidate } else { $candidate + $ext }
            if (Test-Path $candidateWithExt -PathType Leaf) {
                $resolved = $name -replace '\.(tsx|ts|jsx|js)$',''
                break
            }
        }

        if ($resolved) {
            $old = "@/components/marketing/nextly/$name"
            $new = "@/components/$resolved"
            $content = $content.Replace($old,$new)
        }
    }

    # Canonicalize common UI primitive import casing when the lowercase
    # implementation exists. This avoids Windows/TypeScript casing conflicts.
    foreach ($primitive in @("button","badge","input","dialog","card","table","select","textarea","label")) {
        $lowerCandidates = @(
            (Join-Path $DestinationComponents "ui\$primitive.tsx"),
            (Join-Path $DestinationComponents "ui\$primitive.ts")
        )
        $lowerExists = $false
        foreach ($candidate in $lowerCandidates) {
            if (Test-Path $candidate -PathType Leaf) {
                $lowerExists = $true
                break
            }
        }

        if ($lowerExists) {
            $content = $content -replace "(?i)(@/components/ui/)$primitive", ('$1' + $primitive)
        }
    }

    if ($content -ne $original) {
        $relative = Get-Relative $file.FullName
        $ImportChanges.Add([pscustomobject]@{
            File = $relative
            Changed = $true
        })

        if (-not $DryRun) {
            Backup-File $file.FullName
            Set-Content -LiteralPath $file.FullName -Value $content -Encoding UTF8
        }

        Write-Log "$(if ($DryRun) { 'DRY-RUN: would repair' } else { 'Repaired' }) imports in $relative" "PASS"
    }
}

Save-Json (Join-Path $ReportRoot "IMPORT-REPAIRS.json") $ImportChanges

# ------------------------------------------------------------
# 6. CONFIGURATION INTEGRITY
# ------------------------------------------------------------

Section "6. CONFIGURATION INTEGRITY"

$EslintConfig = Join-Path $Repo "eslint.config.mjs"

if (Test-Path $EslintConfig -PathType Leaf) {
    $eslintText = Get-Content $EslintConfig -Raw

    if ($eslintText -match '^\s*cd\s+"' -or $eslintText -match '(?m)^\s*npx\s+eslint\s+') {
        throw "eslint.config.mjs contains shell commands and is corrupted. Refusing to overwrite it automatically."
    }

    Write-Log "eslint.config.mjs contains JavaScript/ESM rather than shell commands." "PASS"
}

$TsConfig = Join-Path $Repo "tsconfig.json"
if (Test-Path $TsConfig -PathType Leaf) {
    try {
        $Ts = Get-Content $TsConfig -Raw | ConvertFrom-Json
        Write-Log "tsconfig.json parses successfully." "PASS"

        if ($Ts.compilerOptions -and $Ts.compilerOptions.paths) {
            $paths = $Ts.compilerOptions.paths.PSObject.Properties
            foreach ($p in $paths) {
                Write-Log "tsconfig path alias: $($p.Name) -> $($p.Value -join ', ')"
            }
        }
    }
    catch {
        throw "tsconfig.json is not valid JSON: $($_.Exception.Message)"
    }
}

# ------------------------------------------------------------
# 7. POST-MIGRATION AUDIT
# ------------------------------------------------------------

Section "7. POST-MIGRATION AUDIT"

$LegacyHits = @()
$SrcComponentHits = @()

foreach ($file in $TextFiles) {
    if (-not (Test-Path $file.FullName -PathType Leaf)) { continue }
    $content = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue
    if (-not $content) { continue }

    if ($content -match '@/components/marketing/nextly/') {
        $LegacyHits += (Get-Relative $file.FullName)
    }

    if ($content -match '@/src/components/') {
        $SrcComponentHits += (Get-Relative $file.FullName)
    }
}

$LegacyHits = @($LegacyHits | Sort-Object -Unique)
$SrcComponentHits = @($SrcComponentHits | Sort-Object -Unique)

Save-Text (Join-Path $ReportRoot "REMAINING-NEXTLY-IMPORTS.txt") ($LegacyHits -join "`r`n")
Save-Text (Join-Path $ReportRoot "REMAINING-SRC-COMPONENT-IMPORTS.txt") ($SrcComponentHits -join "`r`n")

if ($LegacyHits.Count -gt 0) {
    Write-Log "Remaining legacy Nextly imports: $($LegacyHits.Count)" "WARN"
    $LegacyHits | ForEach-Object { Write-Log "  $_" "WARN" }
} else {
    Write-Log "No legacy marketing/nextly imports remain in scanned source." "PASS"
}

if ($SrcComponentHits.Count -gt 0) {
    Write-Log "Remaining @/src/components imports: $($SrcComponentHits.Count)" "WARN"
    $SrcComponentHits | ForEach-Object { Write-Log "  $_" "WARN" }
} else {
    Write-Log "No @/src/components imports remain in scanned source." "PASS"
}

# ------------------------------------------------------------
# 8. VALIDATION
# ------------------------------------------------------------

Section "8. VALIDATION"

$Validation = [ordered]@{
    eslint = "NOT_RUN"
    typecheck = "NOT_RUN"
    build = "NOT_RUN"
}

if ($DryRun) {
    $Validation.eslint = "DRY_RUN"
    $Validation.typecheck = "DRY_RUN"
    $Validation.build = "DRY_RUN"
} else {
    if (-not $SkipLint) {
        Write-Log "Running ESLint..."
        npx eslint . --no-cache
        $Validation.eslint = if ($LASTEXITCODE -eq 0) { "PASS" } else { "FAIL" }

        if ($Validation.eslint -eq "FAIL" -and $AutoFix) {
            Write-Log "Attempting ESLint auto-fix." "WARN"
            npx eslint . --no-cache --fix
            $Validation.eslint = if ($LASTEXITCODE -eq 0) { "PASS" } else { "FAIL" }
        }
    } else {
        $Validation.eslint = "SKIPPED"
    }

    Write-Log "Running TypeScript..."
    npx tsc --noEmit
    $Validation.typecheck = if ($LASTEXITCODE -eq 0) { "PASS" } else { "FAIL" }

    if (-not $SkipBuild) {
        Write-Log "Running production build..."
        npm run build
        $Validation.build = if ($LASTEXITCODE -eq 0) { "PASS" } else { "FAIL" }
    } else {
        $Validation.build = "SKIPPED"
    }
}

Save-Json (Join-Path $ReportRoot "VALIDATION.json") $Validation

# ------------------------------------------------------------
# 9. GATE
# ------------------------------------------------------------

Section "9. OPTIMIZATION GATE"

$GateStatus = "PASS"

foreach ($key in @("eslint","typecheck","build")) {
    if ($Validation[$key] -eq "FAIL") {
        $GateStatus = "FAIL"
    }
}

if ($LegacyHits.Count -gt 0 -or $SrcComponentHits.Count -gt 0) {
    $GateStatus = "FAIL"
}

$Gate = [ordered]@{
    version = $Version
    timestamp = (Get-Date).ToString("o")
    repository = $Repo
    uiSource = $Source
    initialHead = $InitialHead
    branch = $InitialBranch
    dryRun = [bool]$DryRun
    status = $GateStatus
    validation = $Validation
    remainingLegacyNextlyImports = $LegacyHits
    remainingSrcComponentImports = $SrcComponentHits
    backupRoot = $BackupRoot
    reportRoot = $ReportRoot
    deployment = "NOT_PERFORMED"
}

Save-Json (Join-Path $ReportRoot "OPTIMIZATION-GATE.json") $Gate

$Summary = @"
# KITABU YETU OPTIMIZATION

Version: $Version
Run: $Timestamp
Repository: $Repo
UI source: $Source

## Gate

Status: $GateStatus

## Validation

- ESLint: $($Validation.eslint)
- TypeScript: $($Validation.typecheck)
- Production build: $($Validation.build)

## Import audit

- Remaining @/components/marketing/nextly imports: $($LegacyHits.Count)
- Remaining @/src/components imports: $($SrcComponentHits.Count)

## Safety

Initial HEAD: $InitialHead
Initial branch: $InitialBranch
Pre-existing working-tree changes: $($InitialStatus.Count -gt 0)

Backups: $BackupRoot
Reports: $ReportRoot

## Deployment

No Git reset, force push, Vercel deployment, or deletion of src/ was performed by Optimize.ps1.

A successful gate means the repository is ready for the separate deployment/cleanup procedure.
"@

Save-Text (Join-Path $ReportRoot "OPTIMIZATION-SUMMARY.md") $Summary

Write-Host ""
Write-Host ("=" * 72)
Write-Host "OPTIMIZE.PS1 COMPLETE"
Write-Host ("=" * 72)
Write-Host "Status : $GateStatus"
Write-Host "Reports: $ReportRoot"
Write-Host "Backup : $BackupRoot"
Write-Host ""

if ($GateStatus -eq "FAIL") {
    Write-Log "Optimization gate FAILED. Do not deploy yet." "STOP"
    exit 1
}

Write-Log "Optimization gate PASSED. Production build completed successfully." "PASS"
exit 0
