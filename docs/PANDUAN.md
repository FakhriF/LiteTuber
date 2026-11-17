# User guide

This guide covers everyday use. Technical reference is in [ARCHITECTURE.md](ARCHITECTURE.md); builds
and CI are in [CI-WINDOWS.md](CI-WINDOWS.md) and [DESKTOP.md](DESKTOP.md).

## 1. Choose how to run it

| Mode | Good for | Needs |
|---|---|---|
| Local browser | coding, testing, any OS | Node.js 18+ |
| Tauri desktop (Windows) | streaming, no terminal | NSIS installer |

Both serve the same address, `http://127.0.0.1:8770/`, and OBS keeps using
`http://127.0.0.1:8770/?ui=0`. You can switch modes without changing the OBS source.

**Browser:**

```bash
git clone https://github.com/FakhriF/LiteTuber.git
cd LiteTuber
npm install      # once
npm start        # build + start the server
```

**Desktop:** run the installer, then open **LiteTuber** from the Start Menu. If the installer has not
been built yet, see [CI-WINDOWS.md](CI-WINDOWS.md). For development on a Linux laptop:

```bash
npm run tauri dev
```

### If you use the Windows installer

1. Open the repo's **Releases** page, pick the latest version, then download `*-setup.exe` from
   **Assets**. Files on Releases need no GitHub account. If there is no release yet, grab the
   `litetuber-nsis` artifact from **Actions → Tauri Windows** (login required).
2. Run the `*-setup.exe` file.
3. If Windows shows SmartScreen, choose **More info → Run anyway**. This build is not signed.
4. Open **LiteTuber** from the Start Menu.
5. The LiteTuber window is the panel. Keep it open while OBS is running.

To update, close the app and run the new installer. No uninstall needed: the installer replaces the
old version and the data in `%APPDATA%` stays. To uninstall, use
**Settings → Apps → LiteTuber → Uninstall**.

### If you use the portable ZIP

The portable ZIP is available since v0.3.0.

1. Download `*-portable.zip` from **Assets** on the Releases page.
2. Extract it to a normal folder, then run `LiteTuber.exe`. No installer needed.
3. If SmartScreen shows up, choose **More info → Run anyway**.
4. Data still goes to `%APPDATA%\app.litetuber.desktop\`, same as the installer version. So settings,
   avatars, and profiles are not lost when the ZIP folder moves, but they do not come along if you
   copy that folder to another PC.
5. Requires the WebView2 Runtime. Windows 10/11 usually has it already; if the app does not open,
   install the WebView2 Runtime from Microsoft.

To update the portable version, replace `LiteTuber.exe` with the new one; close the app first.

## 2. First run

1. Open `http://127.0.0.1:8770/` (or the LiteTuber window).
2. Choose an avatar: drag a `.vrm` file into the window, or click **Choose .vrm** in the **Avatar**
   tab. A 15 MB upload takes a few seconds; the file name shows a percentage. Files that are not VRM
   are rejected and the old avatar stays safe.
3. Open the **Face** tab, click **Start camera**, then allow camera access. If there are several
   cameras, pick one in the dropdown that appears.
4. Face forward in a neutral position, then click **Calibrate** (or press `R`). This saves the head
   direction baseline so the avatar does not stay tilted.
5. Optional: open the **Mouth** tab, click **Start mic**, allow mic access, then choose the mouth
   source **Camera + Mic**, **Camera only**, or **Mic only**.
6. Set the background, framing, zoom, and FPS cap in the **Display** tab.

Settings are saved right away and used again the next time the app opens. The avatar is also stored
on the server, so there is no need to upload it again.

## 3. What the panel tabs do

| Tab | Contents |
|---|---|
| **Avatar** | Choose/change the avatar, remove the saved avatar (the `✕` button). |
| **Face** | Start the camera, calibrate, sensitivity, smoothing, mirror, invert X/Y/Z, tracking processor (GPU/CPU), and on/off for features (head, eyes, blink, expressions, idle, hair physics). |
| **Mouth** | Start the mic, mouth movement source, mic sensitivity, mic level, mouth movement test, auto blink. |
| **Display** | Background (transparent/green/blue/image), framing, zoom, exposure, FPS cap, render quality, auto quality, tracking rate, profiles, presets, and the **Copy URL for OBS** button. |

The `–` button in the top right hides the panel; press `H` to bring it back. The status bar at the
bottom of the panel shows camera, face, mic, and the version of the app you are running.

### Full profiles

A profile stores the avatar, background image, and all settings as one bundle. The server copies the
avatar and background files into the profile folder, so switching profiles needs no re-upload.

1. Set the avatar, background, and settings the way you want them.
2. In the **Display** tab, fill in **Profile name**, then click **Save**.
3. To switch, pick a profile in the dropdown and click **Apply**.
4. To delete a profile and its asset copies, pick the profile, click `✕`, and confirm.

The same name updates the old profile. Up to 12 profiles. Profiles are stored in the server data
folder (`data/profiles/` or `%APPDATA%\app.litetuber.desktop\profiles\`), not in `localStorage`, so
they come along as long as you use the same data folder. Profiles created before this feature existed
are not converted automatically; save one from the current state once.

### Settings presets

A preset stores a combination of settings so you do not have to set everything again when switching
looks. It contains: framing, zoom, exposure, sensitivity, smoothing, mirror, mouth source, mic gain,
FPS cap, render quality, tracking rate, auto quality, and background choice.

1. Set the panel the way you want it.
2. In the **Display** tab, fill in **Preset name**, then click **Save**.
3. To use it again, pick the preset in the dropdown and click **Apply**.
4. To delete, pick the preset, click `✕`, and confirm.

The same name updates the old preset instead of creating a duplicate. Presets are stored in the
browser's `localStorage`, not in the server data folder, so they do not come along when you move to
another computer. Avatars and background image files are not stored in a preset; the preset only
remembers the background choice. Up to 24 presets.

Presets can be moved with **Export JSON** and **Import JSON** in the Preset section. Export downloads
one file with all presets. Import merges the file into the existing presets: names that already exist
are skipped so local presets are not overwritten, and the rest are added up to the 24 limit.

## 4. Setting up in OBS

1. Make sure the LiteTuber panel **stays open** (browser or desktop window) and is not fully
   minimized. The active panel sends live movement.
2. In OBS: **Sources → + → Browser**.
3. URL: `http://127.0.0.1:8770/?ui=0` — the **Copy URL for OBS** button in the Display tab works too.
4. Width `1920`, Height `1080`.
5. The background is transparent by default. For a green screen, choose **Green** in the panel, not
   in OBS.
6. For stream audio, add **Audio Input Capture** in OBS and pick your mic. The mic in LiteTuber is
   only used to move the mouth; the app does not output sound.

The OBS source is **display only**. Do not open a second panel in OBS: there is no camera button there,
and all settings are meant to be changed from the browser panel. The **OBS off / OBS 1** badge in the
Display tab shows how many sources actually receive movement.

After a LiteTuber update, reload the OBS source once (**right-click → Refresh**). The URL does not
change.

## 5. Release status

The current stable version is **0.5.0**. The installer and portable ZIP are on the
[Releases](https://github.com/FakhriF/LiteTuber/releases) page; both were tested on Windows.
Version 0.5.0 ships the English app and documentation, the performance pass, and the split of
`main.js`. There is no 0.4.0 release: that translation work is part of 0.5.0.

Available:

- browser mode via `npm start`,
- NSIS installer for desktop (since 0.2.0),
- portable ZIP without an installer, data stays in `%APPDATA%` (since 0.3.0),
- the app and all documentation in English (since 0.5.0),
- desktop builds from source,
- a GitHub Actions workflow that builds the installer and portable ZIP from a `v*` tag,
- camera and mic recovery after a device disconnects or changes.

Not available yet:

- true portable mode (data next to the `.exe`),
- signed installers, so SmartScreen still appears,
- an MSIX package for the Microsoft Store,
- auto-update inside the app.

Unreleased builds can be tried through **Actions → Tauri Windows** artifacts (GitHub login required):
`litetuber-nsis` or `litetuber-portable`. Data and the OBS URL are the same as the installer version.

## 6. Where data is stored

| Data | Location |
|---|---|
| Settings and avatar name | `state.json` in the server data folder |
| Avatar file | `avatar.vrm` in the server data folder |
| Background image | `background.json` in the server data folder |
| Settings copy in the browser | `localStorage` |
| Avatar/background copy in the browser | IndexedDB |

Server data folder:

- Browser mode: `data/` inside the repo.
- Desktop mode: `%APPDATA%\app.litetuber.desktop\` (Windows).

OBS does not store the avatar itself; it loads it from the server through the same URL. So changing
the avatar once in the panel is enough.

**Reset:** the `✕` button in the Avatar tab removes the saved avatar. For a full reset, close the app
and delete the data folder above. In the browser, also clear the site data for `127.0.0.1:8770` if you
want the settings to truly go back to defaults.

**Moving to another computer:** copy the server data folder (and the installer if you use desktop
mode), then run the app on the new computer.

## 7. Shortcuts

| Key | Action |
|---|---|
| `H` | hide/show the panel |
| `R` | calibrate the neutral head position |
| `F` | fullscreen |

## 8. Troubleshooting

**Camera does not show up or says "face: not visible"**
Make sure no other app is using the webcam. Check camera permissions in the browser (lock icon) or in
Windows **Settings → Privacy & security → Camera**. On desktop, allow desktop apps to use the camera.
Try brighter light, a distance of about 50 cm, and the right camera in the dropdown.

**Mic does not move the mouth**
Make sure **Start mic** has been clicked, the mouth source is not **Camera only**, and the level meter
moves when you talk. Raise **Mic sensitivity** if the meter moves but the mouth barely opens.

**Camera or mic disconnects while in use**
LiteTuber tries to reconnect automatically up to 3 times, with delays of 2, 5, then 10 seconds. If the
device does not come back, the panel status changes and the **Start camera** / **Start mic** button can
be clicked to try again. A denied permission is not retried automatically; change the permission in
the browser or Windows Settings first. If the selected device disappears, the app falls back to the
default device and shows a notice. A **mic: suspended** status means the browser is holding the audio;
click once on the page to resume it.

**Avatar is too dark/bright**
Adjust **Exposure** in the Display tab.

**Head movement is reversed**
Try **Invert X/Y/Z** under Advanced in the Face tab. For a camera that looks like a mirror, leave
**Mirror** on.

**The panel is in the OBS recording**
Use the `http://127.0.0.1:8770/?ui=0` URL, not the panel URL.

**Avatar in OBS is frozen**
The panel must be open and not minimized. Reload the OBS source once, then check the **OBS 1** badge.
If it still says **OBS off**, make sure the source uses `?ui=0` and the same server.

**Avatar/settings differ in OBS**
Make sure there is only one server on port 8770. If there are two instances, close one. Reload the OBS
source after changing the avatar or settings.

**Port 8770 is already in use**
Close the other LiteTuber or the `npm start` that is still running. The desktop version intentionally
uses the existing server so OBS is not disconnected.

**Quality drops on its own**
That is **Auto quality**: resolution and tracking rate drop when FPS falls, then rise again once it
recovers. Turn it off in the Display tab if you want fixed values.

**Windows SmartScreen appears during install**
Installers from CI are not signed. Choose **More info → Run anyway** if you trust the build source.
This goes away later with a certificate or a Microsoft Store release.

**Tracking feels heavy**
Set the FPS cap to `30`, framing to **Head & shoulders**, and leave auto quality on. If the GPU has
problems, choose the **CPU** tracking processor (slower but more compatible). `?worker=0` can be used
to go back to main-thread tracking while diagnosing.
