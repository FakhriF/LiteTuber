import * as store from "./store.js";
import { $ } from "./ui.js";

// The panel keeps its own copy of settings and pushes them to the local server.
// OBS reads the server, and a second tab or a profile apply can change it, so
// the panel also polls with an ETag and applies what came back.
export function createServerSync({ settings, S, api }) {
  async function getServerState() {
    try {
      const res = await fetch("/api/state", {
        cache: "no-store",
        headers: S.serverStateEtag ? { "if-none-match": S.serverStateEtag } : {},
      });
      if (res.status === 304) return null;
      if (!res.ok) return null;
      S.serverStateEtag = res.headers.get("etag") || "";
      return await res.json();
    } catch {
      return null;
    }
  }

  function settingsPayload() {
    const payload = { ...settings };
    delete payload.panelHidden;
    return payload;
  }

  function pushSettings() {
    if (S.applyingServer) return;
    clearTimeout(S.pushTimer);
    const payload = settingsPayload();
    S.pushTimer = setTimeout(() => {
      fetch("/api/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: payload }),
      }).catch(() => {});
    }, 350);
  }

  // Profiles snapshot the server state, so the debounced save must land first.
  async function flushSettings() {
    clearTimeout(S.pushTimer);
    if (S.applyingServer) return;
    try {
      await fetch("/api/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: settingsPayload() }),
      });
    } catch {
      /* the profile request will report a server problem */
    }
  }

  function applyServerSettings(incoming) {
    const next = { ...store.defaults, ...incoming };
    next.panelHidden = settings.panelHidden;
    if (S.forcedBg) next.bg = S.forcedBg;
    if (JSON.stringify(next) === JSON.stringify(settings)) return false;
    S.applyingServer = true;
    Object.assign(settings, next);
    api.syncUI();
    api.syncQualityFromSettings();
    api.applyBackground();
    api.applyFraming();
    api.applyRenderScaleSetting();
    S.renderer.toneMappingExposure = settings.exposure;
    store.saveSettings(settings);
    S.applyingServer = false;
    return true;
  }

  async function pollServer() {
    if (S.polling) return;
    S.polling = true;
    try {
      const state = await getServerState();
      if (!state) return;
      if (state.settings) applyServerSettings(state.settings);
      if (state.bgExists && state.bgMtime !== S.serverBgMtime)
        await api.loadServerBackground(state);
      else if (!state.bgExists && S.serverBgMtime !== 0) {
        $("bgImage").style.backgroundImage = "";
        S.serverBgMtime = 0;
      }
      if (!S.avatarBusy && state.avatarExists && state.avatarMtime !== S.serverAvatarMtime)
        await api.loadServerAvatar(state);
      else if (!S.avatarBusy && !state.avatarExists && S.serverAvatarMtime !== 0) {
        await api.switchToPlaceholder();
        S.serverAvatarMtime = 0;
      }
    } finally {
      S.polling = false;
    }
  }

  // A profile apply swaps the active avatar, background, and settings on the
  // server. Drop the cached ETag/mtimes so the next poll loads everything.
  async function reloadFromServer() {
    clearTimeout(S.pushTimer);
    S.serverStateEtag = "";
    S.serverAvatarMtime = 0;
    S.serverBgMtime = 0;
    const state = await getServerState();
    if (!state) return;
    if (state.settings) applyServerSettings(state.settings);
    if (state.bgExists) {
      await api.loadServerBackground(state);
    } else {
      $("bgImage").style.backgroundImage = "";
    }
    if (state.avatarExists) {
      await api.loadServerAvatar(state);
    } else {
      await api.switchToPlaceholder();
    }
  }

  return {
    getServerState,
    settingsPayload,
    pushSettings,
    flushSettings,
    applyServerSettings,
    pollServer,
    reloadFromServer,
  };
}
