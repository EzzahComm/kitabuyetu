$ProjectRoot = "D:\Claude\Projects\KITABU YETU\kitabuyetu"
Set-Location -LiteralPath $ProjectRoot

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " 1: DOES A src/ DIRECTORY EXIST, AND WHAT'S IN IT" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

$hasSrc = Test-Path -LiteralPath (Join-Path $ProjectRoot "src") -PathType Container
Write-Host "src/ exists: $hasSrc"

if ($hasSrc) {
    $srcTop = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "src") -Directory | Select-Object -ExpandProperty Name
    Write-Host "Top-level folders inside src/: $($srcTop -join ', ')"
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " 2: DOES BOTH root/app AND src/app EXIST (Next.js will error/pick one)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

$rootApp = Test-Path -LiteralPath (Join-Path $ProjectRoot "app") -PathType Container
$srcApp  = Test-Path -LiteralPath (Join-Path $ProjectRoot "src\app") -PathType Container
$rootPages = Test-Path -LiteralPath (Join-Path $ProjectRoot "pages") -PathType Container
$srcPages  = Test-Path -LiteralPath (Join-Path $ProjectRoot "src\pages") -PathType Container

Write-Host "root app/    exists: $rootApp"
Write-Host "src/app/     exists: $srcApp"
Write-Host "root pages/  exists: $rootPages"
Write-Host "src/pages/   exists: $srcPages"

if ($rootApp -and $srcApp) {
    Write-Host "NOTE: both root app/ and src/app/ exist. Next.js will only use one of these - this is worth resolving." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " 3: tsconfig.json PATH ALIASES" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

$tsconfigPath = Join-Path $ProjectRoot "tsconfig.json"
if (Test-Path -LiteralPath $tsconfigPath) {
    # tsconfig.json can have comments; strip // and /* */ comments crudely for parsing
    $raw = Get-Content -LiteralPath $tsconfigPath -Raw
    $noLineComments = $raw -replace '(?m)^\s*//.*$', ''
    $noBlockComments = $noLineComments -replace '(?s)/\*.*?\*/', ''
    try {
        $json = $noBlockComments | ConvertFrom-Json
        Write-Host "baseUrl: $($json.compilerOptions.baseUrl)"
        Write-Host "paths:"
        $json.compilerOptions.paths.PSObject.Properties | ForEach-Object {
            Write-Host "  $($_.Name) -> $($_.Value -join ', ')"
        }
    } catch {
        Write-Host "Could not parse tsconfig.json as JSON (may have trailing commas). Raw paths section:" -ForegroundColor Yellow
        Write-Host ($raw | Select-String -Pattern '"paths"[\s\S]*?\}' -AllMatches | ForEach-Object { $_.Matches.Value })
    }
} else {
    Write-Host "No tsconfig.json found at project root." -ForegroundColor Red
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " 4: next.config FILE CONTENTS (if present)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

foreach ($name in @("next.config.js", "next.config.mjs", "next.config.ts")) {
    $p = Join-Path $ProjectRoot $name
    if (Test-Path -LiteralPath $p) {
        Write-Host "--- $name ---"
        Get-Content -LiteralPath $p | Write-Host
    }
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " 5: COMPARE root/components vs src/components (and hooks, services)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

function Compare-Tree {
    param($relativeA, $relativeB, $label)

    $a = Join-Path $ProjectRoot $relativeA
    $b = Join-Path $ProjectRoot $relativeB

    $aExists = Test-Path -LiteralPath $a -PathType Container
    $bExists = Test-Path -LiteralPath $b -PathType Container

    Write-Host "$label"
    Write-Host "  $relativeA exists: $aExists"
    Write-Host "  $relativeB exists: $bExists"

    if (-not ($aExists -and $bExists)) {
        Write-Host "  (skipping comparison - one side doesn't exist)"
        Write-Host ""
        return
    }

    $aFiles = Get-ChildItem -LiteralPath $a -Recurse -File | ForEach-Object {
        [PSCustomObject]@{
            Relative = $_.FullName.Substring($a.Length).TrimStart('\')
            Hash     = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
    }
    $bFiles = Get-ChildItem -LiteralPath $b -Recurse -File | ForEach-Object {
        [PSCustomObject]@{
            Relative = $_.FullName.Substring($b.Length).TrimStart('\')
            Hash     = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
    }

    $aOnly = $aFiles | Where-Object { $_.Relative -notin $bFiles.Relative }
    $bOnly = $bFiles | Where-Object { $_.Relative -notin $aFiles.Relative }
    $common = $aFiles | Where-Object { $_.Relative -in $bFiles.Relative }

    $identical = 0
    $diverged = @()
    foreach ($f in $common) {
        $match = $bFiles | Where-Object { $_.Relative -eq $f.Relative }
        if ($match.Hash -eq $f.Hash) { $identical++ }
        else { $diverged += $f.Relative }
    }

    Write-Host "  Files only in $relativeA : $($aOnly.Count)"
    if ($aOnly.Count -gt 0) { $aOnly.Relative | ForEach-Object { Write-Host "    $_" } }
    Write-Host "  Files only in $relativeB : $($bOnly.Count)"
    if ($bOnly.Count -gt 0) { $bOnly.Relative | ForEach-Object { Write-Host "    $_" } }
    Write-Host "  Files in both, byte-identical: $identical"
    Write-Host "  Files in both, DIVERGED (different content): $($diverged.Count)" -ForegroundColor $(if ($diverged.Count -gt 0) { "Yellow" } else { "Green" })
    if ($diverged.Count -gt 0) { $diverged | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow } }
    Write-Host ""
}

Compare-Tree "components" "src\components" "components/ vs src/components/"
Compare-Tree "hooks" "src\hooks" "hooks/ vs src/hooks/"
Compare-Tree "services" "src\services" "services/ vs src/services/"

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " 6: THE ONE HARD SYNTAX ERROR - src/components/ui/Card.tsx" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

$cardPath = Join-Path $ProjectRoot "src\components\ui\Card.tsx"
if (Test-Path -LiteralPath $cardPath) {
    Write-Host "First 5 lines of src\components\ui\Card.tsx:"
    Get-Content -LiteralPath $cardPath -TotalCount 5
} else {
    Write-Host "File not found at src\components\ui\Card.tsx" -ForegroundColor Red
}

$cardPathRoot = Join-Path $ProjectRoot "components\ui\card.tsx"
if (Test-Path -LiteralPath $cardPathRoot) {
    Write-Host ""
    Write-Host "For comparison, first 5 lines of components\ui\card.tsx (the canonical lowercase one):"
    Get-Content -LiteralPath $cardPathRoot -TotalCount 5
}
