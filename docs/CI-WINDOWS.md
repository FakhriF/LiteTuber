# Windows builds & CI

Short answer: **the gaming PC is not needed for CI.** The Windows installer build should run on a
GitHub Actions Windows runner. The gaming PC is only needed once, for a smoke test after the
installer is built.

## Why it cannot be done from the Linux laptop

Tauri uses the native Windows toolchain:

- the MSVC linker,
- the Windows SDK,
- WebView2,
- NSIS/WiX for the installer.

Cross-compiling from Linux can be attempted, but it is not officially supported and fails easily. Do
not make it the main path.

## CI options

| Option | Needs the gaming PC? | Notes |
|---|---|---|
| GitHub Actions `windows-latest` | no | Simplest. Free for public repos; private repos use a monthly minute quota. |
| Gitea Actions + own runner | yes | The runner must run on Windows, so the gaming PC has to be on during the build. Only worth it if the repo must stay on Gitea. |
| Manual build on the gaming PC | yes | Needs Rust, Node, and Visual Studio Build Tools installed. No CI needed, but tedious and not reproducible. |

Recommendation: **mirror the repo to GitHub and use GitHub Actions for the Windows build.** Gitea/Tencent
can stay the primary remote for day-to-day code.

## Existing workflow

File: `.github/workflows/tauri.yml`. It:

- runs on `windows-latest` through `workflow_dispatch` or a `v*` tag,
- installs Node 22, stable Rust, and the Cargo cache,
- runs `npm ci`, `npm test`, `npm run build`, then `cargo test`,
- builds the NSIS installer with `tauri-action`,
- packs `litetuber.exe` into `*-portable.zip` together with `README.txt`,
- uploads the `.exe` as the `litetuber-nsis` artifact and the ZIP as `litetuber-portable`,
- when triggered by a `v*` tag, creates the GitHub Release automatically, puts the installer in Assets,
  then attaches the portable ZIP to the same release.

The workflow uses npm explicitly (`tauriScript: npm run tauri`). The repo only keeps
`package-lock.json`; do not add `bun.lock`, `pnpm-lock.yaml`, or `yarn.lock`, because `tauri-action`
would pick that package manager and the Windows runner does not provide it.

## Creating a release

Releases are created automatically from a tag, so no manual upload is needed:

```bash
# replace X.Y.Z with the version to release, for example v0.3.0
git tag vX.Y.Z
git push origin vX.Y.Z
```

Gitea mirrors the tag to GitHub, then the **Tauri Windows** workflow runs, builds NSIS and the
portable ZIP, and creates the `LiteTuber vX.Y.Z` release containing `*-setup.exe` and
`*-portable.zip`. The Releases page can be downloaded without a GitHub account; Actions artifacts
remain as a fallback and require a login.

`workflow_dispatch` (the **Run workflow** button) only produces artifacts, it does not create a
release. Make sure the version in `package.json` and `src-tauri/tauri.conf.json` is bumped before
tagging.

The portable ZIP contains `LiteTuber.exe` and `README.txt`. Data is still stored in
`%APPDATA%\app.litetuber.desktop\`, same as the installer version, so the ZIP only removes the install
step. A true portable mode (data next to the `.exe`) does not exist yet because it changes how the
server finds its data folder.

## Suggested workflow

1. Code is still written and tested on the Linux laptop:
   `npm test`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`.
2. Push to Gitea, then mirror to GitHub (the `github` remote).
3. Open **Actions → Tauri Windows → Run workflow** on GitHub, or create a `vX.Y.Z` tag for a public
   release.
4. Download the `litetuber-nsis` artifact (installer) or `litetuber-portable` (ZIP) from the run page.
5. Install it on the gaming PC once, then check:
   - the app opens and the local server runs,
   - camera/mic work,
   - the OBS Browser Source `http://127.0.0.1:8770/?ui=0` receives pose.

The gaming PC does not need Node, Rust, or Visual Studio. It only has to be the test machine.

## Desktop build from the Linux laptop

The Tauri scaffold can be compiled on Linux to catch errors:

```bash
npm run build
npm run tauri build -- --debug --no-bundle
```

The result is a Linux binary at `src-tauri/target/debug/litetuber`. The Windows installer still has to
be built on Windows/CI because it uses NSIS and the MSVC toolchain.


## Signing notes

- Installers built by CI are **not signed**. Windows SmartScreen shows a warning until there is an
  Authenticode certificate.
- The Microsoft Store path uses MSIX; the Store re-signs the package after certification.
- Add signing in CI later once a certificate is available; never put the certificate in the repo.
