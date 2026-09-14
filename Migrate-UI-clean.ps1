#requires -Version 5.1
<#
.SYNOPSIS
    Controlled, one-way migration of PRESENTATION COMPONENTS ONLY from a
    reference UI repository into the main Kitabu Yetu project.

.DESCRIPTION
    Direction:
        Reference UI -> Presentation components -> Main project

    PLAN mode is read-only with respect to the application source.
    APPLY mode creates a backup and Git checkpoint (when Git is available),
    then requires the user to type MIGRATE before files are overwritten.

    The hard denylist always wins and cannot be overridden by switches.
#>

[CmdletBinding()]
param(
    [string]$MainRoot = "D:\Claude\Projects\KITABU YETU\kitabuyetu",
    [string]$UIRoot   = "D:\Templates\Kitabu Yetu UI",

    [ValidateSet("Plan", "Apply")]
    [string]$Mode = "Plan",

    [switch]$ExcludeDesignSystem,

    [switch]$IncludeDashboardComponents,

    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ============================================================
# SAFETY: HARD DENYLIST — always wins
# ============================================================

$HardDenylistPatterns = @(
    '\\app\\api\\',
    '\\lib\\',
    '\\supabase\\',
    '\\middleware\.ts$',
    '\\next\.config\.',
    '\\vercel\.json$',
    '\\vercel\\',
    '\.env($|\.)',
    '\\package\.json$',
    '\\package-lock\.json$',
    '\\pnpm-lock\.yaml$',
    '\\yarn\.lock$',
    '\\tsconfig\.json$',
    '\\\.git\\',
    '\\\.optimization\\',
    'mpesa',
    '(^|\\)sms(\\|$|[^a-z])',
    'billing',
    'auth',
    'password-reset',
    'credential',
    'secret',
    'token'
)

$AllowedExtensions = @('.tsx', '.ts', '.jsx', '.js')

# ============================================================
# HELPERS
# ============================================================

function Write-Header {
    param([string]$Text)

    Write-Host ""
    Write-Host ("=" * 72) -ForegroundColor DarkGray
    Write-Host $Text -ForegroundColor Cyan
    Write-Host ("=" * 72) -ForegroundColor DarkGray
}

function Write-Step {
    param([string]$Text)

    Write-Host "[+] $Text" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Text)

    Write-Host "[!] $Text" -ForegroundColor Yellow
}

function Write-Fail {
    param([string]$Text)

    Write-Host "[X] $Text" -ForegroundColor Red
}

function Write-Block {
    param([string]$Text)

    Write-Host "[BLOCKED] $Text" -ForegroundColor DarkRed
}

function Ensure-Directory {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Save-Text {
    param(
        [string]$Path,
        [string]$Content
    )

    $parent = Split-Path -Parent $Path

    if (-not [string]::IsNullOrWhiteSpace($parent)) {
        Ensure-Directory $parent
    }

    $Content | Out-File -LiteralPath $Path -Encoding UTF8
}

function Get-NormalizedHash {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return "MISSING"
    }

    $text = Get-Content -LiteralPath $Path -Raw
    $text = $text -replace "`r`n", "`n"
    $text = $text -replace "`r", "`n"
    $text = $text -replace "(?m)[ \t]+$", ""

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    $sha = [System.Security.Cryptography.SHA256]::Create()

    try {
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLower()
    }
    finally {
        $sha.Dispose()
    }
}

function Test-CommandAvailable {
    param([string]$Name)

    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-Denylisted {
    param([string]$RelativePath)

    foreach ($pattern in $HardDenylistPatterns) {
        if ($RelativePath -match $pattern) {
            return $true
        }
    }

    return $false
}

# ============================================================
# VALIDATE ROOTS
# ============================================================

if (-not (Test-Path -LiteralPath $MainRoot -PathType Container)) {
    Write-Fail "MainRoot not found: $MainRoot"
    exit 1
}

if (-not (Test-Path -LiteralPath $UIRoot -PathType Container)) {
    Write-Fail "UIRoot not found: $UIRoot"
    exit 1
}

$RunTimestamp = Get-Date -Format "yyyyMMdd-HHmmss"

$MigrationRoot = Join-Path $MainRoot ".optimization\ui-migration-$RunTimestamp"
$BackupRoot = Join-Path $MigrationRoot "backup"
$ReportPath = Join-Path $MigrationRoot "MIGRATION-REPORT.json"
$ReportMdPath = Join-Path $MigrationRoot "MIGRATION-REPORT.md"

Ensure-Directory $MigrationRoot

# ============================================================
# BUILD CANDIDATE FILE LIST
# ============================================================

Write-Header "KITABU YETU — CONTROLLED UI MIGRATION ($Mode)"
Write-Host "Reference UI : $UIRoot"
Write-Host "Main project : $MainRoot"
Write-Host ""

$componentsRoot = Join-Path $UIRoot "src\components"

if (-not (Test-Path -LiteralPath $componentsRoot -PathType Container)) {
    Write-Fail "No src\components folder found under UIRoot — nothing to migrate."
    exit 1
}

$candidateFiles = @(
    Get-ChildItem -Path $componentsRoot -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $AllowedExtensions -contains $_.Extension.ToLowerInvariant() }
)

# Scope by subfolder switches.
$candidateFiles = @(
    $candidateFiles | Where-Object {
        $rel = $_.FullName.Substring($UIRoot.Length).TrimStart('\')

        $isDashboard = $rel -match '\\components\\dashboard\\'
        $isDesignSystem = $rel -match '\\components\\ui\\'

        if ($isDashboard -and -not $IncludeDashboardComponents) {
            return $false
        }

        if ($isDesignSystem -and $ExcludeDesignSystem) {
            return $false
        }

        return $true
    }
)

Write-Step "$($candidateFiles.Count) candidate presentation files found under src\components."

if ($IncludeDashboardComponents) {
    Write-Warn "Dashboard components included. Review the plan carefully because these may contain data wiring."
}

# ============================================================
# CLASSIFY FILES
# ============================================================

$results = @()

foreach ($file in $candidateFiles) {
    $relative = $file.FullName.Substring($UIRoot.Length).TrimStart('\')
    $mainPath = Join-Path $MainRoot $relative
    $uiPath = $file.FullName

    $denylisted = (Test-Denylisted $relative) -or (Test-Denylisted $mainPath)

    $mainHash = Get-NormalizedHash $mainPath
    $uiHash = Get-NormalizedHash $uiPath

    if ($denylisted) {
        $status = "BLOCKED"
    }
    elseif ($mainHash -eq "MISSING") {
        $status = "NEW (UI only)"
    }
    elseif ($mainHash -eq $uiHash) {
        $status = "IDENTICAL"
    }
    else {
        $status = "DIFFERENT"
    }

    $results += [PSCustomObject]@{
        RelativePath = $relative
        Status       = $status
        MainHash     = $mainHash
        UIHash       = $uiHash
        MainPath     = $mainPath
        UIPath       = $uiPath
    }
}

$toMigrate = @(
    $results | Where-Object {
        $_.Status -eq "DIFFERENT" -or $_.Status -eq "NEW (UI only)"
    }
)

$blocked = @(
    $results | Where-Object { $_.Status -eq "BLOCKED" }
)

$identical = @(
    $results | Where-Object { $_.Status -eq "IDENTICAL" }
)

# ============================================================
# DISPLAY SUMMARY
# ============================================================

Write-Header "CLASSIFICATION SUMMARY"

if ($results.Count -eq 0) {
    Write-Warn "No eligible presentation files were found."
}
else {
    $results |
        Group-Object Status |
        Select-Object Name, Count |
        Format-Table -AutoSize
}

if ($blocked.Count -gt 0) {
    Write-Host ""
    Write-Block "$($blocked.Count) file(s) matched the hard denylist and will NEVER be touched:"
    $blocked | ForEach-Object {
        Write-Host "    $($_.RelativePath)" -ForegroundColor DarkRed
    }
}

if ($toMigrate.Count -gt 0) {
    Write-Host ""
    Write-Host "Files that WOULD change ($($toMigrate.Count)):" -ForegroundColor Yellow
    $toMigrate |
        Select-Object Status, RelativePath |
        Format-Table -AutoSize
}
else {
    Write-Host ""
    Write-Step "No presentation files differ. Nothing to migrate."
}

# ============================================================
# WRITE REPORT
# ============================================================

$reportObject = [ordered]@{
    Timestamp = (Get-Date).ToString("o")
    Mode = $Mode
    MainRoot = $MainRoot
    UIRoot = $UIRoot

    Summary = [ordered]@{
        Total = $results.Count
        Identical = $identical.Count
        ToMigrate = $toMigrate.Count
        Blocked = $blocked.Count
    }

    Blocked = @(
        $blocked | Select-Object RelativePath
    )

    ToMigrate = @(
        $toMigrate | Select-Object RelativePath, Status
    )

    AllResults = @(
        $results | Select-Object RelativePath, Status, MainHash, UIHash
    )
}

$reportJson = $reportObject | ConvertTo-Json -Depth 6
Save-Text $ReportPath $reportJson

# Build Markdown without a PowerShell here-string so the report
# cannot interfere with PowerShell parsing.
$mdLines = New-Object System.Collections.Generic.List[string]

[void]$mdLines.Add("# UI Migration Report — $RunTimestamp")
[void]$mdLines.Add("")
[void]$mdLines.Add("Mode: **$Mode**")
[void]$mdLines.Add("Reference UI: $UIRoot")
[void]$mdLines.Add("Main project: $MainRoot")
[void]$mdLines.Add("")
[void]$mdLines.Add("## Summary")
[void]$mdLines.Add("")
[void]$mdLines.Add("| Total scanned | Identical | To migrate | Blocked (never touched) |")
[void]$mdLines.Add("|---|---|---|---|")
[void]$mdLines.Add("| $($results.Count) | $($identical.Count) | $($toMigrate.Count) | $($blocked.Count) |")
[void]$mdLines.Add("")
[void]$mdLines.Add("## Files that would change")
[void]$mdLines.Add("")

if ($toMigrate.Count -eq 0) {
    [void]$mdLines.Add("_None._")
}
else {
    foreach ($item in $toMigrate) {
        [void]$mdLines.Add("- ``$($item.RelativePath)`` — $($item.Status)")
    }
}

[void]$mdLines.Add("")
[void]$mdLines.Add("## Blocked by hard denylist (never touched, any mode)")
[void]$mdLines.Add("")

if ($blocked.Count -eq 0) {
    [void]$mdLines.Add("_None matched._")
}
else {
    foreach ($item in $blocked) {
        [void]$mdLines.Add("- ``$($item.RelativePath)``")
    }
}

$md = $mdLines -join [Environment]::NewLine
Save-Text $ReportMdPath $md

Write-Host ""
Write-Step "Report written to:"
Write-Host "  $ReportPath"
Write-Host "  $ReportMdPath"

# ============================================================
# PLAN MODE
# ============================================================

if ($Mode -eq "Plan") {
    Write-Host ""
    Write-Host "This was a PLAN run — no application files were changed." -ForegroundColor Cyan
    Write-Host "Review the report, then re-run with -Mode Apply when ready." -ForegroundColor Cyan
    exit 0
}

# ============================================================
# APPLY MODE
# ============================================================

if ($toMigrate.Count -eq 0) {
    Write-Host ""
    Write-Step "Nothing to migrate. Exiting without changes."
    exit 0
}

Write-Header "APPLY: PRE-FLIGHT CHECKS"

$checkpointTag = $null

if (Test-CommandAvailable "git") {
    Push-Location $MainRoot

    try {
        $gitStatus = (git status --short 2>&1 | Out-String).Trim()

        if (-not [string]::IsNullOrWhiteSpace($gitStatus)) {
            Write-Warn "Main project working tree has uncommitted changes:"
            Write-Host $gitStatus

            if (-not $Force) {
                Write-Fail "Refusing to proceed. Commit/stash your changes first, or use -Force if you understand the risk."
                exit 1
            }

            Write-Warn "-Force supplied — existing changes will NOT be discarded."
        }

        $checkpointTag = "ui-migration-before-$RunTimestamp"

        git tag $checkpointTag 2>&1 | Out-Null

        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Git checkpoint could not be created. Continuing with file backup."
            $checkpointTag = $null
        }
        else {
            Write-Step "Git checkpoint created: $checkpointTag"
        }
    }
    finally {
        Pop-Location
    }
}
else {
    Write-Warn "Git is not available. Proceeding with file backup only."
}

Write-Host ""
Write-Warn "The following $($toMigrate.Count) file(s) will be backed up, then overwritten in Main:"
$toMigrate |
    Select-Object Status, RelativePath |
    Format-Table -AutoSize

Write-Host ""
$confirmation = Read-Host "Type MIGRATE to proceed"

if ($confirmation -cne "MIGRATE") {
    Write-Warn "Migration cancelled. No application files were changed."
    exit 0
}

Write-Header "APPLYING MIGRATION"

$applied = @()

foreach ($item in $toMigrate) {
    # Defense in depth: check denylist again immediately before writing.
    if (Test-Denylisted $item.RelativePath -or Test-Denylisted $item.MainPath) {
        Write-Block "Skipping at write time because it matched the denylist: $($item.RelativePath)"
        continue
    }

    $mainPath = $item.MainPath
    $backupPath = Join-Path $BackupRoot $item.RelativePath

    if (Test-Path -LiteralPath $mainPath) {
        Ensure-Directory (Split-Path -Parent $backupPath)
        Copy-Item -LiteralPath $mainPath -Destination $backupPath -Force
    }

    Ensure-Directory (Split-Path -Parent $mainPath)
    Copy-Item -LiteralPath $item.UIPath -Destination $mainPath -Force

    Write-Step "Migrated: $($item.RelativePath)"

    $applied += [PSCustomObject]@{
        RelativePath = $item.RelativePath
        Status = $item.Status
        BackedUpTo = if (Test-Path -LiteralPath $backupPath) {
            $backupPath
        }
        else {
            $null
        }
    }
}

$appliedPath = Join-Path $MigrationRoot "APPLIED.json"

$applied |
    ConvertTo-Json -Depth 4 |
    Out-File -LiteralPath $appliedPath -Encoding UTF8

# ============================================================
# COMPLETE
# ============================================================

Write-Header "MIGRATION COMPLETE"
Write-Host "Files changed : $($applied.Count)"
Write-Host "Backups       : $BackupRoot"
Write-Host "Report        : $ReportMdPath"

if ($null -ne $checkpointTag) {
    Write-Host "Rollback tag  : $checkpointTag"
    Write-Host "Rollback      : git reset --hard $checkpointTag"
}

Write-Host ""
Write-Warn "Next step: run .\Optimize.ps1 -Mode Verify to confirm lint/typecheck/build still pass."
