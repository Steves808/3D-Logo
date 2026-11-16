// Shared room state + the rules for changing it.
// Used by the server (the referee) and by the page itself in solo/offline mode,
// so both always agree on what each action does.

export const LIMITS = { maxChars: 20000, maxLines: 400, maxPlayers: 8, history: 100 };

export const PLAYER_NAMES = ["Honu", "Pueo", "Nene", "Mano", "Iiwi", "Nai'a", "Kolea", "Heʻe"];
export const PLAYER_COLORS = ["#ff7a59", "#4cc9f0", "#b8e04a", "#f7b801", "#c77dff", "#ff5fa2", "#2ec4b6", "#e0e0e0"];

export const DEFAULT_VIEW = { p: [0, 1.0, 0], q: [0, 0, 0, 1], s: 0.01 };

export function newSeed() { return ((Math.random() * 4294967296) >>> 0) || 1; }

export function newRoomState(now = Date.now()) {
  return {
    doc: { lines: [], seed: newSeed(), rev: 0, t0: now, by: -1 },
    sliders: {},
    view: { ...DEFAULT_VIEW, p: [...DEFAULT_VIEW.p], q: [...DEFAULT_VIEW.q], rev: 0, by: -1 },
    play: { mode: "all", pos: 0, t0: now, rate: 1 },
    history: []
  };
}

export function docText(doc) { return doc.lines.map(l => l.t).join("\n"); }

function clampText(text) {
  text = String(text == null ? "" : text).replace(/\r/g, "");
  if (text.length > LIMITS.maxChars) text = text.slice(0, LIMITS.maxChars);
  return text;
}

function pushHistory(st) {
  st.history.push({ lines: st.doc.lines.map(l => ({ t: l.t, by: l.by })), seed: st.doc.seed });
  if (st.history.length > LIMITS.history) st.history.shift();
}

function touchDoc(st, who, now) {
  st.doc.rev++;
  st.doc.t0 = now;
  st.doc.by = who;
  st.play = { mode: "all", pos: 0, t0: now, rate: st.play.rate || 1 };
}

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Applies one action. Returns the list of parts that changed: "doc", "sliders", "view", "play".
// `who` is the player's slot number, `now` the referee's clock (ms).
export function applyOp(st, op, who, now = Date.now()) {
  if (!op || typeof op.kind !== "string") return [];
  switch (op.kind) {
    case "append": {
      const text = clampText(op.text).trim();
      if (!text) return [];
      const add = text.split("\n").map(t => ({ t, by: who }));
      if (st.doc.lines.length + add.length > LIMITS.maxLines) return [];
      pushHistory(st);
      st.doc.lines.push(...add);
      touchDoc(st, who, now);
      return ["doc", "play"];
    }
    case "set": {
      const text = clampText(op.text).replace(/\s+$/, "");
      if (text === docText(st.doc) && !op.reseed) return [];
      pushHistory(st);
      const old = st.doc.lines;
      const lines = text === "" ? [] : text.split("\n").slice(0, LIMITS.maxLines);
      st.doc.lines = lines.map((t, i) => ({ t, by: (old[i] && old[i].t === t) ? old[i].by : who }));
      if (op.reseed) st.doc.seed = newSeed();
      const out = ["doc", "play"];
      if (op.resetSliders) { st.sliders = {}; out.push("sliders"); }
      touchDoc(st, who, now);
      return out;
    }
    case "undo": {
      const h = st.history.pop();
      if (!h) return [];
      st.doc.lines = h.lines;
      st.doc.seed = h.seed;
      touchDoc(st, who, now);
      return ["doc", "play"];
    }
    case "clear": {
      if (!st.doc.lines.length) return [];
      pushHistory(st);
      st.doc.lines = [];
      st.sliders = {};
      touchDoc(st, who, now);
      return ["doc", "play", "sliders"];
    }
    case "reseed": {
      pushHistory(st);
      st.doc.seed = newSeed();
      touchDoc(st, who, now);
      return ["doc", "play"];
    }
    case "slider": {
      const name = String(op.name || "").toUpperCase().slice(0, 40);
      if (!name || !Number.isFinite(Number(op.value))) return [];
      if (Object.keys(st.sliders).length > 40 && !(name in st.sliders)) return [];
      st.sliders[name] = Number(op.value);
      return ["sliders"];
    }
    case "view": {
      const p = Array.isArray(op.p) ? op.p.slice(0, 3).map(v => num(v)) : null;
      const q = Array.isArray(op.q) ? op.q.slice(0, 4).map(v => num(v)) : null;
      const s = num(op.s, 0);
      if (!p || p.length !== 3 || !q || q.length !== 4 || !(s > 0)) return [];
      st.view = { p, q, s: Math.min(100, Math.max(1e-5, s)), rev: st.view.rev + 1, by: who };
      return ["view"];
    }
    case "play": {
      const mode = ["all", "pause", "play"].includes(op.mode) ? op.mode : "all";
      st.play = { mode, pos: Math.max(0, num(op.pos)), t0: now, rate: Math.min(8, Math.max(0.1, num(op.rate, 1))) };
      return ["play"];
    }
  }
  return [];
}

// What a newcomer is sent (history stays with the referee).
export function publicState(st) {
  return { doc: st.doc, sliders: st.sliders, view: st.view, play: st.play };
}

// Where the shared Watch playhead is right now. `total` = number of steps in the drawing,
// `now` = referee time. Returns null when the whole drawing should be shown.
export function playheadAt(play, total, now) {
  if (!play || play.mode === "all") return null;
  if (play.mode === "pause") return Math.min(total, play.pos);
  const pos = play.pos + ((now - play.t0) / 1000) * stepsPerSecond(total) * play.rate;
  return pos >= total ? null : pos;
}
// Whole drawing in about 6 s (small) to 40 s (large) at rate 1.
export function stepsPerSecond(total) {
  const secs = Math.min(40, Math.max(6, total / 25));
  return Math.max(1, total / secs);
}
