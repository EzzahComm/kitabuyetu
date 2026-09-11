$ProjectRoot = "D:\Claude\Projects\KITABU YETU\kitabuyetu"
Set-Location -LiteralPath $ProjectRoot

$Fixes = @(
    @{
        File = "__tests__\integration\financial-products.test.ts"
        Old  = "['penalty', 'interest', 'principal'] as const"
        New  = "['penalty', 'interest', 'principal'] as Array<'penalty' | 'interest' | 'principal'>"
    },
    @{
        File = "__tests__\integration\helpers\request.ts"
        Old  = "new NextRequest(new URL(path, 'http://localhost'), init);"
        New  = "new NextRequest(new URL(path, 'http://localhost'), init as ConstructorParameters<typeof NextRequest>[1]);"
    },
    @{
        File = "__tests__\unit\observability\error-sink.test.ts"
        Old  = "process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;"
        New  = "(process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_ENV.NODE_ENV;"
    },
    @{
        File = "__tests__\unit\services\organization-finance-donor-report.test.ts"
        Old  = "import { withDb } from '@/lib/db';"
        New  = "import { withDb } from '@/lib/db';`nimport type { TenantContext } from '@/lib/db';"
    },
    @{
        File = "__tests__\unit\services\organization-finance-donor-report.test.ts"
        Old  = "const ctx = { groupId: null, userId: 'coord-1', role: 'organization_coordinator', organizationId: 'org-1' };"
        New  = "const ctx = { groupId: null, userId: 'coord-1', role: 'organization_coordinator', organizationId: 'org-1' } as unknown as TenantContext;"
    }
)

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " STEP 1: BACKUP" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

$UniqueFiles = $Fixes.File | Select-Object -Unique
$BackupRoot = Join-Path $ProjectRoot (".repair-backup-testtypes-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
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

# Group fixes by file so multiple edits to the same file are applied in one pass
$ByFile = $Fixes | Group-Object -Property File

foreach ($group in $ByFile) {
    $relative = $group.Name
    $path = Join-Path $ProjectRoot $relative
    $text = [System.IO.File]::ReadAllText($path)
    $original = $text
    $ok = $true

    foreach ($fix in $group.Group) {
        $old = $fix.Old
        $new = $fix.New

        # Count occurrences (ordinal)
        $count = 0
        $searchFrom = 0
        while ($true) {
            $idx = $text.IndexOf($old, $searchFrom, [System.StringComparison]::Ordinal)
            if ($idx -lt 0) { break }
            $count++
            $searchFrom = $idx + $old.Length
        }

        if ($count -ne 1) {
            Write-Host "STOP: expected exactly 1 match for a fix in $relative but found $count. Aborting this file." -ForegroundColor Red
            Write-Host "  Looking for: $old" -ForegroundColor Red
            $ok = $false
            break
        }

        $idx = $text.IndexOf($old, [System.StringComparison]::Ordinal)
        $text = $text.Substring(0, $idx) + $new + $text.Substring($idx + $old.Length)
    }

    if (-not $ok) { continue }

    if ($text -cne $original) {
        [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false))
        Write-Host "UPDATED: $relative" -ForegroundColor Green
    } else {
        Write-Host "NO CHANGE (unexpected): $relative" -ForegroundColor Red
    }
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
