$ProjectRoot = "D:\Claude\Projects\KITABU YETU\kitabuyetu"
Set-Location -LiteralPath $ProjectRoot

$Fixes = @(
    [PSCustomObject]@{
        File = "__tests__\integration\financial-products.test.ts"
        Old  = "['penalty', 'interest', 'principal'] as const"
        New  = "['penalty', 'interest', 'principal'] as Array<'penalty' | 'interest' | 'principal'>"
    },
    [PSCustomObject]@{
        File = "__tests__\integration\helpers\request.ts"
        Old  = "new NextRequest(new URL(path, 'http://localhost'), init);"
        New  = "new NextRequest(new URL(path, 'http://localhost'), init as ConstructorParameters<typeof NextRequest>[1]);"
    },
    [PSCustomObject]@{
        File = "__tests__\unit\observability\error-sink.test.ts"
        Old  = "process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;"
        New  = "(process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_ENV.NODE_ENV;"
    },
    [PSCustomObject]@{
        File = "__tests__\unit\services\organization-finance-donor-report.test.ts"
        Old  = "import { withDb } from '@/lib/db';"
        New  = "import { withDb } from '@/lib/db';`nimport type { TenantContext } from '@/lib/db';"
    },
    [PSCustomObject]@{
        File = "__tests__\unit\services\organization-finance-donor-report.test.ts"
        Old  = "const ctx = { groupId: null, userId: 'coord-1', role: 'organization_coordinator', organizationId: 'org-1' };"
        New  = "const ctx = { groupId: null, userId: 'coord-1', role: 'organization_coordinator', organizationId: 'org-1' } as unknown as TenantContext;"
    }
)

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " STEP 0: SANITY CHECK GROUPING" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

$UniqueFiles = $Fixes.File | Select-Object -Unique
Write-Host "Fixes reference $($Fixes.Count) edits across $($UniqueFiles.Count) unique files:"
foreach ($f in $UniqueFiles) {
    if ([string]::IsNullOrWhiteSpace($f)) {
        Write-Host "STOP: a fix has an empty/blank File value. Aborting before touching anything." -ForegroundColor Red
        exit 1
    }
    Write-Host "  - $f"
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " STEP 1: BACKUP" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

$BackupRoot = Join-Path $ProjectRoot (".repair-backup-testtypes2-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
[System.IO.Directory]::CreateDirectory($BackupRoot) | Out-Null

foreach ($relative in $UniqueFiles) {
    $source = Join-Path $ProjectRoot $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        Write-Host "STOP: file not found: $relative" -ForegroundColor Red
        exit 1
    }
    $destination = Join-Path $BackupRoot $relative
    $destinationDir = Split-Path -Parent $destination
    [System.IO.Directory]::CreateDirectory($destinationDir) | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
}
Write-Host "PASS: Backup created at $BackupRoot" -ForegroundColor Green

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " STEP 2: APPLY FIXES (each checked for a single, exact match)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

$AnyFailure = $false

foreach ($relative in $UniqueFiles) {
    $path = Join-Path $ProjectRoot $relative

    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Write-Host "STOP: file not found at fix time: $relative" -ForegroundColor Red
        $AnyFailure = $true
        continue
    }

    $fileFixes = $Fixes | Where-Object { $_.File -eq $relative }

    try {
        $text = [System.IO.File]::ReadAllText($path)
    } catch {
        Write-Host "ERROR reading $relative : $($_.Exception.Message)" -ForegroundColor Red
        $AnyFailure = $true
        continue
    }

    $original = $text
    $fileOk = $true

    foreach ($fix in $fileFixes) {
        $old = $fix.Old
        $new = $fix.New

        $count = 0
        $searchFrom = 0
        while ($true) {
            $idx = $text.IndexOf($old, $searchFrom, [System.StringComparison]::Ordinal)
            if ($idx -lt 0) { break }
            $count++
            $searchFrom = $idx + $old.Length
        }

        if ($count -ne 1) {
            Write-Host "STOP: expected exactly 1 match in $relative but found $count." -ForegroundColor Red
            Write-Host "  Looking for: $old" -ForegroundColor Red
            $fileOk = $false
            $AnyFailure = $true
            break
        }

        $idx = $text.IndexOf($old, [System.StringComparison]::Ordinal)
        $text = $text.Substring(0, $idx) + $new + $text.Substring($idx + $old.Length)
    }

    if (-not $fileOk) { continue }

    if ($text -cne $original) {
        try {
            [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false))
            Write-Host "UPDATED: $relative" -ForegroundColor Green
        } catch {
            Write-Host "ERROR writing $relative : $($_.Exception.Message)" -ForegroundColor Red
            $AnyFailure = $true
        }
    } else {
        Write-Host "NO CHANGE (unexpected): $relative" -ForegroundColor Red
        $AnyFailure = $true
    }
}

if ($AnyFailure) {
    Write-Host ""
    Write-Host "One or more fixes did not apply cleanly. Stopping before running tsc." -ForegroundColor Red
    Write-Host "Backup preserved at: $BackupRoot" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " STEP 3: TYPESCRIPT CHECK ONLY" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

npx tsc --noEmit
$TsExit = $LASTEXITCODE

if ($TsExit -ne 0) {
    Write-Host ""
    Write-Host "TypeScript still reports errors. DO NOT run lint or build yet." -ForegroundColor Yellow
    Write-Host "Backup preserved at: $BackupRoot" -ForegroundColor Yellow
    exit $TsExit
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host " TYPESCRIPT PASSED - 0 ERRORS" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
