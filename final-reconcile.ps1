#requires -Version 5.1

<#
===============================================================
 KITABU YETU - FINAL PRODUCTION/TEMPLATE RECONCILIATION
 PowerShell 5.1 compatible
===============================================================

 AUTHORITATIVE APP:
   D:\Claude\Projects\KITABU YETU\kitabuyetu

 TEMPLATE:
   D:\Templates\Kitabu Yetu UI

 PRINCIPLES:
   1. Root app/ remains authoritative.
   2. src/ is NOT activated.
   3. Root aliases point to root directories.
   4. Lowercase UI filenames/imports are canonical.
   5. Existing production files are never blindly overwritten.
   6. Existing public assets are preserved.
   7. Dynamic [id] paths are handled literally.
   8. A timestamped backup is created before changes.
   9. Migration stops on unsafe/ambiguous conditions.
  10. TypeScript, lint and production build are final gates.
#>

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------------

$ProjectRoot = "D:\Claude\Projects\KITABU YETU\kitabuyetu"
$TemplateRoot = "D:\Templates\Kitabu Yetu UI"

Set-Location -LiteralPath $ProjectRoot

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " KITABU YETU - FINAL RECONCILIATION" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------

function Assert-Directory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not [System.IO.Directory]::Exists($Path)) {
        throw "Required directory does not exist: $Path"
    }
}

function Assert-File {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not [System.IO.File]::Exists($Path)) {
        throw "Required file does not exist: $Path"
    }
}

function Ensure-Directory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not [System.IO.Directory]::Exists($Path)) {
        [void][System.IO.Directory]::CreateDirectory($Path)
    }
}

function Read-TextFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    return [System.IO.File]::ReadAllText($Path)
}

function Write-TextFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Content
    )

    [System.IO.File]::WriteAllText(
        $Path,
        $Content,
        (New-Object System.Text.UTF8Encoding($false))
    )
}

function Copy-LiteralFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    Assert-File $Source

    $parent = [System.IO.Path]::GetDirectoryName($Destination)

    if ($parent) {
        Ensure-Directory $parent
    }

    [System.IO.File]::Copy($Source, $Destination, $true)
}

function Move-LiteralFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    Assert-File $Source

    $parent = [System.IO.Path]::GetDirectoryName($Destination)

    if ($parent) {
        Ensure-Directory $parent
    }

    if ([System.IO.File]::Exists($Destination)) {
        throw "Destination already exists: $Destination"
    }

    [System.IO.File]::Move($Source, $Destination)
}

function Get-Sha256 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    Assert-File $Path

    $sha = [System.Security.Cryptography.SHA256]::Create()

    try {
        $bytes = [System.IO.File]::ReadAllBytes($Path)
        $hash = $sha.ComputeHash($bytes)

        return (
            [System.BitConverter]::ToString($hash)
        ).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Get-ActualFileEntry {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Directory,

        [Parameter(Mandatory = $true)]
        [string]$ExactName
    )

    if (-not [System.IO.Directory]::Exists($Directory)) {
        return $null
    }

    $entries = @(
        Get-ChildItem -LiteralPath $Directory -File -Force
    )

    foreach ($entry in $entries) {
        if ($entry.Name -ceq $ExactName) {
            return $entry
        }
    }

    return $null
}

function Get-AllFiles {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    if (-not [System.IO.Directory]::Exists($Root)) {
        return @()
    }

    return @(
        Get-ChildItem -LiteralPath $Root -File -Recurse -Force
    )
}

function Replace-TextExact {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Old,

        [Parameter(Mandatory = $true)]
        [string]$New
    )

    $content = Read-TextFile $Path

    if ($content.Contains($Old)) {
        $updated = $content.Replace($Old, $New)

        if ($updated -ne $content) {
            Write-TextFile $Path $updated
            return $true
        }
    }

    return $false
}

function Backup-File {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [string]$BackupRoot
    )

    $relative = $Source.Substring($ProjectRoot.Length).TrimStart(
        [char[]]@("\", "/")
    )

    $destination = Join-Path $BackupRoot $relative

    Copy-LiteralFile $Source $destination
}

# ---------------------------------------------------------------
# PRE-FLIGHT
# ---------------------------------------------------------------

Write-Host "[1/10] Pre-flight checks..." -ForegroundColor Yellow

Assert-Directory $ProjectRoot
Assert-Directory $TemplateRoot

$PackageJson = Join-Path $ProjectRoot "package.json"
$TsConfig = Join-Path $ProjectRoot "tsconfig.json"

Assert-File $PackageJson
Assert-File $TsConfig

Write-Host "       Project root: $ProjectRoot" -ForegroundColor Green
Write-Host "       Template root: $TemplateRoot" -ForegroundColor Green

# Confirm this really looks like the production tree.
$ProductionApp = Join-Path $ProjectRoot "app"

if (-not [System.IO.Directory]::Exists($ProductionApp)) {
    throw "Production app directory is missing: $ProductionApp"
}

Write-Host "       Production app/ confirmed." -ForegroundColor Green

# ---------------------------------------------------------------
# BACKUP
# ---------------------------------------------------------------

Write-Host ""
Write-Host "[2/10] Creating complete source backup..." -ForegroundColor Yellow

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $ProjectRoot (".migration-backup-final-$Stamp")

Ensure-Directory $BackupRoot

$BackupCandidates = @(
    "app",
    "components",
    "lib",
    "types",
    "hooks",
    "services",
    "public",
    "styles",
    "tsconfig.json",
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "package.json"
)

foreach ($relative in $BackupCandidates) {

    $source = Join-Path $ProjectRoot $relative

    if ([System.IO.Directory]::Exists($source)) {

        $files = Get-AllFiles $source

        foreach ($file in $files) {
            Backup-File $file.FullName $BackupRoot
        }
    }
    elseif ([System.IO.File]::Exists($source)) {
        Backup-File $source $BackupRoot
    }
}

Write-Host "       Backup created:" -ForegroundColor Green
Write-Host "       $BackupRoot" -ForegroundColor Green

# ---------------------------------------------------------------
# TEMPLATE COMPONENT RECONCILIATION
# ---------------------------------------------------------------

Write-Host ""
Write-Host "[3/10] Reconciling reusable template components..." -ForegroundColor Yellow

$TemplateComponents = Join-Path $TemplateRoot "src\components"
$RootComponents = Join-Path $ProjectRoot "components"

if ([System.IO.Directory]::Exists($TemplateComponents)) {

    $templateFiles = Get-AllFiles $TemplateComponents

    $copied = 0
    $identical = 0
    $different = 0

    foreach ($file in $templateFiles) {

        $relative = $file.FullName.Substring(
            $TemplateComponents.Length
        ).TrimStart([char[]]@("\", "/"))

        $destination = Join-Path $RootComponents $relative

        if ([System.IO.File]::Exists($destination)) {

            $sourceHash = Get-Sha256 $file.FullName
            $destinationHash = Get-Sha256 $destination

            if ($sourceHash -eq $destinationHash) {
                $identical++
            }
            else {
                $different++
                Write-Host "       CONFLICT preserved: components\$relative" -ForegroundColor DarkYellow
            }
        }
        else {

            Copy-LiteralFile $file.FullName $destination
            $copied++

            Write-Host "       Copied: components\$relative" -ForegroundColor Green
        }
    }

    Write-Host "       Identical: $identical" -ForegroundColor Gray
    Write-Host "       Copied:    $copied" -ForegroundColor Green
    Write-Host "       Conflicts: $different" -ForegroundColor Yellow
}

# ---------------------------------------------------------------
# PUBLIC ASSETS
# ---------------------------------------------------------------

Write-Host ""
Write-Host "[4/10] Reconciling public assets..." -ForegroundColor Yellow

$TemplatePublic = Join-Path $TemplateRoot "public"
$RootPublic = Join-Path $ProjectRoot "public"

if ([System.IO.Directory]::Exists($TemplatePublic)) {

    Ensure-Directory $RootPublic

    $publicFiles = Get-AllFiles $TemplatePublic

    $copiedPublic = 0
    $identicalPublic = 0
    $differentPublic = 0

    foreach ($file in $publicFiles) {

        $relative = $file.FullName.Substring(
            $TemplatePublic.Length
        ).TrimStart([char[]]@("\", "/"))

        $destination = Join-Path $RootPublic $relative

        if ([System.IO.File]::Exists($destination)) {

            $sourceHash = Get-Sha256 $file.FullName
            $destinationHash = Get-Sha256 $destination

            if ($sourceHash -eq $destinationHash) {
                $identicalPublic++
            }
            else {
                $differentPublic++

                Write-Host "       PUBLIC CONFLICT preserved: $relative" -ForegroundColor DarkYellow
            }
        }
        else {

            Copy-LiteralFile $file.FullName $destination
            $copiedPublic++

            Write-Host "       Copied public asset: $relative" -ForegroundColor Green
        }
    }

    Write-Host "       Identical: $identicalPublic" -ForegroundColor Gray
    Write-Host "       Copied:    $copiedPublic" -ForegroundColor Green
    Write-Host "       Conflicts: $differentPublic" -ForegroundColor Yellow
}

# ---------------------------------------------------------------
# NORMALIZE UI FILE CASING
# ---------------------------------------------------------------

Write-Host ""
Write-Host "[5/10] Normalizing UI filename casing..." -ForegroundColor Yellow

$UIRoot = Join-Path $RootComponents "ui"

Assert-Directory $UIRoot

$UiNames = @(
    "Button.tsx",
    "Input.tsx",
    "Badge.tsx",
    "Card.tsx"
)

foreach ($upperName in $UiNames) {

    $lowerName = $upperName.ToLowerInvariant()

    # IMPORTANT:
    # We enumerate the directory and use -ceq because Windows paths
    # themselves are normally case-insensitive.
    $actualUpper = Get-ActualFileEntry $UIRoot $upperName
    $actualLower = Get-ActualFileEntry $UIRoot $lowerName

    if ($actualUpper -and $actualLower) {

        if ($actualUpper.FullName -eq $actualLower.FullName) {

            # Windows may report the same physical file for both
            # case variants. Normalize its physical filename.
            $tempName = "__kitabuyetu_casefix_$([Guid]::NewGuid().ToString('N')).tmp"
            $tempPath = Join-Path $UIRoot $tempName

            Move-LiteralFile $actualUpper.FullName $tempPath
            Move-LiteralFile $tempPath (Join-Path $UIRoot $lowerName)

            Write-Host "       Normalized: $upperName -> $lowerName" -ForegroundColor Green
        }
        else {

            # Genuine case-sensitive collision.
            $upperHash = Get-Sha256 $actualUpper.FullName
            $lowerHash = Get-Sha256 $actualLower.FullName

            if ($upperHash -eq $lowerHash) {

                $collisionDir = Join-Path $BackupRoot "ui-case-collisions"
                Ensure-Directory $collisionDir

                $collisionDestination = Join-Path $collisionDir $actualUpper.Name

                Copy-LiteralFile $actualUpper.FullName $collisionDestination

                [System.IO.File]::Delete($actualUpper.FullName)

                Write-Host "       Removed identical uppercase collision: $($actualUpper.Name)" -ForegroundColor Green
            }
            else {

                throw @"
UNSAFE UI CASE COLLISION DETECTED.

Both files exist and differ:

  $($actualUpper.FullName)
  $($actualLower.FullName)

They were NOT changed.

Resolve this conflict manually before continuing.
A backup already exists at:

  $BackupRoot
"@
            }
        }

        continue
    }

    if ($actualUpper) {

        $tempName = "__kitabuyetu_casefix_$([Guid]::NewGuid().ToString('N')).tmp"
        $tempPath = Join-Path $UIRoot $tempName
        $targetPath = Join-Path $UIRoot $lowerName

        Move-LiteralFile $actualUpper.FullName $tempPath
        Move-LiteralFile $tempPath $targetPath

        Write-Host "       Renamed: $upperName -> $lowerName" -ForegroundColor Green
    }
}

# ---------------------------------------------------------------
# NORMALIZE UI IMPORTS
# ---------------------------------------------------------------

Write-Host ""
Write-Host "[6/10] Normalizing UI imports..." -ForegroundColor Yellow

$SourceRoots = @(
    (Join-Path $ProjectRoot "app"),
    (Join-Path $ProjectRoot "components"),
    (Join-Path $ProjectRoot "lib"),
    (Join-Path $ProjectRoot "hooks"),
    (Join-Path $ProjectRoot "services"),
    (Join-Path $ProjectRoot "types")
)

$CodeFiles = @()

foreach ($root in $SourceRoots) {

    if ([System.IO.Directory]::Exists($root)) {

        $CodeFiles += @(
            Get-ChildItem -LiteralPath $root -File -Recurse -Force |
            Where-Object {
                $_.Extension -in @(
                    ".ts",
                    ".tsx",
                    ".js",
                    ".jsx",
                    ".mjs",
                    ".cjs"
                )
            }
        )
    }
}

$ImportReplacements = @(
    @("./ui/Button", "./ui/button"),
    @("./ui/button", "./ui/button"),
    @("./ui/Badge", "./ui/badge"),
    @("./ui/badge", "./ui/badge"),
    @("./ui/Card", "./ui/card"),
    @("./ui/card", "./ui/card"),
    @("./ui/Input", "./ui/input"),
    @("./ui/input", "./ui/input"),

    @("@/components/ui/Button", "@/components/ui/button"),
    @("@/components/ui/button", "@/components/ui/button"),
    @("@/components/ui/Badge", "@/components/ui/badge"),
    @("@/components/ui/badge", "@/components/ui/badge"),
    @("@/components/ui/Card", "@/components/ui/card"),
    @("@/components/ui/card", "@/components/ui/card"),
    @("@/components/ui/Input", "@/components/ui/input"),
    @("@/components/ui/input", "@/components/ui/input")
)

$changedImports = 0

foreach ($file in $CodeFiles) {

    $content = Read-TextFile $file.FullName
    $updated = $content

    foreach ($pair in $ImportReplacements) {

        $old = $pair[0]
        $new = $pair[1]

        $updated = $updated.Replace(
            $old + "'",
            $new + "'"
        )

        $updated = $updated.Replace(
            $old + '"',
            $new + '"'
        )
    }

    if ($updated -ne $content) {

        Write-TextFile $file.FullName $updated
        $changedImports++

        Write-Host "       Updated: $($file.FullName.Substring($ProjectRoot.Length + 1))" -ForegroundColor Green
    }
}

Write-Host "       Files with normalized imports: $changedImports" -ForegroundColor Green

# ---------------------------------------------------------------
# FIX UI BARREL
# ---------------------------------------------------------------

Write-Host ""
Write-Host "[7/10] Fixing UI barrel exports..." -ForegroundColor Yellow

$UIIndex = Join-Path $UIRoot "index.ts"

if ([System.IO.File]::Exists($UIIndex)) {

    $uiIndexContent = Read-TextFile $UIIndex

    # Remove known incorrect default-export forms.
    $uiIndexContent = $uiIndexContent.Replace(
        'export { default as Button } from "./Button";',
        'export { Button } from "./button";'
    )

    $uiIndexContent = $uiIndexContent.Replace(
        'export { default as Button } from "./button";',
        'export { Button } from "./button";'
    )

    $uiIndexContent = $uiIndexContent.Replace(
        'export { default as Input } from "./Input";',
        'export { Input } from "./input";'
    )

    $uiIndexContent = $uiIndexContent.Replace(
        'export { default as Input } from "./input";',
        'export { Input } from "./input";'
    )

    $uiIndexContent = $uiIndexContent.Replace(
        'export { default as Badge } from "./Badge";',
        'export { Badge } from "./badge";'
    )

    $uiIndexContent = $uiIndexContent.Replace(
        'export { default as Badge } from "./badge";',
        'export { Badge } from "./badge";'
    )

    $uiIndexContent = $uiIndexContent.Replace(
        'export { default as Card } from "./Card";',
        'export { Card } from "./card";'
    )

    $uiIndexContent = $uiIndexContent.Replace(
        'export { default as Card } from "./card";',
        'export { Card } from "./card";'
    )

    Write-TextFile $UIIndex $uiIndexContent

    Write-Host "       UI barrel normalized." -ForegroundColor Green
}

# ---------------------------------------------------------------
# TYPESCRIPT CONFIGURATION
# ---------------------------------------------------------------

Write-Host ""
Write-Host "[8/10] Repairing TypeScript configuration..." -ForegroundColor Yellow

$ts = Read-TextFile $TsConfig

# ---------------------------------------------------------------
# Repair baseUrl
# ---------------------------------------------------------------

if ($ts -match '"baseUrl"\s*:') {

    $ts = [regex]::Replace(
        $ts,
        '"baseUrl"\s*:\s*"[^"]*"',
        '"baseUrl": "."'
    )
}
else {

    $compilerOptionsMatch = [regex]::Match(
        $ts,
        '"compilerOptions"\s*:\s*\{'
    )

    if (-not $compilerOptionsMatch.Success) {
        throw "Could not locate compilerOptions in tsconfig.json"
    }

    $insertAt = $compilerOptionsMatch.Index +
        $compilerOptionsMatch.Length

    $ts =
        $ts.Substring(0, $insertAt) +
        "`r`n    `"baseUrl`": `".`"," +
        $ts.Substring($insertAt)
}

# ---------------------------------------------------------------
# Repair aliases.
# ---------------------------------------------------------------

$pathsBlock = @'
    "paths": {
      "@/*": ["./*"],
      "@/components/*": ["./components/*"],
      "@/lib/*": ["./lib/*"],
      "@/types/*": ["./types/*"],
      "@/hooks/*": ["./hooks/*"]
    }
'@

if ($ts -match '"paths"\s*:') {

    # Locate paths object conservatively.
    $pathsMatch = [regex]::Match(
        $ts,
        '(?s)"paths"\s*:\s*\{.*?\n\s*\}'
    )

    if ($pathsMatch.Success) {

        $replacement =
            '"paths": {' +
            "`r`n      `"@/*`": [`"./*`"]," +
            "`r`n      `"@/components/*`": [`"./components/*`"]," +
            "`r`n      `"@/lib/*`": [`"./lib/*`"]," +
            "`r`n      `"@/types/*`": [`"./types/*`"]," +
            "`r`n      `"@/hooks/*`": [`"./hooks/*`"]" +
            "`r`n    }"

        $ts = $ts.Remove(
            $pathsMatch.Index,
            $pathsMatch.Length
        ).Insert(
            $pathsMatch.Index,
            $replacement
        )
    }
    else {
        throw "Could not safely locate the paths object in tsconfig.json"
    }
}
else {

    $compilerOptionsMatch = [regex]::Match(
        $ts,
        '"compilerOptions"\s*:\s*\{'
    )

    if (-not $compilerOptionsMatch.Success) {
        throw "Could not locate compilerOptions in tsconfig.json"
    }

    $insertAt = $compilerOptionsMatch.Index +
        $compilerOptionsMatch.Length

    $pathsInsertion =
        "`r`n    `"paths`": {" +
        "`r`n      `"@/*`": [`"./*`"]," +
        "`r`n      `"@/components/*`": [`"./components/*`"]," +
        "`r`n      `"@/lib/*`": [`"./lib/*`"]," +
        "`r`n      `"@/types/*`": [`"./types/*`"]," +
        "`r`n      `"@/hooks/*`": [`"./hooks/*`"]" +
        "`r`n    },"

    $ts =
        $ts.Substring(0, $insertAt) +
        $pathsInsertion +
        $ts.Substring($insertAt)
}

# ---------------------------------------------------------------
# Ensure src is excluded.
# ---------------------------------------------------------------

if ($ts -match '"exclude"\s*:') {

    $excludeMatch = [regex]::Match(
        $ts,
        '(?s)"exclude"\s*:\s*\[(.*?)\]'
    )

    if (-not $excludeMatch.Success) {
        throw "Could not safely locate exclude array in tsconfig.json"
    }

    $excludeBody = $excludeMatch.Groups[1].Value

    if ($excludeBody -notmatch '"src"') {

        $newBody = "`r`n    `"src`"," + $excludeBody

        $ts = $ts.Remove(
            $excludeMatch.Groups[1].Index,
            $excludeMatch.Groups[1].Length
        ).Insert(
            $excludeMatch.Groups[1].Index,
            $newBody
        )
    }
}
else {

    # Insert before the final root object brace.
    $lastBrace = $ts.LastIndexOf("}")

    if ($lastBrace -lt 0) {
        throw "Could not locate end of tsconfig.json"
    }

    $excludeInsertion =
        ",`r`n  `"exclude`": [`"src`"]`r`n"

    $ts =
        $ts.Substring(0, $lastBrace) +
        $excludeInsertion +
        $ts.Substring($lastBrace)
}

Write-TextFile $TsConfig $ts

Write-Host "       tsconfig.json repaired." -ForegroundColor Green
Write-Host "       @/* -> root" -ForegroundColor Gray
Write-Host "       @/components/* -> root components" -ForegroundColor Gray
Write-Host "       @/lib/* -> root lib" -ForegroundColor Gray
Write-Host "       @/types/* -> root types" -ForegroundColor Gray
Write-Host "       @/hooks/* -> root hooks" -ForegroundColor Gray
Write-Host "       src/ excluded from compilation" -ForegroundColor Gray

# ---------------------------------------------------------------
# SERVICES/API
# ---------------------------------------------------------------

Write-Host ""
Write-Host "[9/10] Resolving services/api..." -ForegroundColor Yellow

$RootServices = Join-Path $ProjectRoot "services"
$RootApi = Join-Path $RootServices "api"

$RootApiCandidates = @(
    (Join-Path $ProjectRoot "services\api.ts"),
    (Join-Path $ProjectRoot "services\api.tsx"),
    (Join-Path $ProjectRoot "services\api\index.ts"),
    (Join-Path $ProjectRoot "services\api\index.tsx")
)

$existingRootApi = @(
    $RootApiCandidates |
    Where-Object {
        [System.IO.File]::Exists($_)
    }
)

if ($existingRootApi.Count -gt 0) {

    Write-Host "       Root services/api already exists." -ForegroundColor Green
}
else {

    $srcApiCandidates = @(
        (Join-Path $ProjectRoot "src\services\api.ts"),
        (Join-Path $ProjectRoot "src\services\api.tsx"),
        (Join-Path $ProjectRoot "src\services\api\index.ts"),
        (Join-Path $ProjectRoot "src\services\api\index.tsx")
    )

    $existingSrcApi = @(
        $srcApiCandidates |
        Where-Object {
            [System.IO.File]::Exists($_)
        }
    )

    if ($existingSrcApi.Count -eq 1) {

        $sourceApi = $existingSrcApi[0]

        if ([System.IO.Path]::GetFileName($sourceApi) -eq "api.ts") {

            Ensure-Directory $RootServices

            $destinationApi = Join-Path $RootServices "api.ts"

            Copy-LiteralFile $sourceApi $destinationApi

            Write-Host "       Copied src/services/api.ts -> services/api.ts" -ForegroundColor Green
        }
        else {

            Ensure-Directory $RootApi

            $destinationApi = Join-Path $RootApi "index.ts"

            Copy-LiteralFile $sourceApi $destinationApi

            Write-Host "       Copied source API implementation -> services/api/index.ts" -ForegroundColor Green
        }
    }
    elseif ($existingSrcApi.Count -gt 1) {

        throw @"
Multiple possible src services/api implementations were found.

Resolve manually before continuing:

$($existingSrcApi -join "`r`n")
"@
    }
    else {

        Write-Host "       WARNING: services/api implementation was not found." -ForegroundColor Yellow
        Write-Host "       TypeScript validation will determine whether it is required." -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------
# CACHE CLEANUP
# ---------------------------------------------------------------

Write-Host ""
Write-Host "[10/10] Clearing generated TypeScript/Next.js caches..." -ForegroundColor Yellow

$NextCache = Join-Path $ProjectRoot ".next"

if ([System.IO.Directory]::Exists($NextCache)) {
    [System.IO.Directory]::Delete($NextCache, $true)
    Write-Host "       Removed .next" -ForegroundColor Green
}

$tsBuildInfoFiles = @(
    Get-ChildItem -LiteralPath $ProjectRoot -Filter "*.tsbuildinfo" -File -Force -ErrorAction SilentlyContinue
)

foreach ($file in $tsBuildInfoFiles) {
    [System.IO.File]::Delete($file.FullName)
    Write-Host "       Removed $($file.Name)" -ForegroundColor Green
}

# ---------------------------------------------------------------
# FINAL STATIC CHECKS
# ---------------------------------------------------------------

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " FINAL VALIDATION" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

# Check UI files using actual directory enumeration.
Write-Host "Checking canonical UI files..." -ForegroundColor Yellow

foreach ($name in @(
    "button.tsx",
    "input.tsx",
    "badge.tsx",
    "card.tsx"
)) {

    $entry = Get-ActualFileEntry $UIRoot $name

    if ($null -eq $entry) {
        Write-Host "  WARNING: missing components/ui/$name" -ForegroundColor Yellow
    }
    else {
        Write-Host "  OK: components/ui/$name" -ForegroundColor Green
    }
}

# Check that src is excluded.
$finalTs = Read-TextFile $TsConfig

if ($finalTs -notmatch '"src"') {
    throw "FINAL VALIDATION FAILED: tsconfig.json does not contain src in exclude."
}

Write-Host "  OK: src is excluded in tsconfig.json" -ForegroundColor Green

# Check that aliases do not point at src.
if ($finalTs -match '"@\*"\s*:\s*\[\s*"./src/\*"') {
    throw "FINAL VALIDATION FAILED: @/* still points at ./src/*"
}

Write-Host "  OK: @/* points at project root" -ForegroundColor Green

# Check for active source imports that explicitly point at src.
$srcImportHits = @()

foreach ($file in $CodeFiles) {

    $content = Read-TextFile $file.FullName

    if (
        $content -match "from\s+['""]@/src/" -or
        $content -match "from\s+['""]\.\.?/src/"
    ) {
        $srcImportHits += $file.FullName
    }
}

if ($srcImportHits.Count -gt 0) {

    Write-Host ""
    Write-Host "WARNING: explicit src imports remain:" -ForegroundColor Yellow

    foreach ($hit in $srcImportHits) {
        Write-Host "  $hit" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "These were NOT automatically rewritten." -ForegroundColor Yellow
}

# ---------------------------------------------------------------
# TYPECHECK
# ---------------------------------------------------------------

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " RUNNING TYPESCRIPT CHECK" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

& npx tsc --noEmit

if ($LASTEXITCODE -ne 0) {
    throw "TypeScript validation failed. Migration stopped before lint/build."
}

Write-Host ""
Write-Host "TYPESCRIPT CHECK PASSED." -ForegroundColor Green

# ---------------------------------------------------------------
# LINT
# ---------------------------------------------------------------

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " RUNNING LINT" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

& npm run lint

if ($LASTEXITCODE -ne 0) {
    throw "Lint failed. Review lint output. Backup remains available at $BackupRoot"
}

Write-Host ""
Write-Host "LINT PASSED." -ForegroundColor Green

# ---------------------------------------------------------------
# BUILD
# ---------------------------------------------------------------

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " RUNNING PRODUCTION BUILD" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

& npm run build

if ($LASTEXITCODE -ne 0) {
    throw "Production build failed. Review build output. Backup remains available at $BackupRoot"
}

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Green
Write-Host " RECONCILIATION COMPLETE" -ForegroundColor Green
Write-Host "===============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Production root remains authoritative:" -ForegroundColor Green
Write-Host "  $ProjectRoot" -ForegroundColor Green
Write-Host ""
Write-Host "Backup:" -ForegroundColor Green
Write-Host "  $BackupRoot" -ForegroundColor Green
Write-Host ""
Write-Host "TypeScript: PASSED" -ForegroundColor Green
Write-Host "Lint:       PASSED" -ForegroundColor Green
Write-Host "Build:      PASSED" -ForegroundColor Green
Write-Host ""
Write-Host "The project is ready for deployment validation." -ForegroundColor Cyan
Write-Host ""