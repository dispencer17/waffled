# Host update agent

The host half of the in-app **Update now** button (Settings → System Health).

The API runs in a container with no Docker socket and no git, so it cannot rebuild
its own host or see whether `origin/main` is ahead. The request direction is
therefore inverted: the button only writes a flag, and this agent — running on the
host, where git and Docker live — asks the API whether there is anything to do.

`poll-update.ps1` runs every 60 seconds as the scheduled task
**"Waffled Fork Update Agent"**. Each tick it:

1. reports how many commits `origin/main` is ahead (refreshed by `git fetch` at
   most every 15 minutes), which is what drives the "N new commits ready to
   deploy" banner;
2. asks the API whether an admin pressed the button;
3. if so, runs `update.ps1` and reports its exit code and output tail back, so a
   failure shows up in Settings as the real reason rather than silence.

It authenticates with `UPDATE_AGENT_TOKEN` from `infra/compose/.env`, which
`./waffled up` generates. No deploy logic lives here — it all stays in
`update.ps1`, so a button press and a manual run do exactly the same thing.

It exits 0 and stays quiet on every expected problem (API down mid-rebuild, no
`.env`, no token yet). It runs 1,440 times a day; noise would be worse than
silence.

## "The update agent isn't responding"

That warning means the API has heard nothing from this task for 10 minutes. Check
and re-enable it:

    schtasks /query /tn "Waffled Fork Update Agent"
    schtasks /change /tn "Waffled Fork Update Agent" /enable

Note that `tools/server-move/export-server-bundle.ps1` disables it deliberately
when freezing a retired server, so it cannot wake up, rebuild, and fight the live
machine for the Tailscale name `waffled`.

## Registering it by hand

`tools/server-move/setup-pc-server.ps1` does this for you:

    schtasks /create /f /tn "Waffled Fork Update Agent" /sc minute /mo 1 ^
      /tr "wscript.exe C:\path\to\repo\tools\update-agent\run-hidden.vbs"

**Always register it through `run-hidden.vbs`, never `powershell.exe` directly.** The
task runs every 60 seconds in the logged-in session, so launching PowerShell directly
pops a console window onto the family's desktop and steals focus once a minute. The
session has to stay interactive (Docker Desktop's engine pipe lives there, and
`update.ps1` needs it), so the window is hidden rather than the session changed —
`run-hidden.vbs` explains the details, and `tests/update-agent-shim.test.ps1` guards
against it regressing.
