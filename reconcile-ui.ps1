#requires -Version 5.1
<#
===============================================================
 KITABU YETU - FINAL UI RECONCILIATION
===============================================================

Purpose:
  Reconcile duplicate case-sensitive UI component filenames
  without replacing the production application architecture.

Canonical production tree:
  app\
  components\
  lib\
  types\
  hooks\
  services\

Canonical UI filenames:
  components\ui\button.tsx
  components\ui\input.tsx
  components\ui\card.tsx
  components\ui\badge.tsx

The src\ tree remains excluded from TypeScript.

This script:
  1. Creates a timestamped backup.
  2. Reconciles Card/Button/Input/Badge filename collisions.
  3. Normalizes imports to lowercase UI paths.
  4. Repairs UI barrel files.
  5. Repairs known Modal Button API usage.
  6. Repairs tsconfig root aliases and src exclusion.
  7. Clears generated caches.
  8. Runs tsc, lint and build.
===============================================================
#>

$ErrorActionPreference = "Stop"

$ProjectRoot = "D:\Claude\Projects\KITABU YETU\kitabuyetu"

Set-Location -LiteralPath $ProjectRoot

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " KITABU YETU - FINAL UI RECONCILIATION" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------

function Write-Step {
    param([string]$Text)
    Write-Host ""
    Write-Host $Text -ForegroundColor Yellow
}

function Ensure-Directory {
    param([string]$Path)

    if (-not [System.IO.Directory]::Exists($Path)) {
        [System.IO.Directory]::CreateDirectory($Path) | Out-Null
    }
}

function Read-TextLiteral {
    param([string]$Path)

    return [System.IO.File]::ReadAllText(
        $Path,
        [System.Text.Encoding]::UTF8
    )
}

function Write-TextLiteral {
    param(
        [string]$Path,
        [string]$Content
    )

    [System.IO.File]::WriteAllText(
        $Path,
        $Content,
        [System.Text.UTF8Encoding]::new($false)
    )
}

function Backup-File {
    param(
        [string]$Source,
        [string]$BackupRoot
    )

    if (-not [System.IO.File]::Exists($Source)) {
        return
    }

    $relative = $Source.Substring($ProjectRoot.Length).TrimStart("\")
    $destination = Join-Path $BackupRoot $relative
    $parent = Split-Path -Parent $destination

    Ensure-Directory $parent

    Copy-Item `
        -LiteralPath $Source `
        -Destination $destination `
        -Force
}

function Files-Identical {
    param(
        [string]$A,
        [string]$B
    )

    if (-not [System.IO.File]::Exists($A)) {
        return $false
    }

    if (-not [System.IO.File]::Exists($B)) {
        return $false
    }

    $bytesA = [System.IO.File]::ReadAllBytes($A)
    $bytesB = [System.IO.File]::ReadAllBytes($B)

    if ($bytesA.Length -ne $bytesB.Length) {
        return $false
    }

    for ($i = 0; $i -lt $bytesA.Length; $i++) {
        if ($bytesA[$i] -ne $bytesB[$i]) {
            return $false
        }
    }

    return $true
}

function Rename-FileSafely {
    param(
        [string]$Path,
        [string]$TemporaryName
    )

    if (-not [System.IO.File]::Exists($Path)) {
        return
    }

    $directory = Split-Path -Parent $Path
    $temporaryPath = Join-Path $directory $TemporaryName

    if ([System.IO.File]::Exists($temporaryPath)) {
        Remove-Item -LiteralPath $temporaryPath -Force
    }

    Move-Item `
        -LiteralPath $Path `
        -Destination $temporaryPath `
        -Force
}

# ---------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------

Write-Step "[1/9] Checking production project..."

if (-not [System.IO.Directory]::Exists($ProjectRoot)) {
    throw "Production project does not exist: $ProjectRoot"
}

$ComponentsUi = Join-Path $ProjectRoot "components\ui"

if (-not [System.IO.Directory]::Exists($ComponentsUi)) {
    throw "Production UI directory does not exist: $ComponentsUi"
}

Write-Host "Production root confirmed:"
Write-Host $ProjectRoot -ForegroundColor Green

# ---------------------------------------------------------------
# Backup
# ---------------------------------------------------------------

Write-Step "[2/9] Creating safety backup..."

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $ProjectRoot ".migration-backup-ui-$Stamp"

Ensure-Directory $BackupRoot

$BackupFiles = @(
    "components\ui\Card.tsx",
    "components\ui\card.tsx",
    "components\ui\Button.tsx",
    "components\ui\button.tsx",
    "components\ui\Input.tsx",
    "components\ui\input.tsx",
    "components\ui\Badge.tsx",
    "components\ui\badge.tsx",
    "components\ui\index.ts",
    "components\index.ts",
    "components\dashboard\Modal.tsx",
    "tsconfig.json"
)

foreach ($relative in $BackupFiles) {
    Backup-File `
        -Source (Join-Path $ProjectRoot $relative) `
        -BackupRoot $BackupRoot
}

Write-Host "Backup created:" -ForegroundColor Green
Write-Host $BackupRoot

# ---------------------------------------------------------------
# Inspect duplicate UI files
# ---------------------------------------------------------------

Write-Step "[3/9] Inspecting duplicate UI implementations..."

$Pairs = @(
    @{ Upper = "Card.tsx";  Lower = "card.tsx"  },
    @{ Upper = "Button.tsx"; Lower = "button.tsx" },
    @{ Upper = "Input.tsx";  Lower = "input.tsx"  },
    @{ Upper = "Badge.tsx";  Lower = "badge.tsx" }
)

foreach ($Pair in $Pairs) {

    $upper = Join-Path $ComponentsUi $Pair.Upper
    $lower = Join-Path $ComponentsUi $Pair.Lower

    $upperExists = [System.IO.File]::Exists($upper)
    $lowerExists = [System.IO.File]::Exists($lower)

    Write-Host ""
    Write-Host "$($Pair.Upper) / $($Pair.Lower)"

    if ($upperExists -and $lowerExists) {

        if (Files-Identical $upper $lower) {
            Write-Host "  Identical implementations." -ForegroundColor Green
        }
        else {
            Write-Host "  DIFFERENT implementations detected." -ForegroundColor Yellow
            Write-Host "  Lowercase file will remain canonical."
        }

    }
    elseif ($lowerExists) {
        Write-Host "  Lowercase implementation already exists." -ForegroundColor Green
    }
    elseif ($upperExists) {
        Write-Host "  Only uppercase implementation exists."
    }
    else {
        Write-Host "  Neither implementation exists." -ForegroundColor Red
    }
}

# ---------------------------------------------------------------
# Canonical Card implementation
# ---------------------------------------------------------------

Write-Step "[4/9] Reconciling Card component..."

$CardPath = Join-Path $ComponentsUi "card.tsx"
$CardUpperPath = Join-Path $ComponentsUi "Card.tsx"

$MergedCard = @'
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "outlined";
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ variant = "default", className, ...props }, ref) => {
    const variants = {
      default:
        "rounded-lg border border-slate-200 bg-white text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50",

      elevated:
        "rounded-lg border border-slate-200 bg-white text-slate-900 shadow-md dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50 dark:shadow-lg",

      outlined:
        "rounded-lg border-2 border-slate-300 bg-transparent text-slate-900 dark:border-slate-600 dark:text-slate-50",
    };

    return (
      <div
        ref={ref}
        className={cn(variants[variant], className)}
        {...props}
      />
    );
  }
);

Card.displayName = "Card";

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
));

CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-2xl font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
));

CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));

CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
));

CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
));

CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};

export default Card;
'@

Write-TextLiteral $CardPath $MergedCard

if ([System.IO.File]::Exists($CardUpperPath)) {
    Rename-FileSafely `
        -Path $CardUpperPath `
        -TemporaryName "Card.__reconciled__.tsx"

    Remove-Item `
        -LiteralPath $CardUpperPath `
        -Force `
        -ErrorAction SilentlyContinue
}

Write-Host "Card reconciled." -ForegroundColor Green

# ---------------------------------------------------------------
# Reconcile Button / Input / Badge
# ---------------------------------------------------------------

Write-Step "[5/9] Reconciling Button, Input and Badge..."

#
# IMPORTANT:
# We do not overwrite a differing lowercase implementation with
# an arbitrary template implementation.
#
# Lowercase is canonical because production imports use lowercase.
# If uppercase exists and differs, it is retained in the backup.
#

$ComponentNames = @(
    "Button",
    "Input",
    "Badge"
)

foreach ($Name in $ComponentNames) {

    $upper = Join-Path $ComponentsUi "$Name.tsx"
    $lower = Join-Path $ComponentsUi "$($Name.ToLowerInvariant()).tsx"

    if (-not [System.IO.File]::Exists($lower)) {

        if ([System.IO.File]::Exists($upper)) {

            Rename-FileSafely `
                -Path $upper `
                -TemporaryName "$Name.__reconciled__.tsx"

            $temp = Join-Path $ComponentsUi "$Name.__reconciled__.tsx"

            Move-Item `
                -LiteralPath $temp `
                -Destination $lower `
                -Force

            Write-Host "$Name`: uppercase implementation promoted to lowercase." -ForegroundColor Green
        }
        else {
            Write-Host "$Name`: no implementation found." -ForegroundColor Red
        }

    }
    else {

        if ([System.IO.File]::Exists($upper)) {

            if (Files-Identical $upper $lower) {

                Rename-FileSafely `
                    -Path $upper `
                    -TemporaryName "$Name.__duplicate__.tsx"

                Remove-Item `
                    -LiteralPath (Join-Path $ComponentsUi "$Name.__duplicate__.tsx") `
                    -Force

                Write-Host "$Name`: duplicate removed." -ForegroundColor Green

            }
            else {

                Write-Host "$Name`: differing uppercase implementation quarantined." -ForegroundColor Yellow

                Rename-FileSafely `
                    -Path $upper `
                    -TemporaryName "$Name.__legacy__.tsx"
            }
        }

        Write-Host "$Name`: lowercase implementation is canonical." -ForegroundColor Green
    }
}

# ---------------------------------------------------------------
# Normalize imports throughout production source
# ---------------------------------------------------------------

Write-Step "[6/9] Normalizing production UI imports..."

$SearchRoots = @(
    (Join-Path $ProjectRoot "app"),
    (Join-Path $ProjectRoot "components"),
    (Join-Path $ProjectRoot "hooks"),
    (Join-Path $ProjectRoot "lib"),
    (Join-Path $ProjectRoot "services")
)

$FilesChanged = 0

foreach ($root in $SearchRoots) {

    if (-not [System.IO.Directory]::Exists($root)) {
        continue
    }

    Get-ChildItem `
        -LiteralPath $root `
        -Recurse `
        -File `
        -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Extension -in @(".ts", ".tsx")
        } |
        ForEach-Object {

            $path = $_.FullName
            $text = Read-TextLiteral $path
            $original = $text

            # Alias imports
            $text = $text -replace `
                "@/components/ui/Card\b", `
                "@/components/ui/card"

            $text = $text -replace `
                "@/components/ui/Button\b", `
                "@/components/ui/button"

            $text = $text -replace `
                "@/components/ui/Input\b", `
                "@/components/ui/input"

            $text = $text -replace `
                "@/components/ui/Badge\b", `
                "@/components/ui/badge"

            # Relative imports
            $text = $text -replace `
                '(["''])(\./|\.\./)ui/Card\1', `
                '$1$2ui/card$1'

            $text = $text -replace `
                '(["''])(\./|\.\./)ui/Button\1', `
                '$1$2ui/button$1'

            $text = $text -replace `
                '(["''])(\./|\.\./)ui/Input\1', `
                '$1$2ui/input$1'

            $text = $text -replace `
                '(["''])(\./|\.\./)ui/Badge\1', `
                '$1$2ui/badge$1'

            if ($text -ne $original) {
                Write-TextLiteral $path $text
                $FilesChanged++
            }
        }
}

Write-Host "Normalized files: $FilesChanged" -ForegroundColor Green

# ---------------------------------------------------------------
# Fix UI barrel
# ---------------------------------------------------------------

Write-Step "[7/9] Repairing UI barrel exports..."

$UiIndex = Join-Path $ComponentsUi "index.ts"

$UiIndexContent = @'
export { Button } from "./button";
export { Input } from "./input";
export {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
  CardTitle,
  CardDescription,
} from "./card";
export { Badge } from "./badge";
'@

Write-TextLiteral $UiIndex $UiIndexContent

#
# Repair root components/index.ts only for these four UI imports.
# Preserve all other exports.
#

$ComponentsIndex = Join-Path $ProjectRoot "components\index.ts"

if ([System.IO.File]::Exists($ComponentsIndex)) {

    $text = Read-TextLiteral $ComponentsIndex

    $text = $text -replace `
        '(\./ui/)Button', `
        '${1}button'

    $text = $text -replace `
        '(\./ui/)Input', `
        '${1}input'

    $text = $text -replace `
        '(\./ui/)Card', `
        '${1}card'

    $text = $text -replace `
        '(\./ui/)Badge', `
        '${1}badge'

    Write-TextLiteral $ComponentsIndex $text

    Write-Host "components/index.ts normalized." -ForegroundColor Green
}

Write-Host "components/ui/index.ts repaired." -ForegroundColor Green

# ---------------------------------------------------------------
# Modal API repair
# ---------------------------------------------------------------

Write-Step "[8/9] Repairing known Modal UI API mismatch..."

$Modal = Join-Path $ProjectRoot "components\dashboard\Modal.tsx"

if ([System.IO.File]::Exists($Modal)) {

    $text = Read-TextLiteral $Modal

    #
    # The diagnostic specifically identified:
    #
    # Button size="md"
    # Button variant="primary"
    #
    # The production Button API uses default/sm/lg/icon and
    # default/link/secondary/destructive/outline/ghost.
    #

    $text = $text -replace `
        'size="md"', `
        'size="default"'

    $text = $text -replace `
        'variant="primary"', `
        'variant="default"'

    Write-TextLiteral $Modal $text

    Write-Host "Modal Button API usage normalized." -ForegroundColor Green
}

# ---------------------------------------------------------------
# tsconfig
# ---------------------------------------------------------------

Write-Step "[9/9] Repairing TypeScript architecture and validating..."

$TsConfig = Join-Path $ProjectRoot "tsconfig.json"

if (-not [System.IO.File]::Exists($TsConfig)) {
    throw "tsconfig.json not found."
}

$TsText = Read-TextLiteral $TsConfig

#
# We deliberately manipulate JSON structurally.
#

try {
    $TsObject = $TsText | ConvertFrom-Json
}
catch {
    throw "tsconfig.json is not valid JSON. No TypeScript configuration change was made."
}

if ($null -eq $TsObject.compilerOptions) {
    $TsObject | Add-Member -MemberType NoteProperty -Name compilerOptions -Value ([pscustomobject]@{})
}

$TsObject.compilerOptions.baseUrl = "."

$paths = [ordered]@{
    "@"             = @("./*")
    "@/components/*" = @("./components/*")
    "@/lib/*"        = @("./lib/*")
    "@/types/*"      = @("./types/*")
    "@/hooks/*"      = @("./hooks/*")
}

$TsObject.compilerOptions.paths = [pscustomobject]$paths

#
# Ensure src is excluded.
#

$exclude = @()

if ($null -ne $TsObject.exclude) {
    $exclude = @($TsObject.exclude)
}

if ($exclude -notcontains "src") {
    $exclude += "src"
}

if ($exclude -notcontains ".next") {
    $exclude += ".next"
}

if ($exclude -notcontains "node_modules") {
    $exclude += "node_modules"
}

$TsObject.exclude = $exclude

#
# Preserve useful compiler settings while rewriting only the
# architecture-critical properties.
#

$Json = $TsObject |
    ConvertTo-Json -Depth 20

Write-TextLiteral $TsConfig ($Json + [Environment]::NewLine)

Write-Host "tsconfig.json now points @/* to the production root." -ForegroundColor Green
Write-Host "src remains excluded." -ForegroundColor Green

# ---------------------------------------------------------------
# Remove temporary uppercase files
# ---------------------------------------------------------------

Write-Host ""
Write-Host "Removing temporary reconciliation files..."

Get-ChildItem `
    -LiteralPath $ComponentsUi `
    -File `
    -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -match '(__reconciled__|__duplicate__)'
    } |
    ForEach-Object {

        Remove-Item `
            -LiteralPath $_.FullName `
            -Force `
            -ErrorAction SilentlyContinue
    }

# Legacy files remain as *.legacy.tsx only when they were different.
# They are not imported by the normalized production tree.

# ---------------------------------------------------------------
# Clear caches
# ---------------------------------------------------------------

Write-Host ""
Write-Host "Clearing generated caches..."

$NextCache = Join-Path $ProjectRoot ".next"

try {
    if ([System.IO.Directory]::Exists($NextCache)) {
        Remove-Item `
            -LiteralPath $NextCache `
            -Recurse `
            -Force `
            -ErrorAction Stop

        Write-Host ".next removed." -ForegroundColor Green
    }
}
catch {
    Write-Host "WARNING: .next could not be completely removed." -ForegroundColor Yellow
    Write-Host "This is usually caused by a locked generated file."
    Write-Host "Validation will continue."
}

Get-ChildItem `
    -LiteralPath $ProjectRoot `
    -Filter "*.tsbuildinfo" `
    -File `
    -ErrorAction SilentlyContinue |
    ForEach-Object {

        try {
            Remove-Item `
                -LiteralPath $_.FullName `
                -Force `
                -ErrorAction Stop
        }
        catch {
            Write-Host "WARNING: Could not remove $($_.Name)" -ForegroundColor Yellow
        }
    }

# ---------------------------------------------------------------
# Final filesystem verification
# ---------------------------------------------------------------

Write-Host ""
Write-Host "Checking canonical UI files..."

$RequiredUi = @(
    "button.tsx",
    "input.tsx",
    "card.tsx",
    "badge.tsx"
)

foreach ($file in $RequiredUi) {

    $path = Join-Path $ComponentsUi $file

    if (-not [System.IO.File]::Exists($path)) {
        throw "Required canonical UI file is missing: components\ui\$file"
    }

    Write-Host "  OK  $file" -ForegroundColor Green
}

$ForbiddenUi = @(
    "Button.tsx",
    "Input.tsx",
    "Badge.tsx",
    "Card.tsx"
)

foreach ($file in $ForbiddenUi) {

    $path = Join-Path $ComponentsUi $file

    if ([System.IO.File]::Exists($path)) {
        throw "Uppercase duplicate still exists: components\ui\$file"
    }
}

Write-Host ""
Write-Host "No uppercase UI duplicates remain." -ForegroundColor Green

# ---------------------------------------------------------------
# TypeScript gate
# ---------------------------------------------------------------

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " TYPECHECK" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan

npx tsc --noEmit

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "TYPECHECK FAILED." -ForegroundColor Red
    Write-Host "Do NOT deploy."
    Write-Host ""
    Write-Host "Backup available at:"
    Write-Host $BackupRoot
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "TYPECHECK PASSED." -ForegroundColor Green

# ---------------------------------------------------------------
# Lint gate
# ---------------------------------------------------------------

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " LINT" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan

npm run lint

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "LINT FAILED." -ForegroundColor Red
    Write-Host "Do NOT deploy."
    Write-Host ""
    Write-Host "Backup available at:"
    Write-Host $BackupRoot
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "LINT PASSED." -ForegroundColor Green

# ---------------------------------------------------------------
# Build gate
# ---------------------------------------------------------------

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " PRODUCTION BUILD" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan

npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "BUILD FAILED." -ForegroundColor Red
    Write-Host "Do NOT deploy."
    Write-Host ""
    Write-Host "Backup available at:"
    Write-Host $BackupRoot
    exit $LASTEXITCODE
}

# ---------------------------------------------------------------
# Success
# ---------------------------------------------------------------

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Green
Write-Host " RECONCILIATION COMPLETE" -ForegroundColor Green
Write-Host "===============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "TypeScript : PASSED" -ForegroundColor Green
Write-Host "Lint       : PASSED" -ForegroundColor Green
Write-Host "Build      : PASSED" -ForegroundColor Green
Write-Host ""
Write-Host "Production architecture preserved:"
Write-Host "  app\          authoritative"
Write-Host "  components\   authoritative"
Write-Host "  lib\          authoritative"
Write-Host "  types\        authoritative"
Write-Host "  hooks\        authoritative"
Write-Host "  services\     authoritative"
Write-Host "  src\          excluded"
Write-Host ""
Write-Host "Backup:"
Write-Host $BackupRoot
Write-Host ""
Write-Host "SAFE TO PROCEED TO DEPLOYMENT." -ForegroundColor Green