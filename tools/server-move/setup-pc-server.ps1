# setup-pc-server.ps1 -- turn a fresh Windows machine into THE always-on Waffled
# server, from a bundle produced by export-server-bundle.ps1 on the old server.
#
# End state (mirrors the laptop setup this fork has run on):
#   * Git + Docker Desktop (WSL2) + Tailscale installed
#   * fork cloned to $RepoDir, images built FROM SOURCE (./waffled up --build)
#   * .env, database, and uploaded media restored from the bundle
#   * whisper (voice profile) running for the kiosk voice assistant
#   * Tailscale device named "waffled", serving 443->8080 and 8090->8090
#     (so https://waffled.tail5cf530.ts.net keeps working for every device)
#   * "Waffled Fork Update Agent" task every 60s (powers the in-app Update button)
#   * "Waffled Fork Update" nightly task at 3:30 AM -- registered but DISABLED
#   * machine never sleeps on AC power; firewall open on 8080/8090 for the LAN
#
# Usage: open PowerShell AS ADMINISTRATOR in the extracted bundle folder:
#   powershell -ExecutionPolicy Bypass -File .\setup-pc-server.ps1 -BundlePath .
#
# The script is idempotent -- if it stops (e.g. the WSL install wants a reboot),
# just run it again and it continues where it left off.

param(
    # Extracted bundle folder (or the .zip itself) from export-server-bundle.ps1.
    [Parameter(Mandatory = $true)][string]$BundlePath,
    [string]$RepoDir = (Join-Path $env:USERPROFILE 'Code\waffled_fork'),
    [string]$RepoUrl = 'https://github.com/dispencer17/waffled.git',
    # Skip the Tailscale install/rename/serve steps (LAN-only server).
    [switch]$SkipTailscale,
    # Re-run everything EXCEPT the database/media restore (e.g. after the server
    # is already live -- restoring again would overwrite newer family data).
    [switch]$SkipRestore
)

$ErrorActionPreference = 'Stop'

function Step([string]$msg) { Write-Host ""; Write-Host "== $msg" -ForegroundColor Cyan }

function Update-PathFromRegistry {
    # winget installs append to the registry PATH; pick that up without a new shell.
    $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $u = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$m;$u"
}

function Find-GitBash {
    # Git Bash, never the System32 WSL relay stub (fails with no WSL distro).
    $p = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
    if (Test-Path $p) { return $p }
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) {
        $p = Join-Path (Split-Path (Split-Path $git.Source)) 'bin\bash.exe'
        if (Test-Path $p) { return $p }
    }
    return $null
}

Write-Host ""
Write-Host "Waffled server setup" -ForegroundColor Cyan
Write-Host "--------------------"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Run this from an ADMINISTRATOR PowerShell (needed for installs, the scheduled task, power + firewall settings)." -ForegroundColor Red
    exit 1
}

# ── Bundle ──────────────────────────────────────────────────────────────────
Step "Checking the bundle"
$BundlePath = (Resolve-Path $BundlePath).Path
if ($BundlePath -like '*.zip') {
    $extract = Join-Path $env:TEMP ("waffled-bundle-" + [IO.Path]::GetFileNameWithoutExtension($BundlePath))
    if (-not (Test-Path $extract)) { Expand-Archive -Path $BundlePath -DestinationPath $extract }
    $BundlePath = $extract
}
foreach ($f in 'waffled.env', 'db.sql.gz') {
    if (-not (Test-Path (Join-Path $BundlePath $f))) {
        Write-Host "Bundle is missing $f -- point -BundlePath at the folder exported by export-server-bundle.ps1." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Bundle OK: $BundlePath"
if (Test-Path (Join-Path $BundlePath 'bundle-info.txt')) { Get-Content (Join-Path $BundlePath 'bundle-info.txt') | Write-Host }

# ── Prerequisites ───────────────────────────────────────────────────────────
Step "Installing prerequisites (Git, WSL2, Docker Desktop, Tailscale)"
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "winget not found -- install 'App Installer' from the Microsoft Store, then rerun." -ForegroundColor Red
    exit 1
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
    Update-PathFromRegistry
}
Write-Host "git: $((Get-Command git).Source)"

wsl.exe --status *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Enabling WSL2 (Docker Desktop's backend)..."
    wsl.exe --install --no-distribution
    Write-Host ""
    Write-Host "WSL was just enabled -- REBOOT, then run this script again; it continues from here." -ForegroundColor Yellow
    exit 0
}
Write-Host "WSL2: OK"

$dockerDesktopExe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
if (-not (Test-Path $dockerDesktopExe)) {
    winget install --id Docker.DockerDesktop -e --accept-source-agreements --accept-package-agreements
    Update-PathFromRegistry
}
Write-Host "Docker Desktop: installed"

if (-not $SkipTailscale) {
    if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) {
        winget install --id Tailscale.Tailscale -e --accept-source-agreements --accept-package-agreements
        Update-PathFromRegistry
    }
    Write-Host "Tailscale: installed"
}

# ── Repo + .env ─────────────────────────────────────────────────────────────
Step "Cloning the fork"
if (-not (Test-Path (Join-Path $RepoDir '.git'))) {
    New-Item -ItemType Directory -Force (Split-Path $RepoDir) | Out-Null
    git clone $RepoUrl $RepoDir
    if ($LASTEXITCODE -ne 0) { Write-Host "git clone failed." -ForegroundColor Red; exit 1 }
} else {
    Write-Host "Repo already at $RepoDir -- leaving it as-is."
}

Step "Installing .env (secrets must match the restored database)"
$envTarget = Join-Path $RepoDir 'infra\compose\.env'
if (Test-Path $envTarget) {
    Copy-Item $envTarget "$envTarget.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Write-Host "Existing .env backed up alongside it."
}
Copy-Item (Join-Path $BundlePath 'waffled.env') $envTarget -Force
Write-Host ".env installed. (Its TOKEN_ENCRYPTION_KEY/JWT keys MUST stay paired with this database.)"

# ── Docker engine ───────────────────────────────────────────────────────────
Step "Starting the Docker engine"
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Start-Process $dockerDesktopExe
    Write-Host "Waiting for Docker Desktop (first launch may show a license page -- accept it)..."
    $deadline = (Get-Date).AddMinutes(6)
    do {
        Start-Sleep -Seconds 5
        docker info *> $null
    } until ($LASTEXITCODE -eq 0 -or (Get-Date) -gt $deadline)
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Docker engine never came up. Open Docker Desktop, finish its first-run flow, then rerun this script." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Docker engine: OK"

# ── Tailscale identity: claim the name every device already points at ──────
if (-not $SkipTailscale) {
    Step "Tailscale: claiming the machine name 'waffled'"
    $tsState = tailscale status --peers=false 2>&1
    if ($LASTEXITCODE -ne 0 -or "$tsState" -match 'Logged out|Stopped') {
        Write-Host "Logging in -- a browser window will open; use the SAME Tailscale account as the old server."
        tailscale up
        if ($LASTEXITCODE -ne 0) { Write-Host "tailscale up failed -- rerun the script after logging in." -ForegroundColor Red; exit 1 }
    }
    tailscale set --hostname waffled
    # The rename takes a while to propagate to MagicDNS (~20s observed) -- poll
    # before concluding the name is taken, or a slow control plane false-warns.
    $claimed = $false
    $deadline = (Get-Date).AddSeconds(60)
    do {
        Start-Sleep -Seconds 3
        $dnsName = ''
        try {
            $tsJson = (tailscale status --json 2>$null) -join "`n"
            $dnsName = "$((ConvertFrom-Json $tsJson).Self.DNSName)"
        } catch { }
        if ($dnsName -match '^waffled\.') { $claimed = $true }
    } until ($claimed -or (Get-Date) -gt $deadline)
    $self = tailscale status --self --peers=false
    Write-Host "This device is now: $self"
    if (-not $claimed) {
        Write-Host "The name 'waffled' looks TAKEN (old server still holds it)." -ForegroundColor Yellow
        Write-Host "Free it: on the old machine run the export with -Freeze, or rename/remove the old" -ForegroundColor Yellow
        Write-Host "device at https://login.tailscale.com/admin/machines -- then rerun this script." -ForegroundColor Yellow
    }
    # Same HTTPS fronting the old server had: 443 -> web UI, 8090 -> PowerSync.
    tailscale serve --bg --https=443 http://127.0.0.1:8080
    tailscale serve --bg --https=8090 http://127.0.0.1:8090
    Write-Host "tailscale serve: 443->8080, 8090->8090"
}

# ── Build + start the stack ────────────────────────────────────────────────
Step "Building images from source and starting the stack (5-15 min first time)"
$gitBash = Find-GitBash
if (-not $gitBash) { Write-Host "Git Bash not found even after install -- open a new admin PowerShell and rerun." -ForegroundColor Red; exit 1 }
Set-Location $RepoDir
& $gitBash ./waffled up --build
if ($LASTEXITCODE -ne 0) { Write-Host "./waffled up --build failed -- see output above." -ForegroundColor Red; exit 1 }

# Kiosk voice assistant STT (the .env points WHISPER_BASE_URL at this container).
docker compose -f (Join-Path $RepoDir 'infra\compose\docker-compose.yml') --profile voice up -d whisper
Write-Host "whisper (voice profile): started"

# ── Restore data ────────────────────────────────────────────────────────────
if (-not $SkipRestore) {
    Step "Restoring the database and uploaded media from the bundle"
    $dumpName = "waffled-migrated-$(Get-Date -Format 'yyyyMMdd-HHmmss').sql.gz"
    docker cp (Join-Path $BundlePath 'db.sql.gz') "waffled-backup:/backups/$dumpName"
    if ($LASTEXITCODE -ne 0) { Write-Host "Could not copy the dump into the backup container." -ForegroundColor Red; exit 1 }
    # Piped stdin answers ./waffled restore's confirmation; it stops the app services,
    # restores in one transaction, and restarts the stack (re-running migrations).
    'restore' | & $gitBash ./waffled restore $dumpName
    if ($LASTEXITCODE -ne 0) { Write-Host "Database restore failed -- see output above." -ForegroundColor Red; exit 1 }

    $mediaSrc = Join-Path $BundlePath 'media'
    if ((Test-Path $mediaSrc) -and (Get-ChildItem $mediaSrc -Recurse -File -ErrorAction SilentlyContinue)) {
        docker cp "$mediaSrc\." 'waffled-api:/data/media'
        docker exec -u 0 waffled-api chown -R 1000:1000 /data/media
        Write-Host "Uploaded media restored."
    } else {
        Write-Host "No media in the bundle -- skipping."
    }
} else {
    Step "Skipping database/media restore (-SkipRestore)"
}

# ── Always-on server plumbing ──────────────────────────────────────────────
Step "Update tasks (button agent every minute; nightly job suspended)"
$updatePs1 = Join-Path $RepoDir 'update.ps1'
$agentVbs  = Join-Path $RepoDir 'tools\update-agent\run-hidden.vbs'

# The in-app "Update now" button (Settings -> System Health) is the update path now.
# This task is what makes it work -- without it the button queues and nothing happens.
#
# Launched through run-hidden.vbs, NOT powershell.exe directly: this runs every 60s in
# the logged-in session, and pointing it at powershell popped a console window onto the
# family's desktop once a minute. See that file for why the session has to stay
# interactive (Docker Desktop) and why we hide the window instead.
schtasks /create /f /tn "Waffled Fork Update Agent" /sc minute /mo 1 `
    /tr "wscript.exe `"$agentVbs`"" | Out-Null
Write-Host "Task 'Waffled Fork Update Agent' registered (every 60s, hidden)."

# Registered but DISABLED: the button replaced it. Suspended rather than deleted so
# bringing hands-free nightly updates back is one command, not a rebuild:
#   schtasks /change /tn "Waffled Fork Update" /enable
schtasks /create /f /tn "Waffled Fork Update" /sc daily /st 03:30 `
    /tr "powershell -NoProfile -ExecutionPolicy Bypass -File `"$updatePs1`"" | Out-Null
schtasks /change /tn "Waffled Fork Update" /disable | Out-Null
Write-Host "Task 'Waffled Fork Update' registered but DISABLED (nightly auto-update suspended)."

Step "Power settings: never sleep while plugged in"
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
Write-Host "Sleep/hibernate on AC: disabled (the display may still turn off -- that's fine)."

Step "Firewall: allow the LAN to reach the kiosk (8080) and PowerSync (8090)"
foreach ($rule in @(@{n = 'Waffled HTTP'; p = 8080 }, @{n = 'Waffled PowerSync'; p = 8090 })) {
    netsh advfirewall firewall show rule name="$($rule.n)" *> $null
    if ($LASTEXITCODE -ne 0) {
        netsh advfirewall firewall add rule name="$($rule.n)" dir=in action=allow protocol=TCP localport=$($rule.p) | Out-Null
    }
}
Write-Host "Inbound TCP 8080 + 8090: allowed."

# ── Verify ─────────────────────────────────────────────────────────────────
Step "Verifying"
$health = $null
$deadline = (Get-Date).AddMinutes(3)
do {
    try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/healthz' -TimeoutSec 5 } catch { Start-Sleep -Seconds 5 }
} until ($health -or (Get-Date) -gt $deadline)
if ($health) {
    Write-Host "API healthy -- running build $($health.version.sha)." -ForegroundColor Green
} else {
    Write-Host "API did not answer /healthz within 3 minutes -- check: docker logs waffled-api" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Done! This machine is now the Waffled server." -ForegroundColor Green
Write-Host ""
Write-Host "  Web UI (this machine):  http://localhost:8080"
Write-Host "  Tailnet (all devices):  https://waffled.tail5cf530.ts.net"
Write-Host ""
Write-Host "Two things only you can click (do them now):" -ForegroundColor Yellow
Write-Host "  1. Docker Desktop -> Settings -> General -> enable 'Start Docker Desktop when you sign in'."
Write-Host "  2. Make sure this Windows user signs in automatically after a reboot (Settings ->"
Write-Host "     Accounts -> Sign-in options), or the server won't come back after Windows Updates."
Write-Host ""
Write-Host "Then confirm on the OLD machine that it's frozen (stack down, nightly task disabled,"
Write-Host "Tailscale name released) -- export-server-bundle.ps1 -Freeze does all of it."
