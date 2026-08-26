# poll-update.ps1 -- host side of the in-app Update button.
#
# Runs every 60s as the "Waffled Fork Update Agent" scheduled task. Deliberately
# dumb: it reports how far behind origin/main we are, asks the API whether an
# admin pressed "Update now", and if so runs update.ps1 and reports the result.
# All real deploy logic stays in update.ps1 -- this file must never grow any, so
# that a button press and a manual run do exactly the same thing.
#
# Exits 0 and stays quiet on every expected problem (API down, no .env, no token).
# It runs 1,440 times a day; noise here is worse than silence.
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $repo

$api      = if ($env:WAFFLED_API) { $env:WAFFLED_API } else { 'http://127.0.0.1:3000' }
$envFile  = Join-Path $repo 'infra\compose\.env'
$stampDir = Join-Path $repo '.update-agent'
$stamp    = Join-Path $stampDir 'last-fetch'

if (-not (Test-Path $envFile)) { exit 0 }   # not a configured server -- stay quiet
$match = Select-String -Path $envFile -Pattern '^UPDATE_AGENT_TOKEN=(.+)$' | Select-Object -First 1
if (-not $match) { exit 0 }                 # pre-token install; ./waffled up will add it
$token = $match.Matches[0].Groups[1].Value.Trim()
if (-not $token) { exit 0 }

# Fetch at most every 15 minutes. We poll once a minute, but the answer only
# changes on push -- hitting GitHub 1,440x a day to learn that would be rude.
if (-not (Test-Path $stampDir)) { New-Item -ItemType Directory -Path $stampDir | Out-Null }
$due = (-not (Test-Path $stamp)) -or (((Get-Date) - (Get-Item $stamp).LastWriteTime).TotalMinutes -ge 15)
if ($due) {
    git fetch origin 2>$null | Out-Null
    if (Test-Path $stamp) { (Get-Item $stamp).LastWriteTime = Get-Date }
    else { New-Item -ItemType File -Path $stamp | Out-Null }
}
$behind = 0
try { $behind = [int](git rev-list --count HEAD..origin/main 2>$null) } catch { $behind = 0 }

function Send-Poll($body) {
    return Invoke-RestMethod -Method Post -Uri "$api/api/updates/agent-poll" `
        -Headers @{ 'x-waffled-update-token' = $token } `
        -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 5) -TimeoutSec 20
}

try { $r = Send-Poll @{ behind = $behind } } catch { exit 0 }  # API down; try again next minute
if (-not $r.pending) { exit 0 }

# An admin pressed the button. Run the real updater and keep its tail for the UI --
# update.ps1's own messages ("working tree has uncommitted changes", "fast-forward
# failed") are exactly what an operator needs to see in Settings.
$out  = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'update.ps1') 2>&1
$code = $LASTEXITCODE
$msg  = ($out | Select-Object -Last 12 | Out-String).Trim()
if (-not $msg) { $msg = if ($code -eq 0) { 'Update complete.' } else { "update.ps1 exited $code." } }

# The rebuild just restarted the API, so it is NOT up the instant update.ps1
# returns. Retry for ~2 minutes, or the result is lost and the UI sits on
# "updating" until the 30-minute stuck timeout.
for ($i = 0; $i -lt 12; $i++) {
    try {
        Send-Poll @{ behind = 0; result = @{ exitCode = $code; message = $msg } } | Out-Null
        break
    } catch {
        Start-Sleep -Seconds 10
    }
}
