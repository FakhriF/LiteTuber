// Small helpers for conditional GETs. The state endpoint uses them so clients
// can poll with If-None-Match and skip parsing an unchanged payload.

export function fileSignature(info) {
  if (!info || !info.exists) return "0";
  const mtime = info.mtimeMs ?? info.mtime ?? 0;
  return `${Math.round(mtime)}-${info.size ?? 0}`;
}

/** Builds a quoted strong ETag from numbers/strings or statInfo objects. */
export function makeEtag(...parts) {
  const body = parts
    .map((part) => (part && typeof part === "object" ? fileSignature(part) : String(part)))
    .join(".");
  return `"${body}"`;
}

/** Handles a comma-separated If-None-Match header, including weak W/ tags. */
export function etagMatches(header, etag) {
  if (!header) return false;
  return header.split(",").some((part) => part.trim().replace(/^W\//, "") === etag);
}
