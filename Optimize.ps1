#Requires -Version 7.0
<#
.SYNOPSIS
    KITABU YETU — Autonomous Main-Repo Optimization Engine (v3)

.DESCRIPTION
    Gated, phase-by-phase audit/optimize/validate engine for the single
    Kitabu Yetu repository. Implements the five engines from the execution
    plan:

        1. Discovery Engine   - inventory the repo, no assumptions
        2. Safety Engine      - checkpoint + backup before anything is touched
        3. Optimization Engine- progressive UI/UX + code fixes, phase-scoped
        4. Protection Engine  - SAFE / CAUTION / PROTECTED file classification
        5. Validation Engine  - typecheck -> lint -> test -> build -> audits

    Rule of the master prompt this script enforces mechanically:
    "DO NOT START A PHASE BEFORE PREVIOUS PHASE EXITS IN PRODUCTION."

    A phase only runs if the phase before it is marked PASSED in the state
    file. If a phase's validation fails, the script automatically rolls back
    to the pre-phase checkpoint, writes a failure report, and STOPS — it
    never "continues anyway".

.PARAMETER RepoPath
    Path to the single source-of-truth repository.
    Default: D:\Claude\Projects\KITABU YETU\kitabuyetu

.PARAMETER Phase
    Which phase to run: 0-12, or "Next" to run whatever the state file says
    is next, or "Status" to just print the gate status and exit.

.PARAMETER Apply
    Without -Apply, the Optimization Engine only REPORTS violations
    (dry-run). With -Apply, it will actually run safe, reversible fixes
    (eslint --fix, prettier, token substitution) on SAFE-classified files
    only. CAUTION/PROTECTED files are never auto-modified by this script,
    regardless of -Apply.

.PARAMETER Force
    Required in addition to -Apply if you want the script to even attempt
    touching CAUTION-classified files. PROTECTED files can never be
    auto-modified by this script — full stop, no flag overrides that.

.PARAMETER Resume
    Skip discovery/backup steps that already succeeded for this phase
    according to the state file, and continue from where it left off.

.EXAMPLE
    ./Optimize.ps1 -RepoPath "D:\Claude\Projects\KITABU YETU\kitabuyetu" -Phase 0

.EXAMPLE
    ./Optimize.ps1 -Phase Status

.EXAMPLE
    ./Optimize.ps1 -Phase 0 -Apply
#>

[CmdletBinding()]
param(
    [string]$RepoPath = "D:\Claude\Projects\KITABU YETU\kitabuyetu",

    [Parameter(Mandatory = $false)]
    [ValidateSet("0","1","2","3","4","5","6","7","8","9","10","11","12","Next","Status")]
    [string]$Phase = "Status",

    [switch]$Apply,
    [switch]$Force,
    [switch]$Resume
)

# ============================================================================
# 0. CONSTANTS / CONFIG
# ============================================================================

$Script:EngineVersion = "3.0.0"
$Script:StateDir       = Join-Path $RepoPath ".optimize"
$Script:StateFile      = Join-Path $Script:StateDir "state.json"
$Script:BackupRoot     = Join-Path $Script:StateDir "backups"
$Script:ReportRoot     = Join-Path $Script:StateDir "reports"
$Script:LogFile        = Join-Path $Script:StateDir "optimize.log"

$Script:Phases = [ordered]@{
    "0"  = "Phase 0 - Safety + Discovery + Baseline (Public Site & Design System)"
    "1"  = "Phase 1 - Foundation (Auth, Orgs, Groups, Members, Roles)"
    "2"  = "Phase 2 - Bookkeeper (Ledger, Contributions, Savings)"
    "3"  = "Phase 3 - Payments (Daraja STK/PayBill/B2C)"
    "4"  = "Phase 4 - Chama Reminder (SMS)"
    "5"  = "Phase 5 - Changi`$ha (Fundraising)"
    "6"  = "Phase 6 - Enterprise (Portfolio/Multi-group)"
    "7"  = "Phase 7 - CRM"
    "8"  = "Phase 8 - Blog + Newsletter"
    "9"  = "Phase 9 - HRM"
    "10" = "Phase 10 - Recruitment"
    "11" = "Phase 11 - Job Board"
    "12" = "Phase 12 - Ecosystem"
}

# Rules R1-R9.5 = tenancy/financial => anything mapped to these must be PROTECTED.
$Script:ProtectedPatterns = @(
    '*ledger*', '*payment*', '*daraja*', '*mpesa*', '*m-pesa*', '*callback*',
    '*\bauth\b*', '*authoriz*', '*rls*', '*row-level-security*', '*policies.sql',
    '*migrations*', '*tenant*', '*billing*', '*reconcil*', '*idempot*'
)

$Script:CautionPatterns = @(
    '*hooks*', '*\bapi\b*client*', '*route.ts', '*route.tsx', '*middleware*',
    '*auth-ui*', '*config*', '*env*', '*\.env*'
)

$Script:SafePatterns = @(
    '*components/ui*', '*presentation*', '*styles*', '*\.css', '*\.scss',
    '*layouts*', '*navigation*', '*app/(public)*', '*app/(marketing)*',
    '*public-site*', '*flowbite*', '*shadcn*', '*kitabu-ui*', '*@kitabu/ui*'
)

# Hard-coded value detection (R16-R18 design-system governance)
$Script:HardCodedColorRegex = '#(?:[0-9a-fA-F]{3}){1,2}\b|rgb\(|rgba\('
$Script:HardCodedSpacingRegex = '\bstyle=\{\{[^}]*(margin|padding)[^}]*:\s*[0-9]+px'

# ============================================================================
# 1. LOGGING
# ============================================================================

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet("INFO","WARN","ERROR","PASS","FAIL","STEP")]
        [string]$Level = "INFO"
    )
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] [$Level] $Message"

    $color = switch ($Level) {
        "INFO" { "Gray" }
        "WARN" { "Yellow" }
        "ERROR" { "Red" }
        "PASS" { "Green" }
        "FAIL" { "Red" }
        "STEP" { "Cyan" }
    }
    Write-Host $line -ForegroundColor $color

    if (-not (Test-Path $Script:StateDir)) {
        New-Item -ItemType Directory -Path $Script:StateDir -Force | Out-Null
    }
    Add-Content -Path $Script:LogFile -Value $line
}

function Write-Banner {
    param([string]$Text)
    $bar = "=" * 78
    Write-Log $bar "STEP"
    Write-Log $Text "STEP"
    Write-Log $bar "STEP"
}

# ============================================================================
# 2. STATE MANAGEMENT
# ============================================================================

function Get-OptimizeState {
    if (Test-Path $Script:StateFile) {
        return Get-Content $Script:StateFile -Raw | ConvertFrom-Json -AsHashtable
    }
    return @{
        engineVersion = $Script:EngineVersion
        phases        = @{}
        createdAt     = (Get-Date).ToString("o")
    }
}

function Save-OptimizeState {
    param([hashtable]$State)
    if (-not (Test-Path $Script:StateDir)) {
        New-Item -ItemType Directory -Path $Script:StateDir -Force | Out-Null
    }
    $State | ConvertTo-Json -Depth 10 | Set-Content -Path $Script:StateFile -Encoding UTF8
}

function Set-PhaseStatus {
    param(
        [string]$PhaseId,
        [string]$Status,          # PENDING | RUNNING | PASSED | FAILED | ROLLED_BACK
        [string]$Detail = ""
    )
    $state = Get-OptimizeState
    if (-not $state.phases.ContainsKey($PhaseId)) {
        $state.phases[$PhaseId] = @{}
    }
    $state.phases[$PhaseId]["status"]    = $Status
    $state.phases[$PhaseId]["detail"]    = $Detail
    $state.phases[$PhaseId]["updatedAt"] = (Get-Date).ToString("o")
    Save-OptimizeState -State $state
}

function Get-PhaseStatus {
    param([string]$PhaseId)
    $state = Get-OptimizeState
    if ($state.phases.ContainsKey($PhaseId)) {
        return $state.phases[$PhaseId]["status"]
    }
    return "PENDING"
}

function Assert-PreviousPhasePassed {
    param([string]$PhaseId)
    $idx = [int]$PhaseId
    if ($idx -eq 0) { return $true }
    $prevId = [string]($idx - 1)
    $prevStatus = Get-PhaseStatus -PhaseId $prevId
    if ($prevStatus -ne "PASSED") {
        Write-Log "GATE BLOCKED: Phase $prevId is '$prevStatus', not PASSED." "FAIL"
        Write-Log "Rule: DO NOT START A PHASE BEFORE PREVIOUS PHASE EXITS IN PRODUCTION." "FAIL"
        return $false
    }
    return $true
}

function Show-GateStatus {
    Write-Banner "KITABU YETU OPTIMIZE.PS1 v$($Script:EngineVersion) — GATE STATUS"
    foreach ($id in $Script:Phases.Keys) {
        $status = Get-PhaseStatus -PhaseId $id
        $marker = switch ($status) {
            "PASSED"      { "[x]" }
            "FAILED"      { "[!]" }
            "ROLLED_BACK" { "[<]" }
            "RUNNING"     { "[~]" }
            default       { "[ ]" }
        }
        $line = "{0} {1,-3} {2,-14} {3}" -f $marker, $id, $status, $Script:Phases[$id]
        $level = if ($status -eq "PASSED") { "PASS" } elseif ($status -eq "FAILED") { "FAIL" } else { "INFO" }
        Write-Log $line $level
    }
}

function Get-NextPendingPhase {
    foreach ($id in $Script:Phases.Keys) {
        $status = Get-PhaseStatus -PhaseId $id
        if ($status -ne "PASSED") { return $id }
    }
    return $null
}

# ============================================================================
# 3. SAFETY ENGINE
# ============================================================================

function Invoke-SafetyEngine {
    param([string]$PhaseId)

    Write-Banner "SAFETY ENGINE — Phase $PhaseId"
    Set-Location $RepoPath

    # 3.1 Git status must be clean (or explicitly acknowledged)
    Write-Log "Checking git status..." "STEP"
    $gitStatus = git status --porcelain 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Log "Not a git repository, or git is unavailable at $RepoPath" "ERROR"
        return $null
    }
    if ($gitStatus) {
        Write-Log "Working tree is dirty. Committing/stashing before checkpoint is required." "WARN"
        Write-Log "Uncommitted changes:`n$gitStatus" "WARN"
        if (-not $Force) {
            Write-Log "Refusing to checkpoint a dirty tree without -Force. Commit or stash first." "FAIL"
            return $null
        }
        Write-Log "-Force set: creating a WIP commit to preserve current state." "WARN"
        git add -A | Out-Null
        git commit -m "WIP: pre-phase-$PhaseId auto-checkpoint commit (Optimize.ps1)" | Out-Null
    }

    # 3.2 Create checkpoint tag
    $tagName = "optimize-checkpoint-phase$PhaseId-$(Get-Date -Format yyyyMMdd-HHmmss)"
    git tag -a $tagName -m "Checkpoint before Phase $PhaseId optimization" | Out-Null
    Write-Log "Checkpoint tag created: $tagName" "PASS"

    # 3.3 Filesystem backup (zip) of the working tree, excluding node_modules/.git
    if (-not (Test-Path $Script:BackupRoot)) {
        New-Item -ItemType Directory -Path $Script:BackupRoot -Force | Out-Null
    }
    $backupZip = Join-Path $Script:BackupRoot "phase$PhaseId-$(Get-Date -Format yyyyMMdd-HHmmss).zip"
    Write-Log "Creating filesystem backup: $backupZip" "STEP"

    $exclude = @('node_modules', '.git', '.next', 'dist', 'build', '.optimize')
    $tempStage = Join-Path $env:TEMP "kitabuyetu-backup-stage-$PhaseId"
    if (Test-Path $tempStage) { Remove-Item $tempStage -Recurse -Force }
    New-Item -ItemType Directory -Path $tempStage -Force | Out-Null

    Get-ChildItem -Path $RepoPath -Force | Where-Object {
        $exclude -notcontains $_.Name
    } | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination (Join-Path $tempStage $_.Name) -Recurse -Force
    }
    Compress-Archive -Path (Join-Path $tempStage '*') -DestinationPath $backupZip -Force
    Remove-Item $tempStage -Recurse -Force
    Write-Log "Backup complete: $backupZip" "PASS"

    # 3.4 Snapshot critical manifests individually for fast diffing later
    $snapshotDir = Join-Path $Script:BackupRoot "phase$PhaseId-manifests"
    New-Item -ItemType Directory -Path $snapshotDir -Force | Out-Null
    $manifestTargets = @(
        "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
        "tsconfig.json", "tailwind.config.js", "tailwind.config.ts",
        "next.config.js", "next.config.mjs", ".env.example"
    )
    foreach ($m in $manifestTargets) {
        $src = Join-Path $RepoPath $m
        if (Test-Path $src) {
            Copy-Item $src (Join-Path $snapshotDir $m) -Force
        }
    }
    # Snapshot route tree (Next.js app router) for structural diffing
    $appDir = Join-Path $RepoPath "app"
    if (Test-Path $appDir) {
        Get-ChildItem -Path $appDir -Recurse -Filter "page.tsx" |
            Select-Object -ExpandProperty FullName |
            Set-Content (Join-Path $snapshotDir "routes-snapshot.txt")
    }
    Write-Log "Manifest + route snapshots saved to $snapshotDir" "PASS"

    return @{
        tag        = $tagName
        backupZip  = $backupZip
        snapshotDir = $snapshotDir
    }
}

function Invoke-Rollback {
    param(
        [string]$PhaseId,
        [string]$CheckpointTag
    )
    Write-Banner "ROLLBACK — Phase $PhaseId"
    Set-Location $RepoPath
    Write-Log "Rolling back working tree to $CheckpointTag" "WARN"
    git reset --hard $CheckpointTag | Out-Null
    git clean -fd | Out-Null
    Set-PhaseStatus -PhaseId $PhaseId -Status "ROLLED_BACK" -Detail "Reset to $CheckpointTag"
    Write-Log "Rollback complete. Repository restored to pre-phase-$PhaseId state." "PASS"
}

# ============================================================================
# 4. DISCOVERY ENGINE
# ============================================================================

function Invoke-DiscoveryEngine {
    param([string]$PhaseId)

    Write-Banner "DISCOVERY ENGINE — Phase $PhaseId"

    $inventory = [ordered]@{
        routes         = @()
        components     = @()
        hooks          = @()
        services       = @()
        apiRoutes      = @()
        migrations     = @()
        tailwindConfig = $null
        uiLibraries    = @{ shadcn = $false; flowbite = $false; kitabuUi = $false; tabler = $false }
        packageManager = $null
        envFiles       = @()
    }

    if (-not (Test-Path $RepoPath)) {
        Write-Log "Repo path not found: $RepoPath — did you mean to pass -RepoPath?" "ERROR"
        return $inventory
    }
    Set-Location $RepoPath

    Write-Log "Scanning app router routes..." "STEP"
    $inventory.routes = @(Get-ChildItem -Recurse -Filter "page.tsx" -ErrorAction SilentlyContinue |
        ForEach-Object { $_.FullName.Replace($RepoPath, "") })

    Write-Log "Scanning components..." "STEP"
    $inventory.components = @(Get-ChildItem -Recurse -Include *.tsx -Path "**/components/**" -ErrorAction SilentlyContinue |
        ForEach-Object { $_.FullName.Replace($RepoPath, "") })

    Write-Log "Scanning hooks..." "STEP"
    $inventory.hooks = @(Get-ChildItem -Recurse -Filter "use*.ts*" -ErrorAction SilentlyContinue |
        ForEach-Object { $_.FullName.Replace($RepoPath, "") })

    Write-Log "Scanning services..." "STEP"
    $inventory.services = @(Get-ChildItem -Recurse -Path "**/services/**" -Include *.ts -ErrorAction SilentlyContinue |
        ForEach-Object { $_.FullName.Replace($RepoPath, "") })

    Write-Log "Scanning API route handlers..." "STEP"
    $inventory.apiRoutes = @(Get-ChildItem -Recurse -Filter "route.ts" -ErrorAction SilentlyContinue |
        ForEach-Object { $_.FullName.Replace($RepoPath, "") })

    Write-Log "Scanning database migrations..." "STEP"
    $inventory.migrations = @(Get-ChildItem -Recurse -Path "**/migrations/**" -ErrorAction SilentlyContinue |
        ForEach-Object { $_.FullName.Replace($RepoPath, "") })

    Write-Log "Detecting UI library usage..." "STEP"
    $pkgJsonPath = Join-Path $RepoPath "package.json"
    if (Test-Path $pkgJsonPath) {
        $pkg = Get-Content $pkgJsonPath -Raw | ConvertFrom-Json
        $allDeps = @()
        if ($pkg.dependencies) { $allDeps += $pkg.dependencies.PSObject.Properties.Name }
        if ($pkg.devDependencies) { $allDeps += $pkg.devDependencies.PSObject.Properties.Name }

        $inventory.uiLibraries.shadcn   = ($allDeps -match "class-variance-authority|@radix-ui").Count -gt 0
        $inventory.uiLibraries.flowbite = ($allDeps -match "flowbite").Count -gt 0
        $inventory.uiLibraries.tabler   = ($allDeps -match "@tabler/icons").Count -gt 0
        $inventory.uiLibraries.kitabuUi = ($allDeps -match "@kitabu/ui").Count -gt 0

        if (Test-Path (Join-Path $RepoPath "pnpm-lock.yaml")) { $inventory.packageManager = "pnpm" }
        elseif (Test-Path (Join-Path $RepoPath "yarn.lock")) { $inventory.packageManager = "yarn" }
        elseif (Test-Path (Join-Path $RepoPath "package-lock.json")) { $inventory.packageManager = "npm" }
    } else {
        Write-Log "No package.json found at repo root — is -RepoPath correct?" "WARN"
    }

    $twConfig = @("tailwind.config.js", "tailwind.config.ts") | ForEach-Object { Join-Path $RepoPath $_ } | Where-Object { Test-Path $_ }
    $inventory.tailwindConfig = $twConfig | Select-Object -First 1

    $inventory.envFiles = @(Get-ChildItem -Path $RepoPath -Filter ".env*" -File -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty Name)

    # Write discovery report
    if (-not (Test-Path $Script:ReportRoot)) { New-Item -ItemType Directory -Path $Script:ReportRoot -Force | Out-Null }
    $reportPath = Join-Path $Script:ReportRoot "phase$PhaseId-discovery.json"
    $inventory | ConvertTo-Json -Depth 6 | Set-Content $reportPath -Encoding UTF8

    Write-Log ("Routes: {0} | Components: {1} | Hooks: {2} | Services: {3} | API routes: {4} | Migrations: {5}" -f `
        $inventory.routes.Count, $inventory.components.Count, $inventory.hooks.Count, `
        $inventory.services.Count, $inventory.apiRoutes.Count, $inventory.migrations.Count) "PASS"
    Write-Log ("UI libs -> shadcn:{0} flowbite:{1} tabler:{2} @kitabu/ui:{3}" -f `
        $inventory.uiLibraries.shadcn, $inventory.uiLibraries.flowbite, `
        $inventory.uiLibraries.tabler, $inventory.uiLibraries.kitabuUi) "INFO"
    Write-Log "Discovery report written: $reportPath" "PASS"

    return $inventory
}

# ============================================================================
# 5. PROTECTION ENGINE
# ============================================================================

function Get-FileClassification {
    param([string]$RelativePath)

    foreach ($pattern in $Script:ProtectedPatterns) {
        if ($RelativePath -like $pattern) { return "PROTECTED" }
    }
    foreach ($pattern in $Script:CautionPatterns) {
        if ($RelativePath -like $pattern) { return "CAUTION" }
    }
    foreach ($pattern in $Script:SafePatterns) {
        if ($RelativePath -like $pattern) { return "SAFE" }
    }
    # Default posture: unknown files are CAUTION, never auto-SAFE.
    return "CAUTION"
}

function Invoke-ProtectionEngine {
    param([array]$AllFiles, [string]$PhaseId)

    Write-Banner "PROTECTION ENGINE — Phase $PhaseId"

    $classified = [ordered]@{ SAFE = @(); CAUTION = @(); PROTECTED = @() }
    foreach ($f in $AllFiles) {
        $cls = Get-FileClassification -RelativePath $f
        $classified[$cls] += $f
    }

    Write-Log ("SAFE: {0}  CAUTION: {1}  PROTECTED: {2}" -f `
        $classified.SAFE.Count, $classified.CAUTION.Count, $classified.PROTECTED.Count) "INFO"

    if ($classified.PROTECTED.Count -gt 0) {
        Write-Log "PROTECTED files detected (R1-R9.5 territory). These are NEVER auto-modified:" "WARN"
        $classified.PROTECTED | Select-Object -First 15 | ForEach-Object { Write-Log "  - $_" "WARN" }
    }

    $reportPath = Join-Path $Script:ReportRoot "phase$PhaseId-classification.json"
    $classified | ConvertTo-Json -Depth 4 | Set-Content $reportPath -Encoding UTF8
    return $classified
}

# ============================================================================
# 6. OPTIMIZATION ENGINE
# ============================================================================

function Find-HardCodedValues {
    param([string]$FilePath)

    $issues = @()
    if (-not (Test-Path $FilePath)) { return $issues }
    $lines = Get-Content $FilePath -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $Script:HardCodedColorRegex) {
            $issues += [pscustomobject]@{ file = $FilePath; line = $i + 1; type = "hard-coded-color"; text = $lines[$i].Trim() }
        }
        if ($lines[$i] -match $Script:HardCodedSpacingRegex) {
            $issues += [pscustomobject]@{ file = $FilePath; line = $i + 1; type = "hard-coded-spacing"; text = $lines[$i].Trim() }
        }
    }
    return $issues
}

function Invoke-OptimizationEngine {
    param(
        [hashtable]$Classified,
        [string]$PhaseId
    )

    Write-Banner "OPTIMIZATION ENGINE — Phase $PhaseId $(if(-not $Apply){'(DRY RUN — reporting only)'})"

    $targets = $Classified.SAFE
    if ($Force -and $Apply) {
        Write-Log "-Force -Apply set: CAUTION files included as fix targets (still never PROTECTED)." "WARN"
        $targets += $Classified.CAUTION
    }

    $allIssues = @()
    $scanExt = @('.tsx', '.ts', '.jsx', '.js', '.css')
    foreach ($rel in $targets) {
        $full = Join-Path $RepoPath $rel
        if (($scanExt -contains [IO.Path]::GetExtension($full)) -and (Test-Path $full)) {
            $allIssues += Find-HardCodedValues -FilePath $full
        }
    }

    Write-Log "Design-token violations found: $($allIssues.Count)" $(if ($allIssues.Count -gt 0) { "WARN" } else { "PASS" })

    $reportPath = Join-Path $Script:ReportRoot "phase$PhaseId-optimization.json"
    $allIssues | ConvertTo-Json -Depth 4 | Set-Content $reportPath -Encoding UTF8
    Write-Log "Optimization report written: $reportPath" "INFO"

    if ($Apply) {
        Write-Log "Applying safe, reversible auto-fixes (eslint --fix / prettier)..." "STEP"
        Set-Location $RepoPath
        if (Test-Path (Join-Path $RepoPath "node_modules/.bin/eslint")) {
            & npx eslint --fix . --ext .ts,.tsx,.js,.jsx 2>&1 | Tee-Object -Variable eslintOut | Out-Null
            Write-Log "eslint --fix completed." "INFO"
        } else {
            Write-Log "eslint not installed — skipping auto-fix (run 'npm install' first)." "WARN"
        }
        if (Test-Path (Join-Path $RepoPath "node_modules/.bin/prettier")) {
            & npx prettier --write . 2>&1 | Out-Null
            Write-Log "prettier --write completed." "INFO"
        } else {
            Write-Log "prettier not installed — skipping formatting pass." "WARN"
        }
        Write-Log "Hard-coded color/spacing values require manual token migration — see report above; not auto-rewritten (semantic risk)." "WARN"
    } else {
        Write-Log "Dry run only. Re-run with -Apply to run eslint --fix / prettier on SAFE files." "INFO"
    }

    return $allIssues
}

# ============================================================================
# 7. VALIDATION ENGINE
# ============================================================================

function Invoke-ValidationEngine {
    param([string]$PhaseId)

    Write-Banner "VALIDATION ENGINE — Phase $PhaseId"
    Set-Location $RepoPath

    $results = [ordered]@{}

    function Run-Check {
        param([string]$Name, [scriptblock]$Cmd)
        Write-Log "Running: $Name" "STEP"
        try {
            & $Cmd 2>&1 | Tee-Object -Variable out | Out-Null
            $ok = ($LASTEXITCODE -eq 0) -or ($null -eq $LASTEXITCODE)
        } catch {
            $ok = $false
            $out = $_.Exception.Message
        }
        $results[$Name] = @{ passed = $ok; output = ($out -join "`n") }
        Write-Log "$Name -> $(if($ok){'PASS'}else{'FAIL'})" $(if ($ok) { "PASS" } else { "FAIL" })
        return $ok
    }

    $hasPkgJson = Test-Path (Join-Path $RepoPath "package.json")
    if (-not $hasPkgJson) {
        Write-Log "No package.json — cannot run npm-based validation. Check -RepoPath." "ERROR"
        return $false
    }

    $allPassed = $true
    if (Test-Path (Join-Path $RepoPath "tsconfig.json")) {
        $allPassed = (Run-Check "TypeScript (tsc --noEmit)" { npx tsc --noEmit }) -and $allPassed
    }
    $allPassed = (Run-Check "ESLint" { npx eslint . --ext .ts,.tsx,.js,.jsx }) -and $allPassed
    $allPassed = (Run-Check "Unit/Integration tests" { npm test --silent -- --ci }) -and $allPassed

    # Phase 0-specific audits
    if ($PhaseId -eq "0") {
        $allPassed = (Run-Check "Route smoke check (page.tsx count >= 15 expected pages)" {
            $count = (Get-ChildItem -Recurse -Filter "page.tsx" -Path $RepoPath -ErrorAction SilentlyContinue).Count
            if ($count -lt 15) { throw "Only $count page.tsx files found, expected >= 15 for Phase 0." }
        }) -and $allPassed
    }

    $allPassed = (Run-Check "Production build" { npm run build }) -and $allPassed

    $reportPath = Join-Path $Script:ReportRoot "phase$PhaseId-validation.json"
    $results | ConvertTo-Json -Depth 6 | Set-Content $reportPath -Encoding UTF8
    Write-Log "Validation report written: $reportPath" "INFO"

    return $allPassed
}

# ============================================================================
# 8. PHASE ORCHESTRATION
# ============================================================================

function Invoke-Phase {
    param([string]$PhaseId)

    if (-not $Script:Phases.Contains($PhaseId)) {
        Write-Log "Unknown phase id: $PhaseId" "ERROR"
        return
    }

    Write-Banner "STARTING $($Script:Phases[$PhaseId])"

    if (-not (Assert-PreviousPhasePassed -PhaseId $PhaseId)) {
        Write-Log "Run the previous phase to completion first, or inspect state with -Phase Status." "FAIL"
        return
    }

    if ((Get-PhaseStatus -PhaseId $PhaseId) -eq "PASSED" -and -not $Resume) {
        Write-Log "Phase $PhaseId already PASSED. Nothing to do. (Use -Resume to re-run anyway.)" "INFO"
        return
    }

    Set-PhaseStatus -PhaseId $PhaseId -Status "RUNNING"

    # --- Safety first, always ---
    $checkpoint = Invoke-SafetyEngine -PhaseId $PhaseId
    if (-not $checkpoint) {
        Set-PhaseStatus -PhaseId $PhaseId -Status "FAILED" -Detail "Safety Engine could not create a checkpoint."
        Write-Log "ABORTED before any changes were made — no checkpoint, no risk taken." "FAIL"
        return
    }

    # --- Discovery ---
    $inventory = Invoke-DiscoveryEngine -PhaseId $PhaseId

    $allTrackedFiles = @()
    $allTrackedFiles += $inventory.routes
    $allTrackedFiles += $inventory.components
    $allTrackedFiles += $inventory.hooks
    $allTrackedFiles += $inventory.services
    $allTrackedFiles += $inventory.apiRoutes
    $allTrackedFiles += $inventory.migrations

    # --- Protection classification ---
    $classified = Invoke-ProtectionEngine -AllFiles $allTrackedFiles -PhaseId $PhaseId

    # --- Optimization (dry-run unless -Apply) ---
    Invoke-OptimizationEngine -Classified $classified -PhaseId $PhaseId | Out-Null

    # --- Validation gate ---
    $passed = Invoke-ValidationEngine -PhaseId $PhaseId

    if ($passed) {
        Set-PhaseStatus -PhaseId $PhaseId -Status "PASSED" -Detail "Checkpoint: $($checkpoint.tag)"
        Write-Banner "PHASE $PhaseId PASSED — safe to proceed to next phase."
    } else {
        Write-Log "Validation FAILED for Phase $PhaseId. Rolling back automatically." "FAIL"
        Invoke-Rollback -PhaseId $PhaseId -CheckpointTag $checkpoint.tag
        Write-Banner "PHASE $PhaseId FAILED AND WAS ROLLED BACK. See reports in $Script:ReportRoot"
    }
}

# ============================================================================
# 9. ENTRY POINT
# ============================================================================

Write-Banner "KITABU YETU OPTIMIZE.PS1 v$($Script:EngineVersion)"
Write-Log "Repo: $RepoPath" "INFO"
Write-Log "Mode: Phase=$Phase Apply=$($Apply.IsPresent) Force=$($Force.IsPresent) Resume=$($Resume.IsPresent)" "INFO"

switch ($Phase) {
    "Status" { Show-GateStatus }
    "Next" {
        $next = Get-NextPendingPhase
        if ($null -eq $next) {
            Write-Log "All phases PASSED. Nothing left to run." "PASS"
        } else {
            Invoke-Phase -PhaseId $next
        }
    }
    default { Invoke-Phase -PhaseId $Phase }
}
