import { describe, expect, it } from "vitest";
import { normalizePoseMessage } from "../src/pose-protocol.js";

describe("normalizePoseMessage", () => {
  it("accepts the panel frame and rounds values", () => {
    const pose = normalizePoseMessage({
      t: "pose",
      w: { aa: 0.5, blinkLeft: 0.123456, unknown: 4 },
      head: [0.1, 0.2, 0.3, 0.987654],
    });
    expect(pose).not.toBeNull();
    expect(pose.w.aa).toBe(0.5);
    expect(pose.w.blinkLeft).toBe(0.123);
    expect(pose.w.unknown).toBeUndefined();
    expect(pose.head).toEqual([0.1, 0.2, 0.3, 0.9877]);
  });

  it("rejects malformed frames", () => {
    expect(normalizePoseMessage(null)).toBeNull();
    expect(normalizePoseMessage({ t: "other", w: {} })).toBeNull();
    expect(normalizePoseMessage({ t: "pose", w: { aa: -1 } })).toBeNull();
    expect(normalizePoseMessage({ t: "pose", w: { aa: NaN } })).toBeNull();
    expect(normalizePoseMessage({ t: "pose", w: { aa: 2 } })).toBeNull();
    expect(normalizePoseMessage({ t: "pose", w: {}, head: [1, 2, 3] })).toBeNull();
    expect(normalizePoseMessage({ t: "pose", w: {}, head: [1, 2, 3, "4"] })).toBeNull();
  });

  it("accepts a head-only frame", () => {
    const pose = normalizePoseMessage({ t: "pose", w: {}, head: [0, 0, 0, 1] });
    expect(pose).not.toBeNull();
    expect(pose.head).toEqual([0, 0, 0, 1]);
  });
});
