import { afterEach, describe, expect, it, vi } from "vitest";
import { setupProfiles } from "../src/profiles.js";

function fakeElement(value = "") {
  const listeners = {};
  const el = {
    value,
    innerHTML: "",
    textContent: "",
    disabled: false,
    children: [],
    files: [],
    append(child) {
      el.children.push(child);
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    async fire(type, event = {}) {
      for (const fn of listeners[type] || []) await fn(event);
    },
    async click() {
      await el.fire("click");
    },
  };
  return el;
}

function panel() {
  const ids = {
    profileList: fakeElement(""),
    profileName: fakeElement(""),
    profileSave: fakeElement(),
    profileApply: fakeElement(),
    profileDelete: fakeElement(),
  };
  return {
    $: (id) => ids[id],
    ids,
  };
}

function installDocument() {
  globalThis.document = {
    createElement: () => ({ value: "", textContent: "" }),
  };
}

afterEach(() => {
  delete globalThis.fetch;
  delete globalThis.document;
  delete globalThis.window;
  vi.restoreAllMocks();
});

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("profile panel", () => {
  it("lists profiles with their asset marks", async () => {
    installDocument();
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        profiles: [{ id: "p1", name: "Siang", hasAvatar: true, hasBackground: false }],
      }),
    });
    const { $, ids } = panel();
    setupProfiles({ $, toast: () => {}, flushSettings: async () => {}, reloadFromServer: async () => {} });
    await flush();
    expect(ids.profileList.children).toHaveLength(2);
    expect(ids.profileList.children[1].value).toBe("p1");
    expect(ids.profileList.children[1].textContent).toBe("Siang · avatar");
  });

  it("saves the latest settings before creating a profile", async () => {
    installDocument();
    const calls = [];
    let order = 0;
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET", order: order++ });
      if (url === "/api/profiles" && options.method === "POST") {
        return {
          ok: true,
          json: async () => ({ ok: true, replaced: false, profile: { id: "p9", name: "Malam" } }),
        };
      }
      return { ok: true, json: async () => ({ profiles: [] }) };
    };
    const { $, ids } = panel();
    const toast = vi.fn();
    setupProfiles({ $, toast, flushSettings: async () => { calls.push({ url: "flush", order: order++ }); }, reloadFromServer: async () => {} });
    await flush();

    ids.profileName.value = " Malam ";
    await ids.profileSave.click();
    await flush();

    const post = calls.find((call) => call.method === "POST");
    expect(post.url).toBe("/api/profiles");
    expect(calls.find((call) => call.url === "flush").order).toBeLessThan(post.order);
    expect(toast).toHaveBeenCalledWith('Profil "Malam" disimpan');
  });

  it("applies and reloads the active assets", async () => {
    installDocument();
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET" });
      if (url === "/api/profiles/p1/apply") {
        return { ok: true, json: async () => ({ ok: true, name: "Siang" }) };
      }
      return {
        ok: true,
        json: async () => ({
          profiles: [{ id: "p1", name: "Siang", hasAvatar: true, hasBackground: true }],
        }),
      };
    };
    const { $, ids } = panel();
    const toast = vi.fn();
    const reload = vi.fn(async () => {});
    setupProfiles({ $, toast, flushSettings: async () => {}, reloadFromServer: reload });
    await flush();
    ids.profileList.value = "p1";

    await ids.profileApply.click();
    await flush();

    expect(calls.some((call) => call.url === "/api/profiles/p1/apply")).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith('Profil "Siang" diterapkan');
  });

  it("deletes after confirmation", async () => {
    installDocument();
    globalThis.window = { confirm: () => true };
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET" });
      if (options.method === "DELETE") return { ok: true, json: async () => ({ ok: true }) };
      return {
        ok: true,
        json: async () => ({
          profiles: [{ id: "p1", name: "Siang", hasAvatar: false, hasBackground: false }],
        }),
      };
    };
    const { $, ids } = panel();
    const toast = vi.fn();
    setupProfiles({ $, toast, flushSettings: async () => {}, reloadFromServer: async () => {} });
    await flush();
    ids.profileList.value = "p1";

    await ids.profileDelete.click();
    await flush();

    expect(calls.some((call) => call.method === "DELETE" && call.url === "/api/profiles/p1")).toBe(
      true,
    );
    expect(toast).toHaveBeenCalledWith('Profil "Siang" dihapus');
  });
});
