# package-cpanel.ps1
# Produces TWO deployment archives after `npm run build`:
#
#   deploy\kitabuyetu-cpanel.tar.gz   <- PRIMARY   (use this)
#   deploy\kitabuyetu-cpanel.zip      <- FALLBACK  (unix-path ZIP)
#
# Why tar.gz is primary:
#   cPanel File Manager PHP extractor refuses to mkdir() paths whose
#   component names begin with "(" on some CloudLinux configurations.
#   Next.js App Router route-groups produce directories named (auth),
#   (dashboard), etc. The system tar utility has NO such restriction.
#   cPanel File Manager extracts .tar.gz files using the system tar
#   binary, not PHP, so parentheses and brackets work fine.
#
# Usage:
#   .\scripts\package-cpanel.ps1
#
# Requirements:
#   Windows 10/11 -- tar.exe ships at C:\Windows\System32\tar.exe

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root    = Split-Path $PSScriptRoot -Parent
$out     = "$root\deploy"
$stage   = "$out\stage"
$tarPath = "$out\kitabuyetu-cpanel.tar.gz"
$zipPath = "$out\kitabuyetu-cpanel.zip"

# 1. Clean staging area
Write-Host "==> Cleaning staging area..."
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
if (-not (Test-Path $out)) { New-Item -ItemType Directory -Path $out | Out-Null }

# 2. Copy standalone runtime
Write-Host "==> Copying standalone server + bundled runtime..."
Copy-Item "$root\.next\standalone\*" $stage -Recurse -Force

# 3. Copy static assets (standalone omits .next/static)
Write-Host "==> Copying static assets (.next/static)..."
$staticDest = "$stage\.next\static"
if (Test-Path $staticDest) { Remove-Item $staticDest -Recurse -Force }
Copy-Item "$root\.next\static" $staticDest -Recurse -Force

# 4. Copy public/
Write-Host "==> Copying public/ assets..."
if (Test-Path "$root\public") {
    $publicDest = "$stage\public"
    if (Test-Path $publicDest) { Remove-Item $publicDest -Recurse -Force }
    Copy-Item "$root\public" $publicDest -Recurse -Force
}

# 5. Replace minimal standalone package.json with full dependency list
Write-Host "==> Replacing package.json (full deps for cPanel npm install)..."
Copy-Item "$root\package.json" "$stage\package.json" -Force

# 6. Copy config files
Write-Host "==> Copying .npmrc and .env..."
Copy-Item "$root\.npmrc" "$stage\.npmrc" -Force
Copy-Item "$root\.env"   "$stage\.env"   -Force

# 7. Remove node_modules (cPanel Node.js Selector replaces with symlink)
Write-Host "==> Removing node_modules from staging..."
if (Test-Path "$stage\node_modules") { Remove-Item "$stage\node_modules" -Recurse -Force }

# 8. PRIMARY: tar.gz via Windows built-in tar.exe
# tar always uses forward-slash entry names regardless of OS.
# CloudLinux system tar handles all POSIX characters without restriction.
Write-Host "==> Creating tar.gz (primary archive)..."
if (Test-Path $tarPath) { Remove-Item $tarPath -Force }

$tarExe = "$env:SystemRoot\System32\tar.exe"
if (-not (Test-Path $tarExe)) {
    Write-Warning "tar.exe not found. Skipping tar.gz. Use the ZIP instead."
} else {
    & $tarExe -czf $tarPath -C $stage .
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "tar.exe exited with code $LASTEXITCODE."
    } else {
        $tarSize = [math]::Round((Get-Item $tarPath).Length / 1MB, 1)
        Write-Host "tar.gz ready: $tarPath ($tarSize MB)" -ForegroundColor Green
    }
}

# 9. FALLBACK: Unix-path ZIP via .NET ZipArchive
# Uses forward-slash entry names (fixes Windows backslash bug).
# Works on hosts where system unzip is used instead of PHP ZipArchive.
Write-Host "==> Creating ZIP fallback (unix-path)..."
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$zip       = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
$stageRoot = (Resolve-Path $stage).Path.TrimEnd('\') + '\'
$files     = Get-ChildItem $stage -Recurse -File

foreach ($file in $files) {
    $entryName = $file.FullName.Substring($stageRoot.Length).Replace('\', '/')
    $entry     = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $writer    = $entry.Open()
    $reader    = [System.IO.File]::OpenRead($file.FullName)
    $reader.CopyTo($writer)
    $reader.Close()
    $writer.Close()
}
$zip.Dispose()

$zipSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "ZIP ready: $zipPath ($zipSize MB, $($files.Count) files)" -ForegroundColor Green

# 10. Summary
Write-Host ""
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host " DEPLOYMENT ARCHIVES READY" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host " PRIMARY  --> deploy\kitabuyetu-cpanel.tar.gz" -ForegroundColor Green
Write-Host " FALLBACK --> deploy\kitabuyetu-cpanel.zip" -ForegroundColor Yellow
Write-Host ""
Write-Host " STEPS:"
Write-Host "  1. In cPanel File Manager: DELETE the .next/ folder (and server.js,"
Write-Host "     package.json if they exist) from the app root"
Write-Host "  2. Upload kitabuyetu-cpanel.tar.gz to the app root"
Write-Host "  3. Right-click the .tar.gz file -> Extract"
Write-Host "     (cPanel uses system tar for .tar.gz -- parentheses work fine)"
Write-Host "  4. Node.js Selector: Node 18+, startup file = server.js"
Write-Host "  5. Click NPM Install then Restart"
Write-Host ""
Write-Host " TERMINAL FALLBACK (cPanel Advanced -> Terminal):"
Write-Host '   cd ~/kitabuyetu.ezzahcomm.co.ke'
Write-Host '   rm -rf .next server.js package.json .npmrc .env'
Write-Host '   unzip -o kitabuyetu-cpanel.zip'
