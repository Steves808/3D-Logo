// Logo 3D Together - server
// One small Node program: serves the page and referees the shared rooms over a WebSocket.
//
//   node server.js                 -> http://localhost:3000   (fine for testing on one PC)
//   On the VPS it finds the Let's Encrypt certificate by itself and serves https.
//
// Settings (all optional, as environment variables):
//   PORT=3000   LOGO_CERT=/path/fullchain.pem   LOGO_KEY=/path/privkey.pem   LOGO_HTTP=1 (force plain http)

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { newRoomState, applyOp, publicState, LIMITS, PLAYER_NAMES, PLAYER_COLORS } from "./public/js/state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");
const PORT = Number(process.env.PORT) || 3000;
const SAVE_FILE = process.env.LOGO_SAVE || path.join(__dirname, "rooms.json");
const MAX_ROOMS = 60;

// ---------- http / https ----------
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".md": "text/plain; charset=utf-8"
};

function serveStatic(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname); }
  catch (e) { res.writeHead(400); res.end("Bad request"); return; }
  if (urlPath === "/status") {
    const rooms = [...ROOMS.values()].map(r => ({ room: r.name, players: r.clients.size, lines: r.state.doc.lines.length, rev: r.state.doc.rev }));
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()), rooms }, null, 1));
    return;
  }
  if (urlPath.endsWith("/")) urlPath += "index.html";
  const file = path.normalize(path.join(PUBLIC, urlPath));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); return; }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": st.size,
      // always re-check with the server, so a new upload shows up without clearing the browser cache
      "Cache-Control": "no-cache"
    });
    if (req.method === "HEAD") { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

function findCert() {
  if (process.env.LOGO_HTTP) return null;
  const pairs = [];
  if (process.env.LOGO_CERT && process.env.LOGO_KEY) pairs.push([process.env.LOGO_CERT, process.env.LOGO_KEY]);
  pairs.push(["/etc/letsencrypt/live/elekah.com/fullchain.pem", "/etc/letsencrypt/live/elekah.com/privkey.pem"]);
  for (const [cert, key] of pairs) {
    try { return { cert: fs.readFileSync(cert, "utf8"), key: fs.readFileSync(key, "utf8"), from: cert }; }
    catch (e) { /* try the next one */ }
  }
  return null;
}

const cert = findCert();
const server = cert ? https.createServer({ cert: cert.cert, key: cert.key }, serveStatic) : http.createServer(serveStatic);

// ---------- rooms ----------
const ROOMS = new Map();   // name -> { name, state, clients:Map(id->client), dirty, used }
let nextId = 1;
let dirty = false;

function cleanRoomName(s) {
  s = String(s || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
  return s || "main";
}

function getRoom(name) {
  let r = ROOMS.get(name);
  if (!r) {
    if (ROOMS.size >= MAX_ROOMS) {       // forget the longest-unused empty room
      let old = null;
      for (const x of ROOMS.values()) if (!x.clients.size && (!old || x.used < old.used)) old = x;
      if (old) ROOMS.delete(old.name);
    }
    r = { name, state: newRoomState(), clients: new Map(), used: Date.now() };
    ROOMS.set(name, r);
  }
  r.used = Date.now();
  return r;
}

function loadRooms() {
  try {
    const data = JSON.parse(fs.readFileSync(SAVE_FILE, "utf8"));
    for (const [name, saved] of Object.entries(data.rooms || {})) {
      const st = newRoomState();
      if (saved.doc && Array.isArray(saved.doc.lines)) {
        st.doc.lines = saved.doc.lines.filter(l => l && typeof l.t === "string").slice(0, LIMITS.maxLines).map(l => ({ t: l.t, by: Number(l.by) || 0 }));
        st.doc.seed = Number(saved.doc.seed) || st.doc.seed;
        st.doc.rev = Number(saved.doc.rev) || 0;
      }
      if (saved.sliders && typeof saved.sliders === "object") st.sliders = saved.sliders;
      if (saved.view && Array.isArray(saved.view.p) && Array.isArray(saved.view.q) && saved.view.s > 0)
        st.view = { p: saved.view.p, q: saved.view.q, s: saved.view.s, rev: 0, by: -1 };
      ROOMS.set(name, { name, state: st, clients: new Map(), used: Number(saved.used) || 0 });
    }
    console.log("Loaded " + ROOMS.size + " saved room(s).");
  } catch (e) { /* no save file yet */ }
}

function saveRooms() {
  if (!dirty) return;
  dirty = false;
  const rooms = {};
  for (const r of ROOMS.values()) rooms[r.name] = { doc: r.state.doc, sliders: r.state.sliders, view: r.state.view, used: r.used };
  fs.writeFile(SAVE_FILE + ".tmp", JSON.stringify({ rooms }), err => {
    if (!err) fs.rename(SAVE_FILE + ".tmp", SAVE_FILE, () => {});
  });
}

function send(c, msg) { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); }
function broadcast(room, msg, except) {
  const text = JSON.stringify(msg);
  for (const c of room.clients.values()) if (c !== except && c.ws.readyState === 1) c.ws.send(text);
}
function playerInfo(c) { return { id: c.id, slot: c.slot, name: c.name, color: c.color, bot: c.bot, vr: c.vr }; }

function cleanName(s, fallback) {
  s = String(s || "").replace(/[^\p{L}\p{N} _'.-]/gu, "").trim().slice(0, 16);
  return s || fallback;
}

// ---------- websocket ----------
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 256 * 1024 });

wss.on("connection", (ws) => {
  let c = null;        // set once the client says hello
  let room = null;
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (data) => {
    let m;
    try { m = JSON.parse(data.toString()); } catch (e) { return; }
    if (!m || typeof m.t !== "string") return;

    if (m.t === "ping") { ws.send(JSON.stringify({ t: "pong", c: m.c, now: Date.now() })); return; }

    if (m.t === "hello") {
      if (c) return;
      room = getRoom(cleanRoomName(m.room));
      if (room.clients.size >= LIMITS.maxPlayers) { ws.send(JSON.stringify({ t: "full" })); ws.close(); return; }
      const used = new Set([...room.clients.values()].map(x => x.slot));
      let slot = 0; while (used.has(slot)) slot++;
      c = { ws, id: nextId++, slot, name: cleanName(m.name, PLAYER_NAMES[slot % PLAYER_NAMES.length]),
            color: PLAYER_COLORS[slot % PLAYER_COLORS.length], bot: !!m.bot, vr: false, pose: null };
      room.clients.set(c.id, c);
      send(c, { t: "welcome", you: playerInfo(c), room: room.name, now: Date.now(), state: publicState(room.state),
                players: [...room.clients.values()].map(playerInfo),
                poses: [...room.clients.values()].filter(x => x.pose && x !== c).map(x => ({ id: x.id, pose: x.pose })) });
      broadcast(room, { t: "join", player: playerInfo(c) }, c);
      return;
    }
    if (!c) return;

    if (m.t === "op") {
      const changed = applyOp(room.state, m.op, c.slot, Date.now());
      if (!changed.length) { if (m.n != null) send(c, { t: "ack", n: m.n, ok: false }); return; }
      // moving the sculpture around is not worth a disk write on every frame
      const isDrag = m.op.kind === "view" && m.op.drag;
      const msg = { t: "state", by: c.id, now: Date.now(), n: m.n };
      for (const part of changed) msg[part] = room.state[part];
      broadcast(room, msg);
      if (!isDrag) dirty = true;
      room.used = Date.now();
      return;
    }
    if (m.t === "pose") {
      c.pose = m.pose;
      if (!!m.vr !== c.vr) { c.vr = !!m.vr; broadcast(room, { t: "player", player: playerInfo(c) }); }
      broadcast(room, { t: "pose", id: c.id, pose: m.pose }, c);
      return;
    }
    if (m.t === "name") {
      c.name = cleanName(m.name, c.name);
      broadcast(room, { t: "player", player: playerInfo(c) });
      return;
    }
    if (m.t === "rtc") {          // voice-chat handshake messages are passed straight to one other player
      const to = room.clients.get(Number(m.to));
      if (to) send(to, { t: "rtc", from: c.id, data: m.data });
      return;
    }
    if (m.t === "say") {          // tiny broadcast (e.g. "voice on") that needs no referee
      broadcast(room, { t: "say", from: c.id, data: m.data }, c);
    }
  });

  ws.on("close", () => {
    if (!c) return;
    room.clients.delete(c.id);
    broadcast(room, { t: "leave", id: c.id });
  });
  ws.on("error", () => {});
});

// drop connections that silently died (headset went to sleep, wifi dropped)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignore */ }
  }
}, 15000).unref();

setInterval(saveRooms, 10000).unref();
process.on("SIGINT", () => { dirty = true; saveRoomsSync(); process.exit(0); });
process.on("SIGTERM", () => { dirty = true; saveRoomsSync(); process.exit(0); });
function saveRoomsSync() {
  try {
    const rooms = {};
    for (const r of ROOMS.values()) rooms[r.name] = { doc: r.state.doc, sliders: r.state.sliders, view: r.state.view, used: r.used };
    fs.writeFileSync(SAVE_FILE, JSON.stringify({ rooms }));
  } catch (e) { /* ignore */ }
}

loadRooms();
server.listen(PORT, () => {
  const scheme = cert ? "https" : "http";
  console.log("Logo 3D Together is running.");
  console.log("  " + scheme + "://localhost:" + PORT + "/" + (cert ? "   (certificate: " + cert.from + ")" : "   (plain http - fine on this PC; headsets need https)"));
  console.log("  Test with pretend players:  " + scheme + "://localhost:" + PORT + "/?bots=2");
});
