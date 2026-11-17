# LiteTuber

LiteTuber shows a VRM avatar in the browser. The head, eyes, and mouth follow your webcam and mic,
and the result is used as an OBS Browser Source. Supported models are VRM 0.x and 1.0; Live2D is not
supported. Everything runs on your own computer.

User guide: [docs/PANDUAN.md](docs/PANDUAN.md). What comes next: [ROADMAP.md](ROADMAP.md).

## Install on Windows

Installers are on the [Releases](https://github.com/FakhriF/LiteTuber/releases) page. No GitHub
account is needed to download.

1. Open **Releases** and pick the latest version.
2. Download the `*-setup.exe` file from **Assets**.
3. Run the installer. If SmartScreen shows up, choose **More info** then **Run anyway**. This build is
   not signed.
4. Open **LiteTuber** from the Start Menu.
5. In OBS, add a **Browser Source** with the URL `http://127.0.0.1:8770/?ui=0` and size
   `1920×1080`.

Keep the LiteTuber window open while you use it. That window is the settings panel; OBS only
displays the output. App data is stored in `%APPDATA%\app.litetuber.desktop\`.

Since v0.3.0 there is also a build without an installer: download `*-portable.zip`, extract it, and
run `LiteTuber.exe`. Data still goes to `%APPDATA%`, so settings, avatars, and profiles are not lost
when the ZIP folder moves. Requires the WebView2 Runtime; Windows 10/11 usually has it already.

To try a build that has not been released yet, download an Actions artifact from the **Actions** tab
(GitHub login required). The installer artifact is `litetuber-nsis`, the portable one is
`litetuber-portable`. Build and release steps are in [docs/CI-WINDOWS.md](docs/CI-WINDOWS.md).

## Run from source

Requires Node.js 18 or newer.

```bash
git clone https://github.com/FakhriF/LiteTuber.git
cd LiteTuber
npm install
npm start
```

Open `http://127.0.0.1:8770/`. To run the server without rebuilding, use `npm run serve`.

## Use in OBS

1. Start LiteTuber and open its panel. Do not close or minimize the panel while OBS is running.
2. In OBS, click **+** under **Sources** and choose **Browser**.
3. Enter the URL `http://127.0.0.1:8770/?ui=0`. The **Copy URL for OBS** button in the panel gives
   the same URL.
4. Set width to `1920` and height to `1080`.
5. The transparent background is on by default. If you need a green screen, choose **Green** in the
   panel.

OBS does not open the camera itself. The panel sends movement to OBS through the local server. The
**Display** tab has an **OBS off / OBS 1** badge that shows whether OBS is connected.

After an update, right-click the OBS source and choose **Refresh**. The URL does not change.

## Features

- VRM 0.x and 1.0 avatars, loaded by drag and drop or the file picker.
- Head, blink, expression, and eye direction tracking.
- Mouth movement from the camera, the mic, or both.
- Transparent, green, blue, or image background.
- Head-and-shoulders, half-body, or full-body framing.
- Idle animation and hair physics.
- Quality adjustment based on FPS, plus a smaller tracking frame on weak machines: with the CPU
  processor or a low tracking rate, the camera frame is scaled to 480×360 before the face model reads
  it. The rendered avatar keeps its full resolution.
- Camera and mic recovery after a device disconnects or changes.
- Settings presets: save a combination of framing, quality, and background under a name.
- Full profiles: save the avatar, background image, and settings together, then switch profiles
  without uploading again.
- Preset export/import as JSON, to move presets to another browser or PC.
- Avatar upload with validation and progress; the old avatar stays intact if a file is rejected.
- Settings, presets, and profiles are stored locally and reused by OBS.

## Data

Browser mode stores data in the `data/` folder. Desktop mode stores it in
`%APPDATA%\app.litetuber.desktop\`. OBS loads the avatar from the same server, so there is no
separate copy. Each profile keeps a copy of its avatar and background in the `profiles/` subfolder,
while the active avatar and background stay at the root of the data folder. Running the installer
does not delete this folder; install the new version without uninstalling first.

The `✕` button in the Avatar tab removes the saved avatar. Reset steps and moving to another
computer are covered in [docs/PANDUAN.md](docs/PANDUAN.md).

## Shortcuts

| Key | Action |
| --- | --- |
| `H` | hide/show the panel |
| `R` | calibrate the neutral head position |
| `F` | fullscreen |

## Troubleshooting

- **Camera does not show up**: check camera permissions in the browser or Windows, and make sure no
  other app is using the webcam.
- **The panel is in the recording**: use the `?ui=0` URL, not the panel URL.
- **Avatar is frozen in OBS**: the panel must be open and not minimized. Refresh the OBS source, then
  check the **OBS 1** badge.
- **Quality drops on its own**: that is the automatic adjustment. Turn it off in the Display tab if
  you do not want it.

More problems and full steps are in [docs/PANDUAN.md](docs/PANDUAN.md).

## Development

Requires Node.js 18 or newer. Desktop builds also need stable Rust and the Tauri dependencies.

```bash
npm test        # Vitest
npm run build   # production build to dist/
npm run serve   # run the server without rebuilding
npm run tauri dev
cargo test --manifest-path src-tauri/Cargo.toml
```

Module structure and data flow are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Windows installer
builds and CI are in [docs/CI-WINDOWS.md](docs/CI-WINDOWS.md); desktop architecture is in
[docs/DESKTOP.md](docs/DESKTOP.md).

CI runs `npm ci`, `npm test`, and `npm run build` on Node 22 and 24. The Tauri Windows workflow runs
the same tests, then `cargo test`, then builds the NSIS installer.

## License

MIT, see [LICENSE](LICENSE). Sample models are not included. Dependency licenses are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
