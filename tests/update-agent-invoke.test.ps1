# Invoke-UpdateScript must survive a deploy that writes to stderr.
#   powershell -ExecutionPolicy Bypass -File tests/update-agent-invoke.test.ps1
#
# This is the 2026-08-27 bug: the agent ran update.ps1 with `2>&1` under
# $ErrorActionPreference='Stop'. PowerShell 5.1 wraps a native command's stderr in
# NativeCommandError records, which THROW under Stop -- and `docker build` writes
# all its progress to stderr. So every real deploy killed the agent between
# finishing the update and reporting the result, leaving the UI stuck on
# "Updating..." until the 30-minute timeout. It only passed testing because a
# no-op deploy ("nothing to deploy") emits no stderr at all.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
. (Join-Path $repo 'tools\update-agent\invoke-update.ps1')

$script:failures = 0
function Check([string]$name, [bool]$ok) {
    if ($ok) { Write-Host "PASS: $name" -ForegroundColor Green }
    else { Write-Host "FAIL: $name" -ForegroundColor Red; $script:failures++ }
}

$noisy = Join-Path $env:TEMP "waffled-noisy-$PID.ps1"
$angry = Join-Path $env:TEMP "waffled-angry-$PID.ps1"
try {
    # Mimics `docker build`: chatty on stderr, but succeeds.
    Set-Content $noisy -Encoding ascii -Value @(
        '[Console]::Error.WriteLine("#12 [api builder 4/10] RUN npm ci")'
        '[Console]::Error.WriteLine("#12 CACHED")'
        'Write-Output "Done."'
        'exit 0'
    )
    # Fails the way a dirty tree does: message, non-zero exit.
    Set-Content $angry -Encoding ascii -Value @(
        '[Console]::Error.WriteLine("Working tree has uncommitted changes")'
        'exit 1'
    )

    $ok = $null
    $threw = $false
    try { $ok = Invoke-UpdateScript $noisy } catch { $threw = $true }
    Check "a deploy that writes to stderr does not throw" (-not $threw)
    Check "success exit code survives stderr chatter" ($null -ne $ok -and $ok.ExitCode -eq 0)
    Check "output is captured for the UI" ($null -ne $ok -and $ok.Message -match 'Done|CACHED')

    $bad = $null
    $threw2 = $false
    try { $bad = Invoke-UpdateScript $angry } catch { $threw2 = $true }
    Check "a failing deploy does not throw either" (-not $threw2)
    Check "failure exit code is reported" ($null -ne $bad -and $bad.ExitCode -eq 1)
    Check "the real reason reaches the UI" ($null -ne $bad -and $bad.Message -match 'uncommitted changes')

    # The caller relies on Stop semantics elsewhere; we must not leak Continue.
    Check "ErrorActionPreference is restored" ($ErrorActionPreference -eq 'Stop')
} finally {
    Remove-Item $noisy, $angry -ErrorAction SilentlyContinue
}

if ($script:failures -gt 0) { Write-Host "$($script:failures) failure(s)." -ForegroundColor Red; exit 1 }
Write-Host "All invoke-update tests passed." -ForegroundColor Green
exit 0
