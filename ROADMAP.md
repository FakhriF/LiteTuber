# Roadmap

Status as of November 2026. This is a work plan, not a release schedule. The order can change based
on bug reports and user needs.

## Available now

- Windows installer (NSIS) and automatic releases from a `v*` tag.
- Browser mode and the Tauri desktop app, both served at `http://127.0.0.1:8770/`.
- VRM 0.x and 1.0 avatars, with MediaPipe face tracking in a Web Worker.
- Pose relay to OBS, so OBS only displays the result.
- Mouth movement from the camera or mic, adaptive quality, ETag caching, and avatar upload with
  validation.
- Camera and mic recovery: a dropped track is detected, reconnected automatically 3 times (2, 5, and
  10 second delays), falls back to the default device when a device disappears, and a suspended mic
  can be resumed.
- Settings presets: save a combination of settings under a name, then apply or delete it from the
  Display tab. Avatars and background files are not copied.
- Preset export/import as JSON, so presets can move to another browser or PC.
- Full profiles: the avatar, background image, and settings are stored as one profile with copies of
  the assets on the server. Applying a profile switches without uploading the avatar again. Up to 12
  profiles.
- Vitest and Rust tests, plus Linux and Windows CI.
- Portable ZIP without an installer (`*-portable.zip`) uploaded to the release next to the installer;
  data stays in `%APPDATA%`. A true portable mode (data next to the `.exe`) does not exist yet.
- English UI, README, and docs.
- Performance pass (0.5.0): MediaPipe gets a 480×360 frame on the CPU processor or a tracking rate of
  20 Hz and below, the pose relay no longer allocates an array every frame, window resizing is
  coalesced, and shaders are compiled when an avatar loads instead of during the first draw. Numbers
  are estimates from pixel counts, not profiler runs on Windows.
- Split `main.js` (0.5.0): `main.js` is a ~250-line composition root; the panel, media sessions,
  render loop, renderer and quality ladder, avatar loading, server sync, toasts, and pose keys each
  live in their own module.
- Panel theme refresh (0.6.0). Warmer ink palette with coral and periwinkle accents, rounded status
  chips, one small sparkle next to the logo, a dashed frame around the empty avatar slot, and a
  one-pixel button hover. CSS only: no new dependencies, no blur, no gradients, and no animation
  that runs all the time.
- Hidden-panel handle (0.6.0). Hiding the panel briefly shows a small **Panel** pill in the
  top-left; moving the pointer back to that corner reveals it again. Clicking it restores the panel,
  and `H` still works. The OBS viewer never shows the handle.

## Later

- **MSIX and the Microsoft Store.** The cheapest way to remove SmartScreen, because the Store
  re-signs the package.
- **Hotkeys/Stream Deck.** Deferred until there is a real need. Local shortcuts only work while
  the LiteTuber window has focus; a Stream Deck trigger would need a token-protected local HTTP
  endpoint in both servers.
- **True portable mode.** Keep data beside the `.exe` instead of `%APPDATA%`. Bigger change and
  needs Windows testing.
- **Auto-update.** Needs a signed installer first.
- **Hand tracking.** Deferred until full-body framing is actually needed; the cost is an extra model,
  finger bones that VRM files may not have, and higher latency.

## Not planned

- Live2D.
- Electron.
- Rendering in the cloud or online accounts.
