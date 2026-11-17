import * as store from "./store.js";
import {
  deletePreset,
  exportPresets,
  importPresets,
  mergePreset,
  normalizeName,
  savePreset,
} from "./presets.js";
import { setupProfiles } from "./profiles.js";

// The settings panel: panel chrome, every control, presets, profiles, keyboard
// shortcuts, and drag and drop.
export function createPanel({ $, settings, quality, S, api, face, mic }) {
  let activeTab = "avatar";
  try {
    activeTab = localStorage.getItem("litetuber.tab") || "avatar";
  } catch {
    /* private mode: keep the default */
  }

  let presets = store.loadPresets();

  function applyBackground() {
    document.body.classList.remove("green", "blue");
    $("bgImage").classList.remove("on");

    if (settings.bg === "green") document.body.classList.add("green");
    else if (settings.bg === "blue") document.body.classList.add("blue");
    else if (settings.bg === "image") $("bgImage").classList.add("on");

    for (const btn of document.querySelectorAll("#bgChips button")) {
      btn.classList.toggle("active", btn.dataset.bg === settings.bg);
    }
  }

  function applyPanel() {
    $("panel").classList.toggle("hidden", settings.panelHidden);
    $("hideBtn").textContent = settings.panelHidden ? "+" : "–";
    api.updateCamPreview();
  }

  function applyTab(tab) {
    for (const btn of document.querySelectorAll(".tabs button")) {
      btn.classList.toggle("on", btn.dataset.tab === tab);
    }
    for (const section of document.querySelectorAll("#panel .body section")) {
      section.hidden = section.dataset.tab !== tab;
    }
  }

  function syncUI() {
    $("sens").value = settings.sens;
    $("sensOut").textContent = settings.sens.toFixed(2);
    $("smooth").value = settings.smooth;
    $("smoothOut").textContent = settings.smooth.toFixed(2);
    $("mirror").checked = settings.mirror;
    $("invX").checked = settings.invertX;
    $("invY").checked = settings.invertY;
    $("invZ").checked = settings.invertZ;
    $("delegate").value = settings.delegate;
    $("micGain").value = settings.micGain;
    $("micGainOut").textContent = settings.micGain.toFixed(2);
    $("mouthSrc").value = settings.mouthSrc;
    $("autoBlink").checked = settings.autoBlink;
    $("useHead").checked = settings.useHead;
    $("useEyes").checked = settings.useEyes;
    $("useBlink").checked = settings.useBlink;
    $("useExpr").checked = settings.useExpr;
    $("useIdle").checked = settings.useIdle;
    $("useSpring").checked = settings.useSpring;
    $("framing").value = settings.framing;
    $("zoom").value = settings.zoom;
    $("zoomOut").textContent = settings.zoom.toFixed(2);
    $("exposure").value = settings.exposure;
    $("exposureOut").textContent = settings.exposure.toFixed(2);
    $("fpsCap").value = String(settings.fpsCap);
    $("renderScale").value = String(settings.renderScale);
    $("trackHz").value = String(settings.trackHz);
    $("autoQuality").checked = settings.autoQuality !== false;
    S.renderer.toneMappingExposure = settings.exposure;
  }

  function commit() {
    store.saveSettings(settings);
    api.pushSettings();
  }

  /* ---------- presets ---------- */

  function updatePresetButtons() {
    const selected = $("presetList").value;
    $("presetApply").disabled = !selected;
    $("presetDelete").disabled = !selected;
  }

  function renderPresetOptions(selected = $("presetList").value) {
    const select = $("presetList");
    const names = presets.map((preset) => preset.name).sort((a, b) => a.localeCompare(b, "id"));
    select.innerHTML = "";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "— none selected —";
    select.append(none);
    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.append(option);
    }
    select.value = names.includes(selected) ? selected : "";
    updatePresetButtons();
  }

  function applyPresetSettings(preset) {
    Object.assign(settings, mergePreset(settings, preset));
    syncUI();
    api.syncQualityFromSettings();
    api.applyFraming();
    applyBackground();
    api.applyRenderScaleSetting();
    S.renderer.toneMappingExposure = settings.exposure;
    commit();
  }

  /* ---------- wiring ---------- */

  for (const btn of document.querySelectorAll(".tabs button")) {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      try {
        localStorage.setItem("litetuber.tab", activeTab);
      } catch {
        /* ignore */
      }
      applyTab(activeTab);
    });
  }

  $("pickVrm").addEventListener("click", () => $("vrmFile").click());
  $("vrmFile").addEventListener("change", (e) => {
    api.onVrmFile(e.target.files?.[0]);
    e.target.value = "";
  });

  $("clearVrm").addEventListener("click", async () => {
    await store.clearVrm().catch(() => {});
    fetch("/api/avatar", { method: "DELETE" }).catch(() => {});
    await api.switchToPlaceholder();
    $("vrmName").textContent = "no avatar yet";
    api.toast("Saved avatar removed");
  });

  $("camBtn").addEventListener("click", async () => {
    if (face.running) {
      api.stopCamera();
    } else {
      await api.startCamera();
    }
  });

  $("camDevice").addEventListener("change", async (e) => {
    settings.camDevice = e.target.value;
    commit();
    if (face.running) {
      api.stopCamera();
      await api.startCamera(settings.camDevice);
    }
  });

  $("micDevice").addEventListener("change", async (e) => {
    settings.micDevice = e.target.value;
    commit();
    if (mic.running) {
      api.micRetry.reset();
      mic.stop();
      S.micRunning = false;
      api.micUiOff();
      await api.startMic(settings.micDevice || null);
    }
  });
  $("micBtn").addEventListener("click", api.toggleMic);
  $("calBtn").addEventListener("click", api.calibrate);
  $("mouthTest").addEventListener("click", () => {
    S.mouthTestUntil = performance.now() + 1800;
    api.toast(
      "Expression test — if the avatar does not move, the model has no mouth expressions",
      3500,
    );
  });

  $("hideBtn").addEventListener("click", () => {
    settings.panelHidden = !settings.panelHidden;
    applyPanel();
    commit();
  });

  $("sens").addEventListener("input", (e) => {
    settings.sens = Number(e.target.value);
    $("sensOut").textContent = settings.sens.toFixed(2);
    commit();
  });
  $("smooth").addEventListener("input", (e) => {
    settings.smooth = Number(e.target.value);
    $("smoothOut").textContent = settings.smooth.toFixed(2);
    commit();
  });
  $("mirror").addEventListener("change", (e) => {
    settings.mirror = e.target.checked;
    commit();
  });
  for (const axis of ["x", "y", "z"]) {
    $(`inv${axis.toUpperCase()}`).addEventListener("change", (e) => {
      settings[`invert${axis.toUpperCase()}`] = e.target.checked;
      commit();
    });
  }

  $("delegate").addEventListener("change", (e) => {
    settings.delegate = e.target.value;
    face.delegate = settings.delegate;
    api.applyTrackScale();
    face.resetModel();
    commit();
    if (face.running) api.toast("Tracking processor changed — stop and start the camera");
  });

  $("micGain").addEventListener("input", (e) => {
    settings.micGain = Number(e.target.value);
    $("micGainOut").textContent = settings.micGain.toFixed(2);
    commit();
  });
  $("mouthSrc").addEventListener("change", (e) => {
    settings.mouthSrc = e.target.value;
    commit();
  });
  $("autoBlink").addEventListener("change", (e) => {
    settings.autoBlink = e.target.checked;
    commit();
  });
  for (const key of ["useHead", "useEyes", "useBlink", "useExpr", "useIdle", "useSpring"]) {
    $(key).addEventListener("change", (e) => {
      settings[key] = e.target.checked;
      commit();
    });
  }

  $("framing").addEventListener("change", (e) => {
    settings.framing = e.target.value;
    api.applyFraming();
    commit();
  });
  $("zoom").addEventListener("input", (e) => {
    settings.zoom = Number(e.target.value);
    $("zoomOut").textContent = settings.zoom.toFixed(2);
    api.applyFraming();
    commit();
  });
  $("exposure").addEventListener("input", (e) => {
    settings.exposure = Number(e.target.value);
    $("exposureOut").textContent = settings.exposure.toFixed(2);
    S.renderer.toneMappingExposure = settings.exposure;
    commit();
  });
  $("renderScale").addEventListener("change", (e) => {
    settings.renderScale = Number(e.target.value);
    api.syncQualityFromSettings();
    api.applyRenderScaleSetting();
    commit();
  });
  $("trackHz").addEventListener("change", (e) => {
    settings.trackHz = Number(e.target.value);
    quality.effTrackHz = settings.trackHz;
    api.applyTrackScale();
    commit();
  });
  $("fpsCap").addEventListener("change", (e) => {
    settings.fpsCap = Number(e.target.value);
    quality.fpsEma = 0;
    commit();
  });
  $("autoQuality").addEventListener("change", (e) => {
    settings.autoQuality = e.target.checked;
    api.syncQualityFromSettings();
    api.applyAutoScale();
    commit();
  });

  for (const btn of document.querySelectorAll("#bgChips button")) {
    btn.addEventListener("click", async () => {
      const bg = btn.dataset.bg;
      if (bg === "image") {
        $("bgFile").click();
        return;
      }
      settings.bg = bg;
      applyBackground();
      commit();
    });
  }

  $("bgFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      $("bgImage").style.backgroundImage = `url("${dataUrl}")`;
      settings.bg = "image";
      applyBackground();
      syncUI();
      commit();
      await store.saveBackground(dataUrl).catch(() => api.toast("Image is too large to save"));
      fetch("/api/background", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      }).catch(() => {});
    };
    reader.readAsDataURL(file);
  });

  $("presetList").addEventListener("change", updatePresetButtons);

  $("presetSave").addEventListener("click", () => {
    const name = normalizeName($("presetName").value) || $("presetList").value;
    const result = savePreset(presets, name, settings);
    if (result.error) {
      api.toast(result.error);
      return;
    }
    if (!store.savePresets(result.presets)) {
      api.toast("Could not save the preset. Is browser storage full?");
      return;
    }
    presets = result.presets;
    $("presetName").value = "";
    renderPresetOptions(result.preset.name);
    api.toast(
      result.replaced
        ? `Preset "${result.preset.name}" updated`
        : `Preset "${result.preset.name}" saved`,
    );
  });

  $("presetApply").addEventListener("click", () => {
    const name = $("presetList").value;
    const preset = presets.find((item) => item.name === name);
    if (!preset) {
      api.toast("Choose a preset first.");
      return;
    }
    applyPresetSettings(preset);
    if (settings.bg === "image" && !$("bgImage").style.backgroundImage) {
      api.toast(
        `Preset "${name}" applied. No background image yet; choose one in the Display tab.`,
        4200,
      );
    } else {
      api.toast(`Preset "${name}" applied`);
    }
  });

  $("presetDelete").addEventListener("click", () => {
    const name = $("presetList").value;
    if (!name) return;
    if (!window.confirm(`Delete preset "${name}"?`)) return;
    const next = deletePreset(presets, name);
    if (!store.savePresets(next)) {
      api.toast("Could not delete the preset.");
      return;
    }
    presets = next;
    renderPresetOptions("");
    api.toast(`Preset "${name}" deleted`);
  });

  $("presetExport").addEventListener("click", () => {
    if (!presets.length) {
      api.toast("No presets to export yet.");
      return;
    }
    const file = exportPresets(presets);
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `litetuber-preset-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    api.toast(`${file.presets.length} preset${file.presets.length === 1 ? "" : "s"} exported`);
  });

  $("presetImport").addEventListener("click", () => $("presetFile").click());
  $("presetFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      api.toast("File is not valid JSON.");
      return;
    }
    const result = importPresets(presets, payload);
    if (result.error) {
      api.toast(result.error);
      return;
    }
    if (!store.savePresets(result.presets)) {
      api.toast("Could not save the preset. Is browser storage full?");
      return;
    }
    presets = result.presets;
    renderPresetOptions("");
    const parts = [`${result.added} preset${result.added === 1 ? "" : "s"} imported`];
    if (result.skipped) parts.push(`${result.skipped} skipped because the name already exists`);
    if (result.dropped) parts.push(`${result.dropped} did not fit (max 24)`);
    api.toast(parts.join(", "), 4200);
  });

  renderPresetOptions("");

  setupProfiles({ $, toast: api.toast, flushSettings: api.flushSettings, reloadFromServer: api.reloadFromServer });

  $("obsBtn").addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}?ui=0`;
    try {
      await navigator.clipboard.writeText(url);
      api.toast(`OBS URL copied (display mode): ${url}`, 3200);
    } catch {
      api.toast(url, 6000);
    }
  });

  window.addEventListener("pointerdown", async () => {
    if (mic.running && mic.suspended) {
      const resumed = await mic.resume();
      if (resumed) api.toast("Mic audio resumed");
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const k = e.key.toLowerCase();
    if (k === "h") {
      settings.panelHidden = !settings.panelHidden;
      applyPanel();
      commit();
    } else if (k === "r") {
      api.calibrate();
    } else if (k === "f") {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    }
  });

  const dropZone = window;
  dropZone.addEventListener("dragover", (e) => e.preventDefault());
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file && /\.vrm$/i.test(file.name)) api.onVrmFile(file);
    else if (file && file.type.startsWith("image/")) {
      const dt = new DataTransfer();
      dt.items.add(file);
      $("bgFile").files = dt.files;
      $("bgFile").dispatchEvent(new Event("change"));
    }
  });

  return {
    applyPanel,
    applyTab,
    applyCurrentTab: () => applyTab(activeTab),
    applyBackground,
    syncUI,
    commit,
    applyPresetSettings,
  };
}
