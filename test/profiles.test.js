import { describe, expect, it } from "vitest";
import { MAX_PROFILE_NAME, describeProfile, normalizeProfileName } from "../src/profiles.js";

describe("normalizeProfileName", () => {
  it("collapses spaces and trims", () => {
    expect(normalizeProfileName("  Siang   santai ")).toBe("Siang santai");
  });

  it("caps the name length", () => {
    expect(normalizeProfileName("x".repeat(80))).toHaveLength(MAX_PROFILE_NAME);
  });

  it("handles empty and missing values", () => {
    expect(normalizeProfileName(null)).toBe("");
    expect(normalizeProfileName("   ")).toBe("");
  });
});

describe("describeProfile", () => {
  it("marks which assets a profile holds", () => {
    expect(describeProfile({ name: "Siang", hasAvatar: true, hasBackground: true })).toBe(
      "Siang · avatar + latar",
    );
    expect(describeProfile({ name: "Siang", hasAvatar: true, hasBackground: false })).toBe(
      "Siang · avatar",
    );
    expect(describeProfile({ name: "Siang", hasAvatar: false, hasBackground: false })).toBe("Siang");
  });
});
