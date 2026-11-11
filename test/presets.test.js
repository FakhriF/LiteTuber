import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_PRESETS,
  deletePreset,
  mergePreset,
  normalizeName,
  pickPreset,
  sanitizePresets,
  savePreset,
} from "../src/presets.js";
import { loadPresets, savePresets } from "../src/store.js";

function fakeStorage(raw = null) {
  let value = raw;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    removeItem: () => {
      value = null;
    },
    read: () => value,
  };
}

afterEach(() => {
  delete globalThis.localStorage;
});

const sample = {
  bg: "green",
  framing: "full",
  zoom: 1.4,
  exposure: 1.2,
  sens: 1.3,
  smooth: 0.5,
  mirror: false,
  mouthSrc: "mic",
  micGain: 1.5,
  renderScale: 0.75,
  fpsCap: 30,
  trackHz: 20,
  autoQuality: false,
  // Not part of a preset.
  camDevice: "cam-1",
  micDevice: "mic-1",
  panelHidden: true,
  useHead: false,
};

describe("preset fields", () => {
  it("keeps only display and tracking settings", () => {
    const picked = pickPreset(sample);
    expect(picked).toEqual({
      bg: "green",
      framing: "full",
      zoom: 1.4,
      exposure: 1.2,
      sens: 1.3,
      smooth: 0.5,
      mirror: false,
      mouthSrc: "mic",
      micGain: 1.5,
      renderScale: 0.75,
      fpsCap: 30,
      trackHz: 20,
      autoQuality: false,
    });
    expect(picked.camDevice).toBeUndefined();
    expect(picked.panelHidden).toBeUndefined();
  });

  it("ignores non-scalar values", () => {
    expect(pickPreset({ framing: "bust", bg: { url: "x" }, zoom: null })).toEqual({
      framing: "bust",
    });
  });

  it("normalizes names and caps their length", () => {
    expect(normalizeName("  Siang   santai ")).toBe("Siang santai");
    expect(normalizeName("x".repeat(60))).toHaveLength(32);
    expect(normalizeName(undefined)).toBe("");
  });
});

describe("savePreset", () => {
  it("adds a named preset with only preset settings", () => {
    const result = savePreset([], "Siang", sample, 1000);
    expect(result.error).toBeUndefined();
    expect(result.presets).toHaveLength(1);
    expect(result.presets[0].name).toBe("Siang");
    expect(result.presets[0].ts).toBe(1000);
    expect(result.presets[0].settings.camDevice).toBeUndefined();
  });

  it("replaces an existing preset with the same name, ignoring case", () => {
    const first = savePreset([], "Siang", sample, 1000);
    const second = savePreset(first.presets, "siang", { ...sample, sens: 2 }, 2000);
    expect(second.replaced).toBe(true);
    expect(second.presets).toHaveLength(1);
    expect(second.presets[0].name).toBe("siang");
    expect(second.presets[0].settings.sens).toBe(2);
  });

  it("rejects an empty name", () => {
    const result = savePreset([], "   ", sample);
    expect(result.error).toBeTruthy();
    expect(result.presets).toEqual([]);
  });

  it("drops the oldest preset when the list is full", () => {
    let list = [];
    for (let i = 0; i < MAX_PRESETS; i += 1) {
      list = savePreset(list, `Preset ${i}`, { ...sample, sens: i }, i).presets;
    }
    const result = savePreset(list, "Terbaru", sample, MAX_PRESETS);
    expect(result.presets).toHaveLength(MAX_PRESETS);
    expect(result.presets.some((preset) => preset.name === "Preset 0")).toBe(false);
    expect(result.presets.at(-1).name).toBe("Terbaru");
  });
});

describe("sanitizePresets", () => {
  it("throws away corrupt entries and duplicate names", () => {
    const list = sanitizePresets([
      null,
      { name: "", settings: { sens: 1 } },
      { name: "Siang", settings: { sens: 1 } },
      { name: "siang", settings: { sens: 2 } },
      { name: "Malam", settings: {} },
      { name: "Pagi", settings: { sens: 0.7 } },
    ]);
    expect(list.map((preset) => preset.name)).toEqual(["Siang", "Pagi"]);
  });

  it("returns an empty list for non-arrays", () => {
    expect(sanitizePresets(null)).toEqual([]);
    expect(sanitizePresets({})).toEqual([]);
  });
});

describe("deletePreset and mergePreset", () => {
  it("deletes by name and leaves the rest", () => {
    const list = sanitizePresets([
      { name: "Siang", settings: { sens: 1 } },
      { name: "Malam", settings: { sens: 0.5 } },
    ]);
    expect(deletePreset(list, "siang").map((preset) => preset.name)).toEqual(["Malam"]);
  });

  it("merges preset fields over current settings", () => {
    const merged = mergePreset({ sens: 1, camDevice: "cam-1" }, { name: "Siang", settings: sample });
    expect(merged.sens).toBe(1.3);
    expect(merged.framing).toBe("full");
    expect(merged.camDevice).toBe("cam-1");
  });

  it("ignores an invalid preset", () => {
    const settings = { sens: 1 };
    expect(mergePreset(settings, null)).toEqual(settings);
    expect(mergePreset(settings, { name: "", settings: { sens: 2 } })).toEqual(settings);
  });
});

describe("preset storage", () => {
  it("round-trips presets through localStorage", () => {
    const storage = fakeStorage();
    globalThis.localStorage = storage;
    expect(loadPresets()).toEqual([]);
    expect(savePresets([{ name: "Siang", settings: { sens: 1.1 }, ts: 5 }])).toBe(true);
    const loaded = loadPresets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("Siang");
  });

  it("returns an empty list for corrupt stored JSON", () => {
    globalThis.localStorage = fakeStorage("{oops");
    expect(loadPresets()).toEqual([]);
  });
});
