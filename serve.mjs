import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectVrm } from "./src/vrm.js";
import { etagMatches, makeEtag } from "./src/http-cache.js";
import { normalizePoseMessage } from "./src/pose-protocol.js";
import { WebSocketServer } from "ws";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "dist");
const dataDir = path.join(here, "data");
const statePath = path.join(dataDir, "state.json");
const avatarPath = path.join(dataDir, "avatar.vrm");
const bgPath = path.join(dataDir, "background.json");
const port = Number(process.env.PORT || 8770);

// The server is local-only, but any website open in the same browser can still
// reach 127.0.0.1. Lock the Host header (DNS rebinding) and reflect only
// origins that belong to this server.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function hostAllowed(req) {
  try {
    return LOCAL_HOSTS.has(new URL(`http://${req.headers.host || ""}`).hostname);
  } catch {
    return false;
  }
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    const expected = Number(u.port || (u.protocol === "https:" ? 443 : 80));
    return LOCAL_HOSTS.has(u.hostname) && expected === port;
  } catch {
    return false;
  }
}


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

function sendJson(res, code, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
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

// Streams straight to disk so a large VRM never sits fully in memory.
// `validate`, when given, is called with the growing prefix of the body until it
// returns ok. Nothing is renamed into place until that check passes.
async function writeFileLimited(req, file, limit, validate) {
  const tmp = `${file}.part`;
  const out = fs.createWriteStream(tmp);
  let size = 0;
  let prefix = validate ? Buffer.alloc(0) : null;
  let validated = !validate;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw Object.assign(new Error("too large"), { code: 413 });

      if (!validated) {
        prefix = Buffer.concat([prefix, chunk]);
        const check = validate(prefix);
        if (check.ok) {
          validated = true;
          prefix = null;
        } else if (!check.needMore) {
          throw Object.assign(new Error(check.reason || "invalid avatar"), { code: 415 });
        } else if (prefix.length > 20 * 1024 * 1024) {
          throw Object.assign(new Error("header avatar terlalu besar"), { code: 415 });
        }
      }

      if (!out.write(chunk)) {
        await new Promise((resolve, reject) => {
          out.once("drain", resolve);
          out.once("error", reject);
        });
      }
    }
    if (!validated) {
      const check = validate(prefix);
      if (!check.ok) {
        throw Object.assign(new Error(check.reason || "avatar tidak lengkap"), { code: 415 });
      }
    }
    await new Promise((resolve, reject) => {
      out.once("error", reject);
      out.end(resolve);
    });
    await fsp.rename(tmp, file);
    return size;
  } catch (err) {
    out.destroy();
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

async function readState() {
  try {
    const raw = await fsp.readFile(statePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return { settings: null, avatarName: "" };
  }
}

// Serializes read-modify-write so two quick settings saves cannot interleave.
// Writes go through a temp file and rename, so readers never see half a file.
let stateQueue = Promise.resolve();
let dataRevision = 0;
function updateState(mutate) {
  const run = stateQueue.then(async () => {
    const state = await readState();
    const next = (await mutate(state)) || state;
    const tmp = `${statePath}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(next, null, 2));
    await fsp.rename(tmp, statePath);
    dataRevision++;
    return next;
  });
  stateQueue = run.catch(() => {});
  return run;
}

// Atomic write for small JSON files. Bumping the revision makes the state ETag
// change even when two writes land in the same millisecond at the same size.
async function writeDataFile(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
  dataRevision++;
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
    const avatar = await statInfo(avatarPath);
    const bg = await statInfo(bgPath);
    const stateInfo = await statInfo(statePath);
    const etag = makeEtag(dataRevision, stateInfo, avatar, bg);

    if (etagMatches(req.headers["if-none-match"], etag)) {
      res.writeHead(304, { etag, "cache-control": "no-store" });
      res.end();
      return true;
    }

    const state = await readState();
    sendJson(
      res,
      200,
      {
        settings: state.settings || null,
        avatarName: state.avatarName || "",
        avatarExists: avatar.exists,
        avatarMtime: avatar.mtime,
        bgExists: bg.exists,
        bgMtime: bg.mtime,
      },
      { etag },
    );
    return true;
  }

  if (pathname === "/api/state" && req.method === "PUT") {
    try {
      const body = JSON.parse((await readBody(req, 1024 * 1024)).toString("utf8"));
      await updateState((state) => {
        if (body.settings && typeof body.settings === "object") state.settings = body.settings;
        if (typeof body.avatarName === "string") state.avatarName = body.avatarName;
        return state;
      });
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
    });
    fs.createReadStream(avatarPath).pipe(res);
    return true;
  }

  if (pathname === "/api/avatar" && req.method === "PUT") {
    try {
      await writeFileLimited(req, avatarPath, 300 * 1024 * 1024, inspectVrm);
      await updateState((state) => {
        state.avatarName = query.get("name") || "avatar";
        return state;
      });
      sendJson(res, 200, { ok: true, name: query.get("name") || "avatar" });
    } catch (err) {
      const code = err.code === 413 || err.code === 415 ? err.code : 500;
      sendJson(res, code, { error: String(err.message || err) });
    }
    return true;
  }

  if (pathname === "/api/avatar" && req.method === "DELETE") {
    await fsp.rm(avatarPath, { force: true });
    await updateState((state) => {
      state.avatarName = "";
      return state;
    });
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
      await writeDataFile(bgPath, JSON.stringify({ dataUrl: parsed.dataUrl }));
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, err.code === 413 ? 413 : 400, { error: String(err.message || err) });
    }
    return true;
  }

  if (pathname === "/api/background" && req.method === "DELETE") {
    await fsp.rm(bgPath, { force: true });
    dataRevision++;
    sendJson(res, 200, { ok: true });
    return true;
  }

  sendJson(res, 404, { error: "not found" });
  return true;
}

const server = http.createServer(async (req, res) => {
  if (!hostAllowed(req)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden host");
    return;
  }
  const origin = req.headers.origin;
  if (origin && !originAllowed(req)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden origin");
    return;
  }
  if (origin) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-methods": "GET,PUT,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "600",
    });
    res.end();
    return;
  }

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
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

/* ---------- live pose relay ---------- */
// The OBS source cannot open the panel's camera, so the panel streams its
// smoothed pose here and every viewer mirrors it. Display only; no state write.
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
const panels = new Set();
const viewers = new Set();

function wsSend(ws, payload) {
  try {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  } catch {
    /* the socket is going away */
  }
}

wss.on("connection", (ws, req, role) => {
  ws.isAlive = true;
  ws.role = role;
  ws.rateWindow = 0;
  ws.rateCount = 0;
  (role === "panel" ? panels : viewers).add(ws);

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (data) => {
    if (ws.role !== "panel") return;
    // A panel should send ~33 messages per second. A broken or hostile client
    // must not be able to spin the server or flood OBS.
    const now = Date.now();
    if (now - ws.rateWindow > 1000) {
      ws.rateWindow = now;
      ws.rateCount = 0;
    }
    ws.rateCount += 1;
    if (ws.rateCount > 120) return;

    let parsed;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      return;
    }
    const pose = normalizePoseMessage(parsed);
    if (!pose) return;
    const frame = JSON.stringify(pose);
    for (const viewer of viewers) wsSend(viewer, frame);
  });

  const drop = () => {
    panels.delete(ws);
    viewers.delete(ws);
  };
  ws.on("close", drop);
  ws.on("error", drop);
});

const heartbeat = setInterval(() => {
  for (const ws of [...panels, ...viewers]) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }
}, 30000);
heartbeat.unref();

server.on("upgrade", (req, socket, head) => {
  let role = "";
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/ws/pose") throw new Error("not a pose socket");
    role = url.searchParams.get("role") === "viewer" ? "viewer" : "panel";
  } catch {
    socket.destroy();
    return;
  }
  if (!hostAllowed(req) || !originAllowed(req)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req, role);
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
