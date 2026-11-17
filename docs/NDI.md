# Render on the PC, record on the laptop (NDI)

This setup makes the **PC do the heavy work** (face tracking + 3D rendering) and lets the **laptop just
receive video and record**. Good when the laptop is weak but you want the recording files to land on
the laptop directly.

Flow: **phone camera → PC (render) → NDI → laptop OBS (record)**

## What you need

- PC and laptop on the same network. A LAN cable is the most stable; 5 GHz WiFi is usually fine.
- OBS on both machines + the **NDI Runtime** and the **DistroAV** plugin (formerly OBS-NDI). Both are
  required on **both** machines.
- Phone camera as a webcam on the PC:
  - New Windows 11: **Phone Link → Use phone as webcam**.
  - Otherwise: **Iriun**, **DroidCam**, or **Camo**. USB is more stable than WiFi.
- Mic: easiest from the phone too (DroidCam/Iriun support audio), or a USB mic plugged into the PC.
- **LiteTuber server on the PC.** Pick one:
  - The LiteTuber desktop app (no Node needed), or
  - **Node.js 18+**, then run `serve.mjs`. If the `dist/` folder already exists (built on the laptop),
    `npm run serve` is enough. If cloned from git: `npm install` once, then `npm start`.

Do not open the app on the PC through `http://laptop-IP:8770`. Chrome only allows camera/mic on
`localhost` or HTTPS, so the server has to run on the same computer as the browser.

## 0. Install NDI

NDI is two parts: the **NDI Runtime** (the engine) and the **OBS plugin** (DistroAV, formerly OBS-NDI).
Install them on the PC and the laptop.

**Arch / CachyOS (native OBS, like this laptop)**

```bash
paru -S distroav
```

That installs `ndi-sdk` (which provides `libndi`) + the plugin automatically. Make sure `avahi` runs:

```bash
sudo systemctl enable --now avahi-daemon
```

Restart OBS. Check: **Sources → + → NDI Source** and **Tools → NDI Output Settings**.

**If OBS is a Flatpak**

```bash
flatpak install com.obsproject.Studio.Plugin.DistroAV
sudo flatpak override com.obsproject.Studio --system-talk-name=org.freedesktop.Avahi
```

**Windows**

```powershell
winget install --exact --id DistroAV.DistroAV
```

Then install **NDI Runtime 6.3+** from <https://ndi.video/tools/> (NDI Tools includes the runtime).
Restart OBS.

**macOS**

```bash
brew install --cask distroav
```

Plus NDI Tools for the runtime. Note: DistroAV needs OBS ≥ 31.1.1.

## 1. Phone as a webcam on the PC

1. Install the app on the phone and the client on the PC, connect over USB or WiFi.
2. In LiteTuber, the **camera** dropdown should list the phone device. Pick it.
3. In the **mic** dropdown, pick the phone mic (if the app supports audio), or another mic on the PC.

If the avatar mouth is driven by the phone mic and the recorded audio also comes from the phone mic,
sync is automatic because both go through the same path.

## 2. Run LiteTuber on the PC

Use the LiteTuber desktop app if it is installed. If not, run it from source:

```bash
cd ~/Projects/vtuber-lite
npm start
```

Open `http://127.0.0.1:8770/`, choose an avatar, turn on the camera + mic, set mirror/framing.

If you need transparency in the final output, choose the **Green** background — NDI usually sends an
already composited image (alpha is not always carried), so chroma keying on the laptop is safer.

## 3. OBS on the PC (NDI source)

1. Add a **Browser Source**:
   - URL: `http://127.0.0.1:8770/?ui=0`
   - Width `1920`, Height `1080`.
2. To send audio too: add **Audio Input Capture** in the same scene and pick the phone mic / PC mic.
3. Enable NDI:
   - **Tools → NDI Output Settings** → check **Main Output**, or
   - **Dedicated NDI Output** (NDI Filter) with the name `LiteTuber` (cleaner when there are several
     outputs).
4. Make sure the scene shows only the avatar (no panel UI).

## 4. OBS on the laptop (recorder)

1. Add an **NDI Source** → pick `LiteTuber` (or `Main Output`).
2. **Bandwidth**: `Highest`. **Sync**: `Network`.
3. Check the mixer: audio from NDI should come through. If not, click the audio icon on the NDI source.
4. Recording:
   - **Settings → Output → Recording**: use a hardware encoder (NVENC / QSV / VAAPI).
   - 1080p30 if the laptop is weak, 1080p60 if it is strong.
   - `mkv` format (safer if OBS crashes; can be remuxed to mp4 afterwards).

## If audio and video are out of sync

Video arrives late because it goes phone → PC → NDI. If audio is recorded from the **laptop mic**
(instead of from NDI), the sound will come before the mouth movement.

- Easiest: record audio from **NDI** (same path as video) — automatically in sync.
- If you still want the laptop mic: laptop OBS → **Advanced Audio Properties → Sync Offset** on the
  mic, use `+200` to `+400` ms until it lines up.

## Alternative without NDI: record on the PC to a laptop folder

If you do not need a live monitor on the laptop:

1. Share a folder on the laptop (SMB/NFS).
2. In OBS on the PC, set **Recording Path** to that shared folder.
3. Recording files appear on the laptop directly, with no extra encode/NDI. Lightest for the laptop.

## Troubleshooting

**NDI Source does not find the PC**
- Make sure both are on the same subnet and there is no AP isolation / guest WiFi.
- Try **NDI Access Manager** to add the host manually.
- Open the firewall: UDP 5353 (mDNS), TCP/UDP 5960–5970.

**Video stutters / delay grows**
- Use a LAN cable between the PC and laptop.
- Drop to 30 fps in LiteTuber and OBS.
- In the NDI Source, try bandwidth `Highest` (quality) or lower the scene resolution.

**Laptop is still struggling**
- Make sure the hardware encoder is active, not x264.
- Record 1080p30, not 60.
- Close the preview in laptop OBS (right-click the preview → performance).

**Lip sync feels odd**
- Make sure the mic driving the avatar is the same (or a similar) mic as the one recorded.
- If you use the laptop mic for recording, use Sync Offset as above.
