---
title: The update button
description: Deploy the latest fork code from Settings — how it works, who can press it, and what to do when it fails.
---

:::note[Fork feature]
This page describes **this fork**, which runs from source rather than from
upstream's published images. Upstream Waffled updates with
[`./waffled upgrade`](/operations/upgrading/) instead — a command this fork must
never run, because it would install upstream's images over the fork's own build.
:::

**Settings → System Health → Update now** deploys the fork's latest `main` and
rebuilds the stack on the server. When new commits are waiting, the display also
shows a banner so you don't have to go looking.

## Who can press it

Admins only. The button and the banner are both admin-gated, and the API rejects
the request from anyone else — a non-admin never sees either.

## What happens when you press it

1. **Queued** — the button records the request. Nothing has run yet.
2. **Within a minute**, a task on the server (**"Waffled Fork Update Agent"**)
   picks it up and runs `update.ps1`.
3. **Updating** — `update.ps1` fast-forwards to `origin/main` (always CI-tested)
   and rebuilds the images from source. This takes a few minutes.
4. **Done** — the display notices a new build is being served and reloads itself
   once it's idle, so nobody has to touch the tablet.

The API restarts as part of step 3, so the page will briefly lose contact with
the server. That's expected and the UI treats it as progress, not an error.

Running `.\update.ps1` on the server by hand does exactly the same thing — the
button is not a separate path, just a remote control for it.

## Nightly updates are suspended

The old 3:30 AM **"Waffled Fork Update"** task is registered but **disabled**, now
that updates are on demand. To bring hands-free nightly updates back:

```powershell
schtasks /change /tn "Waffled Fork Update" /enable
```

Both can coexist — `update.ps1` takes an exclusive lock, so whichever starts
first wins and the other bows out rather than running a second concurrent build.

## When it fails

The banner turns red and shows the real reason. The three you're likely to see:

**"Working tree has uncommitted changes"**
Something was edited directly on the server. `update.ps1` refuses to run rather
than clobber it. Commit or stash the changes on the server, then press the button
again.

**"Fast-forward failed — local commits diverge from origin/main"**
The server has commits that aren't on `origin/main`. Resolve the divergence
(push them, or reset to the remote), then retry.

**"The update agent isn't responding"**
The API hasn't heard from the host task in 10 minutes, so a press would queue
forever. Check and re-enable it on the server:

```powershell
schtasks /query /tn "Waffled Fork Update Agent"
schtasks /change /tn "Waffled Fork Update Agent" /enable
```

Note that the server-move kit disables this task on purpose when it *freezes* a
retired machine, so a machine that was once a server and is now not will show
this — correctly.

## Getting upstream's changes

The button only deploys what is already on this fork's `main`. Pulling in an
upstream release stays a deliberate, manual step:

```bash
git fetch upstream
git merge upstream/main
```

Resolve any conflicts, test, and push. Once CI is green and the commits are on
`origin/main`, the button deploys them like any other change.
