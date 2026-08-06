# export-server-bundle.ps1 -- snapshot THIS machine's running Waffled server into a
# portable bundle, so setup-pc-server.ps1 can rebuild it on another Windows box.
#
# What goes in the bundle (everything the git repo does NOT carry):
#   * a FRESH database dump (taken now, via ./waffled backup)
#   * infra/compose/.env        (secrets: JWT/encryption keys, OAuth creds, image pins)
#   * uploaded media            (the waffled_media volume: photos, recipe images, ...)
#   * setup-pc-server.ps1       (so the new machine has the installer before it clones)
#
# Usage (on the OLD server, e.g. the laptop):
#   powershell -ExecutionPolicy Bypass -File tools\server-move\export-server-bundle.ps1
#   powershell -ExecutionPolicy Bypass -File tools\server-move\export-server-bundle.ps1 -Freeze
#
# -Freeze (recommended, also offered interactively): after the export it disables the
# nightly update task, stops the stack, and releases the Tailscale name "waffled" so
# the new machine can claim it. Without freezing, anything the family adds after the
# export exists only on this machine and will NOT reach the new server.

param(
    # Where the finished zip lands.
    [string]$OutDir = (Join-Path $env:USERPROFILE 'Desktop'),
    # Retire this machine as the server right after the export (no prompt).
    [switch]$Freeze
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repo

Write-Host ""
Write-Host "Waffled server exporter" -ForegroundColor Cyan
Write-Host "-----------------------"

# Git Bash, not the System32 WSL stub (same dance as update.ps1).
$gitBash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
if (-not (Test-Path $gitBash)) {
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) { $gitBash = Join-Path (Split-Path (Split-Path $git.Source)) 'bin\bash.exe' }
}
if (-not (Test-Path $gitBash)) { Write-Host "Git Bash not found -- is Git for Windows installed?" -ForegroundColor Red; exit 1 }

# The stack must be running: the dump is taken through the live backup container.
$running = docker ps --format '{{.Names}}' 2>$null
if ($running -notcontains 'waffled-backup') {
    Write-Host "waffled-backup is not running. Start the stack first (update.ps1 or ./waffled up)." -ForegroundColor Red
    exit 1
}
$envFile = Join-Path $repo 'infra\compose\.env'
if (-not (Test-Path $envFile)) { Write-Host "infra\compose\.env not found -- nothing to export." -ForegroundColor Red; exit 1 }

# 1. Fresh dump, so the new server starts from this moment, not last night's backup.
Write-Host "[1/5] Taking a fresh database backup..." -ForegroundColor Cyan
& $gitBash ./waffled backup
if ($LASTEXITCODE -ne 0) { Write-Host "Backup failed -- aborting export." -ForegroundColor Red; exit 1 }
$dump = (docker exec waffled-backup sh -c 'ls -1t /backups/waffled-*.sql.gz | head -1').Trim()
if (-not $dump) { Write-Host "No dump found in /backups after the backup ran." -ForegroundColor Red; exit 1 }
Write-Host "      Using $dump"

# 2. Stage the bundle.
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stage = Join-Path $env:TEMP "waffled-server-bundle-$stamp"
New-Item -ItemType Directory -Force $stage | Out-Null

Write-Host "[2/5] Collecting database dump, .env, and uploaded media..." -ForegroundColor Cyan
docker cp "waffled-backup:$dump" (Join-Path $stage 'db.sql.gz') | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "docker cp of the dump failed." -ForegroundColor Red; exit 1 }
# Stored as waffled.env (not .env) so nothing treats it as hidden; the installer renames it.
Copy-Item $envFile (Join-Path $stage 'waffled.env')
docker cp 'waffled-api:/data/media' (Join-Path $stage 'media') | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "docker cp of /data/media failed." -ForegroundColor Red; exit 1 }
Copy-Item (Join-Path $PSScriptRoot 'setup-pc-server.ps1') $stage

# 3. Manifest, for "which snapshot is this?" questions later.
$sha = git rev-parse --short HEAD
@(
    "exported : $(Get-Date -Format o)"
    "host     : $env:COMPUTERNAME"
    "git sha  : $sha"
    "dump     : $dump"
) | Set-Content (Join-Path $stage 'bundle-info.txt') -Encoding utf8

# 4. Zip it.
Write-Host "[3/5] Zipping..." -ForegroundColor Cyan
$zip = Join-Path $OutDir "waffled-server-bundle-$stamp.zip"
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
Remove-Item -Recurse -Force $stage
$zipMb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "      $zip ($zipMb MB)"

# 5. Optionally retire this machine so the two servers can't diverge.
$doFreeze = $Freeze
if (-not $doFreeze) {
    Write-Host ""
    Write-Host "Freeze this machine as the server now? Recommended: anything added here after" -ForegroundColor Yellow
    Write-Host "this export will NOT reach the new server. This stops the stack, disables the" -ForegroundColor Yellow
    Write-Host "nightly update task, and releases the Tailscale name 'waffled'." -ForegroundColor Yellow
    $ans = Read-Host "Type 'freeze' to do it now (anything else skips)"
    if ($ans -eq 'freeze') { $doFreeze = $true }
}
if ($doFreeze) {
    Write-Host "[4/5] Freezing this machine..." -ForegroundColor Cyan
    schtasks /change /tn "Waffled Fork Update" /disable 2>$null | Out-Null
    & $gitBash ./waffled down
    $ts = Get-Command tailscale -ErrorAction SilentlyContinue
    if ($ts) {
        tailscale serve reset
        # Renaming releases the MagicDNS name "waffled" for the new machine to claim.
        tailscale set --hostname "waffled-retired-$($env:COMPUTERNAME.ToLower())"
    } else {
        Write-Host "      Tailscale CLI not found -- release the name 'waffled' manually in the admin console." -ForegroundColor Yellow
    }
} else {
    Write-Host "[4/5] Skipped freezing -- remember to do it before the new server goes live." -ForegroundColor Yellow
}

Write-Host "[5/5] Done." -ForegroundColor Green
Write-Host ""
Write-Host "Next, on the NEW machine:" -ForegroundColor Cyan
Write-Host "  1. Copy the zip over (USB drive, network share, ...) and extract it."
Write-Host "  2. Open PowerShell AS ADMINISTRATOR in the extracted folder and run:"
Write-Host "       powershell -ExecutionPolicy Bypass -File .\setup-pc-server.ps1 -BundlePath ."
Write-Host "  3. Follow its prompts (Docker/WSL may ask for one reboot; Tailscale opens a browser login)."
if (-not $doFreeze) {
    Write-Host ""
    Write-Host "Then come back HERE and freeze this machine (rerun with -Freeze, or manually:" -ForegroundColor Yellow
    Write-Host "disable the 'Waffled Fork Update' task, ./waffled down, tailscale serve reset," -ForegroundColor Yellow
    Write-Host "tailscale set --hostname waffled-retired-...)." -ForegroundColor Yellow
}
