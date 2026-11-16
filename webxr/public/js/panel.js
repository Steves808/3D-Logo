// The tablet: one canvas of big buttons. In VR it rides on your hand and you press it with the
// other hand's laser; on a normal screen the very same canvas is shown in the corner and clicked
// with the mouse - so everything the headset can do can be tested without a headset.

import { PLAYER_COLORS } from "./state.js";

export const PANEL_W = 1024, PANEL_H = 1280;
const DIST_STEPS = [5, 10, 25, 50, 100, 200];
const ANG_STEPS = [5, 15, 30, 45, 60, 72, 90, 120, 144, 180];
const SWATCHES = [
  ["red", "#ff3b30"], ["orange", "#ff9f0a"], ["yellow", "#ffd60a"], ["green", "#34c759"],
  ["blue", "#0a84ff"], ["purple", "#bf5af2"], ["magenta", "#ff2d55"], ["cyan", "#64d2ff"],
  ["pink", "#ff9fbf"], ["white", "#f2f2f2"], ["gray", "#8e8e93"], ["black", "#23232c"]
];
const TABS = ["BUILD", "EXAMPLES", "WATCH", "VIEW", "ROOM"];
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, Menlo, Consolas, monospace";

function cubeLogo(s) {
  return `REPEAT 4 [FD ${s} RT 90] UP 90 FD ${s} DN 90 REPEAT 4 [FD ${s} RT 90]` +
    ` REPEAT 3 [PU FD ${s} RT 90 PD DN 90 FD ${s} PU BK ${s} PD UP 90] PU FD ${s} RT 90 PD`;
}

export class Panel {
  constructor(app) {
    this.app = app;
    this.canvas = document.createElement("canvas");
    this.canvas.width = PANEL_W; this.canvas.height = PANEL_H;
    this.g = this.canvas.getContext("2d");
    this.tab = "BUILD";
    this.dist = 50; this.ang = 90;
    this.exPage = 0;
    this.widgets = [];
    this.hoverIdx = -1;
    this.pressIdx = -1; this.pressUntil = 0;
    this.dirty = true;
    this.version = 0;          // bumps whenever the picture changed (the VR texture watches this)
    this._lastAuto = 0;
  }

  markDirty() { this.dirty = true; }

  hover(u, v) {
    const i = (u == null) ? -1 : this._hit(u, v);
    if (i !== this.hoverIdx) { this.hoverIdx = i; this.dirty = true; }
    return i >= 0;
  }

  press(u, v) {
    const i = this._hit(u, v);
    if (i < 0) return false;
    const w = this.widgets[i];
    this.pressIdx = i; this.pressUntil = performance.now() + 160; this.dirty = true;
    try { w.fn && w.fn((u * PANEL_W - w.x) / w.w, (v * PANEL_H - w.y) / w.h); } catch (e) { console.error(e); }
    this.dirty = true;
    return true;
  }

  _hit(u, v) {
    const x = u * PANEL_W, y = v * PANEL_H;
    for (let i = this.widgets.length - 1; i >= 0; i--) {
      const w = this.widgets[i];
      if (w.fn && x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) return i;
    }
    return -1;
  }

  // Call every frame; redraws only when something changed.
  update(now) {
    if (this.pressIdx >= 0 && now > this.pressUntil) { this.pressIdx = -1; this.dirty = true; }
    // pages that show live numbers refresh a few times a second
    if ((this.tab === "WATCH" || this.tab === "ROOM") && now - this._lastAuto > 220) { this._lastAuto = now; this.dirty = true; }
    if (!this.dirty) return false;
    this.dirty = false;
    this._layout();
    this._draw();
    this.version++;
    return true;
  }

  // ---------- layout ----------
  _btn(x, y, w, h, label, sub, fn, o) { this.widgets.push(Object.assign({ x, y, w, h, label, sub, fn }, o || {})); }

  _layout() {
    const a = this.app;
    this.widgets = [];
    // tabs
    const tw = (PANEL_W - 24) / TABS.length;
    TABS.forEach((t, i) => this._btn(12 + i * tw, 262, tw - 8, 78, t, null, () => { this.tab = t; }, { tab: true, on: this.tab === t, size: 30 }));

    const X0 = 14, Y0 = 356, CW = (PANEL_W - 2 * X0) / 6, RH = 113;
    const B = (c, r, label, sub, fn, o) => this._btn(X0 + c * CW + 5, Y0 + r * RH + 5, CW * ((o && o.span) || 1) - 10, RH - 10, label, sub, fn, o);
    const d = () => this.dist, g = () => this.ang;

    if (this.tab === "BUILD") {
      B(0, 0, "↑", "FD " + d(), () => a.append("FD " + d()));
      B(1, 0, "↓", "BK " + d(), () => a.append("BK " + d()));
      B(2, 0, "←", "LT " + g(), () => a.append("LT " + g()));
      B(3, 0, "→", "RT " + g(), () => a.append("RT " + g()));
      B(4, 0, "UP", "pitch " + g(), () => a.append("UP " + g()));
      B(5, 0, "DN", "pitch " + g(), () => a.append("DN " + g()));

      B(0, 1, "−", "DIST", () => this._cycle("dist", -1));
      B(1, 1, String(d()), "DIST", null, { flat: true });
      B(2, 1, "+", "DIST", () => this._cycle("dist", 1));
      B(3, 1, "−", "ANGLE", () => this._cycle("ang", -1));
      B(4, 1, String(g()) + "°", "ANGLE", null, { flat: true });
      B(5, 1, "+", "ANGLE", () => this._cycle("ang", 1));

      B(0, 2, "PU", "pen up", () => a.append("PU"));
      B(1, 2, "PD", "pen down", () => a.append("PD"));
      B(2, 2, "RL", "roll " + g(), () => a.append("RL " + g()));
      B(3, 2, "RR", "roll " + g(), () => a.append("RR " + g()));
      B(4, 2, "⌂", "HOME", () => a.append("PU HOME PD"));
      B(5, 2, "●", "BALL", () => a.append("BALL " + Math.max(2, Math.round(d() / 8))));

      SWATCHES.forEach(([name, hex], i) => {
        const dark = ["white", "yellow", "cyan", "pink"].includes(name);
        B(i % 6, 3 + Math.floor(i / 6), "", name, () => a.append("SC " + name.toUpperCase()), { bg: hex, fg: dark ? "#111118" : "#ffffff", subfg: dark ? "#222" : "#fff" });
      });

      B(0, 5, "△", "TRIANGLE", () => a.append(`REPEAT 3 [FD ${d()} RT 120]`));
      B(1, 5, "▢", "SQUARE", () => a.append(`REPEAT 4 [FD ${d()} RT 90]`));
      B(2, 5, "⬡", "HEXAGON", () => a.append(`REPEAT 6 [FD ${d()} RT 60]`));
      B(3, 5, "☆", "STAR", () => a.append(`REPEAT 5 [FD ${d()} RT 144]`));
      B(4, 5, "○", "CIRCLE", () => a.append(`AR 360 ${Math.max(4, Math.round(d() / 2))}`));
      B(5, 5, "⬒", "CUBE", () => a.append(cubeLogo(d())));

      B(0, 6, "★", "RANDOM COLOR", () => a.append("SC RC"));
      B(1, 6, "thin", "LINE", () => a.append("WIDTH 1.5"));
      B(2, 6, "THICK", "LINE", () => a.append("WIDTH 5"));
      B(3, 6, "×2", "REPEAT LAST", () => a.repeatLast(2));
      B(4, 6, "×6", "REPEAT LAST", () => a.repeatLast(6));
      B(5, 6, "🎲", "NEW RANDOM", () => a.reseed());

      B(0, 7, "↩", "UNDO", () => a.undo(), { span: 2, bg: "#3a2f14" });
      B(2, 7, "FIT", "show all", () => a.fit(), { span: 2 });
      B(4, 7, "✕", "CLEAR ALL", () => a.clearAll(), { span: 2, bg: "#3d1a1d" });
    }

    if (this.tab === "EXAMPLES") {
      const ex = a.examples || [], per = 7, pages = Math.max(1, Math.ceil(ex.length / per));
      this.exPage = Math.min(this.exPage, pages - 1);
      ex.slice(this.exPage * per, this.exPage * per + per).forEach((e, i) => {
        this._btn(X0 + 5, Y0 + i * 112 + 5, PANEL_W - 2 * X0 - 10, 102, e.title, null, () => a.loadExample(this.exPage * per + i), { align: "left", size: 36 });
      });
      if (!ex.length) this._btn(X0, Y0, PANEL_W - 2 * X0, 100, "examples.txt not loaded", null, null, { flat: true, size: 34 });
      B(0, 7, "◀", "PAGE", () => { this.exPage = (this.exPage + pages - 1) % pages; }, { span: 2 });
      B(2, 7, (this.exPage + 1) + " / " + pages, "everyone gets it", null, { span: 2, flat: true });
      B(4, 7, "▶", "PAGE", () => { this.exPage = (this.exPage + 1) % pages; }, { span: 2 });
    }

    if (this.tab === "WATCH") {
      const p = a.playInfo();
      B(0, 0, "⏮", "START", () => a.play("pause", 0));
      B(1, 0, "−1", "STEP", () => a.play("pause", Math.max(0, Math.floor(p.shown) - 1)));
      B(2, 0, p.mode === "play" ? "⏸" : "▶", p.mode === "play" ? "PAUSE" : "WATCH", () => {
        if (p.mode === "play") a.play("pause", Math.floor(p.shown));
        else a.play("play", p.mode === "pause" && p.shown < p.total ? p.shown : 0);
      }, { span: 2, bg: "#153a2a" });
      B(4, 0, "+1", "STEP", () => a.play("pause", Math.min(p.total, Math.floor(p.shown) + 1)));
      B(5, 0, "⏭", "ALL", () => a.play("all", 0));
      // scrub bar
      this._btn(X0 + 5, Y0 + RH + 12, PANEL_W - 2 * X0 - 10, 74, null, null, (fx) => a.play("pause", Math.round(Math.min(1, Math.max(0, fx)) * p.total)),
        { bar: p.total ? p.shown / p.total : 1, text: (p.mode === "all" ? p.total : Math.floor(p.shown)) + " / " + p.total + " steps" });
      [0.25, 0.5, 1, 2, 4].forEach((r, i) => B(i, 2, "×" + r, "SPEED", () => a.setRate(r), { on: Math.abs(p.rate - r) < 0.01 }));
      B(5, 2, "🔊", a.flags.sound ? "SOUND ON" : "SOUND OFF", () => a.toggle("sound"), { on: a.flags.sound });
      // sliders
      const sl = (a.result && a.result.sliders) || [];
      if (!sl.length) this._btn(X0 + 5, Y0 + 3 * RH + 30, PANEL_W - 2 * X0 - 10, 150, "No sliders in this program", "add a line like:  SLIDER n 3 12 5", null, { flat: true, size: 34 });
      sl.slice(0, 5).forEach((s, i) => {
        const y = Y0 + 3 * RH + 14 + i * 104, span = (s.max - s.min) || 1, stepSz = niceStep(span);
        const set = (v) => a.slider(s.name, Math.min(s.max, Math.max(s.min, v)));
        this._btn(X0 + 5, y, 120, 92, "−", null, () => set(snap(s.value - stepSz, stepSz)));
        this._btn(X0 + 135, y, PANEL_W - 2 * X0 - 270, 92, null, null, (fx) => set(snap(s.min + Math.min(1, Math.max(0, fx)) * span, stepSz / 5)),
          { bar: (s.value - s.min) / span, text: s.name + " = " + fmt(s.value) });
        this._btn(PANEL_W - X0 - 125, y, 120, 92, "+", null, () => set(snap(s.value + stepSz, stepSz)));
      });
    }

    if (this.tab === "VIEW") {
      B(0, 0, "FIT", "show all of it", () => a.fit(), { span: 3, bg: "#153a2a" });
      B(3, 0, "1 : 1", "FD 100 = 1 metre", () => a.resetView(), { span: 3 });
      B(0, 1, "+", "BIGGER", () => a.scaleBy(1.25), { span: 2 });
      B(2, 1, "−", "SMALLER", () => a.scaleBy(0.8), { span: 2 });
      B(4, 1, "◀", "TURN", () => a.spin(-Math.PI / 8));
      B(5, 1, "▶", "TURN", () => a.spin(Math.PI / 8));
      B(0, 2, "▲", "HIGHER", () => a.lift(0.15), { span: 2 });
      B(2, 2, "▼", "LOWER", () => a.lift(-0.15), { span: 2 });
      B(4, 2, "CENTRE", "bring it back", () => a.recenter(), { span: 2 });
      B(0, 3, "🐢", a.flags.turtle ? "TURTLE SHOWN" : "TURTLE HIDDEN", () => a.toggle("turtle"), { span: 2, on: a.flags.turtle });
      B(2, 3, "WALL", a.flags.board ? "CODE WALL ON" : "CODE WALL OFF", () => a.toggle("board"), { span: 2, on: a.flags.board });
      B(4, 3, "FLOOR", a.flags.floor ? "FLOOR ON" : "FLOOR OFF", () => a.toggle("floor"), { span: 2, on: a.flags.floor });
      this._btn(X0 + 5, Y0 + 4 * RH + 20, PANEL_W - 2 * X0 - 10, 330, null, null, null, { flat: true, lines: [
        "Grab the sculpture: squeeze a GRIP button and move your hand.",
        "Squeeze BOTH grips to stretch, shrink and turn it.",
        "Everyone sees it move.",
        "Left stick: walk    Right stick: turn / up-down"
      ] });
    }

    if (this.tab === "ROOM") {
      const players = a.players();
      players.slice(0, 6).forEach((p, i) => {
        this._btn(X0 + 5, Y0 + i * 82, PANEL_W - 2 * X0 - 10, 74, (p.me ? "You: " : "") + p.name + (p.bot ? "  (bot)" : "") + (p.vr ? "  🥽" : ""), null, null,
          { flat: true, align: "left", size: 34, dot: p.color, right: p.me ? a.pingText() : "" });
      });
      const y = Y0 + 6 * 82 + 10;
      this._btn(X0 + 5, y, PANEL_W - 2 * X0 - 10, 150, null, null, null, { flat: true, lines: a.roomLines() });
      B(0, 6, "SWAP", a.flags.swap ? "TABLET: RIGHT HAND" : "TABLET: LEFT HAND", () => a.toggle("swap"), { span: 3 });
      B(3, 6, "🎤", a.voiceLabel(), () => a.toggle("mic"), { span: 3, on: a.flags.mic });
      B(0, 7, "TAGS", "NAME TAGS " + (a.flags.tags ? "ON" : "OFF"), () => a.toggle("tags"), { span: 3, on: a.flags.tags });
      B(3, 7, "SYNC", "RE-SYNC", () => a.resync(), { span: 3 });
    }
  }

  _cycle(which, dir) {
    const arr = which === "dist" ? DIST_STEPS : ANG_STEPS;
    const cur = which === "dist" ? this.dist : this.ang;
    let i = arr.indexOf(cur); if (i < 0) i = 0;
    const v = arr[(i + dir + arr.length) % arr.length];
    if (which === "dist") this.dist = v; else this.ang = v;
  }

  // ---------- drawing ----------
  _draw() {
    const g = this.g, a = this.app, W = PANEL_W, H = PANEL_H;
    g.fillStyle = "#0b0b13"; g.fillRect(0, 0, W, H);

    // readout: the last few lines of the shared program, coloured by who added them
    g.fillStyle = "#11111c"; rr(g, 12, 12, W - 24, 238, 16); g.fill();
    g.textBaseline = "middle"; g.textAlign = "left";
    g.font = "600 26px " + FONT; g.fillStyle = "#8f8fa3";
    g.fillText("SHARED PROGRAM  ·  " + a.codeLines().length + " lines", 30, 38);
    const st = a.statusText();
    g.textAlign = "right"; g.fillStyle = st.error ? "#ff8a80" : "#6fd08f";
    g.fillText(clip(g, st.text, 480), W - 30, 38);
    g.textAlign = "left"; g.font = "500 31px " + MONO;
    const all = a.codeLines(), hl = a.highlightLine();
    let start = Math.max(0, all.length - 5);
    if (hl > 0) start = Math.max(0, Math.min(all.length - 5, hl - 3));
    const lines = all.slice(start, start + 5);
    if (!lines.length) { g.fillStyle = "#6f6f86"; g.fillText("empty - press a button below", 34, 130); }
    lines.forEach((l, i) => {
      const y = 78 + i * 37, n = start + i + 1;
      if (n === hl) { g.fillStyle = "rgba(255,214,10,0.18)"; g.fillRect(20, y - 18, W - 40, 36); }
      g.fillStyle = PLAYER_COLORS[(l.by >= 0 ? l.by : 0) % PLAYER_COLORS.length]; g.fillRect(24, y - 14, 7, 28);
      g.fillStyle = "#62627a"; g.fillText(String(n).padStart(2, " "), 40, y);
      g.fillStyle = "#e8e8f2"; g.fillText(clip(g, l.t, W - 150), 96, y);
    });

    this.widgets.forEach((w, i) => this._drawWidget(w, i === this.hoverIdx, i === this.pressIdx));
  }

  _drawWidget(w, hover, pressed) {
    const g = this.g;
    let bg = w.bg || (w.flat ? "#11111c" : "#1c1c2b");
    if (w.tab) bg = w.on ? "#2b3f7a" : "#161622";
    else if (w.on) bg = "#234a8a";
    g.fillStyle = bg; rr(g, w.x, w.y, w.w, w.h, 14); g.fill();
    if (w.fn) {
      g.lineWidth = hover ? 6 : 2;
      g.strokeStyle = pressed ? "#ffffff" : hover ? "#9fc0ff" : "rgba(255,255,255,0.13)";
      rr(g, w.x + 1, w.y + 1, w.w - 2, w.h - 2, 14); g.stroke();
      if (pressed) { g.fillStyle = "rgba(255,255,255,0.22)"; rr(g, w.x, w.y, w.w, w.h, 14); g.fill(); }
    }
    g.textBaseline = "middle";
    if (w.bar != null) {
      const f = Math.min(1, Math.max(0, w.bar));
      g.fillStyle = "#2f6fd6"; rr(g, w.x + 6, w.y + 6, Math.max(8, (w.w - 12) * f), w.h - 12, 10); g.fill();
      g.fillStyle = "#ffffff"; g.font = "600 32px " + FONT; g.textAlign = "center";
      g.fillText(w.text || "", w.x + w.w / 2, w.y + w.h / 2);
      return;
    }
    if (w.lines) {
      g.fillStyle = "#b9b9cc"; g.font = "500 29px " + FONT; g.textAlign = "left";
      w.lines.forEach((t, i) => g.fillText(clip(g, t, w.w - 40), w.x + 22, w.y + 34 + i * 40));
      return;
    }
    const fg = w.fg || "#f2f2f8";
    const left = w.align === "left";
    let tx = left ? w.x + 26 : w.x + w.w / 2;
    if (w.dot) { g.fillStyle = w.dot; g.beginPath(); g.arc(w.x + 34, w.y + w.h / 2, 14, 0, 7); g.fill(); tx = w.x + 64; }
    g.textAlign = left ? "left" : "center";
    g.fillStyle = fg;
    const big = w.size || (w.sub ? (String(w.label).length > 3 ? 40 : 50) : 46);
    g.font = "600 " + big + "px " + FONT;
    if (w.label) g.fillText(clip(g, w.label, w.w - (left ? 60 : 12) - (w.right ? 150 : 0)), tx, w.sub ? w.y + w.h * 0.40 : w.y + w.h / 2);
    if (w.sub) {
      g.fillStyle = w.subfg || "#a5a5b8"; g.font = "600 " + (w.w > 300 ? 24 : 19) + "px " + FONT;
      g.fillText(clip(g, w.sub, w.w - 10), tx, w.y + w.h * (w.label ? 0.80 : 0.5));
    }
    if (w.right) { g.textAlign = "right"; g.fillStyle = "#8f8fa3"; g.font = "500 26px " + FONT; g.fillText(w.right, w.x + w.w - 20, w.y + w.h / 2); }
  }
}

function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
function clip(g, text, maxW) {
  text = String(text);
  if (g.measureText(text).width <= maxW) return text;
  while (text.length > 1 && g.measureText(text + "…").width > maxW) text = text.slice(0, -1);
  return text + "…";
}
function niceStep(span) {
  const raw = span / 20, p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
function snap(v, step) { return step > 0 ? Math.round(v / step) * step : v; }
function fmt(v) { return Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : v.toFixed(2); }
