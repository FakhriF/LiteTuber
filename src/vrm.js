// Shared GLB/VRM header inspection. Used by the browser before a file is loaded
// and by the server while an upload streams in, so both sides agree on what
// counts as a usable avatar.
//
// A .vrm file is a GLB container: 12-byte header ("glTF", version 2, length)
// followed by a JSON chunk. The VRM data lives in that JSON under the `VRM`
// (VRM 0.x) or `VRMC_vrm` (VRM 1.0) extension.

const GLB_MAGIC = 0x46546c67; // "glTF" read as little-endian uint32
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const MAX_JSON_CHUNK = 16 * 1024 * 1024;

function fail(reason) {
  return { ok: false, needMore: false, reason };
}

/**
 * @param {Uint8Array} bytes Bytes from the start of the file.
 * @returns {{ok: true, title: string} | {ok: false, needMore: boolean, reason?: string}}
 *   `needMore` means the buffer is still too short to decide, not that it is bad.
 */
export function inspectVrm(bytes) {
  if (!bytes || bytes.length < 12) return { ok: false, needMore: true };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) return fail("not a GLB file");
  if (view.getUint32(4, true) !== 2) return fail("glTF version is not 2");
  if (bytes.length < 20) return { ok: false, needMore: true };

  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON) return fail("first chunk is not JSON");
  if (jsonLength === 0) return fail("JSON chunk is empty");
  if (jsonLength > MAX_JSON_CHUNK) return fail("JSON chunk is too large");
  if (bytes.length < 20 + jsonLength) return { ok: false, needMore: true };

  let json;
  try {
    const text = new TextDecoder()
      .decode(bytes.subarray(20, 20 + jsonLength))
      .replace(/\0+$/, "")
      .trim();
    json = JSON.parse(text);
  } catch {
    return fail("avatar JSON is corrupted");
  }

  const extensions = json?.extensions || {};
  const used = Array.isArray(json?.extensionsUsed) ? json.extensionsUsed : [];
  const isVrm = extensions.VRM || extensions.VRMC_vrm || used.includes("VRM") || used.includes("VRMC_vrm");
  if (!isVrm) return fail("no VRM data");

  const meta = extensions.VRMC_vrm?.meta || extensions.VRM?.meta || {};
  return { ok: true, title: String(meta.name || meta.title || "") };
}
