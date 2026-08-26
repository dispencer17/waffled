' Launches poll-update.ps1 with NO console window.
'
' Why this exists: the "Waffled Fork Update Agent" task runs every 60 seconds with
' LogonType=Interactive, so pointing it straight at powershell.exe popped a console
' window onto the desktop and stole focus once a minute. (The old nightly task had
' the same flaw and got away with it by firing once a day at 3:30 AM.)
'
' Interactive is deliberate and must stay: update.ps1 drives `docker compose`, and
' Docker Desktop's engine pipe lives in the logged-in user's session -- a
' non-interactive or SYSTEM task cannot reach it, which would break deploys.
' So we keep the session and hide the window instead.
'
' wscript.exe is itself windowless, and WshShell.Run with intWindowStyle=0 starts
' PowerShell hidden. update.ps1 is later launched by poll-update.ps1 with the call
' operator, so it inherits this same hidden console rather than opening its own.
'
' bWaitOnReturn=True keeps the task "running" for the real duration of a deploy, so
' Task Scheduler's default IgnoreNew policy won't start a second overlapping run.
' (update.ps1's lockfile is the real guarantee; this just avoids pointless starts.)
'
' `conhost.exe --headless` was tried first and silently failed to run the script at
' all -- do not "simplify" back to it without testing that the agent still reports in.

Dim shell, fso, here, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Resolve the sibling script, so this works from any clone path.
here = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File """ & here & "\poll-update.ps1"""

shell.Run cmd, 0, True
