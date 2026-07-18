# update.ps1 -- one-click updater for this Waffled fork (Windows PowerShell 5.1+).
#
# What it does, in order:
#   1. Refuses to run if you have uncommitted local changes (nothing gets clobbered).
#   2. Fetches the fork's main branch and fast-forwards to it (CI-tested code only --
#      if the fast-forward fails, local history has diverged; resolve that first).
#   3. Rebuilds the images FROM SOURCE and restarts the stack (bash ./waffled up --build).
#      Never pulls registry images, so upstream's published images can't sneak in.
#
# Getting the author's updates is a separate, deliberate step (merge upstream/main,
# resolve, test, push to the fork) -- once that lands on origin/main, this button
# deploys it. Double-click via a shortcut with target:
#   powershell -ExecutionPolicy Bypass -File C:\Users\dispe\Code\waffled_fork\update.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "Waffled fork updater" -ForegroundColor Cyan
Write-Host "--------------------"

# 1. Clean tree check.
$dirty = git status --porcelain
if ($dirty) {
    Write-Host "Working tree has uncommitted changes -- commit or stash them first:" -ForegroundColor Yellow
    git status --short
    exit 1
}

# 2. Fetch + fast-forward to the fork's main.
git fetch origin | Out-Null
$behind = [int](git rev-list --count HEAD..origin/main)
if ($behind -gt 0) {
    Write-Host "Updating: $behind new commit(s) on origin/main" -ForegroundColor Green
    git --no-pager log --oneline HEAD..origin/main
    git merge --ff-only origin/main
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Fast-forward failed -- local commits diverge from origin/main." -ForegroundColor Red
        Write-Host "Resolve the divergence (or ask Claude to), then rerun."
        exit 1
    }
} else {
    Write-Host "Code already up to date -- rebuilding to converge the running stack."
}

# 3. Rebuild from source + restart. Image names are pinned to waffled-fork/* in
#    infra/compose/.env, so this can never resurrect upstream's registry images.
#    NOTE: must be GIT bash — in PowerShell a bare `bash` resolves to the WSL relay
#    stub in System32, which fails when no WSL distro is installed.
$gitBash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
if (-not (Test-Path $gitBash)) {
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) { $gitBash = Join-Path (Split-Path (Split-Path $git.Source)) 'bin\bash.exe' }
}
if (-not (Test-Path $gitBash)) {
    Write-Host "Couldn't find Git Bash (needed to run ./waffled). Is Git for Windows installed?" -ForegroundColor Red
    exit 1
}
& $gitBash ./waffled up --build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build/restart failed -- see output above." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Done. Open http://localhost:8080 (hard-refresh once: Ctrl+Shift+R)." -ForegroundColor Green
