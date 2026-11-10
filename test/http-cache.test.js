import { describe, expect, it } from "vitest";
import { etagMatches, fileSignature, makeEtag } from "../src/http-cache.js";

describe("fileSignature", () => {
  it("combines mtime and size", () => {
    expect(fileSignature({ exists: true, mtimeMs: 1234.6, size: 99 })).toBe("1235-99");
  });

  it("accepts the server's rounded mtime field", () => {
    expect(fileSignature({ exists: true, mtime: 1234, size: 99 })).toBe("1234-99");
  });

  it("treats a missing file as zero", () => {
    expect(fileSignature({ exists: false })).toBe("0");
    expect(fileSignature(null)).toBe("0");
  });
});

describe("makeEtag", () => {
  it("quotes the parts", () => {
    expect(makeEtag(7, { exists: true, mtimeMs: 10, size: 2 })).toBe('"7.10-2"');
  });

  it("changes when a part changes", () => {
    const a = makeEtag(1, { exists: true, mtimeMs: 10, size: 2 });
    const b = makeEtag(2, { exists: true, mtimeMs: 10, size: 2 });
    expect(a).not.toBe(b);
  });
});

describe("etagMatches", () => {
  const tag = '"abc"';

  it("matches the exact tag", () => {
    expect(etagMatches(tag, tag)).toBe(true);
  });

  it("matches inside a list", () => {
    expect(etagMatches('"x", "abc", "y"', tag)).toBe(true);
  });

  it("ignores the weak prefix", () => {
    expect(etagMatches('W/"abc"', tag)).toBe(true);
  });

  it("rejects a different tag or no header", () => {
    expect(etagMatches('"other"', tag)).toBe(false);
    expect(etagMatches(undefined, tag)).toBe(false);
  });
});
