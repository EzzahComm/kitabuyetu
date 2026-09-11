$ProjectRoot = "D:\Claude\Projects\KITABU YETU\kitabuyetu"
Set-Location -LiteralPath $ProjectRoot

$Targets = @(
    "components\dashboard\AdvancedDataTable.tsx",
    "components\dashboard\DeleteConfirmationDialog.tsx",
    "components\dashboard\EmptyState.tsx",
    "components\dashboard\FormField.tsx",
    "components\dashboard\KPICard.tsx",
    "components\dashboard\Modal.tsx"
)

$OldNew = @(
    @('@/components/ui/Button', '@/components/ui/button'),
    @('@/components/ui/Input',  '@/components/ui/input'),
    @('@/components/ui/Card',   '@/components/ui/card'),
    @('@/components/ui/Badge',  '@/components/ui/badge'),
    @('./ui/Button', './ui/button'),
    @('./ui/Input',  './ui/input'),
    @('./ui/Card',   './ui/card'),
    @('./ui/Badge',  './ui/badge')
)

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " TEST 1: SELF-TEST THE REPLACE MECHANISM" -ForegroundColor Cyan
Write-Host " (using a hardcoded string, not file content)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

$sample = 'import { Button } from "@/components/ui/Button";'
$sampleFixed = $sample
foreach ($pair in $OldNew) {
    $idx = $sampleFixed.IndexOf($pair[0], [System.StringComparison]::Ordinal)
    if ($idx -ge 0) {
        $sampleFixed = $sampleFixed.Substring(0, $idx) + $pair[1] + $sampleFixed.Substring($idx + $pair[0].Length)
    }
}
Write-Host "Hardcoded input:  $sample"
Write-Host "After manual fix: $sampleFixed"
if ($sampleFixed -ne $sample) {
    Write-Host "PASS: manual ordinal replace works correctly on a hardcoded string." -ForegroundColor Green
} else {
    Write-Host "STOP: even the hardcoded self-test did not change. Something is wrong with this PowerShell session itself." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " TEST 2: CHARACTER-LEVEL FORENSICS ON REAL FILES" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

foreach ($relative in $Targets) {
    $path = Join-Path $ProjectRoot $relative
    $text = [System.IO.File]::ReadAllText($path)

    $target = ($OldNew | Where-Object { $text.Contains($_[0]) } | Select-Object -First 1)

    Write-Host "$relative"

    if (-not $target) {
        Write-Host "  No known old-path substring found via .Contains() (ordinal). This is unexpected." -ForegroundColor Red
        continue
    }

    $needle = $target[0]
    $idx = $text.IndexOf($needle, [System.StringComparison]::Ordinal)

    Write-Host "  Found '$needle' via ordinal IndexOf at position $idx"

    $extracted = $text.Substring($idx, $needle.Length)
    $codes = ($extracted.ToCharArray() | ForEach-Object { [int]$_ })
    $expectedCodes = ($needle.ToCharArray() | ForEach-Object { [int]$_ })

    Write-Host "  Extracted text: $extracted"
    Write-Host "  Extracted char codes: $($codes -join ',')"
    Write-Host "  Expected char codes:  $($expectedCodes -join ',')"

    if (($codes -join ',') -eq ($expectedCodes -join ',')) {
        Write-Host "  MATCH: character codes are identical to expected ASCII." -ForegroundColor Green
    } else {
        Write-Host "  MISMATCH: hidden/different characters detected!" -ForegroundColor Red
    }
    Write-Host ""
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " STEP 3: BACKUP" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

$BackupRoot = Join-Path $ProjectRoot (".repair-backup-forensic-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
[System.IO.Directory]::CreateDirectory($BackupRoot) | Out-Null

foreach ($relative in $Targets) {
    $source = Join-Path $ProjectRoot $relative
    $destination = Join-Path $BackupRoot $relative
    $destinationDir = Split-Path -Parent $destination
    [System.IO.Directory]::CreateDirectory($destinationDir) | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
}
Write-Host "PASS: Backup created at $BackupRoot" -ForegroundColor Green

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " STEP 4: FIX VIA MANUAL ORDINAL SUBSTRING SURGERY" -ForegroundColor Cyan
Write-Host " (no regex, no .Replace(), no -creplace)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

foreach ($relative in $Targets) {
    $path = Join-Path $ProjectRoot $relative
    try {
        $text = [System.IO.File]::ReadAllText($path)
        $original = $text

        foreach ($pair in $OldNew) {
            $old = $pair[0]
            $new = $pair[1]
            $idx = $text.IndexOf($old, [System.StringComparison]::Ordinal)
            while ($idx -ge 0) {
                $text = $text.Substring(0, $idx) + $new + $text.Substring($idx + $old.Length)
                $idx = $text.IndexOf($old, [System.StringComparison]::Ordinal)
            }
        }

        if ($text -ne $original) {
            [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false))

            # Immediately re-read from disk to confirm the write actually persisted
            $reread = [System.IO.File]::ReadAllText($path)
            if ($reread -eq $text) {
                Write-Host "UPDATED AND CONFIRMED ON DISK: $relative" -ForegroundColor Green
            } else {
                Write-Host "WARNING: wrote $relative but re-read content does not match what was written. Something is reverting this file." -ForegroundColor Red
            }
        }
        else {
            Write-Host "NO CHANGE: $relative (this would now be a genuine surprise)" -ForegroundColor Red
        }
    }
    catch {
        Write-Host "ERROR on $relative : $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " STEP 5: VERIFY" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

$Remaining = @()
foreach ($relative in $Targets) {
    $path = Join-Path $ProjectRoot $relative
    $matches = Select-String -LiteralPath $path -Pattern '@/components/ui/(Button|Input|Card|Badge)(\.tsx)?|"\./ui/(Button|Input|Card|Badge)(\.tsx)?' -CaseSensitive
    if ($matches) {
        foreach ($m in $matches) {
            $Remaining += ("{0}: line {1}: {2}" -f $relative, $m.LineNumber, $m.Line.Trim())
        }
    }
}

if ($Remaining.Count -gt 0) {
    Write-Host "STILL FAILING:" -ForegroundColor Red
    foreach ($item in $Remaining) { Write-Host $item -ForegroundColor Red }
    Write-Host ""
    Write-Host "If STEP 4 said 'UPDATED AND CONFIRMED ON DISK' for these files but they still" -ForegroundColor Yellow
    Write-Host "show up here, something outside this script is rewriting them between STEP 4" -ForegroundColor Yellow
    Write-Host "and STEP 5 - a running dev server, an editor with the file open and autosave/" -ForegroundColor Yellow
    Write-Host "organize-imports-on-save enabled, or a git/husky hook. Close those and re-run." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Backup preserved at: $BackupRoot" -ForegroundColor Yellow
    exit 1
}

Write-Host "PASS: No uppercase UI import paths remain." -ForegroundColor Green
Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " STEP 6: TYPESCRIPT CHECK ONLY" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

npx tsc --noEmit
$TsExit = $LASTEXITCODE

if ($TsExit -ne 0) {
    Write-Host ""
    Write-Host "TypeScript still reports errors. DO NOT run lint or build yet." -ForegroundColor Yellow
    exit $TsExit
}

Write-Host ""
Write-Host "PASS: TypeScript is clean." -ForegroundColor Green
