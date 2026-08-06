# Moving the Waffled server to another Windows machine

Two scripts that move the *whole* server — code, secrets, database, uploaded
media, Tailscale identity, nightly auto-update — from one Windows box (e.g. a
laptop) to another (e.g. an always-on PC). The git repo alone is **not** the
server: `infra/compose/.env` (gitignored) holds the encryption/JWT keys that
are paired with the database, and the family's data lives in Docker volumes.
These scripts carry all of that.

## 1. On the OLD server (the machine currently running Waffled)

```powershell
powershell -ExecutionPolicy Bypass -File tools\server-move\export-server-bundle.ps1 -Freeze
```

Takes a fresh DB dump, bundles it with `.env`, uploaded media, and the
installer script into a zip on the Desktop. `-Freeze` (recommended) then stops
the stack, disables the nightly "Waffled Fork Update" task, and renames the
Tailscale device so the new machine can claim the name `waffled`. Skip
`-Freeze` only if you need the old server to keep running a bit longer — but
anything added after the export stays behind.

## 2. On the NEW server

Copy the zip over, extract it, then in an **Administrator** PowerShell inside
the extracted folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-pc-server.ps1 -BundlePath .
```

It is idempotent — if it stops (WSL wants a reboot, Docker's first-run page,
Tailscale name still taken), fix the thing it names and run it again. It:

1. Installs Git, WSL2, Docker Desktop, and Tailscale via winget (skipping
   anything already present).
2. Clones `dispencer17/waffled` to `%USERPROFILE%\Code\waffled_fork`
   (override with `-RepoDir`).
3. Installs the bundled `.env`, builds the images **from source**
   (`./waffled up --build` — registry images can never sneak in), and starts
   the voice-profile whisper container.
4. Restores the database (`./waffled restore`) and uploaded media.
5. Claims the Tailscale name `waffled` and re-creates the HTTPS fronting
   (`tailscale serve` 443→8080 and 8090→8090), so
   `https://waffled.tail5cf530.ts.net` keeps working on every device with no
   OAuth or kiosk reconfiguration.
6. Registers the nightly 3:30 AM auto-update task, disables sleep on AC power,
   and opens firewall ports 8080/8090 for the LAN.
7. Verifies `/healthz` and prints the two remaining manual clicks
   (Docker Desktop auto-start; Windows auto sign-in).

Flags: `-SkipTailscale` for a LAN-only server, `-SkipRestore` to re-run setup
steps after the server is already live (never re-restore over newer data).

## Gotchas that shaped these scripts

- **`.env` must travel with the database.** `TOKEN_ENCRYPTION_KEY`,
  `LOCAL_JWT_SECRET`, and `POWERSYNC_JWT_PRIVATE_KEY` are paired with what's
  stored in Postgres — a regenerated `.env` on the new machine would break
  calendar OAuth tokens, sessions, and sync.
- **The Tailscale *name* is the identity.** `PUBLIC_BASE_URL` and the tablet
  kiosk point at `waffled.tail5cf530.ts.net`; the old device must release the
  name before the new one can claim it (that's what `-Freeze` does).
- **Restore, don't seed.** `./waffled up` on a fresh machine creates an empty
  database; the restore step overwrites it with the family's real data, then
  re-runs migrations.
- **`bash` means Git Bash.** A bare `bash` in PowerShell resolves to the
  System32 WSL stub, which fails without a distro — both scripts locate
  `Git\bin\bash.exe` explicitly (same as `update.ps1`).
