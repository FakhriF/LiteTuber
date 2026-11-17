import { VrmAvatar } from "./avatar.js";
import { PlaceholderAvatar } from "./placeholder.js";
import { inspectVrm } from "./vrm.js";

// Loading, saving, and swapping avatars and background images, including the
// server copy that OBS reads.
export function createAvatarLoader({ $, store, settings, S, api, scene, camera }) {
  async function pushAvatar(buffer, name) {
    const label = $("vrmName");
    // XHR (not fetch) because upload progress events are what let a 15 MB avatar
    // show a percentage instead of looking frozen.
    await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `/api/avatar?name=${encodeURIComponent(name)}`);
      xhr.upload.addEventListener("progress", (e) => {
        if (!e.lengthComputable) return;
        if (!label.textContent.startsWith(name)) return;
        const pct = Math.min(100, Math.round((e.loaded / e.total) * 100));
        label.textContent = `${name} · uploading ${pct}%`;
      });
      const done = (ok, code) => {
        label.textContent = name;
        if (!ok) {
          api.toast(
            code === 415
              ? "The server rejected the file: not a valid VRM avatar"
              : `Could not save the avatar to the server (${code})`,
          );
        }
        resolve();
      };
      xhr.addEventListener("load", () => done(xhr.status >= 200 && xhr.status < 300, xhr.status));
      xhr.addEventListener("error", () => done(false, 0));
      xhr.addEventListener("abort", () => done(false, 0));
      xhr.send(buffer);
    });
  }

  async function loadServerAvatar(state) {
    try {
      const res = await fetch("/api/avatar", { cache: "no-store" });
      if (!res.ok) return false;
      const buffer = await res.arrayBuffer();
      await loadVrmBuffer(buffer, state?.avatarName || "avatar", false);
      S.serverAvatarMtime = state?.avatarMtime || 0;
      return true;
    } catch {
      return false;
    }
  }

  async function serverJson(pathname, options) {
    const res = await fetch(pathname, { cache: "no-store", ...options });
    if (!res.ok) throw new Error(`${pathname} ${res.status}`);
    return res.json();
  }

  async function loadServerBackground(state) {
    try {
      const data = await serverJson("/api/background");
      if (!data?.dataUrl) return false;
      $("bgImage").style.backgroundImage = `url("${data.dataUrl}")`;
      S.serverBgMtime = state?.bgMtime || 0;
      return true;
    } catch {
      return false;
    }
  }

  async function setBackgroundImageFromStore() {
    const dataUrl = await store.loadBackground();
    if (dataUrl) {
      $("bgImage").style.backgroundImage = `url("${dataUrl}")`;
    } else if (settings.bg === "image") {
      api.toast("No background image yet. Choose an image first.");
      settings.bg = "transparent";
      store.saveSettings(settings);
      api.applyBackground();
      api.syncUI();
    }
  }

  async function loadVrmBuffer(buffer, name, persist = true) {
    if (S.avatarBusy) return;
    const check = inspectVrm(new Uint8Array(buffer));
    if (!check.ok) {
      api.toast(`Not a valid VRM avatar: ${check.reason || "incomplete file"}`);
      return;
    }
    S.avatarBusy = true;
    const next = new VrmAvatar(scene);
    try {
      await next.load(buffer.slice(0), name);
      const previous = S.avatar;
      S.avatar = next;
      previous.dispose();
      api.dismissHint();
      $("vrmName").textContent = name;
      api.applyFraming();
      // Shader programs are compiled on the first draw otherwise, which shows up
      // as a one-frame hitch right when an avatar appears. A failed compile is
      // harmless: the first real render will report the error.
      try {
        S.renderer.compile(scene, camera);
      } catch {
        /* ignore */
      }
      if (persist) {
        await store.saveVrm(buffer, name).catch(() => {});
        pushAvatar(buffer, name);
      }
      api.toast(`Avatar loaded: ${name}`);
    } catch (err) {
      console.error(err);
      next.dispose();
      api.toast(`Could not load the avatar: ${err.message || err}`);
    } finally {
      S.avatarBusy = false;
    }
  }

  async function switchToPlaceholder() {
    if (S.avatar.kind !== "vrm") return;
    S.avatar.dispose();
    S.avatar = new PlaceholderAvatar(scene);
    api.applyFraming();
  }

  async function onVrmFile(file) {
    if (!file) return;
    const name = file.name.replace(/\.vrm$/i, "");
    const buffer = await file.arrayBuffer();
    await loadVrmBuffer(buffer, name);
  }

  return {
    pushAvatar,
    loadServerAvatar,
    loadServerBackground,
    setBackgroundImageFromStore,
    loadVrmBuffer,
    switchToPlaceholder,
    onVrmFile,
  };
}
