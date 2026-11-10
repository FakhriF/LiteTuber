import { afterEach, describe, expect, it } from "vitest";
import { defaults, loadSettings } from "../src/store.js";

function fakeStorage(raw) {
  return {
    getItem: () => raw,
    setItem: () => {},
    removeItem: () => {},
  };
}

afterEach(() => {
  delete globalThis.localStorage;
});

describe("loadSettings", () => {
  it("has auto quality on by default", () => {
    expect(defaults.autoQuality).toBe(true);
  });

  it("returns defaults when nothing is stored", () => {
    globalThis.localStorage = fakeStorage(null);
    expect(loadSettings()).toEqual(defaults);
  });

  it("merges stored values over defaults", () => {
    globalThis.localStorage = fakeStorage(
      JSON.stringify({ renderScale: 0.5, autoQuality: false }),
    );
    const settings = loadSettings();
    expect(settings.renderScale).toBe(0.5);
    expect(settings.autoQuality).toBe(false);
    expect(settings.fpsCap).toBe(defaults.fpsCap);
  });

  it("ignores corrupt stored JSON", () => {
    globalThis.localStorage = fakeStorage("{oops");
    expect(loadSettings()).toEqual(defaults);
  });
});
