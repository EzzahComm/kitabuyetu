#requires -Version 5.1

$ErrorActionPreference = 'Stop'

$ProjectRoot = 'D:\Claude\Projects\KITABU YETU\kitabuyetu'

Set-Location -LiteralPath $ProjectRoot

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " KITABU YETU - UI CASING REPAIR" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

function Assert-File {
    param([string]$Path)

    if (-not [System.IO.File]::Exists($Path)) {
        throw "Required file does not exist: $Path"
    }
}

function Ensure-Directory {
    param([string]$Path)

    if (-not [System.IO.Directory]::Exists($Path)) {
        [System.IO.Directory]::CreateDirectory($Path) | Out-Null
    }
}

function Get-FileHashValue {
    param([string]$Path)

    Assert-File $Path
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Get-ActualEntry {
    param(
        [string]$Directory,
        [string]$Name
    )

    if (-not [System.IO.Directory]::Exists($Directory)) {
        return $null
    }

    $entries = Get-ChildItem -LiteralPath $Directory -Force

    foreach ($entry in $entries) {
        if ($entry.Name -ceq $Name) {
            return $entry
        }
    }

    return $null
}

function Rename-LiteralFile {
    param(
        [string]$Source,
        [string]$Destination
    )

    Assert-File $Source

    $destDir = Split-Path -Parent $Destination
    Ensure-Directory $destDir

    [System.IO.File]::Move($Source, $Destination)
}

function Normalize-Duplicate {
    param(
        [string]$Directory,
        [string]$UpperName,
        [string]$LowerName
    )

    $upper = Get-ActualEntry -Directory $Directory -Name $UpperName
    $lower = Get-ActualEntry -Directory $Directory -Name $LowerName

    Write-Host ""
    Write-Host "Checking $UpperName / $LowerName ..." -ForegroundColor Yellow

    if ($null -eq $upper -and $null -eq $lower) {
        Write-Host "  Neither file exists. Skipping." -ForegroundColor DarkGray
        return
    }

    if ($null -eq $upper) {
        Write-Host "  Lowercase file already exists: $LowerName" -ForegroundColor Green
        return
    }

    if ($null -eq $lower) {
        Write-Host "  Only uppercase file exists." -ForegroundColor Yellow
        Write-Host "  Renaming $UpperName -> $LowerName"

        $temporary = Join-Path $Directory ($UpperName + ".migration-temp")

        if ([System.IO.File]::Exists($temporary)) {
            [System.IO.File]::Delete($temporary)
        }

        Rename-LiteralFile `
            -Source $upper.FullName `
            -Destination $temporary

        Rename-LiteralFile `
            -Source $temporary `
            -Destination (Join-Path $Directory $LowerName)

        Write-Host "  Renamed successfully." -ForegroundColor Green
        return
    }

    # Both files exist.
    $upperHash = Get-FileHashValue $upper.FullName
    $lowerHash = Get-FileHashValue $lower.FullName

    if ($upperHash -eq $lowerHash) {
        Write-Host "  Both files are identical." -ForegroundColor Green
        Write-Host "  Keeping lowercase: $LowerName"

        # Move uppercase version out temporarily, then delete it.
        # This avoids Windows case-insensitive path ambiguity.
        $quarantineRoot = Join-Path $ProjectRoot ".migration-quarantine-ui-casing"

        Ensure-Directory $quarantineRoot

        $quarantinePath = Join-Path `
            $quarantineRoot `
            ($UpperName + "-" + [DateTime]::Now.ToString("yyyyMMdd-HHmmssfff") + ".bak")

        Rename-LiteralFile `
            -Source $upper.FullName `
            -Destination $quarantinePath

        Write-Host "  Uppercase duplicate quarantined:" -ForegroundColor Green
        Write-Host "  $quarantinePath"

        return
    }

    Write-Host ""
    Write-Host "  !!! CONFLICT: files are different !!!" -ForegroundColor Red
    Write-Host "  Uppercase: $($upper.FullName)" -ForegroundColor Red
    Write-Host "  Lowercase: $($lower.FullName)" -ForegroundColor Red
    Write-Host ""
    Write-Host "  SHA256 uppercase: $upperHash"
    Write-Host "  SHA256 lowercase: $lowerHash"
    Write-Host ""

    throw "Cannot automatically reconcile $UpperName and $LowerName because their contents differ."
}

$UI = Join-Path $ProjectRoot 'components\ui'

Assert-File (Join-Path $ProjectRoot 'tsconfig.json')

if (-not [System.IO.Directory]::Exists($UI)) {
    throw "Production UI directory not found: $UI"
}

Write-Host "[1/5] Normalizing duplicate UI filenames..." -ForegroundColor Cyan

# These are the casing conflicts identified by the TypeScript diagnostics.
Normalize-Duplicate `
    -Directory $UI `
    -UpperName 'Input.tsx' `
    -LowerName 'input.tsx'

Normalize-Duplicate `
    -Directory $UI `
    -UpperName 'Badge.tsx' `
    -LowerName 'badge.tsx'

Normalize-Duplicate `
    -Directory $UI `
    -UpperName 'Button.tsx' `
    -LowerName 'button.tsx'

Normalize-Duplicate `
    -Directory $UI `
    -UpperName 'Card.tsx' `
    -LowerName 'card.tsx'

Write-Host ""
Write-Host "[2/5] Normalizing production imports..." -ForegroundColor Cyan

# IMPORTANT:
# Only production source files are changed.
# src\ is deliberately excluded.

$scanRoots = @(
    (Join-Path $ProjectRoot 'app'),
    (Join-Path $ProjectRoot 'components'),
    (Join-Path $ProjectRoot 'lib'),
    (Join-Path $ProjectRoot 'hooks'),
    (Join-Path $ProjectRoot 'types'),
    (Join-Path $ProjectRoot 'services')
)

$filesChanged = 0

foreach ($root in $scanRoots) {

    if (-not [System.IO.Directory]::Exists($root)) {
        continue
    }

    $files = Get-ChildItem `
        -LiteralPath $root `
        -Recurse `
        -File `
        -Include *.ts,*.tsx,*.js,*.jsx `
        -ErrorAction SilentlyContinue

    foreach ($file in $files) {

        $path = $file.FullName

        $text = [System.IO.File]::ReadAllText($path)

        $original = $text

        # Normalize only the known UI component paths.
        $text = $text -replace '@/components/ui/Input', '@/components/ui/input'
        $text = $text -replace '@/components/ui/Badge', '@/components/ui/badge'
        $text = $text -replace '@/components/ui/Button', '@/components/ui/button'
        $text = $text -replace '@/components/ui/Card', '@/components/ui/card'

        # Normalize relative UI references where they occur.
        $text = $text -replace '(["''])(\./)?Input(["''])', '$1input$3'
        $text = $text -replace '(["''])(\./)?Badge(["''])', '$1badge$3'
        $text = $text -replace '(["''])(\./)?Button(["''])', '$1button$3'
        $text = $text -replace '(["''])(\./)?Card(["''])', '$1card$3'

        if ($text -ne $original) {
            [System.IO.File]::WriteAllText(
                $path,
                $text,
                [System.Text.UTF8Encoding]::new($false)
            )

            $filesChanged++

            Write-Host "  Updated: $path" -ForegroundColor DarkGray
        }
    }
}

Write-Host "  Files changed: $filesChanged" -ForegroundColor Green

Write-Host ""
Write-Host "[3/5] Repairing UI barrel exports..." -ForegroundColor Cyan

$UIIndex = Join-Path $UI 'index.ts'

if ([System.IO.File]::Exists($UIIndex)) {

    $text = [System.IO.File]::ReadAllText($UIIndex)

    $text = $text -replace 'from ["'']\./Button["'']', 'from "./button"'
    $text = $text -replace 'from ["'']\./Input["'']', 'from "./input"'
    $text = $text -replace 'from ["'']\./Badge["'']', 'from "./badge"'
    $text = $text -replace 'from ["'']\./Card["'']', 'from "./card"'

    [System.IO.File]::WriteAllText(
        $UIIndex,
        $text,
        [System.Text.UTF8Encoding]::new($false)
    )

    Write-Host "  Updated components\ui\index.ts" -ForegroundColor Green
}
else {
    Write-Host "  No components\ui\index.ts found." -ForegroundColor DarkGray
}

$ComponentsIndex = Join-Path $ProjectRoot 'components\index.ts'

if ([System.IO.File]::Exists($ComponentsIndex)) {

    $text = [System.IO.File]::ReadAllText($ComponentsIndex)

    $text = $text -replace 'from ["'']\./ui/Button["'']', 'from "./ui/button"'
    $text = $text -replace 'from ["'']\./ui/Input["'']', 'from "./ui/input"'
    $text = $text -replace 'from ["'']\./ui/Badge["'']', 'from "./ui/badge"'
    $text = $text -replace 'from ["'']\./ui/Card["'']', 'from "./ui/card"'

    [System.IO.File]::WriteAllText(
        $ComponentsIndex,
        $text,
        [System.Text.UTF8Encoding]::new($false)
    )

    Write-Host "  Updated components\index.ts" -ForegroundColor Green
}

Write-Host ""
Write-Host "[4/5] Checking final UI filename state..." -ForegroundColor Cyan

foreach ($name in @(
    'button.tsx',
    'input.tsx',
    'badge.tsx',
    'card.tsx'
)) {
    $entry = Get-ActualEntry -Directory $UI -Name $name

    if ($null -ne $entry) {
        Write-Host "  OK: $name" -ForegroundColor Green
    }
    else {
        Write-Host "  WARNING: $name not found" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "[5/5] Clearing generated caches safely..." -ForegroundColor Cyan

$NextCache = Join-Path $ProjectRoot '.next'

if ([System.IO.Directory]::Exists($NextCache)) {

    try {
        Remove-Item `
            -LiteralPath $NextCache `
            -Recurse `
            -Force `
            -ErrorAction Stop

        Write-Host "  .next removed successfully." -ForegroundColor Green
    }
    catch {
        Write-Host ""
        Write-Host "  WARNING: .next could not be completely removed." -ForegroundColor Yellow
        Write-Host "  This is normally caused by a locked generated file." -ForegroundColor Yellow
        Write-Host "  The migration will continue." -ForegroundColor Yellow
        Write-Host "  Details: $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
}
else {
    Write-Host "  .next does not exist." -ForegroundColor DarkGray
}

$tsbuildFiles = Get-ChildItem `
    -LiteralPath $ProjectRoot `
    -Filter '*.tsbuildinfo' `
    -File `
    -ErrorAction SilentlyContinue

foreach ($tsbuild in $tsbuildFiles) {

    try {
        Remove-Item `
            -LiteralPath $tsbuild.FullName `
            -Force `
            -ErrorAction Stop

        Write-Host "  Removed: $($tsbuild.Name)" -ForegroundColor Green
    }
    catch {
        Write-Host "  WARNING: Could not remove $($tsbuild.Name)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Green
Write-Host " UI CASING REPAIR COMPLETE" -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Green
Write-Host ""

Write-Host "IMPORTANT:" -ForegroundColor Yellow
Write-Host "The script intentionally did NOT modify src\."
Write-Host "The production root app\ remains authoritative."
Write-Host ""

Write-Host "Next command:" -ForegroundColor Cyan
Write-Host "    npx tsc --noEmit" -ForegroundColor White
Write-Host ""