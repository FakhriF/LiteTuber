import { describe, expect, it } from "vitest";
import { vowelWeights } from "../src/audio.js";

const closed = [0, 0, 0, 0, 0];

describe("vowelWeights", () => {
  it("produces silence when the level is zero", () => {
    const w = vowelWeights(0.5, 0.5, 0.5, 0.5, 0.5, 0);
    for (const value of Object.values(w)) expect(value).toBe(0);
  });

  it("produces no shape when every band is empty", () => {
    const w = vowelWeights(...closed, 1);
    for (const value of Object.values(w)) expect(value).toBeLessThan(0.05);
  });

  it("keeps every weight inside 0..1", () => {
    for (let i = 0; i <= 10; i++) {
      const s = i / 10;
      const w = vowelWeights(s, 1 - s, s * 0.5, 1 - s * 0.5, s, 1);
      for (const value of Object.values(w)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("scales with the input level", () => {
    const loud = vowelWeights(0.2, 0.8, 0.1, 0.1, 0.1, 1);
    const soft = vowelWeights(0.2, 0.8, 0.1, 0.1, 0.1, 0.4);
    expect(loud.aa).toBeGreaterThan(soft.aa);
  });

  it("opens the wide vowel for bright bands", () => {
    const w = vowelWeights(0.1, 0.1, 0.1, 1, 1, 1);
    expect(w.ee).toBeGreaterThan(w.ou);
    expect(w.ih).toBeGreaterThan(w.ou);
  });
});
