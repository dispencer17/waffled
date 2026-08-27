# Runs update.ps1 for the agent and captures its exit code + output tail.
#
# Why this isn't just an inline `& powershell ... 2>&1`:
#
# Windows PowerShell 5.1 wraps every stderr line from a native command in a
# NativeCommandError record when you redirect with `2>&1`. Under
# $ErrorActionPreference = 'Stop' that THROWS on the first one -- and `docker build`
# writes all of its progress to stderr. So a real deploy killed the agent between
# finishing the update and POSTing the result, leaving the UI stuck on "Updating..."
# until the 30-minute stuck timeout, even though the deploy had succeeded.
#
# It survived testing because the only deploy exercised was a no-op ("nothing to
# deploy"), which emits no stderr at all -- the one path that dodges the bug.
#
# So: drop to 'Continue' for the duration of the call, and restore it afterwards
# (the caller still wants Stop semantics for its own logic).

function Invoke-UpdateScript {
    param([Parameter(Mandatory = $true)][string]$Path)

    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $Path 2>&1
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
    }

    # The tail is what an operator reads in Settings, so keep update.ps1's own
    # wording ("Working tree has uncommitted changes", "Fast-forward failed", ...).
    $msg = ($out | Select-Object -Last 12 | Out-String).Trim()
    if (-not $msg) {
        $msg = if ($code -eq 0) { 'Update complete.' } else { "update.ps1 exited $code." }
    }

    return @{ ExitCode = $code; Message = $msg }
}
