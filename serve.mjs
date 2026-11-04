import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "dist");
const dataDir = path.join(here, "data");
const statePath = path.join(dataDir, "state.json");
const avatarPath = path.join(dataDir, "avatar.vrm");
const bgPath = path.join(dataDir, "background.json");
const port = Number(process.env.PORT || 8770);

fs.mkdirSync(dataDir, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".vrm": "application/octet-stream",
};

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("too large"), { code: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readState() {
  try {
    const raw = await fsp.readFile(statePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return { settings: null, avatarName: "" };
  }
}

async function statInfo(file) {
  try {
    const st = await fsp.stat(file);
    return { exists: true, mtime: Math.round(st.mtimeMs), size: st.size };
  } catch {
    return { exists: false, mtime: 0, size: 0 };
  }
}

async function handleApi(req, res, pathname, query) {
  if (pathname === "/api/state" && req.method === "GET") {
    const state = await readState();
    const avatar = await statInfo(avatarPath);
    const bg = await statInfo(bgPath);
    sendJson(res, 200, {
      settings: state.settings || null,
      avatarName: state.avatarName || "",
      avatarExists: avatar.exists,
      avatarMtime: avatar.mtime,
      bgExists: bg.exists,
      bgMtime: bg.mtime,
    });
    return true;
  }

  if (pathname === "/api/state" && req.method === "PUT") {
    try {
      const body = JSON.parse((await readBody(req, 1024 * 1024)).toString("utf8"));
      const state = await readState();
      if (body.settings && typeof body.settings === "object") state.settings = body.settings;
      if (typeof body.avatarName === "string") state.avatarName = body.avatarName;
      await fsp.writeFile(statePath, JSON.stringify(state, null, 2));
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, err.code === 413 ? 413 : 400, { error: String(err.message || err) });
    }
    return true;
  }

  if (pathname === "/api/avatar" && req.method === "GET") {
    const info = await statInfo(avatarPath);
    if (!info.exists) {
      sendJson(res, 404, { error: "no avatar" });
      return true;
    }
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": info.size,
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    fs.createReadStream(avatarPath).pipe(res);
    return true;
  }

  if (pathname === "/api/avatar" && req.method === "PUT") {
    try {
      const buffer = await readBody(req, 300 * 1024 * 1024);
      await fsp.writeFile(avatarPath, buffer);
      const state = await readState();
      state.avatarName = query.get("name") || "avatar";
      await fsp.writeFile(statePath, JSON.stringify(state, null, 2));
      sendJson(res, 200, { ok: true, name: state.avatarName });
    } catch (err) {
      sendJson(res, err.code === 413 ? 413 : 500, { error: String(err.message || err) });
    }
    return true;
  }

  if (pathname === "/api/avatar" && req.method === "DELETE") {
    await fsp.rm(avatarPath, { force: true });
    const state = await readState();
    state.avatarName = "";
    await fsp.writeFile(statePath, JSON.stringify(state, null, 2));
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/background" && req.method === "GET") {
    try {
      const raw = await fsp.readFile(bgPath, "utf8");
      sendJson(res, 200, JSON.parse(raw));
    } catch {
      sendJson(res, 404, { error: "no background" });
    }
    return true;
  }

  if (pathname === "/api/background" && req.method === "PUT") {
    try {
      const raw = await readBody(req, 25 * 1024 * 1024);
      const parsed = JSON.parse(raw.toString("utf8"));
      if (typeof parsed.dataUrl !== "string") throw new Error("dataUrl required");
      await fsp.writeFile(bgPath, JSON.stringify({ dataUrl: parsed.dataUrl }));
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, err.code === 413 ? 413 : 400, { error: String(err.message || err) });
    }
    return true;
  }

  if (pathname === "/api/background" && req.method === "DELETE") {
    await fsp.rm(bgPath, { force: true });
    sendJson(res, 200, { ok: true });
    return true;
  }

  sendJson(res, 404, { error: "not found" });
  return true;
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(parsed.pathname);

  if (pathname.startsWith("/api/")) {
    try {
      await handleApi(req, res, pathname, parsed.searchParams);
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: String(err.message || err) });
      else res.end();
    }
    return;
  }

  const filePath = path.join(root, pathname === "/" ? "index.html" : pathname);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || stat.isDirectory()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=3600",
      "access-control-allow-origin": "*",
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log("");
  console.log("  LiteTuber siap");
  console.log(`  Buka di browser : http://127.0.0.1:${port}/`);
  console.log(`  URL untuk OBS   : http://127.0.0.1:${port}/?ui=0`);
  console.log(`  Data tersimpan  : ${dataDir}`);
  console.log("");
  console.log("  Ctrl+C untuk berhenti");
});
