# SigPath logo — "Patchbay" mark

The six signal colors (video / audio / A·V / network / control / power) as a 2×3 patch field — carries the app's core visual DNA.

## What's here

```
logo/
├─ sigpath-app-icon.svg        Vector master — DARK tile + dots (app icon)
├─ sigpath-app-icon-light.svg  Vector master — LIGHT tile + dots
├─ sigpath-mark.svg            Vector master — dots only, transparent (in-app / favicon)
├─ app-icon/                   Dark inky tile (#14131f), rounded — default for OS app icons & favicons
│   └─ sigpath-icon-{16,24,32,48,64,128,256,512,1024}.png
├─ app-icon-light/             Light tile (#f2f3f7), rounded — for light contexts
│   └─ sigpath-icon-light-{16,24,32,48,64,128,256,512,1024}.png
└─ mark/                       Transparent background, dots only
    └─ sigpath-mark-{256,512,1024}.png
```

## Colors
`#3b82f6` video · `#22c55e` audio · `#8b5cf6` A/V · `#06b6d4` network · `#f59e0b` control · `#ef4444` power. Tile background: **dark** `#14131f`, **light** `#f2f3f7`. Tile corner radius = 22% of size.

## Which variant?
- **Dark tile** (`app-icon/`) — the default. Best app icon and favicon; the dots pop and it reads on light or dark OS chrome.
- **Light tile** (`app-icon-light/`) — for light/printed contexts, docs, or a light-themed dock where the dark tile feels heavy. Same geometry; swap the folder.
- **Transparent mark** (`mark/`) — dots only, no tile, for in-app placement on an existing surface.

## Building platform icons

**macOS (.icns)** — needs 16/32/128/256/512 plus @2x (i.e. 32/64/256/512/1024). All present.
```
mkdir SigPath.iconset
cp app-icon/sigpath-icon-16.png   SigPath.iconset/icon_16x16.png
cp app-icon/sigpath-icon-32.png   SigPath.iconset/icon_16x16@2x.png
cp app-icon/sigpath-icon-32.png   SigPath.iconset/icon_32x32.png
cp app-icon/sigpath-icon-64.png   SigPath.iconset/icon_32x32@2x.png
cp app-icon/sigpath-icon-128.png  SigPath.iconset/icon_128x128.png
cp app-icon/sigpath-icon-256.png  SigPath.iconset/icon_128x128@2x.png
cp app-icon/sigpath-icon-256.png  SigPath.iconset/icon_256x256.png
cp app-icon/sigpath-icon-512.png  SigPath.iconset/icon_256x256@2x.png
cp app-icon/sigpath-icon-512.png  SigPath.iconset/icon_512x512.png
cp app-icon/sigpath-icon-1024.png SigPath.iconset/icon_512x512@2x.png
iconutil -c icns SigPath.iconset
```

**Windows (.ico)** — bundle 16/24/32/48/256 (e.g. with ImageMagick):
```
magick app-icon/sigpath-icon-16.png app-icon/sigpath-icon-24.png \
       app-icon/sigpath-icon-32.png app-icon/sigpath-icon-48.png \
       app-icon/sigpath-icon-256.png  sigpath.ico
```

**Favicon** — use `app-icon/sigpath-icon-32.png` (and 16) for the dark tile, or `sigpath-mark.svg` for a modern scalable favicon. For a multi-res `favicon.ico`, bundle 16/32/48 the same way as the Windows .ico.

**Tauri** — drop the PNGs into the bundle `icons/` and reference them in `tauri.conf.json` (`icon` array); Tauri also accepts the 1024 PNG to generate the rest.

## Notes
- The SVG masters are the source of truth — re-rasterize from them if you need other sizes. Dot radius is bumped slightly at 16/24px for legibility; the SVG uses the standard ratio.
- For light backgrounds where the tile feels heavy, use the transparent `mark/` dots directly (no tile).
