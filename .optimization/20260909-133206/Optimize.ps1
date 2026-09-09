#requires -Version 5.1
<#
.SYNOPSIS
    PowerShell-only project optimization workflow.

.DESCRIPTION
    Scans an existing project, discovers prior audits and Claude context,
    captures Git/dependency/framework/infrastructure information, creates
    a ChatGPT-ready optimization package, and can safely apply a reviewed
    PowerShell command file.

    NO Claude Code subscription or CLI is required.

WORKFLOW
    1. .\Optimize.ps1 -Scan
    2. Review .optimization\<run>\CHATGPT-PROMPT.md
    3. Give the generated package/report to ChatGPT
    4. Ask ChatGPT to return a reviewed OPTIMIZATION-COMMAND.ps1
    5. Put that command file in the run folder
    6. .\Optimize.ps1 -ApplyCommand -CommandFile .\path\OPTIMIZATION-COMMAND.ps1
    7. .\Optimize.ps1 -Verify

SAFETY
    - Never copies .env values into reports.
    - Creates a Git checkpoint before applying changes.
    - Creates a file backup before applying a command file.
    - Refuses to execute commands that look like destructive or secret-exfiltration
      commands unless -AllowRiskyCommands is explicitly supplied.
#>

[CmdletBinding()]
param(
    [ValidateSet("Scan","Verify")]
    [string]$Mode = "Scan",

    [switch]$ApplyCommand,

    [string]$CommandFile,

    [switch]$AllowRiskyCommands,

    [switch]$SkipGitCheckpoint,

    [switch]$SkipDependencyAudit,

    [switch]$SkipBuild,

    [switch]$OpenReport
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

# ============================================================
# PATHS
# ============================================================

$ProjectRoot = (Get-Location).Path
$OptimizationRoot = Join-Path $ProjectRoot ".optimization"
$RunTimestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$RunRoot = Join-Path $OptimizationRoot $RunTimestamp

$AuditRoot = Join-Path $RunRoot "audits"
$ContextRoot = Join-Path $RunRoot "context"
$DependencyRoot = Join-Path $RunRoot "dependencies"
$FrameworkRoot = Join-Path $RunRoot "framework"
$GitRoot = Join-Path $RunRoot "git"
$ReportsRoot = Join-Path $RunRoot "reports"
$BackupRoot = Join-Path $RunRoot "backup"

$ManifestPath = Join-Path $RunRoot "MANIFEST.json"
$PromptPath = Join-Path $RunRoot "CHATGPT-PROMPT.md"
$CommandTemplatePath = Join-Path $RunRoot "OPTIMIZATION-COMMAND.template.ps1"

$ExcludedDirectories = @(
    "node_modules",
    ".git",
    ".next",
    ".vercel",
    "dist",
    "build",
    ".optimization",
    "coverage",
    ".turbo",
    ".cache"
)

$SensitiveNamePatterns = @(
    "^\.env($|\.)",
    "secret",
    "credential",
    "password",
    "token",
    "private[-_]?key"
)

$AuditNamePatterns = @(
    "audit",
    "optimization",
    "performance",
    "security",
    "review",
    "benchmark",
    "analysis",
    "technical[-_ ]?debt",
    "lighthouse",
    "architecture",
    "findings",
    "recommendations"
)

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
    Ensure-Directory $parent
    $Content | Out-File -LiteralPath $Path -Encoding UTF8
}

function Relative-PathSafe {
    param([string]$FullPath)
    if ($FullPath.StartsWith($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $FullPath.Substring($ProjectRoot.Length).TrimStart('\','/')
    }
    return $FullPath
}

function Is-ExcludedPath {
    param([string]$Path)

    foreach ($dir in $ExcludedDirectories) {
        $escaped = [regex]::Escape($dir)
        if ($Path -match "(^|[\\/])$escaped([\\/]|$)") {
            return $true
        }
    }
    return $false
}

function Test-CommandAvailable {
    param([string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Capture {
    param(
        [string]$Command,
        [string[]]$Arguments = @(),
        [string]$OutputPath
    )

    try {
        $output = & $Command @Arguments 2>&1
        ($output | Out-String) | Out-File -LiteralPath $OutputPath -Encoding UTF8
        return $LASTEXITCODE
    }
    catch {
        $_ | Out-String | Out-File -LiteralPath $OutputPath -Encoding UTF8
        return 1
    }
}

function Get-FileSha256 {
    param([string]$Path)
    try {
        return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    }
    catch {
        return $null
    }
}

function Copy-SafeBackup {
    param([string]$Source)

    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        return
    }

    $relative = Relative-PathSafe $Source
    $destination = Join-Path $BackupRoot $relative
    Ensure-Directory (Split-Path -Parent $destination)

    Copy-Item -LiteralPath $Source -Destination $destination -Force
}

function Test-RiskyCommand {
    param([string]$Text)

    $patterns = @(
        "Remove-Item\s+.*-Recurse",
        "Remove-Item\s+.*-Force",
        "rm\s+-rf",
        "rmdir\s+/s",
        "del\s+/s",
        "format\s+",
        "Stop-Computer",
        "Restart-Computer",
        "Invoke-WebRequest.*\|\s*iex",
        "Invoke-Expression",
        "iex\s*\(",
        "curl.*\|\s*iex",
        "wget.*\|\s*iex",
        "Set-ExecutionPolicy\s+Bypass",
        "Set-ExecutionPolicy\s+Unrestricted",
        "git\s+reset\s+--hard",
        "git\s+clean\s+-fd",
        "git\s+push\s+--force",
        "DROP\s+DATABASE",
        "DROP\s+TABLE",
        "TRUNCATE\s+TABLE",
        "DELETE\s+FROM\s+.*\s+WHERE\s+1\s*=\s*1",
        "process\.env\[[^\]]+\].*(Write|Out|Set|Add)",
        "Get-Content.*\.env",
        "cat\s+\.env",
        "type\s+\.env"
    )

    foreach ($pattern in $patterns) {
        if ($Text -match $pattern) {
            return $true
        }
    }

    return $false
}

function New-GitCheckpoint {
    if (-not (Test-CommandAvailable "git")) {
        Write-Warn "Git is not installed."
        return $null
    }

    $status = git status --short 2>&1
    $branch = git branch --show-current 2>&1
    $commit = git rev-parse HEAD 2>&1

    Save-Text (Join-Path $GitRoot "status-before.txt") ($status | Out-String)
    Save-Text (Join-Path $GitRoot "branch-before.txt") ($branch | Out-String)
    Save-Text (Join-Path $GitRoot "commit-before.txt") ($commit | Out-String)

    if (-not [string]::IsNullOrWhiteSpace(($status | Out-String))) {
        Write-Warn "Git working tree has existing changes. They will not be discarded."
    }

    $tag = "optimization-before-$RunTimestamp"

    try {
        git tag $tag 2>&1 | Out-File (Join-Path $GitRoot "checkpoint.txt") -Encoding UTF8
        Write-Step "Git checkpoint created: $tag"
        return $tag
    }
    catch {
        Write-Warn "Could not create Git tag. Existing files will still be backed up."
        return $null
    }
}

# ============================================================
# CREATE RUN DIRECTORIES
# ============================================================

Ensure-Directory $OptimizationRoot
Ensure-Directory $RunRoot
Ensure-Directory $AuditRoot
Ensure-Directory $ContextRoot
Ensure-Directory $DependencyRoot
Ensure-Directory $FrameworkRoot
Ensure-Directory $GitRoot
Ensure-Directory $ReportsRoot
Ensure-Directory $BackupRoot

# ============================================================
# VERIFY MODE
# ============================================================

if ($Mode -eq "Verify") {
    Write-Header "OPTIMIZATION VERIFICATION"

    if (-not (Test-Path $ProjectRoot)) {
        Write-Fail "Project root not found."
        exit 1
    }

    Write-Host "Project: $ProjectRoot"
    Write-Host ""

    $verification = [ordered]@{
        Timestamp = (Get-Date).ToString("o")
        Node = $false
        Npm = $false
        TypeScript = $false
        Lint = $false
        Build = $false
        Git = $false
        NpmAudit = $false
    }

    if (Test-CommandAvailable "node") {
        $verification.Node = $true
        node --version
    }

    if (Test-CommandAvailable "npm") {
        $verification.Npm = $true
        npm --version
    }

    if (Test-Path (Join-Path $ProjectRoot "package.json")) {
        Write-Step "package.json detected."

        if (Test-Path (Join-Path $ProjectRoot "tsconfig.json")) {
            Write-Step "Running TypeScript check..."
            $out = Join-Path $ReportsRoot "verify-typescript.txt"
            Invoke-Capture "npx" @("tsc","--noEmit") $out | Out-Null
            $verification.TypeScript = $LASTEXITCODE -eq 0
        }

        Write-Step "Running lint..."
        $lintOut = Join-Path $ReportsRoot "verify-lint.txt"
        Invoke-Capture "npm" @("run","lint") $lintOut | Out-Null
        $verification.Lint = $LASTEXITCODE -eq 0

        if (-not $SkipBuild) {
            Write-Step "Running production build..."
            $buildOut = Join-Path $ReportsRoot "verify-build.txt"
            Invoke-Capture "npm" @("run","build") $buildOut | Out-Null
            $verification.Build = $LASTEXITCODE -eq 0
        }

        if (-not $SkipDependencyAudit) {
            Write-Step "Running npm audit..."
            $auditOut = Join-Path $ReportsRoot "verify-npm-audit.json"
            Invoke-Capture "npm" @("audit","--json") $auditOut | Out-Null
            $verification.NpmAudit = $true
        }
    }

    if (Test-CommandAvailable "git") {
        $verification.Git = $true
        git status --short | Out-File (Join-Path $GitRoot "verify-status.txt") -Encoding UTF8
        git diff --stat | Out-File (Join-Path $GitRoot "verify-diff-stat.txt") -Encoding UTF8
    }

    $verification | ConvertTo-Json -Depth 5 |
        Out-File (Join-Path $ReportsRoot "VERIFICATION.json") -Encoding UTF8

    Write-Header "VERIFICATION COMPLETE"
    Write-Host "Reports: $ReportsRoot"
    exit 0
}

# ============================================================
# APPLY COMMAND FILE
# ============================================================

if ($ApplyCommand) {
    Write-Header "SAFE OPTIMIZATION COMMAND APPLICATION"

    if ([string]::IsNullOrWhiteSpace($CommandFile)) {
        Write-Fail "You must supply -CommandFile."
        Write-Host ""
        Write-Host 'Example:'
        Write-Host '.\Optimize.ps1 -ApplyCommand -CommandFile .\.optimization\RUN\OPTIMIZATION-COMMAND.ps1'
        exit 1
    }

    $resolvedCommandFile = Resolve-Path -LiteralPath $CommandFile -ErrorAction SilentlyContinue

    if (-not $resolvedCommandFile) {
        Write-Fail "Command file not found: $CommandFile"
        exit 1
    }

    $commandText = Get-Content -LiteralPath $resolvedCommandFile.Path -Raw

    if ($commandText -match '^\s*#\s*OPTIMIZATION-COMMAND-V1' -eq $false) {
        Write-Fail "Command file does not contain the required OPTIMIZATION-COMMAND-V1 header."
        exit 1
    }

    if ((Test-RiskyCommand $commandText) -and (-not $AllowRiskyCommands)) {
        Write-Fail "Potentially risky command detected."
        Write-Host "Review the command file manually."
        Write-Host "If intentionally approved, rerun with -AllowRiskyCommands."
        exit 1
    }

    Write-Warn "The following command file will be executed:"
    Write-Host $resolvedCommandFile.Path
    Write-Host ""

    $preview = Get-Content -LiteralPath $resolvedCommandFile.Path |
        Select-Object -First 120

    $preview | ForEach-Object {
        Write-Host $_ -ForegroundColor DarkGray
    }

    Write-Host ""
    $confirmation = Read-Host "Type APPLY to execute this command file"

    if ($confirmation -ne "APPLY") {
        Write-Warn "Operation cancelled."
        exit 0
    }

    # New run folder for the application operation
    $ApplyTimestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $ApplyRoot = Join-Path $OptimizationRoot "applied-$ApplyTimestamp"
    $ApplyBackup = Join-Path $ApplyRoot "backup"
    $ApplyReports = Join-Path $ApplyRoot "reports"

    Ensure-Directory $ApplyRoot
    Ensure-Directory $ApplyBackup
    Ensure-Directory $ApplyReports

    Write-Step "Creating Git checkpoint..."

    if (-not $SkipGitCheckpoint) {
        New-GitCheckpoint | Out-Null
    }

    Write-Step "Backing up tracked project files..."

    if (Test-CommandAvailable "git") {
        $trackedFiles = git ls-files 2>&1

        foreach ($relative in $trackedFiles) {
            $source = Join-Path $ProjectRoot $relative

            if (Test-Path -LiteralPath $source -PathType Leaf) {
                $destination = Join-Path $ApplyBackup $relative
                Ensure-Directory (Split-Path -Parent $destination)
                Copy-Item -LiteralPath $source -Destination $destination -Force
            }
        }
    }
    else {
        Write-Warn "Git unavailable; backing up common source files."

        Get-ChildItem -Path $ProjectRoot -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object {
                -not (Is-ExcludedPath $_.FullName)
            } |
            ForEach-Object {
                $relative = Relative-PathSafe $_.FullName
                $destination = Join-Path $ApplyBackup $relative
                Ensure-Directory (Split-Path -Parent $destination)
                Copy-Item $_.FullName $destination -Force
            }
    }

    Write-Step "Backup created: $ApplyBackup"

    Save-Text `
        (Join-Path $ApplyReports "command-executed.txt") `
        $resolvedCommandFile.Path

    try {
        & $resolvedCommandFile.Path 2>&1 |
            Tee-Object `
                -FilePath (Join-Path $ApplyReports "command-output.txt")

        $exitCode = $LASTEXITCODE

        Write-Host ""
        Write-Host "Command exit code: $exitCode"

        if ($exitCode -ne 0) {
            Write-Fail "Optimization command returned a non-zero exit code."
        }
        else {
            Write-Step "Optimization command completed."
        }
    }
    catch {
        $_ | Out-String |
            Out-File (Join-Path $ApplyReports "command-error.txt") -Encoding UTF8

        Write-Fail "Optimization command failed."
    }

    Write-Host ""
    Write-Host "Backup: $ApplyBackup"
    Write-Host "Reports: $ApplyReports"
    exit 0
}

# ============================================================
# SCAN
# ============================================================

Write-Header "POWERSELL OPTIMIZATION WORKFLOW V2"

Write-Host "Project root : $ProjectRoot"
Write-Host "Run          : $RunRoot"
Write-Host "Mode         : SCAN"
Write-Host ""
Write-Host "No Claude Code subscription or CLI is required." -ForegroundColor Green

# ------------------------------------------------------------
# Git
# ------------------------------------------------------------

Write-Header "1. GIT CHECKPOINT"

$gitInfo = [ordered]@{
    Available = Test-CommandAvailable "git"
    Branch = $null
    Commit = $null
    Status = $null
    Checkpoint = $null
}

if ($gitInfo.Available) {
    $gitInfo.Branch = (git branch --show-current 2>&1 | Out-String).Trim()
    $gitInfo.Commit = (git rev-parse HEAD 2>&1 | Out-String).Trim()
    $gitInfo.Status = (git status --short 2>&1 | Out-String).Trim()

    Save-Text (Join-Path $GitRoot "status.txt") $gitInfo.Status
    Save-Text (Join-Path $GitRoot "branch.txt") $gitInfo.Branch
    Save-Text (Join-Path $GitRoot "commit.txt") $gitInfo.Commit

    if (-not $SkipGitCheckpoint) {
        $gitInfo.Checkpoint = New-GitCheckpoint
    }
}
else {
    Write-Warn "Git not detected."
}

# ------------------------------------------------------------
# Project inventory
# ------------------------------------------------------------

Write-Header "2. PROJECT INVENTORY"

$allFiles = Get-ChildItem `
    -Path $ProjectRoot `
    -Recurse `
    -File `
    -ErrorAction SilentlyContinue |
    Where-Object {
        -not (Is-ExcludedPath $_.FullName)
    }

$inventory = foreach ($file in $allFiles) {

    $relative = Relative-PathSafe $file.FullName

    [pscustomobject]@{
        Path = $relative
        Extension = $file.Extension
        SizeBytes = $file.Length
        Modified = $file.LastWriteTime.ToString("o")
        SHA256 = if ($file.Length -lt 10MB) {
            Get-FileSha256 $file.FullName
        } else {
            $null
        }
    }
}

$inventory |
    ConvertTo-Json -Depth 5 |
    Out-File $ManifestPath -Encoding UTF8

$inventory |
    Export-Csv `
        -LiteralPath (Join-Path $ReportsRoot "project-inventory.csv") `
        -NoTypeInformation `
        -Encoding UTF8

Write-Step "$($inventory.Count) project files inventoried."

# ------------------------------------------------------------
# Audit discovery
# ------------------------------------------------------------

Write-Header "3. EXISTING AUDITS"

$auditFiles = $allFiles | Where-Object {

    $name = $_.Name.ToLowerInvariant()

    $isCandidateExtension = $_.Extension.ToLowerInvariant() -in @(
        ".md",".txt",".json",".html",".log",".csv",".xml",".yaml",".yml"
    )

    if (-not $isCandidateExtension) {
        return $false
    }

    foreach ($pattern in $AuditNamePatterns) {
        if ($name -match $pattern) {
            return $true
        }
    }

    return $false
}

$auditIndex = New-Object System.Collections.Generic.List[string]

foreach ($file in $auditFiles) {
    $relative = Relative-PathSafe $file.FullName
    $destination = Join-Path $AuditRoot ($relative -replace '[\\/:*?"<>|]', '_')

    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
    $auditIndex.Add($relative)

    Write-Host "  $relative"
}

Save-Text `
    (Join-Path $AuditRoot "INDEX.txt") `
    ($auditIndex -join [Environment]::NewLine)

Write-Step "$($auditFiles.Count) audit/review files found."

# ------------------------------------------------------------
# Claude / project context discovery
# ------------------------------------------------------------

Write-Header "4. CLAUDE / PROJECT CONTEXT"

$contextPatterns = @(
    "CLAUDE.md",
    "CLAUDE.*",
    "*claude*memory*",
    "*claude*context*",
    "*memory*.md",
    "*memory*.txt",
    "*architecture*.md",
    "*adr*.md",
    "*decision*.md",
    "*project-context*.md",
    "*technical-debt*.md"
)

$contextFiles = $allFiles | Where-Object {

    foreach ($pattern in $contextPatterns) {
        if ($_.Name -like $pattern) {
            return $true
        }
    }

    return $false
}

$contextIndex = New-Object System.Collections.Generic.List[string]

foreach ($file in $contextFiles) {
    $relative = Relative-PathSafe $file.FullName
    $destination = Join-Path $ContextRoot ($relative -replace '[\\/:*?"<>|]', '_')

    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
    $contextIndex.Add($relative)

    Write-Host "  $relative"
}

Save-Text `
    (Join-Path $ContextRoot "INDEX.txt") `
    ($contextIndex -join [Environment]::NewLine)

Write-Step "$($contextFiles.Count) Claude/project-context files found."

# ------------------------------------------------------------
# Package manager / dependencies
# ------------------------------------------------------------

Write-Header "5. DEPENDENCY ANALYSIS"

$packageJsonPath = Join-Path $ProjectRoot "package.json"
$packageLockPath = Join-Path $ProjectRoot "package-lock.json"
$pnpmLockPath = Join-Path $ProjectRoot "pnpm-lock.yaml"
$yarnLockPath = Join-Path $ProjectRoot "yarn.lock"

$dependencyInfo = [ordered]@{
    PackageJson = Test-Path $packageJsonPath
    PackageManager = $null
    NodeVersion = $null
    NpmVersion = $null
    DependencyAudit = $false
}

if (Test-Path $packageJsonPath) {

    Copy-Item $packageJsonPath `
        (Join-Path $DependencyRoot "package.json") `
        -Force

    if (Test-Path $packageLockPath) {
        $dependencyInfo.PackageManager = "npm"
        Copy-Item $packageLockPath `
            (Join-Path $DependencyRoot "package-lock.json") `
            -Force
    }
    elseif (Test-Path $pnpmLockPath) {
        $dependencyInfo.PackageManager = "pnpm"
        Copy-Item $pnpmLockPath `
            (Join-Path $DependencyRoot "pnpm-lock.yaml") `
            -Force
    }
    elseif (Test-Path $yarnLockPath) {
        $dependencyInfo.PackageManager = "yarn"
        Copy-Item $yarnLockPath `
            (Join-Path $DependencyRoot "yarn.lock") `
            -Force
    }

    if (Test-CommandAvailable "node") {
        $dependencyInfo.NodeVersion = (node --version 2>&1 | Out-String).Trim()
    }

    if (Test-CommandAvailable "npm") {
        $dependencyInfo.NpmVersion = (npm --version 2>&1 | Out-String).Trim()
    }

    if (-not $SkipDependencyAudit -and (Test-CommandAvailable "npm")) {

        Write-Step "Running npm audit..."

        Invoke-Capture `
            "npm" `
            @("audit","--json") `
            (Join-Path $DependencyRoot "npm-audit.json") |
            Out-Null

        Write-Step "Running npm outdated..."

        Invoke-Capture `
            "npm" `
            @("outdated","--json") `
            (Join-Path $DependencyRoot "npm-outdated.json") |
            Out-Null

        $dependencyInfo.DependencyAudit = $true
    }
}

$dependencyInfo |
    ConvertTo-Json -Depth 5 |
    Out-File (Join-Path $DependencyRoot "DEPENDENCY-INFO.json") -Encoding UTF8

# ------------------------------------------------------------
# Next.js
# ------------------------------------------------------------

Write-Header "6. NEXT.JS ANALYSIS"

$nextInfo = [ordered]@{
    Detected = $false
    Config = $null
    AppDirectory = $false
    PagesDirectory = $false
    NextVersion = $null
    TypeScript = $false
}

$nextConfig = Get-ChildItem `
    -Path $ProjectRoot `
    -File `
    -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "^next\.config\." } |
    Select-Object -First 1

$nextPackage = $false

if (Test-Path $packageJsonPath) {
    try {
        $pkg = Get-Content $packageJsonPath -Raw | ConvertFrom-Json

        if ($pkg.dependencies.next -or $pkg.devDependencies.next) {
            $nextPackage = $true

            if ($pkg.dependencies.next) {
                $nextInfo.NextVersion = [string]$pkg.dependencies.next
            }
            else {
                $nextInfo.NextVersion = [string]$pkg.devDependencies.next
            }
        }
    }
    catch {
        Write-Warn "Could not parse package.json."
    }
}

if ($nextPackage -or $nextConfig) {

    $nextInfo.Detected = $true

    if ($nextConfig) {
        $nextInfo.Config = $nextConfig.Name
        Copy-Item `
            $nextConfig.FullName `
            (Join-Path $FrameworkRoot $nextConfig.Name) `
            -Force
    }

    $nextInfo.AppDirectory =
        (Test-Path (Join-Path $ProjectRoot "app")) -or
        (Test-Path (Join-Path $ProjectRoot "src\app"))

    $nextInfo.PagesDirectory =
        (Test-Path (Join-Path $ProjectRoot "pages")) -or
        (Test-Path (Join-Path $ProjectRoot "src\pages"))

    $nextInfo.TypeScript =
        Test-Path (Join-Path $ProjectRoot "tsconfig.json")

    Write-Step "Next.js detected."
}

$nextInfo |
    ConvertTo-Json -Depth 5 |
    Out-File (Join-Path $FrameworkRoot "NEXTJS-INFO.json") -Encoding UTF8

# ------------------------------------------------------------
# Supabase
# ------------------------------------------------------------

Write-Header "7. SUPABASE ANALYSIS"

$supabaseInfo = [ordered]@{
    Detected = $false
    Directory = $false
    Migrations = 0
    Functions = 0
    ConfigFiles = @()
    ClientReferences = 0
}

$supabaseDir = Join-Path $ProjectRoot "supabase"

if (Test-Path $supabaseDir) {

    $supabaseInfo.Detected = $true
    $supabaseInfo.Directory = $true

    $migrationsDir = Join-Path $supabaseDir "migrations"
    $functionsDir = Join-Path $supabaseDir "functions"

    if (Test-Path $migrationsDir) {
        $supabaseInfo.Migrations = @(
            Get-ChildItem $migrationsDir -File -ErrorAction SilentlyContinue
        ).Count
    }

    if (Test-Path $functionsDir) {
        $supabaseInfo.Functions = @(
            Get-ChildItem $functionsDir -Directory -ErrorAction SilentlyContinue
        ).Count
    }

    $supabaseInfo.ConfigFiles = @(
        Get-ChildItem $supabaseDir -File -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty Name
    )

    Write-Step "Supabase directory detected."
}

# Search code for Supabase references without reading secrets.
$supabaseReferences = $allFiles |
    Where-Object {
        $_.Extension -in @(
            ".ts",".tsx",".js",".jsx",".mjs",".cjs",".sql"
        )
    } |
    Select-String `
        -Pattern "supabase|createClient|SUPABASE_" `
        -SimpleMatch `
        -ErrorAction SilentlyContinue

$supabaseInfo.ClientReferences = @($supabaseReferences).Count

$supabaseInfo |
    ConvertTo-Json -Depth 5 |
    Out-File (Join-Path $FrameworkRoot "SUPABASE-INFO.json") -Encoding UTF8

# ------------------------------------------------------------
# Vercel
# ------------------------------------------------------------

Write-Header "8. VERCEL ANALYSIS"

$vercelInfo = [ordered]@{
    Detected = $false
    Config = $false
    ProjectConfig = $false
    Functions = 0
    CronReferences = 0
}

$vercelConfig = Join-Path $ProjectRoot "vercel.json"

if (Test-Path $vercelConfig) {
    $vercelInfo.Detected = $true
    $vercelInfo.Config = $true

    Copy-Item `
        $vercelConfig `
        (Join-Path $FrameworkRoot "vercel.json") `
        -Force
}

if (Test-Path (Join-Path $ProjectRoot ".vercel\project.json")) {
    $vercelInfo.Detected = $true
    $vercelInfo.ProjectConfig = $true

    Copy-Item `
        (Join-Path $ProjectRoot ".vercel\project.json") `
        (Join-Path $FrameworkRoot "vercel-project.json") `
        -Force
}

$apiDir = Join-Path $ProjectRoot "api"

if (Test-Path $apiDir) {
    $vercelInfo.Functions = @(
        Get-ChildItem $apiDir -Recurse -File -ErrorAction SilentlyContinue
    ).Count
}

$cronReferences = $allFiles |
    Where-Object {
        $_.Extension -in @(
            ".ts",".tsx",".js",".jsx",".json",".md"
        )
    } |
    Select-String `
        -Pattern "cron|vercel.json|schedule|vercel cron" `
        -ErrorAction SilentlyContinue

$vercelInfo.CronReferences = @($cronReferences).Count

if ($vercelInfo.Detected) {
    Write-Step "Vercel configuration detected."
}

$vercelInfo |
    ConvertTo-Json -Depth 5 |
    Out-File (Join-Path $FrameworkRoot "VERCEL-INFO.json") -Encoding UTF8

# ------------------------------------------------------------
# Environment / secret safety
# ------------------------------------------------------------

Write-Header "9. SECRET / ENVIRONMENT SAFETY"

$secretFiles = $allFiles | Where-Object {

    foreach ($pattern in $SensitiveNamePatterns) {
        if ($_.Name -match $pattern) {
            return $true
        }
    }

    return $false
}

$secretIndex = foreach ($file in $secretFiles) {
    Relative-PathSafe $file.FullName
}

Save-Text `
    (Join-Path $ReportsRoot "POTENTIAL-SENSITIVE-FILES.txt") `
    ($secretIndex -join [Environment]::NewLine)

Write-Warn "Sensitive filenames were recorded; secret VALUES were not collected."

# ------------------------------------------------------------
# Test / build baseline
# ------------------------------------------------------------

Write-Header "10. BASELINE VALIDATION"

$baseline = [ordered]@{
    TypeScript = $null
    Lint = $null
    Build = $null
}

if (Test-Path $packageJsonPath) {

    if (Test-Path (Join-Path $ProjectRoot "tsconfig.json")) {

        Write-Step "Running baseline TypeScript check..."

        $code = Invoke-Capture `
            "npx" `
            @("tsc","--noEmit") `
            (Join-Path $ReportsRoot "baseline-typescript.txt")

        $baseline.TypeScript = ($code -eq 0)
    }

    Write-Step "Running baseline lint..."

    $code = Invoke-Capture `
        "npm" `
        @("run","lint") `
        (Join-Path $ReportsRoot "baseline-lint.txt")

    $baseline.Lint = ($code -eq 0)

    if (-not $SkipBuild) {

        Write-Step "Running baseline production build..."

        $code = Invoke-Capture `
            "npm" `
            @("run","build") `
            (Join-Path $ReportsRoot "baseline-build.txt")

        $baseline.Build = ($code -eq 0)
    }
}

$baseline |
    ConvertTo-Json |
    Out-File (Join-Path $ReportsRoot "BASELINE.json") -Encoding UTF8

# ============================================================
# CREATE CHATGPT PACKAGE
# ============================================================

Write-Header "11. GENERATING CHATGPT-READY PACKAGE"

$inventorySummary = @"
Project files: $($inventory.Count)
Audit files: $($auditFiles.Count)
Context files: $($contextFiles.Count)
Next.js detected: $($nextInfo.Detected)
Supabase detected: $($supabaseInfo.Detected)
Vercel detected: $($vercelInfo.Detected)
Package manager: $($dependencyInfo.PackageManager)
Node: $($dependencyInfo.NodeVersion)
TypeScript baseline: $($baseline.TypeScript)
Lint baseline: $($baseline.Lint)
Build baseline: $($baseline.Build)
Git branch: $($gitInfo.Branch)
Git commit: $($gitInfo.Commit)
"@

$prompt = @"
# CHATGPT OPTIMIZATION REQUEST

You are reviewing an existing production application.

This package was generated entirely by PowerShell.
There is NO Claude Code subscription or Claude CLI dependency.

## PROJECT ROOT

$ProjectRoot

## RUN

$RunRoot

## EVIDENCE

### Existing audits

$AuditRoot

### Claude/project context

$ContextRoot

### Dependency evidence

$DependencyRoot

### Framework evidence

$FrameworkRoot

### Git evidence

$GitRoot

### Reports

$ReportsRoot

---

# BASELINE SUMMARY

$inventorySummary

---

# YOUR TASK

Review the evidence and produce a controlled optimization plan.

DO NOT invent findings.

DO NOT assume old audit findings are still valid.

Validate historical findings against the current project evidence.

Prioritize:

1. Critical security issues
2. Reliability issues
3. Database issues
4. Authentication/authorization issues
5. Performance issues
6. Deployment issues
7. Cost/scalability issues
8. Maintainability

Pay particular attention to:

- Next.js architecture
- React server/client boundaries
- unnecessary client JavaScript
- caching
- database queries
- Supabase RLS
- Supabase service-role usage
- M-Pesa callbacks
- Resend/email
- SMS integrations
- Vercel deployment
- Vercel cron
- environment variables
- dependency vulnerabilities
- database connection pooling
- API validation
- authentication
- authorization
- logging
- error handling

## SECURITY RULE

Never request or expose actual secret values.

Environment files are intentionally excluded from content collection.

---

# REQUIRED OUTPUT

Produce:

## 1. OPTIMIZATION-PLAN.md

Include a table:

| ID | Finding | Evidence | Severity | Impact | Effort | Risk | Recommendation |
|----|---------|----------|----------|--------|--------|------|----------------|

Then classify:

- Critical
- High
- Medium
- Low
- Already Fixed
- False Positive / Obsolete

## 2. POWERSHELL COMMAND FILE

Return a complete file named:

OPTIMIZATION-COMMAND.ps1

It MUST begin with exactly:

# OPTIMIZATION-COMMAND-V1

The command file must contain ONLY changes that you recommend implementing.

Every modification must be explicit.

Preferred operations:

- Set-Content
- Add-Content
- Copy-Item
- Move-Item
- Rename-Item
- New-Item
- package-manager commands where appropriate

Avoid destructive commands.

Do not modify:

- .env
- production credentials
- secrets
- certificates
- SSH keys

unless the change only updates an example/template file.

Before modifying an existing file, create a backup if the command file itself is being run outside the main workflow.

## 3. VALIDATION COMMANDS

Also return:

VALIDATION-COMMANDS.ps1

with commands that should be run after optimization.

Use:

- npm run lint
- npx tsc --noEmit
- npm run build
- npm audit
- relevant tests
- Supabase checks where available

## 4. FINAL EXPECTED RESULT

Explain:

BEFORE
→
CHANGE
→
EXPECTED AFTER

Do not claim a performance improvement without measurement.

---

# IMPORTANT

PowerShell will execute your returned command file only after human review.

Do not return a command file that performs broad rewrites.

Prefer small, reversible, testable changes.
"@

Save-Text $PromptPath $prompt

# ------------------------------------------------------------
# COMMAND TEMPLATE
# ------------------------------------------------------------

$commandTemplate = @'
# OPTIMIZATION-COMMAND-V1
# Generated template.
# Replace this file with the reviewed command file returned by ChatGPT.
#
# RULE:
# Only put explicit, reviewed changes here.
# Do not put secrets here.

$ErrorActionPreference = "Stop"

$ProjectRoot = (Get-Location).Path

Write-Host "Applying approved optimization changes..." -ForegroundColor Cyan

# Example:
# Copy-Item ".\src\example.ts" ".\.optimization\manual-backup\example.ts" -Force
#
# Example:
# Set-Content ".\src\example.ts" -Value @'
# new content
# '@ -Encoding UTF8

Write-Host "Optimization command completed." -ForegroundColor Green
'@

Save-Text $CommandTemplatePath $commandTemplate

# ------------------------------------------------------------
# RUN MANIFEST
# ------------------------------------------------------------

$runManifest = [ordered]@{
    SchemaVersion = "2.0"
    Generated = (Get-Date).ToString("o")
    ProjectRoot = $ProjectRoot
    RunRoot = $RunRoot
    AuditFiles = $auditFiles.Count
    ContextFiles = $contextFiles.Count
    ProjectFiles = $inventory.Count
    NextJs = $nextInfo
    Supabase = $supabaseInfo
    Vercel = $vercelInfo
    Dependencies = $dependencyInfo
    Git = $gitInfo
    Baseline = $baseline
    Files = [ordered]@{
        Prompt = $PromptPath
        CommandTemplate = $CommandTemplatePath
        Manifest = $ManifestPath
        Audits = $AuditRoot
        Context = $ContextRoot
        Dependencies = $DependencyRoot
        Framework = $FrameworkRoot
        Reports = $ReportsRoot
        Git = $GitRoot
        Backup = $BackupRoot
    }
}

$runManifest |
    ConvertTo-Json -Depth 10 |
    Out-File $ManifestPath -Encoding UTF8

# ------------------------------------------------------------
# FINAL
# ------------------------------------------------------------

Write-Header "SCAN COMPLETE"

Write-Host ""
Write-Host "CHATGPT-READY PACKAGE" -ForegroundColor Green
Write-Host ""
Write-Host "Run folder:"
Write-Host "  $RunRoot"
Write-Host ""
Write-Host "Main prompt:"
Write-Host "  $PromptPath"
Write-Host ""
Write-Host "Command template:"
Write-Host "  $CommandTemplatePath"
Write-Host ""
Write-Host "Manifest:"
Write-Host "  $ManifestPath"
Write-Host ""
Write-Host "Reports:"
Write-Host "  $ReportsRoot"
Write-Host ""

Write-Host @"
NEXT STEP

1. Open CHATGPT-PROMPT.md.
2. Give ChatGPT the optimization evidence from this run.
3. Ask ChatGPT to produce:
       OPTIMIZATION-PLAN.md
       OPTIMIZATION-COMMAND.ps1
       VALIDATION-COMMANDS.ps1
4. Review the commands.
5. Run:

   .\Optimize.ps1 -ApplyCommand -CommandFile <path-to-OPTIMIZATION-COMMAND.ps1>

6. Then run:

   .\Optimize.ps1 -Mode Verify

"@ -ForegroundColor Yellow

if ($OpenReport) {
    if (Test-Path $PromptPath) {
        Start-Process notepad.exe $PromptPath
    }
}
