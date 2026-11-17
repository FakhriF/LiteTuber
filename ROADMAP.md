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

## v0.4

- **English UI and the remaining docs.** Translate all panel text, the user guide, and the rest of
  `docs/` in one pass so app terms and docs stay consistent.
- **Split `main.js`.** Separate the render loop, sync, and UI. Profiles already live in their own
  module; presets and the rest of the UI follow without changing behavior.

## Later

- **MSIX and the Microsoft Store.** The cheapest way to remove SmartScreen, because the Store
  re-signs the package.
- **Hotkeys/Stream Deck.** Switch expression, background, or profile from a button.
- **Auto-update.** Needs a signed installer first.
- **Hand tracking.** Deferred until full-body framing is actually needed; the cost is an extra model,
  finger bones that VRM files may not have, and higher latency.

## Not planned

- Live2D.
- Electron.
- Rendering in the cloud or online accounts.
