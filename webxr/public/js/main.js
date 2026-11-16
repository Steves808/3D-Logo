// Logo 3D Together - the page's main program. It wires the pieces together:
//   net.js     the shared room            engine.js  the real Logo 3D interpreter
//   world.js   the 3D room + avatars      render.js  drawing -> fast 3D objects
//   panel.js   the tablet                 xr.js      headset controls
//   desktop.js mouse camera               bots.js    pretend players for testing

import { createWorld, THREE, spawnFor, packPose } from "./world.js";
import { loadEngine, parseExamples } from "./engine.js";
import { Net } from "./net.js";
import { Panel } from "./panel.js";
import { XR } from "./xr.js";
import { OrbitCam } from "./desktop.js";
import { Bots } from "./bots.js";
import { Voice } from "./voice.js";
import { docText, playheadAt, DEFAULT_VIEW } from "./state.js";

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

const ROOM = String(Q.get("room") || "main").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24) || "main";
const WS_URL = Q.get("server") || (location.protocol === "file:" ? null : (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
const MIN_TUBE_METRES = 0.0022;      // thinnest a line may look, however far the sculpture is shrunk
const CENTRE_HEIGHT = 1.2;

const world = createWorld($("gl"));
const net = new Net({ url: WS_URL, room: ROOM, name: Q.get("name") || lsGet("logo3d.together.name") || "" });
const bots = new Bots(WS_URL, ROOM);
const voice = new Voice(net);

let engine = null;
let result = { error: null, segs: [], events: [], usesTime: false, scene: {}, sliders: [], turtle: null, steps: 0, ms: 0 };
let examples = [];
let pendingFit = false;
let firstDoc = true;
let builtScale = 0, scaleStableAt = 0;
let lastAnimRun = 0;
let lastLine = -1, lastStep = undefined;
let dirtyUI = true;
let typingUntil = 0, liveTimer = 0;
let xrOn = false, xrMode = null;
const viewTarget = { p: new THREE.Vector3(...DEFAULT_VIEW.p), q: new THREE.Quaternion(...DEFAULT_VIEW.q), s: DEFAULT_VIEW.s, snap: true };
let lastViewSend = 0;

const flags = Object.assign({ turtle: true, board: true, floor: true, swap: false, mic: false, tags: true, sound: true },
  JSON.parse(lsGet("logo3d.together.flags") || "{}"), { mic: false });

// ---------- what the tablet (and the desktop buttons) can do ----------
const app = {
  flags,
  get result() { return result; },
  get examples() { return examples; },
  slot: () => (net.me ? net.me.slot : 0),
  codeLines: () => (net.state ? net.state.doc.lines : []),
  statusText: () => statusInfo(),
  highlightLine: () => (lastLine > 0 ? lastLine : 0),
  append: (text) => net.op({ kind: "append", text }),
  undo: () => net.op({ kind: "undo" }),
  clearAll: () => { net.op({ kind: "clear" }); setView(DEFAULT_VIEW.p, DEFAULT_VIEW.q, DEFAULT_VIEW.s); },
  reseed: () => net.op({ kind: "reseed" }),
  repeatLast(n) {
    const lines = app.codeLines().map(l => l.t);
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) return;
    const last = lines[lines.length - 1].trim();
    if (/^(to|end)\b/i.test(last) || /;/.test(last)) return;
    lines[lines.length - 1] = "REPEAT " + n + " [" + last + "]";
    net.op({ kind: "set", text: lines.join("\n") });
  },
  loadExample(i) {
    const e = examples[i]; if (!e) return;
    pendingFit = true;
    net.op({ kind: "set", text: e.code, reseed: true, resetSliders: true });
  },
  fit, resetView: () => setView(DEFAULT_VIEW.p, DEFAULT_VIEW.q, DEFAULT_VIEW.s),
  scaleBy(f) {
    const c = centreWorld(), r = world.viewRoot;
    const p = r.position.clone().sub(c).multiplyScalar(f).add(c);
    setView(p.toArray(), r.quaternion.toArray(), r.scale.x * f);
  },
  lift(dy) { const r = world.viewRoot; setView([r.position.x, r.position.y + dy, r.position.z], r.quaternion.toArray(), r.scale.x); },
  spin(a) {
    const c = centreWorld(), r = world.viewRoot, rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    const p = r.position.clone().sub(c).applyQuaternion(rot).add(c);
    setView(p.toArray(), rot.multiply(r.quaternion).toArray(), r.scale.x);
  },
  recenter() {
    const c = centreWorld(), r = world.viewRoot;
    setView([r.position.x - c.x, r.position.y - c.y + CENTRE_HEIGHT, r.position.z - c.z], r.quaternion.toArray(), r.scale.x);
  },
  toggle(name) {
    if (name === "mic") { toggleMic(); return; }
    flags[name] = !flags[name];
    lsSet("logo3d.together.flags", JSON.stringify(flags));
    if (name === "swap") xr.reassign();
    if (name === "tags") world.setPlayers(net.players, net.me && net.me.id, flags.tags);
    applyFlags(); dirtyUI = true;
  },
  players: () => [...net.players.values()].sort((a, b) => a.slot - b.slot).map(p => Object.assign({ me: net.me && p.id === net.me.id }, p)),
  pingText: () => (net.status === "online" ? net.rtt + " ms" : net.status),
  roomLines: () => [
    "Room: " + ROOM + "      " + (net.status === "online" ? "connected" : net.status === "solo" ? "SOLO (no server found)" : "connecting…"),
    "Engine: Logo 3D " + (engine ? engine.version : "…") + "      program version " + (net.state ? net.state.doc.rev : 0),
    stats.fps + " frames/s      " + result.segs.length + " things drawn" + (voice.on ? "      voice: " + voice.connected + " linked" : "")
  ],
  voiceLabel: () => (voice.on ? "MIC ON (" + voice.connected + " linked)" : voice.error ? voice.error.toUpperCase() : "MIC OFF (voice chat)"),
  resync() { if (net.ws) { try { net.ws.close(); } catch (e) {} } else runDoc(false); },
  playInfo() {
    const total = result.steps, play = net.state ? net.state.play : { mode: "all", rate: 1 };
    const ph = net.state ? playheadAt(play, total, net.now()) : null;
    return { mode: ph == null ? "all" : play.mode, shown: ph == null ? total : ph, total, rate: play.rate || 1 };
  },
  play: (mode, pos) => net.op({ kind: "play", mode, pos, rate: (net.state && net.state.play.rate) || 1 }),
  setRate(r) { const i = app.playInfo(); net.op({ kind: "play", mode: i.mode, pos: i.shown, rate: r }); },
  slider: (name, value) => net.op({ kind: "slider", name, value }),
  onXR(on, mode) {
    xrOn = on; xrMode = mode;
    orbit.enabled = !on;
    applyFlags(); world.resize(); dirtyUI = true;
    $("btnVR").textContent = on && mode === "vr" ? "Leave VR" : "Enter VR";
    $("btnAR").textContent = on && mode === "ar" ? "Leave AR" : "Enter AR (see your room)";
  },
  viewFromLocal(final) {
    const r = world.viewRoot, now = performance.now();
    viewTarget.p.copy(r.position); viewTarget.q.copy(r.quaternion); viewTarget.s = r.scale.x;
    if (!final && now - lastViewSend < 80) return;
    lastViewSend = now;
    net.op({ kind: "view", p: r.position.toArray().map(r4), q: r.quaternion.toArray().map(r4), s: r.scale.x, drag: !final });
  }
};

const panel = new Panel(app);
const xr = new XR(world, app, panel);
const orbit = new OrbitCam(world.camera, $("gl"), 0);
const stats = { fps: 0, frames: 0, t: performance.now() };
const r4 = (n) => Math.round(n * 10000) / 10000;

// ---------- the shared view (where the sculpture sits and how big it is) ----------
function setView(p, q, s) {
  viewTarget.p.fromArray(p); viewTarget.q.fromArray(q); viewTarget.s = s; viewTarget.snap = true;
  net.op({ kind: "view", p: Array.from(p).map(r4), q: Array.from(q).map(r4), s });
}
function centreWorld() {
  const r = world.viewRoot;
  return world.sculpture.bounds.center.clone().multiplyScalar(r.scale.x).applyQuaternion(r.quaternion).add(r.position);
}
function fit() {
  const b = world.sculpture.bounds;
  const s = Math.min(1, Math.max(1e-4, 0.6 / b.radius));
  const c = b.center.clone().multiplyScalar(s);
  setView([-c.x, CENTRE_HEIGHT - c.y, -c.z], [0, 0, 0, 1], s);
  if (!xrOn) orbit.lookAt(new THREE.Vector3(0, CENTRE_HEIGHT, 0), 0.75);
}
function applyView(dt) {
  const r = world.viewRoot;
  if (!xr.grab) {
    const k = viewTarget.snap ? 1 : Math.min(1, dt * 10);
    viewTarget.snap = false;
    r.position.lerp(viewTarget.p, k); r.quaternion.slerp(viewTarget.q, k);
    r.scale.setScalar(r.scale.x + (viewTarget.s - r.scale.x) * k);
  }
  const s = r.scale.x, now = performance.now();
  world.sculpture.setTurtleSize(0.05 / s);
  // keep thin lines visible: when the size has settled at something new, redo the tube thickness
  if (builtScale && (s / builtScale > 1.3 || s / builtScale < 0.77)) {
    if (!scaleStableAt) scaleStableAt = now;
    else if (now - scaleStableAt > 250 && !xr.grab) { scaleStableAt = 0; rebuild(); }
  } else scaleStableAt = 0;
}

// ---------- running the shared program ----------
function statusInfo() {
  if (!engine) return { text: "loading the Logo engine…", error: false };
  if (result.error) return { text: result.error, error: true };
  const info = world.sculpture.info;
  let t = result.segs.length + " drawn · " + Math.round(result.ms) + " ms";
  if (result.usesTime) t += " · moving";
  if (info.hidden) t += " · " + info.hidden + " lines not shown (too many)";
  return { text: t, error: false };
}
function rebuild() {
  builtScale = world.viewRoot.scale.x || viewTarget.s;
  world.sculpture.build(result, MIN_TUBE_METRES / builtScale);
  world.sculpture.limit = undefined;
}
function runDoc(withSound) {
  if (!engine || !net.state) return;
  const doc = net.state.doc;
  const time = Math.max(0, (net.now() - doc.t0) / 1000);
  let r;
  try { r = engine.run({ code: docText(doc), seed: doc.seed, time, frame: Math.floor(time * 60), sliders: net.state.sliders }); }
  catch (e) { r = Object.assign({}, result, { error: "Engine problem: " + (e.message || e), segs: [], events: [], steps: 0, sliders: [], ms: 0 }); }
  if (!r.turtle) r.turtle = { pos: { x: 0, y: 0, z: 0 }, R: [1, 0, 0, 0, 1, 0, 0, 0, 1], color: "#fff" };
  result = r;
  // an error while someone is half-way through typing keeps the last good picture on show
  if (!r.error || !world.sculpture.result) rebuild();
  lastAnimRun = performance.now();
  if (pendingFit) { pendingFit = false; if (!r.error) fit(); }
  if (withSound && flags.sound && !r.usesTime) playNotes(r.events);
  if (!xrOn || xrMode !== "ar") world.setBackground(r.scene.bg, false);
  dirtyUI = true;
}

net.on("welcome", () => {
  const v = net.state.view;
  viewTarget.p.fromArray(v.p); viewTarget.q.fromArray(v.q); viewTarget.s = v.s; viewTarget.snap = true;
  world.viewRoot.scale.setScalar(v.s);
  if (!xrOn) { const sp = spawnFor(net.me.slot); orbit.yaw = sp.yaw; }
  $("nameInput").value = net.me.name;
  firstDoc = true;
  syncEditor(true);
  runDoc(false);
  firstDoc = false;
});
net.on("state", (parts, by, mine) => {
  if (parts.includes("view") && !mine && !xr.grab) {
    const v = net.state.view;
    viewTarget.p.fromArray(v.p); viewTarget.q.fromArray(v.q); viewTarget.s = v.s;
  }
  if (parts.includes("doc")) { syncEditor(mine); runDoc(true); }
  else if (parts.includes("sliders")) runDoc(false);
  if (parts.includes("play") || parts.includes("doc")) { lastStep = undefined; }
  dirtyUI = true;
});
net.on("players", () => { world.setPlayers(net.players, net.me && net.me.id, flags.tags); dirtyUI = true; });
net.on("pose", (id, pose) => { const av = world.avatars.get(id); if (av) av.setPose(pose); });
net.on("status", () => { dirtyUI = true; });
net.on("full", () => { $("status").textContent = "This room is full (8 players). Try another room name."; });

// ---------- sound (NOTE / REST) ----------
let audio = null;
function ensureAudio() { if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (audio && audio.state === "suspended") audio.resume(); }
window.addEventListener("pointerdown", ensureAudio, { passive: true });
function tone(freq, dur, at) {
  if (!audio || !flags.sound || !(freq > 0)) return;
  const t0 = Math.max(audio.currentTime, at || 0), o = audio.createOscillator(), g = audio.createGain();
  o.type = "triangle"; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.08, dur * 0.95));
  o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + Math.max(0.1, dur) + 0.05);
}
function playNotes(events) {
  if (!audio || !events || !events.length) return;
  let t = audio.currentTime + 0.05, n = 0;
  for (const e of events) {
    if (e.type === "note") { if (n++ < 96) tone(e.freq, e.dur, t); t += e.dur; }
    else if (e.type === "rest") t += e.dur;
  }
}

// ---------- desktop controls ----------
function syncEditor(mine) {
  const el = $("code"), text = docText(net.state.doc);
  const busy = document.activeElement === el && performance.now() < typingUntil;
  if (el.value !== text && !(busy && mine) && !(busy && liveTimer)) el.value = text;
}
function sendEditor(reseed) {
  clearTimeout(liveTimer); liveTimer = 0;
  net.op({ kind: "set", text: $("code").value, reseed: !!reseed });
}
$("code").addEventListener("input", () => {
  typingUntil = performance.now() + 1500;
  if (!$("chkLive").checked) return;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => sendEditor(false), 350);
});
$("btnRun").addEventListener("click", () => sendEditor(true));
$("btnUndo").addEventListener("click", () => app.undo());
$("btnClear").addEventListener("click", () => app.clearAll());
$("btnSeed").addEventListener("click", () => app.reseed());
$("btnFit").addEventListener("click", () => fit());
$("btnWatchStart").addEventListener("click", () => app.play("pause", 0));
$("btnWatchAll").addEventListener("click", () => app.play("all", 0));
$("btnWatchPlay").addEventListener("click", () => { const p = app.playInfo(); if (p.mode === "play") app.play("pause", Math.floor(p.shown)); else app.play("play", p.mode === "pause" && p.shown < p.total ? p.shown : 0); });
$("watchRange").addEventListener("input", (e) => app.play("pause", Math.round(Number(e.target.value) / 1000 * result.steps)));
$("exampleSel").addEventListener("change", (e) => { if (e.target.value !== "") app.loadExample(Number(e.target.value)); e.target.value = ""; });

async function showText(title, file) {
  $("modalTitle").textContent = title; $("modalBody").textContent = "Loading…"; $("modal").hidden = false;
  try { const r = await fetch("./engine/" + file, { cache: "no-cache" }); if (!r.ok) throw new Error(r.status); $("modalBody").textContent = await r.text(); }
  catch (e) { $("modalBody").textContent = "Could not read " + file + " (" + e.message + ")."; }
}
$("btnHelp").addEventListener("click", () => showText("List of Commands", "commands.txt"));
$("btnAck").addEventListener("click", () => showText("Acknowledgements", "acknowledge.txt"));
$("modalClose").addEventListener("click", () => { $("modal").hidden = true; });
$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) $("modal").hidden = true; });

$("btnSide").addEventListener("click", () => { $("side").classList.add("hidden"); $("btnSideOpen").hidden = false; world.resize(); });
$("btnSideOpen").addEventListener("click", () => { $("side").classList.remove("hidden"); $("btnSideOpen").hidden = true; world.resize(); });

// testing tools
function setBots(n) { bots.setCount(n); $("botCount").textContent = bots.count; }
$("btnBotAdd").addEventListener("click", () => setBots(bots.count + 1));
$("btnBotDel").addEventListener("click", () => setBots(bots.count - 1));
$("chkBotsDraw").addEventListener("change", (e) => { bots.draw = e.target.checked; });
$("btnNewTab").addEventListener("click", () => { const u = new URL(location.href); u.searchParams.delete("bots"); u.searchParams.delete("name"); window.open(u.href, "_blank"); });
$("btnInvite").addEventListener("click", async () => {
  const link = location.origin + location.pathname + (ROOM === "main" ? "" : "?room=" + ROOM);
  try { await navigator.clipboard.writeText(link); $("btnInvite").textContent = "Copied ✓"; } catch (e) { window.prompt("Copy this link:", link); }
  setTimeout(() => { $("btnInvite").textContent = "Copy invite link"; }, 1600);
});
$("nameInput").addEventListener("change", (e) => { const v = e.target.value.trim(); if (v) { lsSet("logo3d.together.name", v); net.rename(v); } });
$("roomInput").value = ROOM;
function goRoom() { const v = $("roomInput").value.toLowerCase().replace(/[^a-z0-9_-]/g, ""); const u = new URL(location.href); if (v && v !== "main") u.searchParams.set("room", v); else u.searchParams.delete("room"); location.href = u.href; }
$("btnRoomGo").addEventListener("click", goRoom);
$("roomInput").addEventListener("keydown", (e) => { if (e.key === "Enter") goRoom(); });
$("chkTablet").addEventListener("change", (e) => { $("tabletDock").classList.toggle("off", !e.target.checked); });

// the tablet, clickable with the mouse
(function dockTablet() {
  const dock = $("tabletDock"), cv = panel.canvas;
  dock.appendChild(cv);
  if (Q.get("tablet") === "0") { dock.classList.add("off"); $("chkTablet").checked = false; }
  const uv = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  cv.addEventListener("pointermove", (e) => { const [u, v] = uv(e); panel.hover(u, v); });
  cv.addEventListener("pointerleave", () => panel.hover(null));
  cv.addEventListener("pointerdown", (e) => { e.preventDefault(); const [u, v] = uv(e); panel.press(u, v); });
})();

async function toggleMic() {
  if (voice.on) { voice.disable(); flags.mic = false; }
  else { flags.mic = await voice.enable(); }
  dirtyUI = true; panel.markDirty();
}

function applyFlags() {
  world.sculpture.setTurtleVisible(flags.turtle && !(result.scene && result.scene.showTurtle === false));
  world.board.mesh.visible = flags.board;
  const ar = xrOn && xrMode === "ar";
  world.floor.visible = flags.floor && !ar;
  world.setBackground(result.scene && result.scene.bg, ar);
}

// DOM bits that mirror the shared state
let sliderSig = "";
function refreshUI() {
  const st = statusInfo();
  $("status").textContent = st.text + (lastLine > 0 ? "\nwatching line " + lastLine + ": " + ((app.codeLines()[lastLine - 1] || {}).t || "") : "");
  $("status").classList.toggle("err", !!st.error);
  const ns = $("netStatus");
  ns.textContent = net.status === "online" ? "connected · " + net.rtt + " ms" : net.status === "solo" ? "solo (no server)" : net.status === "closed" ? "room full" : "connecting…";
  ns.className = "pill " + (net.status === "online" ? "ok" : net.status === "solo" ? "solo" : "bad");
  $("roomName").textContent = ROOM;
  $("playerChips").innerHTML = "";
  for (const p of app.players()) {
    const c = document.createElement("span"); c.className = "chip";
    const dot = document.createElement("i"); dot.style.background = p.color;
    c.append(dot, document.createTextNode((p.me ? "you: " : "") + p.name + (p.vr ? " 🥽" : "")));
    $("playerChips").appendChild(c);
  }
  // sliders
  const sl = result.sliders || [], sig = sl.map(s => s.name + ":" + s.min + ":" + s.max).join("|");
  const box = $("sliders");
  if (sig !== sliderSig) {
    sliderSig = sig; box.innerHTML = "";
    for (const s of sl) {
      const row = document.createElement("label"); row.className = "sl";
      const name = document.createElement("span"); name.dataset.name = s.name;
      const inp = document.createElement("input"); inp.type = "range"; inp.min = s.min; inp.max = s.max; inp.step = (s.max - s.min) / 200 || 1; inp.dataset.name = s.name;
      inp.addEventListener("input", () => app.slider(s.name, Number(inp.value)));
      row.append(name, inp); box.appendChild(row);
    }
  }
  for (const s of sl) {
    const inp = box.querySelector('input[data-name="' + s.name + '"]'), name = box.querySelector('span[data-name="' + s.name + '"]');
    if (inp && document.activeElement !== inp) inp.value = s.value;
    if (name) name.textContent = s.name + " = " + (Math.round(s.value * 100) / 100);
  }
  const p = app.playInfo();
  $("btnWatchPlay").textContent = p.mode === "play" ? "⏸ Pause" : "▶ Watch";
  if (document.activeElement !== $("watchRange")) $("watchRange").value = p.total ? Math.round(p.shown / p.total * 1000) : 1000;
  world.board.draw({
    room: ROOM, lines: app.codeLines(), highlight: lastLine > 0 ? lastLine : 0, status: st,
    players: app.players().map(q => ({ name: q.name, color: q.color })),
    hint: "tablet: point + trigger   ·   grip: grab the sculpture"
  });
  panel.markDirty();
}

// ---------- the frame loop ----------
let lastT = performance.now(), lastPose = 0, lastStats = 0, lastUI = 0;
new ResizeObserver(() => world.resize()).observe($("stage"));
world.resize();

world.renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  stats.frames++;
  if (now - stats.t > 1000) { stats.fps = Math.round(stats.frames * 1000 / (now - stats.t)); stats.frames = 0; stats.t = now; }

  if (xrOn) xr.update(dt); else orbit.update(dt);
  applyView(dt);
  bots.update(now);
  world.updateAvatars(dt);

  if (net.state && engine) {
    const play = net.state.play, total = result.steps;
    const ph = playheadAt(play, total, net.now());
    // programs that read TIME keep running (unless someone is stepping through with Watch)
    if (result.usesTime && ph == null && !result.error) {
      const gap = Math.max(33, result.ms * 3);
      if (now - lastAnimRun >= gap) runDoc(false);
    }
    const step = ph == null ? null : Math.floor(ph);
    if (step !== lastStep) {
      if (step != null && typeof lastStep === "number" && step > lastStep && step - lastStep < 40 && flags.sound)
        for (const e of result.events) if (e.type === "note" && e.step > lastStep && e.step <= step) tone(e.freq, e.dur);
      lastStep = step;
      world.sculpture.setLimit(step);
      const line = step == null ? -1 : world.sculpture.lineAtLimit();
      if (line !== lastLine) { lastLine = line; dirtyUI = true; }
    } else if (world.sculpture.limit === undefined) world.sculpture.setLimit(step);
  }

  if (now - lastPose > 80 && net.status === "online" && net.me) {
    lastPose = now;
    net.pose(xrOn ? xr.pose() : { h: packPose(world.camera), l: null, r: null }, xrOn);
  }
  if (dirtyUI && now - lastUI > 100) { dirtyUI = false; lastUI = now; refreshUI(); }
  if (now - lastStats > 500) {
    lastStats = now;
    const i = world.sculpture.info;
    $("stats").textContent = stats.fps + " frames/s · " + i.tubes + " tubes, " + i.balls + " balls, " + i.sheets + " sheets, " + i.labels + " labels\n" +
      "last run " + Math.round(result.ms) + " ms · program version " + (net.state ? net.state.doc.rev : 0) + " · " + net.players.size + " in room" +
      (bots.count ? " (" + bots.count + " pretend)" : "") + "\nengine: Logo 3D " + (engine ? engine.version : "loading");
    if (net.status !== lastNetStatus || net.rtt !== lastRtt) { lastNetStatus = net.status; lastRtt = net.rtt; dirtyUI = true; }
  }
  panel.update(now);
  world.renderer.render(world.scene, world.camera);
});
let lastNetStatus = "", lastRtt = -1;

// ---------- start-up ----------
(async function start() {
  $("hud").textContent = "drag: look around · wheel: zoom · right-drag: slide · W A S D Q E: move";
  applyFlags();
  // headset buttons
  const sup = await xr.detect();
  $("btnVR").disabled = !sup.vr; $("btnAR").disabled = !sup.ar;
  $("btnVR").addEventListener("click", () => { ensureAudio(); xr.enter("vr").catch(e => { $("xrNote").textContent = "Could not start VR: " + e.message; }); });
  $("btnAR").addEventListener("click", () => { ensureAudio(); xr.enter("ar").catch(e => { $("xrNote").textContent = "Could not start AR: " + e.message; }); });
  $("xrNote").textContent = (sup.vr || sup.ar) ? "Headset found. The tablet rides on your left hand; point with the right and pull the trigger."
    : !window.isSecureContext ? "Headsets only work over https (or on localhost). This page still works with mouse and keyboard."
    : "No headset mode in this browser - mouse and keyboard work here. On a Quest, open this same address in its browser.";

  try {
    const r = await fetch("./engine/examples.txt", { cache: "no-cache" });
    if (r.ok) examples = parseExamples(await r.text());
  } catch (e) { /* the page works without examples */ }
  const sel = $("exampleSel");
  examples.forEach((e, i) => { const o = document.createElement("option"); o.value = i; o.textContent = e.title; sel.appendChild(o); });

  try { engine = await loadEngine(); }
  catch (e) { $("status").textContent = "The Logo engine did not load: " + e.message; $("status").classList.add("err"); }

  net.connect();
  const nb = Math.max(0, Math.min(6, parseInt(Q.get("bots") || "0", 10) || 0));
  if (Q.get("botsdraw") === "1") { bots.draw = true; $("chkBotsDraw").checked = true; }
  if (nb) setBots(nb);
  if (net.state) runDoc(false);
  dirtyUI = true;
})();

// for tests and for poking around in the browser console
window.LogoTogether = { app, net, world, panel, xr, bots, voice, get result() { return result; }, get engine() { return engine; } };
