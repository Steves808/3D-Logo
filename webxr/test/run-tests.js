// Automated check:  npm test
// Starts a private copy of the server, connects three pretend players, has them edit at the same
// time, and confirms every player ends up with exactly the same program AND the same drawing.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Net } from "../public/js/net.js";
import { docText, newRoomState, applyOp, playheadAt } from "../public/js/state.js";
import { loadEngine, parseExamples } from "./engine-node.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3900 + Math.floor(Math.random() * 90);
const save = path.join(os.tmpdir(), "logo3d-test-rooms-" + PORT + ".json");
let failed = 0, passed = 0;
const ok = (cond, name, extra = "") => { if (cond) { passed++; console.log("  ok   " + name); } else { failed++; console.log("  FAIL " + name + (extra ? "  -> " + extra : "")); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(20); } return false; }

function startServer() {
  const p = spawn(process.execPath, [path.join(here, "../server.js")], { env: { ...process.env, PORT: String(PORT), LOGO_HTTP: "1", LOGO_SAVE: save }, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    p.stdout.on("data", d => { if (String(d).includes("is running")) resolve(p); });
    p.stderr.on("data", d => process.stderr.write(d));
    p.on("exit", c => reject(new Error("server exited " + c)));
    setTimeout(() => reject(new Error("server did not start")), 5000);
  });
}
function player(room, name) {
  const n = new Net({ url: "ws://localhost:" + PORT + "/ws", room, name, allowSolo: false });
  n.connect();
  return n;
}
const drawingOf = (L, net) => {
  const r = L.runSource(docText(net.state.doc), { seed: net.state.doc.seed });
  return JSON.stringify(r.segments.map(s => [s.a.x.toFixed(4), s.a.y.toFixed(4), s.a.z.toFixed(4), s.b.x.toFixed(4), s.b.y.toFixed(4), s.b.z.toFixed(4), s.color]));
};

console.log("\n1. Rules (no network)");
{
  const st = newRoomState(1000);
  applyOp(st, { kind: "append", text: "FD 50" }, 0, 1000);
  applyOp(st, { kind: "append", text: "RT 90" }, 1, 1001);
  ok(docText(st.doc) === "FD 50\nRT 90" && st.doc.lines[1].by === 1, "append keeps who added each line");
  applyOp(st, { kind: "set", text: "FD 50\nRT 45" }, 2, 1002);
  ok(st.doc.lines[0].by === 0 && st.doc.lines[1].by === 2, "editing a line makes it yours, untouched lines keep their owner");
  applyOp(st, { kind: "undo" }, 0, 1003);
  ok(docText(st.doc) === "FD 50\nRT 90", "undo brings back the previous program");
  const seed = st.doc.seed; applyOp(st, { kind: "reseed" }, 0, 1004);
  ok(st.doc.seed !== seed, "new random picks a new seed");
  ok(applyOp(st, { kind: "view", p: [0, 1, 0], q: [0, 0, 0, 1], s: -1 }, 0).length === 0, "nonsense view is refused");
  ok(playheadAt({ mode: "pause", pos: 5, t0: 0, rate: 1 }, 10, 99999) === 5 && playheadAt({ mode: "all" }, 10, 0) === null, "watch playhead");
  applyOp(st, { kind: "clear" }, 0, 1005);
  ok(st.doc.lines.length === 0, "clear empties the program");
}

console.log("\n2. Engine (the real logo3d.js)");
const L = loadEngine();
{
  const ex = parseExamples(fs.readFileSync(path.join(here, "../public/engine/examples.txt"), "utf8"));
  let bad = [], differ = [];
  for (const e of ex) {
    const a = L.runSource(e.code, { seed: 12345 }); if (a.error) bad.push(e.title + ": " + a.error);
    const sa = a.segments.length + JSON.stringify(a.segments.slice(-2));
    const b = L.runSource(e.code, { seed: 12345 });
    if (sa !== b.segments.length + JSON.stringify(b.segments.slice(-2))) differ.push(e.title);
  }
  ok(ex.length > 5 && !bad.length, "all " + ex.length + " examples run without error", bad.join("; "));
  ok(!differ.length, "same seed gives the same drawing every time (so every headset matches)", differ.join("; "));
  const r = L.runSource("slider n 3 12 5\nrepeat n [fd 50 rt 360/n]", { seed: 1 });
  ok(r.turtle && r.sliderInfo && r.sliderInfo[0].name === "N", "engine reports turtle position and sliders");
  ok(L.setSlider("N", 9) && L.runSource("slider n 3 12 5\nrepeat n [fd 50 rt 360/n]", { seed: 1 }).segments.length === 9, "a slider can be moved from outside");
}

console.log("\n3. Three players in one room");
const server = await startServer();
try {
  const A = player("t1", "Ann"), B = player("t1", ""), C = player("t1", "");
  ok(await until(() => A.status === "online" && B.status === "online" && C.status === "online"), "three players connect");
  ok(await until(() => A.players.size === 3 && B.players.size === 3 && C.players.size === 3), "everyone sees three players");
  ok(new Set([A.me.slot, B.me.slot, C.me.slot]).size === 3 && A.me.name === "Ann" && B.me.name, "each gets their own colour and name");

  // all three press buttons at the same moment
  for (let i = 0; i < 10; i++) { A.op({ kind: "append", text: "FD " + (10 + i) }); B.op({ kind: "append", text: "RT " + (5 + i) }); C.op({ kind: "append", text: "SC RC" }); }
  ok(await until(() => [A, B, C].every(n => n.state.doc.lines.length === 30)), "30 presses at once: nobody's press is lost");
  ok(docText(A.state.doc) === docText(B.state.doc) && docText(B.state.doc) === docText(C.state.doc), "all three hold the identical program");
  ok(drawingOf(L, A) === drawingOf(L, B) && drawingOf(L, B) === drawingOf(L, C), "all three compute the identical drawing (random colours included)");

  B.op({ kind: "undo" });
  ok(await until(() => [A, B, C].every(n => n.state.doc.lines.length === 29)), "undo reaches everyone");

  // a late joiner gets everything at once
  A.op({ kind: "view", p: [0.5, 1.2, 0], q: [0, 0, 0, 1], s: 0.02 });
  A.op({ kind: "slider", name: "n", value: 7 });
  await until(() => C.state.view.s === 0.02 && C.state.sliders.N === 7);
  const D = player("t1", "Late");
  ok(await until(() => D.status === "online"), "a late joiner connects");
  ok(docText(D.state.doc) === docText(A.state.doc) && D.state.view.s === 0.02 && D.state.sliders.N === 7 && D.state.doc.seed === A.state.doc.seed, "late joiner has the program, seed, size and sliders straight away");

  // shared Watch
  A.op({ kind: "play", mode: "pause", pos: 4, rate: 1 });
  ok(await until(() => [B, C, D].every(n => n.state.play.mode === "pause" && n.state.play.pos === 4)), "Watch position is shared");
  B.op({ kind: "append", text: "FD 1" });
  ok(await until(() => [A, C, D].every(n => n.state.play.mode === "all")), "a new edit ends Watch for everyone");

  // head positions
  let got = null; B.on("pose", (id, p) => { if (id === A.me.id) got = p; });
  A.pose({ h: [1, 1.6, 2, 0, 0, 0, 1], l: null, r: null }, true);
  ok(await until(() => got && got.h[1] === 1.6), "head position reaches the others");
  ok(await until(() => B.players.get(A.me.id).vr === true), "others can see who is in a headset");

  // rooms are separate
  const E = player("other", "");
  await until(() => E.status === "online");
  ok(E.state.doc.lines.length === 0 && E.players.size === 1, "a different room is separate");

  // clocks agree (needed for moving programs and Watch)
  await sleep(2500);
  ok(Math.abs(A.now() - B.now()) < 60, "players' clocks agree within 60 ms", String(Math.abs(A.now() - B.now())));

  D.close();
  ok(await until(() => A.players.size === 3), "leaving is noticed");

  // the status page
  const st = await (await fetch("http://localhost:" + PORT + "/status")).json();
  ok(st.ok && st.rooms.some(r => r.room === "t1" && r.players === 3), "/status page lists the room");
  const page = await fetch("http://localhost:" + PORT + "/");
  ok(page.status === 200 && (await page.text()).includes("Logo 3D"), "the page is served");
  ok((await fetch("http://localhost:" + PORT + "/..%2fserver.js")).status !== 200, "files outside the public folder are not served");

  for (const n of [A, B, C, E]) n.close();
} finally {
  server.kill("SIGTERM");
  await sleep(300);
}

console.log("\n4. Restart keeps the drawing");
{
  const saved = JSON.parse(fs.readFileSync(save, "utf8"));
  ok(saved.rooms.t1 && saved.rooms.t1.doc.lines.length === 30, "the room was saved to disk when the server stopped");
  const s2 = await startServer();
  const F = player("t1", "");
  await until(() => F.status === "online");
  ok(F.state && F.state.doc.lines.length === 30, "after a restart the room still has its program");
  F.close(); s2.kill("SIGTERM"); await sleep(200);
  try { fs.unlinkSync(save); } catch (e) {}
}

console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed ? 1 : 0);
