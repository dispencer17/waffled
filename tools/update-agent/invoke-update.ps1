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

# `waffled up` is a bash script: it colourises its health table with ANSI escapes.
# Those are meaningless in a browser, so a failure banner would show the operator
# fragments like "<ESC>[32m" mixed into the reason. Strip CSI and OSC sequences, then
# any stray lone escape.
function Remove-AnsiCodes {
    param([string]$Text)
    if (-not $Text) { return $Text }
    $esc = [char]27
    $out = [regex]::Replace($Text, "$esc\[[0-?]*[ -/]*[@-~]", '')          # CSI (colours, cursor)
    $out = [regex]::Replace($out, "$esc\][^$esc`a]*(`a|$esc\\)", '')       # OSC (window title)
    return $out -replace $esc, ''
}

function Invoke-UpdateScript {
    param([Parameter(Mandatory = $true)][string]$Path)

    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    # Pin the decoding of the child's stdout. The scheduled-task host does not
    # necessarily start with the same codepage as an interactive shell, and the
    # bash half of the deploy emits UTF-8 glyphs.
    $prevEnc = [Console]::OutputEncoding
    try {
        try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
        $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $Path 2>&1
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
        try { [Console]::OutputEncoding = $prevEnc } catch { }
    }

    # The tail is what an operator reads in Settings, so keep update.ps1's own
    # wording ("Working tree has uncommitted changes", "Fast-forward failed", ...).
    $msg = (Remove-AnsiCodes (($out | Select-Object -Last 12 | Out-String))).Trim()
    if (-not $msg) {
        $msg = if ($code -eq 0) { 'Update complete.' } else { "update.ps1 exited $code." }
    }

    return @{ ExitCode = $code; Message = $msg }
}
