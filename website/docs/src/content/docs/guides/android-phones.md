---
title: Waffled on Android phones
description: Install the web app as a PWA — or build the optional sideloadable Android app.
---

There's no Play Store app, and you don't need one: the web app is an
**installable PWA**. On an Android phone it gets its own home-screen icon,
launches full screen, offers long-press shortcuts, and its app shell loads even
when the server is briefly unreachable. For a fully native feel with no URL bar
at all, an optional **Trusted Web Activity (TWA)** build wraps the same PWA in a
sideloadable APK.

## 1. Make the server reachable from the phone

Same rule as any off-server device: the phone talks to the server over your
network, so it has to be reachable at a real address — not `localhost`:

```bash
./waffled setup   # choose your LAN IP, or a hostname for automatic HTTPS
./waffled up
```

For the **full install experience** — Chrome's *Install app*, the offline app
shell — the phone needs a secure context, i.e. an **HTTPS hostname** (see
[Reverse proxy & TLS](/install/reverse-proxy/)). Over plain `http://<ip>:8080`
everything still works and **Add to Home Screen** still gives you an icon, but
it opens with browser chrome and without the offline cache.

## 2. Install from Chrome

On the phone, open your Waffled address in Chrome and sign in. Then either:

- **Chrome menu (⋮) → Install app** (older Chrome: **Add to Home Screen**), or
- **Settings → About → Install the app** — an **Install** button appears there
  whenever the browser is ready to offer it.

Waffled now launches from its own icon, full screen. **Long-press the icon**
for shortcuts straight to **Today**, the **Grocery list**, and the
**Calendar**.

## 3. (Optional) Build the TWA — no URL bar, sideloaded

The TWA in `apps/android-twa/` is a thin Android shell around your instance's
PWA: same one codebase, packaged with its own launcher icon and zero browser
UI. It's sideloaded onto each phone — no Play Store account needed.

You'll need your instance reachable over **HTTPS at a stable hostname**, plus
Node.js and a JDK on the machine doing the build:

```bash
npm i -g @bubblewrap/cli
cd apps/android-twa
bubblewrap init --manifest https://YOUR-HOST/manifest.webmanifest
bubblewrap build
```

That produces `app-release-signed.apk` — install it on each phone
(`adb install`, or share the file and open it).

**To hide the URL bar**, your origin has to vouch for the app's signing key:
put the key's SHA-256 fingerprint (`bubblewrap fingerprint`) into
`apps/web/public/.well-known/assetlinks.json` and redeploy the web app. Until
the fingerprint matches, the app works but shows a browser bar at the top.

Because the app is just a shell, **web updates ship instantly** with the
server — rebuild the APK only when the Android wrapper itself changes (name,
icons, orientation). The full walkthrough — suggested `bubblewrap init`
answers, keeping the signing key, optional Play distribution — is in
[`apps/android-twa/README.md`](https://github.com/dispencer17/waffled/blob/main/apps/android-twa/README.md).

## Verify

You're done when, on the phone:

- The app launches from its own icon **without an address bar** (PWA installed
  over HTTPS, or the TWA with a verified fingerprint).
- Long-pressing the icon shows the **Today / Grocery list / Calendar**
  shortcuts.
- With the server unreachable, relaunching still brings up the app shell —
  live data returns once the phone can see the server again.

## Notes

- **iPhone?** Use the native app instead — see
  [iPhone & iPad](/features/mobile/).
- The phone is a **personal device**: sign in as yourself, not the shared
  kiosk login. A phone is never a kiosk.
- Web **camera / barcode scanning** needs HTTPS or `localhost` — one more
  reason to give the server a hostname with auto-TLS.
