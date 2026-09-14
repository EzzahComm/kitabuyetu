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
Write-Host " STEP 1: BACKUP" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

$BackupRoot = Join-Path $ProjectRoot (".repair-backup-final-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
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
Write-Host " STEP 2: FIX (case-sensitive change detection)" -ForegroundColor Cyan
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

        # -cne is CASE-SENSITIVE not-equal. The previous scripts used -ne, which is
        # case-INsensitive by default in PowerShell, so a pure-case change like
        # "Button" -> "button" was (wrongly) treated as "no change" and never written.
        if ($text -cne $original) {
            [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false))
            $reread = [System.IO.File]::ReadAllText($path)
            if ($reread -ceq $text) {
                Write-Host "UPDATED AND CONFIRMED ON DISK: $relative" -ForegroundColor Green
            } else {
                Write-Host "WARNING: wrote $relative but re-read content does not match." -ForegroundColor Red
            }
        }
        else {
            Write-Host "NO CHANGE: $relative" -ForegroundColor DarkGray
        }
    }
    catch {
        Write-Host "ERROR on $relative : $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " STEP 3: VERIFY" -ForegroundColor Cyan
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
    Write-Host "Backup preserved at: $BackupRoot" -ForegroundColor Yellow
    exit 1
}

Write-Host "PASS: No uppercase UI import paths remain." -ForegroundColor Green
Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " STEP 4: TYPESCRIPT CHECK ONLY" -ForegroundColor Cyan
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
