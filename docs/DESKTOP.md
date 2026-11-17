# Desktop app (Tauri)

The Tauri v2 scaffold is in `src-tauri/`. The goal: a Windows installer that does not need Node.js,
without changing the OBS flow.

## Principles

- The Tauri window opens **`http://127.0.0.1:8770/`**, not `tauri://localhost`.
  Browser panel, desktop window, and OBS Browser Source share the same origin.
- The HTTP server still runs on `127.0.0.1:8770`, started from inside the Rust process.
- The frontend built by `npm run build` (the `dist/` folder) is embedded into the binary at compile
  time.
- Runtime data is stored in the Tauri app-data folder, not the repo's `data/`.

## What the Rust server does

`src-tauri/src/server.rs` is a port of `serve.mjs`:

| Endpoint | Behavior |
|---|---|
| `GET /` and static files | serve the embedded `dist/` |
| `GET/PUT /api/state` | ETag + `304`, atomic writes, serialized read-modify-write |
| `GET/PUT/DELETE /api/avatar` | streaming upload, GLB/VRM header validation, `415` if not VRM |
| `GET/PUT/DELETE /api/background` | JSON `dataUrl`, atomic writes |
| `GET /ws/pose` | panel -> OBS pose relay, validation + per-socket rate limit |

Host and Origin are still restricted to `127.0.0.1`/`localhost` port `8770`, same as the Node server.

## Port already in use

If `8770` is already listening (for example `npm start` is still running, or a second LiteTuber is
open), the app still opens its window and uses the existing server. This is intentional: you can open
the desktop panel while an old Node server keeps serving OBS.

## Commands

```bash
npm install
npm run build                      # frontend -> dist/
npm run tauri build                # installer (needs the target OS)
npm run tauri build -- --debug --no-bundle   # compile check on Linux
npx tauri info                     # check the toolchain
```

The Windows installer build (NSIS) must run on Windows or GitHub Actions
(`.github/workflows/tauri.yml`). See [CI-WINDOWS.md](CI-WINDOWS.md).

## Data location

Tauri uses `app_data_dir()`:

- Windows: `%APPDATA%\app.litetuber.desktop\`
- Linux: `~/.local/share/app.litetuber.desktop/`

It contains `state.json`, `avatar.vrm`, and `background.json`. This is separate from the `data/` used
by `npm start`, so desktop avatars/settings start empty on the first run.

## What cannot be verified on the Linux laptop

- Camera/mic permissions in WebView2. WebView2 has its own permissions; if the prompt does not appear
  or the camera is denied, that is the first thing to check on the PC.
- Rendering and the relay in OBS CEF.
- NSIS/MSI builds and the installer result.
- Installer signing; CI builds are not signed, so SmartScreen still appears.

The smoke test order on the PC is in [CI-WINDOWS.md](CI-WINDOWS.md).
