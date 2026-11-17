# LiteTuber architecture

This document explains the shape of the system, the reasons behind important decisions, and the rules
that must not be broken when changing the code. The goal is to keep later changes from quietly
breaking the OBS flow.

## Principles

1. **Lightweight.** One browser tab, no UI framework, no Electron/Unity.
2. **OBS-first.** The URL the panel opens and the URL configured in the OBS Browser Source must match
   exactly: `http://127.0.0.1:8770/`.
3. **The local server is the source of truth.** Settings, avatars, and backgrounds are stored in
   `data/`, not only in the browser. This is what keeps the panel and OBS in sync automatically.
4. **No data leaves the machine.** The server binds only to `127.0.0.1` and rejects foreign
   Host/Origin headers.

## Data flow

```
          camera                         mic
            │                             │
            ▼                             ▼
   ┌─────────────────┐          ┌─────────────────┐
   │ face-worker.js  │          │ audio.js         │
   │ MediaPipe       │          │ FFT → vowel      │
   └────────┬────────┘          └────────┬─────────┘
            │ 52 blendshapes + matrix    │ a/i/u/e/o weights
            ▼                            ▼
   ┌──────────────────────────────────────────────┐
   │ face.js / MicMouth                           │
   │ → VRM expressions, head turn, calibration    │
   └──────────────────────┬───────────────────────┘
                          ▼
   ┌──────────────────────────────────────────────┐
   │ avatar.js (three-vrm) + main.js render loop  │
   │ adaptive quality → renderer + tracking rate  │
   └──────────────────────┬───────────────────────┘
                          ▼
                 canvas → OBS Browser Source

   Panel UI ──PUT /api/state──▶ serve.mjs ──data/state.json
   OBS      ──GET /api/state──▶ serve.mjs (polls ~2.5 s)
   Upload   ──PUT /api/avatar─▶ serve.mjs ──data/avatar.vrm
   Panel    ──WS /ws/pose────▶ serve.mjs ──pose──▶ OBS (live, 33 Hz)
```

## Modules

| File | Responsibility |
|---|---|
| `src/main.js` | Entry, render loop, adaptive quality, UI wiring, server polling, background |
| `src/avatar.js` | Load VRM, mesh optimization, idle pose, expressions, spring bones |
| `src/face.js` | Tracking orchestration: choose worker/main thread, calibration, conversion to VRM |
| `src/expressions.js` | Convert blendshapes to VRM expressions, including per-eye blink (pure, testable) |
| `src/face-worker.js` | Classic worker entry: init MediaPipe, inference per `ImageBitmap` |
| `src/pose-sync.js` | WebSocket relay client panel → OBS, reconnect with backoff |
| `src/pose-protocol.js` | Validate and normalize pose messages, used by client and server |
| `src/audio.js` | Mic analysis, `vowelWeights`, mouth smoothing |
| `src/store.js` | Settings defaults, localStorage, IndexedDB cache |
| `src/vrm.js` | Validate GLB/VRM headers, used by client and server |
| `src/http-cache.js` | ETag from write revision + mtime/size, used by `/api/state` |
| `serve.mjs` | Static server + REST API, upload validation, atomic writes |
| `index.html` | Control panel (no framework; events wired by hand) |
| `src/style.css` | All panel and background styling |

## Rules that must not be broken

### 1. The tracking worker must be classic, not a module

The MediaPipe WASM glue calls `importScripts`, which a module worker does not provide. That is why
`vite.config.js` uses `worker: { format: "iife" }` and `face-worker.js` is imported through `?worker`.

- A worker counts as failed if it does not send `ready` within 12 seconds or sends `error`.
- The fallback to the main thread is automatic and must not run halfway: `mode` is only `"worker"` or
  `"main"`.
- `?worker=0` forces the main-thread path for diagnosis.
- Frames are only sent while the worker is idle. Do not build a frame queue; latency matters more than
  completeness.

### 2. Do not switch to the `tauri://` protocol or another URL

The desktop app uses Tauri, but its window still opens `http://127.0.0.1:8770/`. The OBS Browser Source
uses the same URL. If the protocol changes, the two-step flow (start it, paste the URL) breaks.

The desktop server is a Rust port of `serve.mjs` in `src-tauri/src/server.rs`. Endpoints, ETag, VRM
validation, and the pose relay must stay identical to the Node version. The window is created after
the port is bound successfully; if the port is already in use, the app reuses the existing server.

### 3. The server is the synchronization bus

- The panel writes settings to the server; OBS only needs to poll.
- `panelHidden` is intentionally not synced because it is per-window state.
- State is compared through an ETag built from the write revision + mtime/size, not through
  `JSON.stringify` on every poll. Do not add faster polling as a substitute for versioning.
- File writes are always atomic (`.part` for avatar uploads, `.tmp` for state/background, then
  `rename`). Never write directly to `avatar.vrm`, `state.json`, or `background.json`.
- Live pose does **not** go through state/polling. The panel sends `{w, head}` to `/ws/pose` at about
  33 Hz, and the server only forwards it to `?ui=0` viewers. Do not write pose to `data/`; it is
  session data, not a setting.
- The server sends `{t:"status", viewers}` to the panel whenever a viewer joins or leaves. The panel
  only uses it for the OBS badge; this status is not saved state.

### 4. Uploads are validated before use

- The client checks `src/vrm.js` before loading an avatar, so a wrong file is not sent as 15 MB.
- The server checks the same stream prefix. Non-VRM files are rejected with `415` and the old avatar
  is left untouched.
- `GLB` must have the `glTF` magic, version 2, a JSON first chunk, and a `VRM` or `VRMC_vrm` extension.

### 5. Quality must not drop below the limit without a reason

Adaptive quality may only lower `renderScale`/`trackHz` when FPS is below target. The user's chosen
values are the ceiling: auto quality must not exceed the manual setting. When the load is light, the
values rise again gradually back to the ceiling.

- Antialiasing is only on when `renderScale >= 0.9`; the renderer is rebuilt on an off-DOM canvas, and
  rendered once after the swap so the canvas is never blank.
- The FPS badge shows the active scale (`28 fps · 45%`) so this behavior is visible.

### 6. The data plane is DOM-free

`face.js`, `audio.js`, `avatar.js`, and `vrm.js` must not touch the panel DOM. The only element they
may create is the internal `<video>` for the camera. This is what makes those modules testable without
a full browser.

## State path

1. The UI changes `settings` → `store.saveSettings` (120 ms debounce) → `pushSettings` (350 ms
   debounce) → `PUT /api/state`.
2. Other clients call `GET /api/state` about every 2.5 seconds with `If-None-Match` containing the
   last ETag.
3. The ETag is computed from the write revision + mtime/size of `state.json`, `avatar.vrm`, and
   `background.json`. If nothing changed, the server answers `304` with no body, so clients do not
   need to parse JSON.
4. When it changes, `applyServerSettings` compares the state, then does `Object.assign` + `syncUI` +
   apply background/framing/scale. The `applyingServer` flag prevents an echo back to the server.
5. Avatar/background are only downloaded again when `mtime` changes.

All state/background writes use a temporary file then `rename`, and read-modify-write is serialized so
two quick saves cannot overwrite each other.

Known limits: last-write-wins if two clients write settings at the same time, and three cache layers
(localStorage, IndexedDB, `data/`). That is enough for one panel + one OBS.

## Build and tests

```bash
npm install
npm test        # Vitest: VRM validator, vowelWeights, settings merge
npm run build   # dist/ (gitignored)
npm run serve   # PORT=8770
cargo test --manifest-path src-tauri/Cargo.toml   # Rust server + pose + VRM
```

- `dist/` is not committed.
- The worker produces a separate IIFE bundle in `dist/assets/`; that is normal.
- CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm test`, and `npm run build` on Node 22 and 24.

## Deployment notes

- **Portable/browser:** `dist/` + `serve.mjs` + Node 18+.
- **Tauri:** the Rust server serves the embedded `dist/` with identical endpoints and URL; data lives
  in `%APPDATA%\app.litetuber.desktop\`. The Windows installer is built on Windows/Windows CI. Details
  in [DESKTOP.md](DESKTOP.md).
- **Microsoft Store:** the MSIX path (free signing by Microsoft). EXE/MSI needs its own certificate.
- Do not bundle sample avatars without a clear VRM license.
