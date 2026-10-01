#requires -Version 5.1

<#
============================================================
 KITABU YETU
 CODEBASE CLEANUP & DEDUPLICATION AUDIT
============================================================

 PURPOSE
 -------
 Read-only audit of the Kitabu Yetu codebase.

 ANALYZES
 --------
 - Exact duplicate source files
 - Duplicate function names
 - Duplicate exported symbols
 - Source reference counts
 - Potentially orphaned files
 - Legacy/stale-looking source files
 - Next.js routes
 - API routes
 - Supabase usage
 - Auth/authorization usage
 - Service/business logic
 - console/debug/TODO/FIXME
 - TypeScript suppressions and any
 - React/Next.js patterns
 - Environment variables
 - npm dependency references
 - package manager files
 - CSS/Tailwind
 - duplicate long strings
 - repository artifacts
 - Git state
 - TypeScript
 - ESLint
 - npm audit

 SAFETY
 ------
 This script DOES NOT:
 - delete files
 - modify source code
 - modify package.json
 - modify lockfiles
 - modify .env files
 - modify Supabase
 - modify Vercel
 - commit
 - push
 - deploy

 IMPORTANT
 ---------
 Static analysis produces CANDIDATES.
 It does not prove that a file/function is dead.

============================================================
#>

$ErrorActionPreference = "Continue"

# ============================================================
# CONFIGURATION
# ============================================================

$StartedAt = Get-Date
$Timestamp = $StartedAt.ToString("yyyyMMdd-HHmmss")

$Repo = (Get-Location).Path

$AuditRoot = Join-Path `
    $Repo `
    ".optimization\codebase-audit-$Timestamp"

$Reports = Join-Path `
    $AuditRoot `
    "reports"

New-Item `
    -ItemType Directory `
    -Force `
    -Path $Reports |
    Out-Null

$SourceExtensions = @(
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs"
)

$ExcludedDirectories = @(
    ".git",
    ".next",
    ".vercel",
    ".turbo",
    ".cache",
    "node_modules",
    "coverage",
    "dist",
    "build",
    ".optimization",
    ".test-results"
)

# ============================================================
# FUNCTIONS
# ============================================================

function Write-Section {
    param(
        [string]$Title
    )

    Write-Host ""
    Write-Host "============================================================" `
        -ForegroundColor Cyan

    Write-Host " $Title" `
        -ForegroundColor Cyan

    Write-Host "============================================================" `
        -ForegroundColor Cyan
}

function Write-Step {
    param(
        [string]$Message
    )

    Write-Host ""
    Write-Host "[AUDIT] $Message" `
        -ForegroundColor Yellow
}

function Save-Text {
    param(
        [string]$Path,
        [string]$Content
    )

    $Content |
        Out-File `
            -FilePath $Path `
            -Encoding UTF8
}

function Get-RelativePathSafe {
    param(
        [string]$FullPath
    )

    try {
        return [System.IO.Path]::GetRelativePath(
            $Repo,
            $FullPath
        )
    }
    catch {
        return $FullPath
    }
}

function Test-IsExcludedPath {
    param(
        [string]$Path
    )

    $Normalized = $Path.Replace("/", "\")

    foreach ($Excluded in $ExcludedDirectories) {

        if (
            $Normalized -match "(^|\\)$([regex]::Escape($Excluded))(\\|$)"
        ) {
            return $true
        }

        if (
            $Normalized -match "\\$([regex]::Escape($Excluded))\\"
        ) {
            return $true
        }
    }

    return $false
}

function Get-SourceFiles {

    Get-ChildItem `
        -Path $Repo `
        -Recurse `
        -File `
        -ErrorAction SilentlyContinue |
        Where-Object {

            $Extension =
                $_.Extension.ToLowerInvariant()

            ($SourceExtensions -contains $Extension) -and
            (-not (Test-IsExcludedPath $_.FullName))
        }
}

function Get-LineCount {
    param(
        [string]$Path
    )

    try {

        $Content =
            Get-Content `
                -LiteralPath $Path `
                -Raw `
                -ErrorAction Stop

        if ([string]::IsNullOrEmpty($Content)) {
            return 0
        }

        return ($Content -split "`r?`n").Count
    }
    catch {
        return 0
    }
}

function Get-FileHashSafe {
    param(
        [string]$Path
    )

    try {

        return (
            Get-FileHash `
                -Algorithm SHA256 `
                -LiteralPath $Path `
                -ErrorAction Stop
        ).Hash
    }
    catch {
        return $null
    }
}

# ============================================================
# START
# ============================================================

Write-Section "KITABU YETU — CODEBASE CLEANUP & DEDUPLICATION AUDIT"

Write-Host ""
Write-Host "Repository : $Repo"
Write-Host "Audit      : $AuditRoot"
Write-Host "Started    : $StartedAt"

# ============================================================
# 1. GIT VALIDATION
# ============================================================

Write-Step "Capturing Git state"

$Branch = (
    & git branch --show-current 2>$null
)

$GitStatus = @(
    & git status --short 2>&1
)

$GitLog = @(
    & git log -1 --format="%H%n%s%n%ad" --date=iso 2>&1
)

Save-Text `
    (Join-Path $Reports "git-status.txt") `
    ($GitStatus -join "`r`n")

Save-Text `
    (Join-Path $Reports "git-latest-commit.txt") `
    ($GitLog -join "`r`n")

# ============================================================
# 2. SOURCE INVENTORY
# ============================================================

Write-Step "Building source-file inventory"

$SourceFiles = @(
    Get-SourceFiles
)

$Inventory = foreach ($File in $SourceFiles) {

    $Relative =
        Get-RelativePathSafe $File.FullName

    [PSCustomObject]@{
        File      = $Relative
        Extension = $File.Extension
        SizeKB    = [math]::Round(
            $File.Length / 1KB,
            2
        )
        Lines     = Get-LineCount $File.FullName
        LastWrite = $File.LastWriteTime
    }
}

$Inventory |
    Sort-Object File |
    Export-Csv `
        (Join-Path $Reports "source-inventory.csv") `
        -NoTypeInformation

Write-Host ""
Write-Host "Source files discovered: $($SourceFiles.Count)" `
    -ForegroundColor Green

# ============================================================
# 3. LOAD SOURCE CONTENT
# ============================================================

Write-Step "Loading source files for static analysis"

$FileContents = @{}

foreach ($File in $SourceFiles) {

    $Relative =
        Get-RelativePathSafe $File.FullName

    try {

        $FileContents[$Relative] =
            Get-Content `
                -LiteralPath $File.FullName `
                -Raw `
                -ErrorAction Stop
    }
    catch {

        Write-Warning `
            "Could not read $Relative"
    }
}

# ============================================================
# 4. EXACT DUPLICATE FILES
# ============================================================

Write-Step "Detecting exact duplicate source files"

$Hashes = foreach ($File in $SourceFiles) {

    $Hash =
        Get-FileHashSafe $File.FullName

    if ($Hash) {

        [PSCustomObject]@{
            SHA256    = $Hash
            File      = Get-RelativePathSafe $File.FullName
            SizeBytes = $File.Length
        }
    }
}

$DuplicateFileGroups = @(
    $Hashes |
        Group-Object SHA256 |
        Where-Object {
            $_.Count -gt 1
        }
)

$DuplicateFiles = foreach (
    $Group in $DuplicateFileGroups
) {

    foreach ($Item in $Group.Group) {

        [PSCustomObject]@{
            SHA256         = $Group.Name
            DuplicateCount = $Group.Count
            SizeBytes      = $Item.SizeBytes
            File           = $Item.File
        }
    }
}

$DuplicateFiles |
    Sort-Object SHA256, File |
    Export-Csv `
        (Join-Path $Reports "duplicate-files.csv") `
        -NoTypeInformation

# ============================================================
# 5. LARGE SOURCE FILES
# ============================================================

Write-Step "Detecting large source files"

$LargeFiles =
    $Inventory |
    Where-Object {
        $_.Lines -ge 500 -or
        $_.SizeKB -ge 100
    } |
    Sort-Object Lines -Descending

$LargeFiles |
    Export-Csv `
        (Join-Path $Reports "large-source-files.csv") `
        -NoTypeInformation

# ============================================================
# 6. LEGACY / STALE NAMING
# ============================================================

Write-Step "Detecting legacy/stale-looking source names"

$LegacyPattern =
    '(?i)\b(backup|bak|old|obsolete|deprecated|draft|temp|temporary|scratch|copy|previous|legacy|disabled|unused|archive)\b'

$LegacyFiles =
    $SourceFiles |
    Where-Object {
        $_.Name -match $LegacyPattern
    } |
    ForEach-Object {

        [PSCustomObject]@{
            File      = Get-RelativePathSafe $_.FullName
            Name      = $_.Name
            SizeKB    = [math]::Round(
                $_.Length / 1KB,
                2
            )
            LastWrite = $_.LastWriteTime
        }
    }

$LegacyFiles |
    Sort-Object LastWrite |
    Export-Csv `
        (Join-Path $Reports "legacy-looking-files.csv") `
        -NoTypeInformation

# ============================================================
# 7. FUNCTION NAME ANALYSIS
# ============================================================

Write-Step "Detecting repeated function/method names"

$FunctionRows = @()

foreach ($Entry in $FileContents.GetEnumerator()) {

    $Path = $Entry.Key
    $Content = $Entry.Value

    # Patterns 2/3 require a const/let/var declaration keyword immediately
    # before the identifier. Without that anchor, these also match JSX
    # attributes like onClick={() => ...} or className={fn(...)} — the
    # attribute name isn't a function declaration at all, and JSX attributes
    # are never preceded by a declaration keyword, so this anchor is a clean
    # way to exclude them.
    $Patterns = @(
        '\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)',
        '\b(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(',
        '\b(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?[^=]*=>'
    )

    foreach ($Pattern in $Patterns) {

        foreach (
            $Match in [regex]::Matches(
                $Content,
                $Pattern,
                [System.Text.RegularExpressions.RegexOptions]::Multiline
            )
        ) {

            if ($Match.Groups.Count -gt 1) {

                $Name =
                    $Match.Groups[1].Value

                if (
                    $Name.Length -gt 1 -and
                    $Name -notmatch '^(if|for|while|switch)$'
                ) {

                    $FunctionRows +=
                        [PSCustomObject]@{
                            Name = $Name
                            File = $Path
                        }
                }
            }
        }
    }
}

$DuplicateFunctionGroups = @(
    $FunctionRows |
        Group-Object Name |
        Where-Object {
            $_.Count -gt 1
        }
)

$DuplicateFunctions = foreach (
    $Group in $DuplicateFunctionGroups
) {

    foreach ($Item in $Group.Group) {

        [PSCustomObject]@{
            FunctionName = $Group.Name
            Occurrences  = $Group.Count
            File         = $Item.File
        }
    }
}

$DuplicateFunctions |
    Sort-Object FunctionName, File |
    Export-Csv `
        (Join-Path $Reports "duplicate-function-names.csv") `
        -NoTypeInformation

# ============================================================
# 8. EXPORT ANALYSIS
# ============================================================

Write-Step "Detecting repeated exported symbols"

$ExportRows = @()

foreach ($Entry in $FileContents.GetEnumerator()) {

    $Path = $Entry.Key
    $Content = $Entry.Value

    $Patterns = @(
        'export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)',
        'export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)',
        'export\s+(?:default\s+)?(?:class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)'
    )

    foreach ($Pattern in $Patterns) {

        foreach (
            $Match in [regex]::Matches(
                $Content,
                $Pattern
            )
        ) {

            if ($Match.Groups.Count -gt 1) {

                $ExportRows +=
                    [PSCustomObject]@{
                        Symbol = $Match.Groups[1].Value
                        File   = $Path
                    }
            }
        }
    }
}

# A symbol declared and separately re-exported within the SAME file (e.g.
# `export const x = ...` plus a later `export { x }`) would otherwise count
# as two "occurrences" of one symbol even though no other file is involved.
# Dedupe to one row per (Symbol, File) pair before counting duplicates, so
# only genuine cross-file symbol collisions are reported.
$ExportRows = @(
    $ExportRows |
        Group-Object Symbol, File |
        ForEach-Object {
            $_.Group[0]
        }
)

$DuplicateExportGroups = @(
    $ExportRows |
        Group-Object Symbol |
        Where-Object {
            $_.Count -gt 1
        }
)

$DuplicateExports = foreach (
    $Group in $DuplicateExportGroups
) {

    foreach ($Item in $Group.Group) {

        [PSCustomObject]@{
            Symbol      = $Group.Name
            Occurrences = $Group.Count
            File        = $Item.File
        }
    }
}

$DuplicateExports |
    Sort-Object Symbol, File |
    Export-Csv `
        (Join-Path $Reports "duplicate-exports.csv") `
        -NoTypeInformation

# ============================================================
# 9. IMPORT GRAPH
# ============================================================

Write-Step "Building static import graph"

$ImportRows = @()

$ImportRegexes = @(
    '(?m)^\s*import\s+(?:type\s+)?(?:.+?\s+from\s+)?["'']([^"'']+)["'']',
    '(?m)^\s*export\s+.+?\s+from\s+["'']([^"'']+)["'']',
    'import\(\s*["'']([^"'']+)["'']\s*\)',
    'require\(\s*["'']([^"'']+)["'']\s*\)'
)

foreach ($Entry in $FileContents.GetEnumerator()) {

    $Importer = $Entry.Key
    $Content = $Entry.Value

    foreach ($Regex in $ImportRegexes) {

        foreach (
            $Match in [regex]::Matches(
                $Content,
                $Regex
            )
        ) {

            if ($Match.Groups.Count -gt 1) {

                $ImportRows +=
                    [PSCustomObject]@{
                        Importer = $Importer
                        Import   = $Match.Groups[1].Value
                    }
            }
        }
    }
}

$ImportRows |
    Sort-Object Importer, Import |
    Export-Csv `
        (Join-Path $Reports "imports.csv") `
        -NoTypeInformation

# ============================================================
# 10. SOURCE REFERENCE COUNTS
# ============================================================

Write-Step "Estimating source-file references"

$ReferenceRows = @()

foreach ($File in $SourceFiles) {

    $Relative =
        Get-RelativePathSafe $File.FullName

    $Directory =
        [System.IO.Path]::GetDirectoryName(
            $Relative
        )

    $BaseName =
        [System.IO.Path]::GetFileNameWithoutExtension(
            $Relative
        )

    $RelativeNoExt =
        if ($Directory) {
            "$Directory\$BaseName"
        }
        else {
            $BaseName
        }

    $Normalized =
        $RelativeNoExt.Replace("\", "/")

    $AliasPath =
        ($Normalized -replace '^src/', '')

    $EscapedRelative =
        [regex]::Escape($Normalized)

    $EscapedAlias =
        [regex]::Escape("@/$AliasPath")

    # Same-directory / parent-relative imports (./foo, ../foo) never contain
    # the full repo-relative path above, so they're invisible to
    # $EscapedRelative and $EscapedAlias. Match any relative import string
    # that ends in this file's own basename as a fallback. This can produce
    # false negatives (crediting a reference meant for a different same-named
    # file elsewhere) rather than false positives — the safer direction for
    # a report meant to surface deletion *candidates*.
    $EscapedBaseName =
        [regex]::Escape($BaseName)

    $RelativeImportPattern =
        "[""']\.[^""']*?/$EscapedBaseName[""']"

    $References = 0
    $ReferencingFiles = @()

    foreach ($Entry in $FileContents.GetEnumerator()) {

        if ($Entry.Key -eq $Relative) {
            continue
        }

        $Content = $Entry.Value

        if (
            $Content -match $EscapedRelative -or
            $Content -match $EscapedAlias -or
            $Content -match $RelativeImportPattern
        ) {

            $References++

            $ReferencingFiles += $Entry.Key
        }
    }

    $ReferenceRows +=
        [PSCustomObject]@{
            File             = $Relative
            EstimatedImports = $References
            ReferencedBy     = (
                $ReferencingFiles -join "; "
            )
        }
}

$ReferenceRows |
    Sort-Object EstimatedImports, File |
    Export-Csv `
        (Join-Path $Reports "source-reference-counts.csv") `
        -NoTypeInformation

# ============================================================
# 11. POTENTIAL ORPHAN FILES
# ============================================================

Write-Step "Identifying potentially orphaned source files"

$OrphanCandidates = @()

foreach ($Row in $ReferenceRows) {

    $Path = $Row.File

    $IsFrameworkEntry =
        $Path -match `
        '(^|/|\\)(page|layout|loading|error|not-found|global-error|template|default|route)\.(ts|tsx|js|jsx)$'

    $IsConfig =
        $Path -match `
        '(next\.config|middleware|instrumentation|proxy|sitemap|robots)'

    $IsEntryPoint =
        $Path -match `
        '(^|/|\\)(index|main)\.(ts|tsx|js|jsx)$'

    if (
        $Row.EstimatedImports -eq 0 -and
        -not $IsFrameworkEntry -and
        -not $IsConfig -and
        -not $IsEntryPoint
    ) {

        $OrphanCandidates += $Row
    }
}

$OrphanCandidates |
    Export-Csv `
        (Join-Path $Reports "potentially-orphaned-source-files.csv") `
        -NoTypeInformation

# ============================================================
# 12. API ROUTES
# ============================================================

Write-Step "Auditing API routes"

$ApiRoutes = $SourceFiles |
    Where-Object {

        $Relative =
            Get-RelativePathSafe $_.FullName

        $Relative -match '(^|/|\\)api(/|\\)' -and
        $_.Name -match '^route\.(ts|tsx|js|jsx)$'
    } |
    ForEach-Object {

        $Relative =
            Get-RelativePathSafe $_.FullName

        $Content =
            $FileContents[$Relative]

        $Methods = @()

        foreach ($Method in @(
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "HEAD",
            "OPTIONS"
        )) {

            if (
                $Content -match
                "(?m)\bexport\s+(?:async\s+)?function\s+$Method\b"
            ) {

                $Methods += $Method
            }
            elseif (
                $Content -match
                "(?m)\bexport\s+const\s+$Method\b"
            ) {

                $Methods += $Method
            }
        }

        [PSCustomObject]@{
            Route =
                $Relative.Replace("\", "/")

            Methods =
                ($Methods -join ", ")

            Lines =
                Get-LineCount $_.FullName
        }
    }

$ApiRoutes |
    Sort-Object Route |
    Export-Csv `
        (Join-Path $Reports "api-routes.csv") `
        -NoTypeInformation

# ============================================================
# 13. NEXT.JS ROUTE INVENTORY
# ============================================================

Write-Step "Auditing Next.js route files"

$NextRoutes = $SourceFiles |
    Where-Object {

        $_.Name -match `
        '^(page|layout|loading|error|not-found|template|default|global-error)\.(ts|tsx|js|jsx)$'
    } |
    ForEach-Object {

        [PSCustomObject]@{
            Type =
                $_.BaseName

            RouteFile =
                Get-RelativePathSafe $_.FullName

            Lines =
                Get-LineCount $_.FullName
        }
    }

$NextRoutes |
    Sort-Object RouteFile |
    Export-Csv `
        (Join-Path $Reports "nextjs-routes.csv") `
        -NoTypeInformation

# ============================================================
# 14. SUPABASE CLIENT AUDIT
# ============================================================

Write-Step "Auditing Supabase usage"

$SupabaseRows = foreach (
    $Entry in $FileContents.GetEnumerator()
) {

    $Content = $Entry.Value

    if (
        $Content -match '@supabase/' -or
        $Content -match 'createClient\s*\(' -or
        $Content -match 'createServerClient\s*\(' -or
        $Content -match 'createBrowserClient\s*\('
    ) {

        [PSCustomObject]@{
            File =
                $Entry.Key

            CreateClient =
                [bool](
                    $Content -match
                    'createClient\s*\('
                )

            ServerClient =
                [bool](
                    $Content -match
                    'createServerClient\s*\('
                )

            BrowserClient =
                [bool](
                    $Content -match
                    'createBrowserClient\s*\('
                )
        }
    }
}

$SupabaseRows |
    Sort-Object File |
    Export-Csv `
        (Join-Path $Reports "supabase-client-usage.csv") `
        -NoTypeInformation

# ============================================================
# 15. AUTHORIZATION / AUTHENTICATION AUDIT
# ============================================================

Write-Step "Auditing authentication and authorization"

$AuthRows = foreach (
    $Entry in $FileContents.GetEnumerator()
) {

    $Content = $Entry.Value

    $Signals = @(
        'getUser\s*\(',
        'getSession\s*\(',
        'auth\.getUser',
        'auth\.getSession',
        'signIn',
        'signOut',
        'authorize',
        'authorization',
        'permission',
        'role',
        'RBAC',
        'MFA',
        'middleware'
    )

    $MatchedSignals = @()

    foreach ($Signal in $Signals) {

        if ($Content -match $Signal) {
            $MatchedSignals += $Signal
        }
    }

    if ($MatchedSignals.Count -ge 2) {

        [PSCustomObject]@{
            File =
                $Entry.Key

            SignalCount =
                $MatchedSignals.Count

            Signals =
                ($MatchedSignals -join "; ")
        }
    }
}

$AuthRows |
    Sort-Object SignalCount -Descending |
    Export-Csv `
        (Join-Path $Reports "auth-authorization-usage.csv") `
        -NoTypeInformation

# ============================================================
# 16. SERVICE / BUSINESS LOGIC INVENTORY
# ============================================================

Write-Step "Auditing services and business logic"

$ServiceRows =
    $SourceFiles |
    Where-Object {

        $_.FullName -match '\\(services|service|lib)\\' -or
        $_.Name -match `
        '(?i)(service|repository|manager|handler|provider|adapter)'
    } |
    ForEach-Object {

        [PSCustomObject]@{
            File =
                Get-RelativePathSafe $_.FullName

            Name =
                $_.Name

            Lines =
                Get-LineCount $_.FullName
        }
    }

$ServiceRows |
    Sort-Object Name |
    Export-Csv `
        (Join-Path $Reports "service-inventory.csv") `
        -NoTypeInformation

# ============================================================
# 17. DEBUG / TODO / FIXME
# ============================================================

Write-Step "Detecting debugging and stale development markers"

$DebugRows = @()

foreach ($Entry in $FileContents.GetEnumerator()) {

    $Lines =
        $Entry.Value -split "`r?`n"

    for (
        $i = 0;
        $i -lt $Lines.Count;
        $i++
    ) {

        $Line = $Lines[$i]

        # -cmatch (case-sensitive) below is deliberate for the all-caps
        # markers: -match is case-insensitive by default, which flagged
        # incidental lowercase prose like "temporary password" and "hack
        # the Platform" as if they were developer TODO/FIXME/HACK markers.
        if (
            $Line -match
            '\bconsole\.(log|debug|info|warn|error)\s*\(' -or

            $Line -match
            '\bdebugger\s*;' -or

            $Line -cmatch
            '\bTODO\b' -or

            $Line -cmatch
            '\bFIXME\b' -or

            $Line -cmatch
            '\bHACK\b' -or

            $Line -cmatch
            'TEMPORARY' -or

            $Line -cmatch
            'DO NOT SHIP'
        ) {

            $DebugRows +=
                [PSCustomObject]@{
                    File =
                        $Entry.Key

                    Line =
                        $i + 1

                    Content =
                        $Line.Trim()
                }
        }
    }
}

$DebugRows |
    Export-Csv `
        (Join-Path $Reports "debug-todo-fixme.csv") `
        -NoTypeInformation

# ============================================================
# 18. TYPESCRIPT SUPPRESSIONS
# ============================================================

Write-Step "Detecting TypeScript suppressions and any"

$TypeScriptRows = @()

foreach ($Entry in $FileContents.GetEnumerator()) {

    $Lines =
        $Entry.Value -split "`r?`n"

    for (
        $i = 0;
        $i -lt $Lines.Count;
        $i++
    ) {

        $Line = $Lines[$i]

        if (
            $Line -match '@ts-ignore' -or
            $Line -match '@ts-nocheck' -or
            $Line -match '@ts-expect-error' -or
            $Line -match '\bany\b'
        ) {

            $TypeScriptRows +=
                [PSCustomObject]@{
                    File =
                        $Entry.Key

                    Line =
                        $i + 1

                    Content =
                        $Line.Trim()
                }
        }
    }
}

$TypeScriptRows |
    Export-Csv `
        (Join-Path $Reports "typescript-suppressions-and-any.csv") `
        -NoTypeInformation

# ============================================================
# 19. REACT / NEXT.JS RISK PATTERNS
# ============================================================

Write-Step "Detecting React/Next.js patterns requiring review"

$ReactRiskRows = @()

foreach ($Entry in $FileContents.GetEnumerator()) {

    $Content = $Entry.Value

    $Patterns = @(
        "useEffect\s*\(",
        "window\.",
        "document\.",
        "localStorage",
        "sessionStorage",
        "dangerouslySetInnerHTML",
        "use client",
        "use server",
        "getServerSideProps",
        "getStaticProps",
        "next/router",
        "next/navigation"
    )

    foreach ($Pattern in $Patterns) {

        $Count =
            ([regex]::Matches(
                $Content,
                $Pattern
            )).Count

        if ($Count -gt 0) {

            $ReactRiskRows +=
                [PSCustomObject]@{
                    File =
                        $Entry.Key

                    Pattern =
                        $Pattern

                    Count =
                        $Count
                }
        }
    }
}

$ReactRiskRows |
    Export-Csv `
        (Join-Path $Reports "react-next-risk-patterns.csv") `
        -NoTypeInformation

# ============================================================
# 20. ENVIRONMENT VARIABLES
# ============================================================

Write-Step "Auditing environment variables"

$EnvRows = @()

foreach ($Entry in $FileContents.GetEnumerator()) {

    $Matches =
        [regex]::Matches(
            $Entry.Value,
            'process\.env\.([A-Z0-9_]+)'
        )

    foreach ($Match in $Matches) {

        $EnvRows +=
            [PSCustomObject]@{
                Variable =
                    $Match.Groups[1].Value

                File =
                    $Entry.Key
            }
    }
}

$EnvRows |
    Sort-Object Variable, File |
    Export-Csv `
        (Join-Path $Reports "environment-variable-usage.csv") `
        -NoTypeInformation

$EnvSummary =
    $EnvRows |
    Group-Object Variable |
    Sort-Object Count -Descending |
    ForEach-Object {

        [PSCustomObject]@{
            Variable =
                $_.Name

            References =
                $_.Count

            Files =
                ($_.Group.File -join "; ")
        }
    }

$EnvSummary |
    Export-Csv `
        (Join-Path $Reports "environment-variable-summary.csv") `
        -NoTypeInformation

# ============================================================
# 21. NPM DEPENDENCIES
# ============================================================

Write-Step "Auditing npm dependencies"

$PackagePath =
    Join-Path $Repo "package.json"

$DependencyRows = @()

if (Test-Path -LiteralPath $PackagePath) {

    try {

        $Package =
            Get-Content `
                $PackagePath `
                -Raw |
            ConvertFrom-Json

        $DeclaredDependencies = @{}

        if ($Package.dependencies) {

            foreach (
                $Property in
                $Package.dependencies.PSObject.Properties
            ) {

                $DeclaredDependencies[
                    $Property.Name
                ] = "dependencies"
            }
        }

        if ($Package.devDependencies) {

            foreach (
                $Property in
                $Package.devDependencies.PSObject.Properties
            ) {

                $DeclaredDependencies[
                    $Property.Name
                ] = "devDependencies"
            }
        }

        foreach (
            $Dependency in
            $DeclaredDependencies.Keys
        ) {

            $Escaped =
                [regex]::Escape($Dependency)

            $Count = 0
            $FilesUsing = @()

            foreach (
                $Entry in
                $FileContents.GetEnumerator()
            ) {

                if (
                    $Entry.Value -match
                    "from\s+['""]$Escaped(?:/[^'""]*)?['""]"
                ) {

                    $Count++
                    $FilesUsing += $Entry.Key
                }
                elseif (
                    $Entry.Value -match
                    "require\s*\(\s*['""]$Escaped(?:/[^'""]*)?['""]"
                ) {

                    $Count++
                    $FilesUsing += $Entry.Key
                }
                elseif (
                    $Entry.Value -match
                    "import\s*\(\s*['""]$Escaped(?:/[^'""]*)?['""]"
                ) {

                    $Count++
                    $FilesUsing += $Entry.Key
                }
            }

            $DependencyRows +=
                [PSCustomObject]@{
                    Package =
                        $Dependency

                    DeclaredIn =
                        $DeclaredDependencies[$Dependency]

                    StaticReferences =
                        $Count

                    Files =
                        ($FilesUsing -join "; ")
                }
        }
    }
    catch {

        Write-Warning `
            "Could not parse package.json"
    }
}

$DependencyRows |
    Sort-Object StaticReferences, Package |
    Export-Csv `
        (Join-Path $Reports "dependency-usage.csv") `
        -NoTypeInformation

# ============================================================
# 22. PACKAGE MANAGER FILES
# ============================================================

Write-Step "Checking package manager files"

$PackageManagerRows = @()

foreach ($Name in @(
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "bun.lock"
)) {

    $Path =
        Join-Path $Repo $Name

    if (Test-Path -LiteralPath $Path) {

        $File =
            Get-Item -LiteralPath $Path

        $PackageManagerRows +=
            [PSCustomObject]@{
                File =
                    $Name

                SizeKB =
                    [math]::Round(
                        $File.Length / 1KB,
                        2
                    )

                LastWrite =
                    $File.LastWriteTime
            }
    }
}

$PackageManagerRows |
    Export-Csv `
        (Join-Path $Reports "package-manager-files.csv") `
        -NoTypeInformation

# ============================================================
# 23. CSS / TAILWIND
# ============================================================

Write-Step "Auditing CSS and Tailwind"

$StyleFiles =
    Get-ChildItem `
        -Path $Repo `
        -Recurse `
        -File `
        -ErrorAction SilentlyContinue |
    Where-Object {

        $_.Extension.ToLowerInvariant() -in @(
            ".css",
            ".scss",
            ".sass"
        ) -and
        (-not (Test-IsExcludedPath $_.FullName))
    }

$StyleRows = foreach (
    $File in $StyleFiles
) {

    try {

        $Content =
            Get-Content `
                -LiteralPath $File.FullName `
                -Raw `
                -ErrorAction Stop
    }
    catch {
        $Content = ""
    }

    [PSCustomObject]@{

        File =
            Get-RelativePathSafe $File.FullName

        Lines =
            Get-LineCount $File.FullName

        TailwindMarkers =
            ([regex]::Matches(
                $Content,
                '@tailwind|@apply'
            )).Count

        CSSVariables =
            ([regex]::Matches(
                $Content,
                '--[A-Za-z0-9_-]+\s*:'
            )).Count

        MediaQueries =
            ([regex]::Matches(
                $Content,
                '@media'
            )).Count
    }
}

$StyleRows |
    Sort-Object Lines -Descending |
    Export-Csv `
        (Join-Path $Reports "style-inventory.csv") `
        -NoTypeInformation

# ============================================================
# 24. DUPLICATE LONG STRING CANDIDATES
# ============================================================

Write-Step "Detecting repeated long string literals"

$StringRows = @()

foreach ($Entry in $FileContents.GetEnumerator()) {

    foreach (
        $Match in [regex]::Matches(
            $Entry.Value,
            '(?<![A-Za-z0-9_])["'']([^"'']{40,})["'']'
        )
    ) {

        $Value =
            $Match.Groups[1].Value.Trim()

        if (
            $Value -and
            $Value -notmatch '^https?://' -and
            $Value -notmatch '^[A-Za-z0-9+/=_-]{40,}$'
        ) {

            $StringRows +=
                [PSCustomObject]@{
                    Value =
                        $Value

                    File =
                        $Entry.Key
                }
        }
    }
}

$DuplicateStringGroups = @(
    $StringRows |
        Group-Object Value |
        Where-Object {
            $_.Count -gt 1
        }
)

$DuplicateStrings = foreach (
    $Group in $DuplicateStringGroups
) {

    [PSCustomObject]@{
        Occurrences =
            $Group.Count

        Value =
            $Group.Name

        Files =
            ($Group.Group.File -join "; ")
    }
}

$DuplicateStrings |
    Sort-Object Occurrences -Descending |
    Export-Csv `
        (Join-Path $Reports "duplicate-string-candidates.csv") `
        -NoTypeInformation

# ============================================================
# 25. REPOSITORY ARTIFACTS
# ============================================================

Write-Step "Auditing repository artifacts"

$ArtifactPattern =
    '(?i)(\.bak$|\.backup$|\.old$|\.orig$|\.tmp$|\.temp$|\.swp$|~$|\.canvas$|\.base$)'

$ArtifactFiles =
    Get-ChildItem `
        -Path $Repo `
        -Recurse `
        -File `
        -ErrorAction SilentlyContinue |
    Where-Object {

        (-not (Test-IsExcludedPath $_.FullName)) -and
        $_.Name -match $ArtifactPattern
    } |
    ForEach-Object {

        [PSCustomObject]@{
            File =
                Get-RelativePathSafe $_.FullName

            SizeKB =
                [math]::Round(
                    $_.Length / 1KB,
                    2
                )

            LastWrite =
                $_.LastWriteTime
        }
    }

$ArtifactFiles |
    Sort-Object LastWrite |
    Export-Csv `
        (Join-Path $Reports "artifacts.csv") `
        -NoTypeInformation

# ============================================================
# 26. GIT TRACKED FILES
# ============================================================

Write-Step "Checking Git tracked files"

$TrackedFiles = @(
    & git ls-files 2>$null |
        Where-Object {
            $_
        }
)

$TrackedRows = foreach (
    $Path in $TrackedFiles
) {

    [PSCustomObject]@{

        TrackedFile =
            $Path

        ExistsOnDisk =
            Test-Path -LiteralPath (
                Join-Path $Repo $Path
            )
    }
}

$TrackedRows |
    Export-Csv `
        (Join-Path $Reports "git-tracked-files.csv") `
        -NoTypeInformation

$MissingTrackedFiles =
    $TrackedRows |
    Where-Object {
        -not $_.ExistsOnDisk
    }

$MissingTrackedFiles |
    Export-Csv `
        (Join-Path $Reports "missing-git-tracked-files.csv") `
        -NoTypeInformation

# ============================================================
# 27. TOOLCHAIN
# ============================================================

Write-Step "Checking available development tools"

$ToolRows = foreach (
    $Command in @(
        "node",
        "npm",
        "npx",
        "git",
        "rg"
    )
) {

    $CommandInfo =
        Get-Command `
            $Command `
            -ErrorAction SilentlyContinue

    $Version = ""

    if ($CommandInfo) {

        try {

            $Version =
                & $Command --version 2>$null |
                Select-Object -First 1
        }
        catch {
            $Version = ""
        }
    }

    [PSCustomObject]@{

        Tool =
            $Command

        Available =
            [bool]$CommandInfo

        Path =
            if ($CommandInfo) {
                $CommandInfo.Source
            }
            else {
                ""
            }

        Version =
            $Version
    }
}

$ToolRows |
    Export-Csv `
        (Join-Path $Reports "toolchain.csv") `
        -NoTypeInformation

# ============================================================
# 28. TYPESCRIPT
# ============================================================

Write-Step "Running TypeScript check"

$TsOut =
    Join-Path $Reports "typescript-check.txt"

try {

    $TsResult =
        & npx tsc --noEmit 2>&1

    $TsExit =
        $LASTEXITCODE

    Save-Text `
        $TsOut `
        (
            "ExitCode: $TsExit`r`n`r`n" +
            ($TsResult -join "`r`n")
        )
}
catch {

    Save-Text `
        $TsOut `
        $_.Exception.Message
}

# ============================================================
# 29. ESLINT
# ============================================================

Write-Step "Running ESLint check"

$LintOut =
    Join-Path $Reports "eslint-check.txt"

try {

    $LintResult =
        & npm run lint 2>&1

    $LintExit =
        $LASTEXITCODE

    Save-Text `
        $LintOut `
        (
            "ExitCode: $LintExit`r`n`r`n" +
            ($LintResult -join "`r`n")
        )
}
catch {

    Save-Text `
        $LintOut `
        $_.Exception.Message
}

# ============================================================
# 30. NPM AUDIT
# ============================================================

Write-Step "Running read-only npm audit"

$NpmAuditOut =
    Join-Path $Reports "npm-audit.json"

try {

    $AuditResult =
        & npm audit --json 2>&1

    Save-Text `
        $NpmAuditOut `
        (
            $AuditResult -join "`r`n"
        )
}
catch {

    Save-Text `
        $NpmAuditOut `
        $_.Exception.Message
}

# ============================================================
# 31. SUMMARY
# ============================================================

Write-Step "Building summary"

$Summary = [ordered]@{

    Repository =
        $Repo

    AuditDirectory =
        $AuditRoot

    Started =
        $StartedAt

    Completed =
        Get-Date

    Branch =
        $Branch

    SourceFiles =
        $SourceFiles.Count

    DuplicateFileGroups =
        $DuplicateFileGroups.Count

    DuplicateFunctionGroups =
        $DuplicateFunctionGroups.Count

    DuplicateExportGroups =
        $DuplicateExportGroups.Count

    PotentialOrphanFiles =
        $OrphanCandidates.Count

    LegacyLookingFiles =
        $LegacyFiles.Count

    DebugTodoFixmeOccurrences =
        $DebugRows.Count

    TypeScriptSuppressionOrAnyOccurrences =
        $TypeScriptRows.Count

    LargeSourceFiles =
        $LargeFiles.Count

    ApiRoutes =
        $ApiRoutes.Count

    NextJsRoutes =
        $NextRoutes.Count

    SupabaseRelatedFiles =
        $SupabaseRows.Count

    ServiceFiles =
        $ServiceRows.Count

    ArtifactFiles =
        $ArtifactFiles.Count

    EnvironmentVariablesReferenced =
        @($EnvSummary).Count

    GitStatusEntries =
        @($GitStatus).Count
}

$Summary |
    ConvertTo-Json -Depth 5 |
    Out-File `
        (Join-Path $Reports "summary.json") `
        -Encoding UTF8

# ============================================================
# 32. HUMAN-READABLE REPORT
# ============================================================

Write-Step "Generating CODEBASE-CLEANUP-AUDIT.md"

$Report = @"

# KITABU YETU — CODEBASE CLEANUP & DEDUPLICATION AUDIT

Audit timestamp: $Timestamp

Repository:

$Repo

Audit directory:

$AuditRoot

---

## IMPORTANT

This is a READ-ONLY static analysis.

No source code was deleted or modified.

Static analysis produces candidates for review.

A candidate is NOT automatically considered dead code.

---

# EXECUTIVE SUMMARY

| Metric | Count |
|---|---:|
| Source files | $($SourceFiles.Count) |
| Exact duplicate file groups | $($DuplicateFileGroups.Count) |
| Duplicate function-name groups | $($DuplicateFunctionGroups.Count) |
| Duplicate export groups | $($DuplicateExportGroups.Count) |
| Potentially orphaned source files | $($OrphanCandidates.Count) |
| Legacy-looking source files | $($LegacyFiles.Count) |
| Debug/TODO/FIXME occurrences | $($DebugRows.Count) |
| TypeScript suppression/any occurrences | $($TypeScriptRows.Count) |
| Large source files | $($LargeFiles.Count) |
| API routes | $($ApiRoutes.Count) |
| Next.js route files | $($NextRoutes.Count) |
| Supabase-related files | $($SupabaseRows.Count) |
| Service/business-logic files | $($ServiceRows.Count) |
| Repository artifacts | $($ArtifactFiles.Count) |
| Environment variables referenced | $(@($EnvSummary).Count) |

---

# PRIORITY 0 — SECURITY / CORRECTNESS

Review first:

1. Authentication duplication
2. Authorization duplication
3. Tenant isolation
4. Supabase client boundaries
5. M-Pesa callbacks
6. Financial calculations
7. API security
8. Privileged service-role usage

---

# PRIORITY 1 — DUPLICATE BUSINESS LOGIC

Review:

- services
- repositories
- database helpers
- validation
- notification logic
- financial calculations
- member operations

Particular attention should be paid to:

- savings
- shares
- loans
- welfare
- attendance
- projects
- ledger
- statements
- share-out
- M-Pesa
- SMS
- email
- billing
- treasury

---

# PRIORITY 2 — DUPLICATE UI

Review:

- components
- hooks
- forms
- navigation
- layouts
- tables
- cards
- modals

The Main Kitabu Yetu repository's business logic must remain intact.

The UI repository remains the visual/design reference.

---

# PRIORITY 3 — DEAD / STALE CODE

Review:

- potentially orphaned files
- legacy-looking files
- unused functions
- obsolete components
- obsolete routes
- stale dependencies
- debug remnants

Do NOT bulk-delete these.

---

# PRIORITY 4 — CODE QUALITY

Review:

- TypeScript suppressions
- any
- lint issues
- console logging
- TODO/FIXME/HACK
- duplicate constants
- CSS duplication
- repeated long strings

---

# GENERATED REPORTS

## Core

- reports/summary.json
- reports/source-inventory.csv

## Duplication

- reports/duplicate-files.csv
- reports/duplicate-function-names.csv
- reports/duplicate-exports.csv
- reports/duplicate-string-candidates.csv

## References

- reports/imports.csv
- reports/source-reference-counts.csv
- reports/potentially-orphaned-source-files.csv

## Next.js / API

- reports/api-routes.csv
- reports/nextjs-routes.csv

## Architecture

- reports/supabase-client-usage.csv
- reports/auth-authorization-usage.csv
- reports/service-inventory.csv

## Code quality

- reports/debug-todo-fixme.csv
- reports/typescript-suppressions-and-any.csv
- reports/react-next-risk-patterns.csv
- reports/large-source-files.csv

## Configuration

- reports/environment-variable-usage.csv
- reports/environment-variable-summary.csv
- reports/dependency-usage.csv
- reports/package-manager-files.csv

## Styling

- reports/style-inventory.csv

## Repository

- reports/artifacts.csv
- reports/git-status.txt
- reports/git-latest-commit.txt
- reports/git-tracked-files.csv
- reports/missing-git-tracked-files.csv

## Validation

- reports/typescript-check.txt
- reports/eslint-check.txt
- reports/npm-audit.json
- reports/toolchain.csv

---

# CLEANUP SAFETY RULES

A file must NOT be deleted merely because:

- it has zero static imports
- it looks old
- its name contains "legacy"
- another function has the same name
- another file looks similar
- a dependency has zero obvious source references

Before removal, verify:

1. Git history
2. imports
3. dynamic imports
4. Next.js filesystem conventions
5. server actions
6. API consumers
7. environment configuration
8. database dependencies
9. production integrations
10. business logic
11. tests
12. production build

---

# VALIDATION GATES

After every cleanup batch:

    npm run lint

    npx tsc --noEmit

    npm run build

Then:

    git diff

    git status

---

# DEPLOYMENT RULE

Do not deploy cleanup changes until:

1. The cleanup is reviewed.
2. TypeScript passes.
3. Lint is reviewed/fixed.
4. Production build passes.
5. Critical API/auth/business workflows are tested.
6. Git diff is reviewed.
7. A recovery checkpoint exists.

---

# AUDIT PHILOSOPHY

The objective is NOT to minimize the number of files.

The objective is to create:

- one canonical implementation for each responsibility
- clear architectural boundaries
- no unnecessary duplicate business logic
- no unverified dead code
- consistent authentication
- consistent authorization
- consistent database access
- maintainable UI
- predictable API behavior
- production-safe code

This report is the evidence-gathering phase.

Cleanup should be performed only after reviewing the evidence.

"@

Save-Text `
    (Join-Path $AuditRoot "CODEBASE-CLEANUP-AUDIT.md") `
    $Report

# ============================================================
# 33. FINAL OUTPUT
# ============================================================

$CompletedAt =
    Get-Date

$Duration =
    $CompletedAt - $StartedAt

Write-Section "AUDIT COMPLETE"

Write-Host ""
Write-Host "Audit directory:" `
    -ForegroundColor Green

Write-Host $AuditRoot

Write-Host ""
Write-Host "KEY FINDINGS" `
    -ForegroundColor Cyan

Write-Host ""
Write-Host "Source files                    : $($SourceFiles.Count)"
Write-Host "Exact duplicate groups         : $($DuplicateFileGroups.Count)"
Write-Host "Duplicate function groups      : $($DuplicateFunctionGroups.Count)"
Write-Host "Duplicate export groups        : $($DuplicateExportGroups.Count)"
Write-Host "Potential orphan files         : $($OrphanCandidates.Count)"
Write-Host "Legacy-looking files           : $($LegacyFiles.Count)"
Write-Host "Debug/TODO/FIXME occurrences   : $($DebugRows.Count)"
Write-Host "TS suppression/any occurrences : $($TypeScriptRows.Count)"
Write-Host "Large source files             : $($LargeFiles.Count)"
Write-Host "API routes                     : $($ApiRoutes.Count)"
Write-Host "Next.js routes                 : $($NextRoutes.Count)"
Write-Host "Supabase-related files         : $($SupabaseRows.Count)"
Write-Host "Service files                  : $($ServiceRows.Count)"
Write-Host "Artifacts                      : $($ArtifactFiles.Count)"
Write-Host "Environment variables          : $(@($EnvSummary).Count)"

Write-Host ""
Write-Host "PRIMARY REPORT" `
    -ForegroundColor Green

Write-Host (
    Join-Path `
        $AuditRoot `
        "CODEBASE-CLEANUP-AUDIT.md"
)

Write-Host ""
Write-Host "Duration: $($Duration.ToString())" `
    -ForegroundColor DarkGray

Write-Host ""
Write-Host "NO SOURCE CODE WAS DELETED OR MODIFIED." `
    -ForegroundColor Yellow

Write-Host ""
Write-Host "============================================================" `
    -ForegroundColor Green

Write-Host " READ-ONLY CODEBASE AUDIT FINISHED" `
    -ForegroundColor Green

Write-Host "============================================================" `
    -ForegroundColor Green