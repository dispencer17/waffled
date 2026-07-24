# Offline mascot

`waffled-down-source.png` (1254×1254, opaque RGB, no alpha) is a sad, unplugged
waffle-iron mascot with a broken WiFi symbol, supplied directly by the user for
`offline_screen.cpp`'s "can't reach the server" state. Resized to 320×320 with `sips`:

```sh
sips -Z 320 --setProperty format png waffled-down-source.png --out waffled_down_320.png
```

Baked as an LVGL 9 **RGB565** `lv_image_dsc_t` (`src/icons/wb_offline_mascot_320.c`,
`wb_offline_mascot_320` declared in `src/icons/wb_icons.h`) — same full-color, no-recolor
pipeline as `tools/logo/`'s Waffled logo, reusing that directory's script directly rather
than duplicating it:

```sh
python3 ../logo/png_to_lvgl_rgb565.py waffled_down_320.png ../../src/icons/wb_offline_mascot_320.c wb_offline_mascot_320 320 320
```

Used on `offline_screen.cpp` only — semi-large on the left side of the split layout, with
the "Can't reach the server" message and action buttons on the right.
