// Full-screen "can't reach the server" state — takes over whenever the
// device has been offline for a few consecutive polls (see main.cpp's
// WB_OFFLINE_AFTER_MISSES, the same threshold the small "Offline" badge
// already used before this screen existed). Every device-initiated action
// (starting a timer, completing a chore, toggling sound/nightlight...)
// needs a live request to the server and used to just silently do nothing
// when one failed — this gives the kid/parent an actual explanation and a
// way out instead of a dead tap.
//
// Deliberately does NOT expose a direct "forget pairing"/change-server
// shortcut — that stays behind Settings' existing 5-tap "For a grown-up"
// gesture (forget_confirm_screen.h). Being offline can happen for entirely
// mundane reasons (router reboot, moved rooms) and this screen is reached
// automatically, not by deliberate navigation — an ungated unpair button
// here would let a kid force the device offline on purpose to escape
// pairing. "Go to Settings" just routes there; actually reconfiguring the
// server address is still grown-up-gated same as it always was.
#pragma once

#include <lvgl.h>
#include <functional>

using WbOfflineActionCallback = std::function<void()>;

// Builds onto `parent`. Caller is responsible for lv_obj_clean(parent)
// before calling this and lv_scr_load_anim after — same convention as
// forget_confirm_screen.h's build-then-navigate call sites (no live state
// to sync; main.cpp force-navigates away the moment a poll next succeeds).
// `onRetry` should trigger an immediate poll attempt (not just wait for the
// next scheduled one, which may be backed off up to 30s); `onChangeWifi`
// re-opens the WiFi picker.
void wb_build_offline_screen(lv_obj_t *parent, lv_obj_t *settings_scr,
                              WbOfflineActionCallback onRetry, WbOfflineActionCallback onChangeWifi);
