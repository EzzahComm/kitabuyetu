$ScriptPath = "D:\Claude\Projects\KITABU YETU\kitabuyetu\FINAL-RECONCILE-KITABU-YETU.ps1"

@'
#requires -Version 5.1
<#
===========================================================
 KITABU YETU - FINAL UI / APP RECONCILIATION
===========================================================

AUTHORITATIVE TREE:
    D:\Claude\Projects\KITABU YETU\kitabuyetu

RULE:
    Root app/components/lib/types/hooks remain authoritative.
    src\app is NOT activated.

This script:
  1. Creates a timestamped safety backup.
  2. Safely creates canonical lowercase UI files.
  3. Merges Button/Input/Badge/Card compatibility.
  4. Repairs UI barrels.
  5. Repairs known Modal Button/Card usages.
  6. Repairs tsconfig root aliases and excludes src.
  7. Restores services/api if root is missing and a unique source exists.
  8. Clears .next / tsbuildinfo where possible.
  9. Runs tsc, lint and build.
===========================================================
#>

$ErrorActionPreference = "Stop"

$Root = "D:\Claude\Projects\KITABU YETU\kitabuyetu"

if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    throw "Project root does not exist: $Root"
}

Set-Location -LiteralPath $Root

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " KITABU YETU - FINAL RECONCILIATION" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

# -------------------------------------------------------
# Helpers
# -------------------------------------------------------

function Ensure-Directory {
    param([string]$Path)

    if (-not [System.IO.Directory]::Exists($Path)) {
        [System.IO.Directory]::CreateDirectory($Path) | Out-Null
    }
}

function Backup-File {
    param(
        [string]$Path,
        [string]$BackupRoot
    )

    if ([System.IO.File]::Exists($Path)) {
        $relative = $Path.Substring($Root.Length).TrimStart('\')
        $destination = Join-Path $BackupRoot $relative
        $destinationDir = Split-Path -Parent $destination

        Ensure-Directory $destinationDir
        [System.IO.File]::Copy($Path, $destination, $true)

        Write-Host "  Backed up: $relative" -ForegroundColor DarkGray
    }
}

function Write-TextFileSafely {
    param(
        [string]$Path,
        [string]$Content,
        [string]$BackupRoot
    )

    Backup-File $Path $BackupRoot

    $directory = Split-Path -Parent $Path
    Ensure-Directory $directory

    # Write to temporary file first.
    $temp = "$Path.__repair_tmp__"

    if ([System.IO.File]::Exists($temp)) {
        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    }

    [System.IO.File]::WriteAllText(
        $temp,
        $Content,
        (New-Object System.Text.UTF8Encoding($false))
    )

    # If destination exists, replace it.
    if ([System.IO.File]::Exists($Path)) {
        Remove-Item -LiteralPath $Path -Force
    }

    Move-Item -LiteralPath $temp -Destination $Path -Force
}

function Safe-Remove-File {
    param([string]$Path)

    if ([System.IO.File]::Exists($Path)) {
        Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    }
}

function Replace-Text {
    param(
        [string]$Path,
        [string]$Pattern,
        [string]$Replacement,
        [string]$BackupRoot
    )

    if (-not [System.IO.File]::Exists($Path)) {
        return
    }

    $text = [System.IO.File]::ReadAllText($Path)
    $newText = [regex]::Replace($text, $Pattern, $Replacement)

    if ($newText -ne $text) {
        Backup-File $Path $BackupRoot
        [System.IO.File]::WriteAllText(
            $Path,
            $newText,
            (New-Object System.Text.UTF8Encoding($false))
        )
        Write-Host "  Updated: $($Path.Substring($Root.Length).TrimStart('\'))" -ForegroundColor Green
    }
}

# -------------------------------------------------------
# Safety backup
# -------------------------------------------------------

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $Root ".migration-backup-final-$Stamp"

Ensure-Directory $BackupRoot

Write-Host "[1/9] Creating safety backup..." -ForegroundColor Yellow

$BackupTargets = @(
    "components\ui",
    "components\index.ts",
    "components\dashboard\Modal.tsx",
    "tsconfig.json",
    "services\api.ts",
    "services\api\index.ts"
)

foreach ($relative in $BackupTargets) {
    $path = Join-Path $Root $relative

    if ([System.IO.File]::Exists($path)) {
        Backup-File $path $BackupRoot
    }
    elseif ([System.IO.Directory]::Exists($path)) {
        $destination = Join-Path $BackupRoot $relative
        Ensure-Directory $destination

        Get-ChildItem -LiteralPath $path -File -Force | ForEach-Object {
            [System.IO.File]::Copy(
                $_.FullName,
                (Join-Path $destination $_.Name),
                $true
            )
        }
    }
}

Write-Host "  Backup: $BackupRoot" -ForegroundColor Green

# -------------------------------------------------------
# Canonical UI paths
# -------------------------------------------------------

$UiDir = Join-Path $Root "components\ui"
Ensure-Directory $UiDir

# -------------------------------------------------------
# Button
# -------------------------------------------------------

Write-Host "[2/9] Installing canonical Button..." -ForegroundColor Yellow

$ButtonContent = @'
"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "default"
    | "primary"
    | "secondary"
    | "outline"
    | "ghost"
    | "destructive"
    | "link";
  size?: "default" | "sm" | "md" | "lg" | "icon";
  asChild?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      asChild = false,
      loading = false,
      icon,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";

    const variantClasses = {
      default:
        "bg-primary text-primary-foreground hover:bg-primary/90",
      primary:
        "bg-primary-500 text-white hover:bg-primary-600 active:bg-primary-700 dark:bg-primary-600 dark:hover:bg-primary-500",
      secondary:
        "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      outline:
        "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
      ghost:
        "hover:bg-accent hover:text-accent-foreground",
      destructive:
        "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      link:
        "text-primary underline-offset-4 hover:underline",
    };

    const sizeClasses = {
      default: "h-10 px-4 py-2",
      sm: "h-9 rounded-md px-3",
      md: "h-10 px-4 py-2",
      lg: "h-11 rounded-md px-8",
      icon: "h-10 w-10",
    };

    const baseClasses =
      "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";

    const content = asChild ? (
      children
    ) : (
      <>
        {loading && (
          <svg
            className="h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}

        {!loading && icon && icon}

        {loading ? "Loading..." : children}
      </>
    );

    return (
      <Comp
        ref={ref}
        className={cn(
          baseClasses,
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {content}
      </Comp>
    );
  }
);

Button.displayName = "Button";

export function buttonVariants({
  variant = "default",
  size = "default",
  className,
}: {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
} = {}) {
  const variantClasses = {
    default: "bg-primary text-primary-foreground hover:bg-primary/90",
    primary:
      "bg-primary-500 text-white hover:bg-primary-600 active:bg-primary-700",
    secondary:
      "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    outline:
      "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
    ghost: "hover:bg-accent hover:text-accent-foreground",
    destructive:
      "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    link: "text-primary underline-offset-4 hover:underline",
  };

  const sizeClasses = {
    default: "h-10 px-4 py-2",
    sm: "h-9 rounded-md px-3",
    md: "h-10 px-4 py-2",
    lg: "h-11 rounded-md px-8",
    icon: "h-10 w-10",
  };

  return cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium",
    variantClasses[variant || "default"],
    sizeClasses[size || "default"],
    className
  );
}

export { Button };
export default Button;
'@

Write-TextFileSafely `
    (Join-Path $UiDir "button.tsx") `
    $ButtonContent `
    $BackupRoot

# -------------------------------------------------------
# Input
# -------------------------------------------------------

Write-Host "[3/9] Installing canonical Input..." -ForegroundColor Yellow

$InputContent = @'
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  icon?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      icon,
      className,
      id,
      ...props
    },
    ref
  ) => {
    const reactId = React.useId();
    const inputId = id || `input-${reactId.replace(/:/g, "")}`;

    const input = (
      <div className="relative">
        {icon && (
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
            {icon}
          </div>
        )}

        <input
          ref={ref}
          id={inputId}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
            "file:border-0 file:bg-transparent file:text-sm file:font-medium",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            icon && "pl-10",
            error && "border-error-500 focus-visible:ring-error-500",
            className
          )}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error
              ? `${inputId}-error`
              : helperText
                ? `${inputId}-helper`
                : undefined
          }
          {...props}
        />
      </div>
    );

    if (!label && !error && !helperText) {
      return input;
    }

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="mb-2 block text-sm font-medium text-slate-900 dark:text-slate-50"
          >
            {label}
            {props.required && (
              <span className="ml-1 text-error-600">*</span>
            )}
          </label>
        )}

        {input}

        {error && (
          <p
            id={`${inputId}-error`}
            className="mt-2 text-sm font-medium text-error-600 dark:text-error-400"
          >
            {error}
          </p>
        )}

        {helperText && !error && (
          <p
            id={`${inputId}-helper`}
            className="mt-2 text-sm text-slate-600 dark:text-slate-400"
          >
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export { Input };
export default Input;
'@

Write-TextFileSafely `
    (Join-Path $UiDir "input.tsx") `
    $InputContent `
    $BackupRoot

# -------------------------------------------------------
# Badge
# -------------------------------------------------------

Write-Host "[4/9] Installing canonical Badge..." -ForegroundColor Yellow

$BadgeContent = @'
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  variant?:
    | "default"
    | "primary"
    | "secondary"
    | "success"
    | "warning"
    | "error"
    | "destructive"
    | "outline"
    | "slate";
  size?: "sm" | "md";
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      variant = "default",
      size = "md",
      className,
      children,
      ...props
    },
    ref
  ) => {
    const variants = {
      default:
        "border-transparent bg-primary text-primary-foreground",
      primary:
        "bg-primary-100 text-primary-900 dark:bg-primary-900/30 dark:text-primary-400",
      secondary:
        "border-transparent bg-secondary text-secondary-foreground",
      success:
        "bg-success-100 text-success-900 dark:bg-success-900/30 dark:text-success-400",
      warning:
        "bg-warning-100 text-warning-900 dark:bg-warning-900/30 dark:text-warning-400",
      error:
        "bg-error-100 text-error-900 dark:bg-error-900/30 dark:text-error-400",
      destructive:
        "border-transparent bg-destructive text-destructive-foreground",
      outline:
        "border border-current bg-transparent text-foreground",
      slate:
        "bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-200",
    };

    const sizes = {
      sm: "px-2 py-1 text-xs",
      md: "px-3 py-1.5 text-sm",
    };

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-md font-medium",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = "Badge";

export function badgeVariants({
  variant = "default",
}: {
  variant?: BadgeProps["variant"];
} = {}) {
  const variants = {
    default:
      "border-transparent bg-primary text-primary-foreground",
    primary:
      "bg-primary-100 text-primary-900 dark:bg-primary-900/30 dark:text-primary-400",
    secondary:
      "border-transparent bg-secondary text-secondary-foreground",
    success:
      "bg-success-100 text-success-900 dark:bg-success-900/30 dark:text-success-400",
    warning:
      "bg-warning-100 text-warning-900 dark:bg-warning-900/30 dark:text-warning-400",
    error:
      "bg-error-100 text-error-900 dark:bg-error-900/30 dark:text-error-400",
    destructive:
      "border-transparent bg-destructive text-destructive-foreground",
    outline:
      "border border-current bg-transparent text-foreground",
    slate:
      "bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-200",
  };

  return cn(
    "inline-flex items-center rounded-md font-medium",
    variants[variant || "default"]
  );
}

export { Badge };
export default Badge;
'@

Write-TextFileSafely `
    (Join-Path $UiDir "badge.tsx") `
    $BadgeContent `
    $BackupRoot

# -------------------------------------------------------
# Card
# -------------------------------------------------------

Write-Host "[5/9] Installing canonical Card..." -ForegroundColor Yellow

$CardContent = @'
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement> {
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

Write-TextFileSafely `
    (Join-Path $UiDir "card.tsx") `
    $CardContent `
    $BackupRoot

# -------------------------------------------------------
# Remove/neutralize uppercase duplicate UI files.
# Windows requires a temporary name for case-only rename.
# -------------------------------------------------------

Write-Host "  Normalizing UI filename casing..." -ForegroundColor DarkCyan

$CaseVariants = @(
    @{ Upper = "Button.tsx"; Lower = "button.tsx" },
    @{ Upper = "Input.tsx";  Lower = "input.tsx" },
    @{ Upper = "Badge.tsx";  Lower = "badge.tsx" },
    @{ Upper = "Card.tsx";   Lower = "card.tsx" }
)

foreach ($item in $CaseVariants) {
    $upperPath = Join-Path $UiDir $item.Upper
    $lowerPath = Join-Path $UiDir $item.Lower

    # DirectoryInfo gives us the actual stored filename.
    $actual = Get-ChildItem -LiteralPath $UiDir -File -Force |
        Where-Object { $_.Name -ieq $item.Upper } |
        Select-Object -First 1

    if ($null -ne $actual -and $actual.Name -cne $item.Lower) {
        # Our canonical lowercase file now exists, so preserve the
        # previous differently-cased implementation in the backup.
        $legacy = Join-Path $BackupRoot ("components\ui\" + $actual.Name)
        Ensure-Directory (Split-Path -Parent $legacy)

        if (-not [System.IO.File]::Exists($legacy)) {
            [System.IO.File]::Copy($actual.FullName, $legacy, $true)
        }

        Remove-Item -LiteralPath $actual.FullName -Force -ErrorAction SilentlyContinue
    }
}

# -------------------------------------------------------
# UI barrel
# -------------------------------------------------------

Write-Host "[6/9] Repairing UI exports/import paths..." -ForegroundColor Yellow

$UiIndex = @'
export { Button, buttonVariants } from "./button";
export { Input } from "./input";
export { Card, CardHeader, CardContent, CardFooter, CardTitle, CardDescription } from "./card";
export { Badge, badgeVariants } from "./badge";
'@

Write-TextFileSafely `
    (Join-Path $UiDir "index.ts") `
    $UiIndex `
    $BackupRoot

# Repair known root component barrel casing.
$ComponentsIndex = Join-Path $Root "components\index.ts"

if ([System.IO.File]::Exists($ComponentsIndex)) {
    Replace-Text `
        $ComponentsIndex `
        "['""]@/components/ui/(Button|button)['""]" `
        "@/components/ui/button" `
        $BackupRoot

    Replace-Text `
        $ComponentsIndex `
        "['""]@/components/ui/(Input|input)['""]" `
        "@/components/ui/input" `
        $BackupRoot

    Replace-Text `
        $ComponentsIndex `
        "['""]@/components/ui/(Badge|badge)['""]" `
        "@/components/ui/badge" `
        $BackupRoot

    Replace-Text `
        $ComponentsIndex `
        "['""]@/components/ui/(Card|card)['""]" `
        "@/components/ui/card" `
        $BackupRoot
}

# General import casing cleanup throughout root source.
$SourceExtensions = @("*.ts", "*.tsx")

foreach ($extension in $SourceExtensions) {
    Get-ChildItem -LiteralPath $Root -Recurse -File -Filter $extension -Force |
        Where-Object {
            $_.FullName -notmatch "\\node_modules\\" -and
            $_.FullName -notmatch "\\.next\\" -and
            $_.FullName -notmatch "\\src\\"
        } |
        ForEach-Object {
            Replace-Text $_.FullName `
                "@/components/ui/(Button|button)" `
                "@/components/ui/button" `
                $BackupRoot

            Replace-Text $_.FullName `
                "@/components/ui/(Input|input)" `
                "@/components/ui/input" `
                $BackupRoot

            Replace-Text $_.FullName `
                "@/components/ui/(Badge|badge)" `
                "@/components/ui/badge" `
                $BackupRoot

            Replace-Text $_.FullName `
                "@/components/ui/(Card|card)" `
                "@/components/ui/card" `
                $BackupRoot
        }
}

# -------------------------------------------------------
# Modal compatibility
# -------------------------------------------------------

$Modal = Join-Path $Root "components\dashboard\Modal.tsx"

if ([System.IO.File]::Exists($Modal)) {
    Write-Host "  Repairing Modal compatibility..." -ForegroundColor DarkCyan

    Replace-Text `
        $Modal `
        '<Button([^>]*?)size="md"' `
        '<Button$1size="default"' `
        $BackupRoot

    Replace-Text `
        $Modal `
        '<Button([^>]*?)variant="primary"' `
        '<Button$1variant="default"' `
        $BackupRoot
}

# -------------------------------------------------------
# services/api
# -------------------------------------------------------

Write-Host "  Checking services/api..." -ForegroundColor DarkCyan

$RootApiFile = Join-Path $Root "services\api.ts"
$RootApiDir  = Join-Path $Root "services\api"

$RootApiExists =
    [System.IO.File]::Exists($RootApiFile) -or
    [System.IO.File]::Exists((Join-Path $RootApiDir "index.ts"))

if (-not $RootApiExists) {

    $TemplateRoot = "D:\Templates\Kitabu Yetu UI"

    $Candidates = @()

    $candidate1 = Join-Path $TemplateRoot "src\services\api.ts"
    $candidate2 = Join-Path $TemplateRoot "src\services\api\index.ts"

    if ([System.IO.File]::Exists($candidate1)) {
        $Candidates += $candidate1
    }

    if ([System.IO.File]::Exists($candidate2)) {
        $Candidates += $candidate2
    }

    if ($Candidates.Count -eq 1) {
        $sourceApi = $Candidates[0]

        if ($sourceApi -like "*\api\index.ts") {
            Ensure-Directory $RootApiDir
            Write-TextFileSafely `
                (Join-Path $RootApiDir "index.ts") `
                ([System.IO.File]::ReadAllText($sourceApi)) `
                $BackupRoot
        }
        else {
            Ensure-Directory (Split-Path -Parent $RootApiFile)
            Write-TextFileSafely `
                $RootApiFile `
                ([System.IO.File]::ReadAllText($sourceApi)) `
                $BackupRoot
        }

        Write-Host "  Restored services/api from template source." -ForegroundColor Green
    }
    elseif ($Candidates.Count -gt 1) {
        Write-Warning "Multiple template services/api candidates found. No automatic copy performed."
    }
    else {
        Write-Warning "No template services/api candidate found."
    }
}
else {
    Write-Host "  services/api already exists; preserved." -ForegroundColor Green
}

# -------------------------------------------------------
# tsconfig
# -------------------------------------------------------

Write-Host "[7/9] Repairing tsconfig.json..." -ForegroundColor Yellow

$TsConfigPath = Join-Path $Root "tsconfig.json"

if (-not [System.IO.File]::Exists($TsConfigPath)) {
    throw "tsconfig.json was not found."
}

Backup-File $TsConfigPath $BackupRoot

$ts = Get-Content -LiteralPath $TsConfigPath -Raw | ConvertFrom-Json

if ($null -eq $ts.compilerOptions) {
    $ts | Add-Member -MemberType NoteProperty -Name compilerOptions -Value ([pscustomobject]@{})
}

$ts.compilerOptions.baseUrl = "."

$paths = [ordered]@{
    "@" = @("./*")
    "@/components/*" = @("./components/*")
    "@/lib/*" = @("./lib/*")
    "@/types/*" = @("./types/*")
    "@/hooks/*" = @("./hooks/*")
}

$ts.compilerOptions.paths = [pscustomobject]$paths

# Preserve existing excludes while guaranteeing src is excluded.
$existingExclude = @()

if ($null -ne $ts.exclude) {
    foreach ($x in $ts.exclude) {
        $existingExclude += [string]$x
    }
}

if ($existingExclude -notcontains "src") {
    $existingExclude += "src"
}

if ($existingExclude -notcontains "src/**") {
    $existingExclude += "src/**"
}

$ts.exclude = @($existingExclude)

$tsJson = $ts | ConvertTo-Json -Depth 20

[System.IO.File]::WriteAllText(
    $TsConfigPath,
    $tsJson + [Environment]::NewLine,
    (New-Object System.Text.UTF8Encoding($false))
)

Write-Host "  tsconfig now uses root aliases and excludes src." -ForegroundColor Green

# -------------------------------------------------------
# Verify canonical files
# -------------------------------------------------------

Write-Host "[8/9] Verifying canonical files..." -ForegroundColor Yellow

$Required = @(
    "components\ui\button.tsx",
    "components\ui\input.tsx",
    "components\ui\badge.tsx",
    "components\ui\card.tsx",
    "components\ui\index.ts"
)

foreach ($relative in $Required) {
    $path = Join-Path $Root $relative

    if (-not [System.IO.File]::Exists($path)) {
        throw "Required canonical file is missing: $relative"
    }

    Write-Host "  OK  $relative" -ForegroundColor Green
}

# Show actual UI filenames.
Write-Host ""
Write-Host "Canonical UI directory:" -ForegroundColor Cyan

Get-ChildItem -LiteralPath $UiDir -File -Force |
    Select-Object Name, Length, LastWriteTime |
    Sort-Object Name |
    Format-Table -AutoSize

# -------------------------------------------------------
# Cache cleanup
# -------------------------------------------------------

Write-Host "  Clearing build cache..." -ForegroundColor DarkCyan

$NextCache = Join-Path $Root ".next"

if ([System.IO.Directory]::Exists($NextCache)) {
    try {
        Remove-Item -LiteralPath $NextCache -Recurse -Force -ErrorAction Stop
        Write-Host "  .next removed." -ForegroundColor Green
    }
    catch {
        Write-Warning ".next could not be completely removed. Continuing."
        Write-Warning $_.Exception.Message
    }
}

Get-ChildItem -LiteralPath $Root -Recurse -File -Filter "*.tsbuildinfo" -Force -ErrorAction SilentlyContinue |
    Where-Object {
        $_.FullName -notmatch "\\node_modules\\"
    } |
    ForEach-Object {
        try {
            Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop
        }
        catch {
            Write-Warning "Could not remove $($_.FullName)"
        }
    }

# -------------------------------------------------------
# Verification gates
# -------------------------------------------------------

Write-Host ""
Write-Host "[9/9] RUNNING VERIFICATION GATES" -ForegroundColor Yellow
Write-Host "=====================================================" -ForegroundColor Cyan

Write-Host ""
Write-Host "GATE 1/3 - TypeScript" -ForegroundColor Cyan
npx tsc --noEmit

if ($LASTEXITCODE -ne 0) {
    throw "TypeScript verification FAILED. Migration stopped before lint/build."
}

Write-Host ""
Write-Host "GATE 2/3 - ESLint" -ForegroundColor Cyan
npm run lint

if ($LASTEXITCODE -ne 0) {
    throw "Lint verification FAILED. Deployment is NOT approved."
}

Write-Host ""
Write-Host "GATE 3/3 - Production build" -ForegroundColor Cyan
npm run build

if ($LASTEXITCODE -ne 0) {
    throw "Production build FAILED. Deployment is NOT approved."
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Green
Write-Host " ALL VERIFICATION GATES PASSED" -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Backup created at:" -ForegroundColor Cyan
Write-Host $BackupRoot -ForegroundColor White
Write-Host ""
Write-Host "The project is ready for deployment." -ForegroundColor Green
Write-Host ""
'@ | Set-Content -LiteralPath $ScriptPath -Encoding UTF8

Write-Host ""
Write-Host "Created:" -ForegroundColor Green
Write-Host $ScriptPath -ForegroundColor White