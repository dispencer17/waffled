# Mutual exclusion for update.ps1.
#
# Three callers can now reach update.ps1 -- the in-app Update button (via the
# "Waffled Fork Update Agent" task), the nightly "Waffled Fork Update" task when
# it is re-enabled, and a human running it by hand. Two concurrent
# `docker compose up --build` runs against one stack corrupt each other, so they
# take this lock first.
#
# FileShare::None is the mutex: the OS refuses every other handle while one is
# open, and the handle dies with the process, so a crashed or killed run cannot
# wedge the lock the way a stale PID file would.

function Enter-UpdateLock {
    param([Parameter(Mandatory = $true)][string]$Path)
    try {
        return [System.IO.File]::Open($Path, 'OpenOrCreate', 'ReadWrite', 'None')
    } catch {
        return $null   # someone else holds it
    }
}
