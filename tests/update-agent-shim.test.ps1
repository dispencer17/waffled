# The update agent must never pop a console window on the family's desktop --
# it runs every 60 seconds in the logged-in session.
#   powershell -ExecutionPolicy Bypass -File tests/update-agent-shim.test.ps1
#
# These are structural checks. "No window appears" can't be asserted from a script,
# but every way we've actually broken it can: the shim losing track of the script,
# the window style drifting off 0, or the installer going back to launching
# powershell.exe directly (which is how the bug shipped in the first place).
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$vbs = Join-Path $repo 'tools\update-agent\run-hidden.vbs'
$setup = Join-Path $repo 'tools\server-move\setup-pc-server.ps1'

$script:failures = 0
function Check([string]$name, [bool]$ok) {
    if ($ok) { Write-Host "PASS: $name" -ForegroundColor Green }
    else { Write-Host "FAIL: $name" -ForegroundColor Red; $script:failures++ }
}

Check "the hidden-launch shim exists" (Test-Path $vbs)

if (Test-Path $vbs) {
    $body = Get-Content -Raw $vbs

    # intWindowStyle 0 is the whole point of the file.
    Check "shim runs with window style 0 (hidden)" ($body -match 'Run\s+cmd,\s*0\s*,')

    # The shim resolves its target as a sibling; make sure that target is really there.
    Check "shim targets poll-update.ps1" ($body -match 'poll-update\.ps1')
    Check "the targeted script exists beside the shim" (Test-Path (Join-Path $repo 'tools\update-agent\poll-update.ps1'))
}

if (Test-Path $setup) {
    $s = Get-Content -Raw $setup

    # schtasks registrations span several backtick-continued lines, so fold those
    # into one logical line first -- matching line-by-line silently misses the
    # `/tr "powershell ..."` argument and reports a false pass.
    $folded = [regex]::Replace($s, '`\r?\n\s*', ' ')
    $agentBlock = ($folded -split "`r?`n" | Where-Object { $_ -match 'Waffled Fork Update Agent' }) -join "`n"

    # This is the regression that shipped: registering the agent against
    # powershell.exe directly makes it flash a console once a minute.
    Check "installer registers the agent through the hidden shim" ($s -match 'run-hidden\.vbs')
    Check "installer does not point the agent straight at powershell" (-not ($agentBlock -match 'powershell -NoProfile'))
}

if ($script:failures -gt 0) { Write-Host "$($script:failures) failure(s)." -ForegroundColor Red; exit 1 }
Write-Host "All update-agent shim tests passed." -ForegroundColor Green
exit 0
