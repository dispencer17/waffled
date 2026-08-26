# Lock helper behind update.ps1 -- run:
#   powershell -ExecutionPolicy Bypass -File tests/update-lock.test.ps1
#
# Tests the helper directly rather than invoking update.ps1, deliberately: an
# unlocked update.ps1 proceeds to `waffled up --build`, and a test must never be
# one bug away from deploying.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
. (Join-Path $repo 'tools\update-lock.ps1')

$lock = Join-Path $env:TEMP "waffled-update-lock-test-$PID.lock"
$script:failures = 0
function Check([string]$name, [bool]$ok) {
    if ($ok) { Write-Host "PASS: $name" -ForegroundColor Green }
    else { Write-Host "FAIL: $name" -ForegroundColor Red; $script:failures++ }
}

try {
    $first = Enter-UpdateLock $lock
    Check "first caller acquires the lock" ($null -ne $first)

    # FileShare::None excludes every other handle, including one from this same
    # process -- which is exactly the guarantee the nightly job and the button need.
    $second = Enter-UpdateLock $lock
    Check "second caller is refused while the lock is held" ($null -eq $second)

    $first.Close()
    $third = Enter-UpdateLock $lock
    Check "lock is reusable once released" ($null -ne $third)
    if ($third) { $third.Close() }
} finally {
    Remove-Item $lock -ErrorAction SilentlyContinue
}

if ($script:failures -gt 0) { Write-Host "$($script:failures) failure(s)." -ForegroundColor Red; exit 1 }
Write-Host "All update-lock tests passed." -ForegroundColor Green
exit 0
