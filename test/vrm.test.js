import { describe, expect, it } from "vitest";
import { inspectVrm } from "../src/vrm.js";

const MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;

function glb(json) {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20);
  padded.set(text);
  const out = new Uint8Array(12 + 8 + padded.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, padded.length, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(padded, 20);
  return out;
}

function rawJson(bytes) {
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(0x20);
  padded.set(bytes);
  const out = new Uint8Array(12 + 8 + padded.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, padded.length, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(padded, 20);
  return out;
}

describe("inspectVrm", () => {
  it("accepts a VRM 1.0 GLB and reads its title", () => {
    const file = glb({ extensions: { VRMC_vrm: { meta: { name: "Ava" } } } });
    expect(inspectVrm(file)).toEqual({ ok: true, title: "Ava" });
  });

  it("accepts legacy VRM 0.x files", () => {
    const file = glb({ extensions: { VRM: { meta: { title: "Old" } } } });
    expect(inspectVrm(file)).toMatchObject({ ok: true, title: "Old" });
  });

  it("falls back to extensionsUsed", () => {
    const file = glb({ extensionsUsed: ["VRMC_vrm"], extensions: {} });
    expect(inspectVrm(file).ok).toBe(true);
  });

  it("asks for more bytes while the JSON chunk is incomplete", () => {
    const full = glb({ extensions: { VRMC_vrm: { meta: { name: "Ava" } } } });
    const result = inspectVrm(full.slice(0, 24));
    expect(result).toEqual({ ok: false, needMore: true });
  });

  it("rejects a non-GLB file", () => {
    const result = inspectVrm(new Uint8Array(64));
    expect(result.ok).toBe(false);
    expect(result.needMore).toBe(false);
  });

  it("rejects glTF version 1", () => {
    const bad = new Uint8Array(32);
    const view = new DataView(bad.buffer);
    view.setUint32(0, MAGIC, true);
    view.setUint32(4, 1, true);
    expect(inspectVrm(bad)).toMatchObject({ ok: false, needMore: false });
  });

  it("rejects a GLB without a VRM extension", () => {
    const file = glb({ asset: { version: "2.0" }, extensions: {} });
    const result = inspectVrm(file);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/VRM/);
  });

  it("rejects a corrupt JSON chunk", () => {
    const result = inspectVrm(rawJson(new TextEncoder().encode("{not json")));
    expect(result.ok).toBe(false);
    expect(result.needMore).toBe(false);
  });
});
