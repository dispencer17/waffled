# Waffled Android app (Trusted Web Activity)

A thin Android wrapper around the Waffled web app: it opens your self-hosted
instance full screen (no URL bar) with its own launcher icon. One codebase —
the PWA — packaged for phones. Sideloaded; no Play Store account needed.

## Prerequisites

- Your Waffled instance reachable over **HTTPS** at a stable hostname
  (a Tailscale/Cloudflare/Caddy TLS setup all work).
- Node.js + a JDK (Bubblewrap fetches the Android SDK bits it needs).

## Build

```bash
npm i -g @bubblewrap/cli
cd apps/android-twa
bubblewrap init --manifest https://YOUR-HOST/manifest.webmanifest
# Suggested answers:
#   applicationId: app.waffled.twa   (must match assetlinks.json)
#   display: standalone · orientation: any
# Bubblewrap creates a signing key on first run — keep it; you'll reuse it
# for every update.
bubblewrap build
```

That produces `app-release-signed.apk`. Install it on each phone (`adb install`
or share the file and open it).

## Hide the URL bar (digital asset links)

The TWA only goes full screen when your origin vouches for the app's signing
key:

1. Print the key's SHA-256: `bubblewrap fingerprint` (or
   `keytool -list -v -keystore android.keystore`).
2. Put that fingerprint into `apps/web/public/.well-known/assetlinks.json`
   (replacing the placeholder) and redeploy the web app.
3. Verify: `https://YOUR-HOST/.well-known/assetlinks.json` must return the JSON
   with your fingerprint.

Until the fingerprint matches, the app still works but shows a browser custom-
tab bar at the top.

## Updating

The app is just a shell — web updates ship instantly with the server. Rebuild
the APK only when you change the manifest (name, icons, orientation) or want a
new Android target SDK: bump `appVersionCode` in `twa-manifest.json`, then
`bubblewrap update && bubblewrap build`.

## Play Store (optional, later)

Sideloading fits a family. If you ever want Play distribution: a one-time $25
developer account, `bubblewrap build --skipPwaValidation` for the AAB, and your
origin must stay publicly reachable for Google's asset-links crawler.
