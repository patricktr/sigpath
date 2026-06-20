<p align="center">
  <img src="design/logo/app-icon/sigpath-icon-256.png" width="116" alt="SigPath" />
</p>

<h1 align="center">SigPath</h1>

<p align="center">
  A free, local-first, native macOS app for designing AV signal-flow diagrams.
</p>

---

SigPath is an engineering-grade diagramming tool for audio-visual systems —
place devices, wire their ports, and the app colors cables by connector type,
validates the signal path live, and derives pack lists and patch lists. Built to
be fast, offline, and instrument-like for broadcast and AV engineers.

## Highlights

- **Connector-aware canvas** — devices with typed ports; cables colored by
  connector, with live signal validation (adapter / converter / incompatible).
- **Add-device flow** — a ⌘K command palette, a full equipment-database browser,
  and a guided create wizard saving to your personal library.
- **Reports** — auto pack lists and patch lists; export the diagram to
  PNG/JPG/PDF and the lists to CSV.
- **Native macOS shell** — menu bar, multi-window documents, light/dark themes
  that follow the system.

## Develop

```sh
pnpm install
pnpm tauri dev      # run the desktop app (Vite + Tauri)
pnpm build          # type-check + build the frontend
pnpm tauri build    # bundle the macOS app
```

Built with **Tauri 2 · React 19 · TypeScript · Vite · React Flow**.

## Branding

Logo and icon assets live in [`design/logo/`](design/logo/) (SVG sources, app
icon, and the dots mark). The six dots are the signal kinds — video, audio, A/V,
network, control, power.
