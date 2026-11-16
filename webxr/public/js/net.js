// Connection to the room referee (server.js). Works in the browser and in Node 22+ (tests, bots).
// If no server answers, it switches to SOLO mode and applies the same rules locally.

import { newRoomState, applyOp, publicState, PLAYER_NAMES, PLAYER_COLORS } from "./state.js";

export class Net {
  constructor(opts = {}) {
    this.url = opts.url;                 // ws:// or wss:// address
    this.room = opts.room || "main";
    this.name = opts.name || "";
    this.bot = !!opts.bot;
    this.allowSolo = opts.allowSolo !== false;
    this.handlers = {};
    this.me = null;                      // { id, slot, name, color }
    this.players = new Map();            // id -> player info
    this.state = null;                   // { doc, sliders, view, play }
    this.offset = 0;                     // referee clock minus my clock (ms)
    this.rtt = 0;
    this.status = "connecting";          // connecting | online | solo | closed
    this.ws = null;
    this._n = 0;
    this._retry = 0;
    this._everOnline = false;
    this._closed = false;
    this._solo = null;
  }

  on(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); return this; }
  emit(name, ...args) { for (const fn of this.handlers[name] || []) { try { fn(...args); } catch (e) { console.error(e); } } }

  now() { return Date.now() + this.offset; }

  connect() {
    if (this._closed) return;
    if (!this.url) { this._goSolo(); return; }
    let ws;
    try { ws = new WebSocket(this.url); } catch (e) { this._failed(); return; }
    this.ws = ws;
    const soloTimer = setTimeout(() => { if (ws.readyState !== 1) { try { ws.close(); } catch (e) {} } }, 5000);
    ws.onopen = () => {
      clearTimeout(soloTimer);
      this._retry = 0;
      ws.send(JSON.stringify({ t: "hello", room: this.room, name: this.name, bot: this.bot }));
      this._ping();
      clearInterval(this._pingTimer);
      this._pingTimer = setInterval(() => this._ping(), 2000);
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)); } catch (e) { return; }
      this._onMessage(m);
    };
    ws.onclose = () => { clearTimeout(soloTimer); clearInterval(this._pingTimer); if (this.ws === ws) this._failed(); };
    ws.onerror = () => {};
  }

  close() {
    this._closed = true;
    clearInterval(this._pingTimer); clearTimeout(this._retryTimer);
    this.status = "closed";
    try { this.ws && this.ws.close(); } catch (e) {}
  }

  _failed() {
    if (this._closed) return;
    this.ws = null;
    if (!this._everOnline && this.allowSolo && this._retry >= 1) { this._goSolo(); }
    else if (this.status !== "solo") { this.status = "connecting"; this.emit("status", this.status); }
    // keep trying in the background (also from solo mode, in case the server comes up later)
    this._retry++;
    const wait = Math.min(15000, 600 * Math.pow(1.7, this._retry));
    this._retryTimer = setTimeout(() => this.connect(), wait);
    if (this._retryTimer.unref && this.bot) this._retryTimer.unref();
  }

  _goSolo() {
    if (this.status === "solo") return;
    this.status = "solo";
    this._solo = this._solo || newRoomState();
    if (!this.state) this.state = publicState(this._solo);
    this.me = this.me || { id: 0, slot: 0, name: this.name || PLAYER_NAMES[0], color: PLAYER_COLORS[0] };
    this.players = new Map([[this.me.id, this.me]]);
    this.offset = 0;
    this.emit("status", this.status);
    this.emit("welcome");
    this.emit("players");
  }

  _ping() { this._send({ t: "ping", c: Date.now() }); }
  _send(m) { if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(m)); return true; } return false; }

  _onMessage(m) {
    switch (m.t) {
      case "pong": {
        const now = Date.now(), rtt = now - m.c;
        const off = m.now + rtt / 2 - now;
        // trust the quickest round trips most
        if (!this._bestRtt || rtt <= this._bestRtt * 1.5) { this.offset = this._bestRtt ? this.offset * 0.7 + off * 0.3 : off; }
        if (!this._bestRtt || rtt < this._bestRtt) { this._bestRtt = rtt; this.offset = off; }
        this.rtt = rtt;
        break;
      }
      case "welcome": {
        const wasSolo = this.status === "solo";
        const soloDoc = wasSolo && this._solo ? this._solo.doc.lines.map(l => l.t).join("\n") : "";
        this.me = m.you;
        this.offset = m.now - Date.now();
        this.state = m.state;
        this.players = new Map(m.players.map(p => [p.id, p]));
        this.status = "online"; this._everOnline = true; this._solo = null;
        this.emit("status", this.status);
        this.emit("welcome");
        this.emit("players");
        for (const p of m.poses || []) this.emit("pose", p.id, p.pose);
        // work done while offline is not thrown away if the shared room is still empty
        if (wasSolo && soloDoc && !m.state.doc.lines.length) this.op({ kind: "set", text: soloDoc });
        break;
      }
      case "state": {
        const parts = [];
        for (const k of ["doc", "sliders", "view", "play"]) if (m[k] !== undefined) { this.state[k] = m[k]; parts.push(k); }
        this.emit("state", parts, m.by, m.by === (this.me && this.me.id));
        break;
      }
      case "join": this.players.set(m.player.id, m.player); this.emit("players"); this.emit("join", m.player); break;
      case "player": this.players.set(m.player.id, m.player); if (this.me && m.player.id === this.me.id) this.me = m.player; this.emit("players"); break;
      case "leave": { const p = this.players.get(m.id); this.players.delete(m.id); this.emit("players"); this.emit("leave", m.id, p); break; }
      case "pose": this.emit("pose", m.id, m.pose); break;
      case "rtc": this.emit("rtc", m.from, m.data); break;
      case "say": this.emit("say", m.from, m.data); break;
      case "full": this.emit("full"); this._closed = true; this.status = "closed"; this.emit("status", "full"); break;
    }
  }

  // Ask the referee to change the shared state (see state.js for the kinds of op).
  op(op) {
    if (this.status === "solo") {
      const parts = applyOp(this._solo, op, this.me.slot, Date.now());
      if (parts.length) { this.state = publicState(this._solo); this.emit("state", parts, this.me.id, true); }
      return;
    }
    this._send({ t: "op", op, n: ++this._n });
  }
  pose(pose, vr) { this._send({ t: "pose", pose, vr: vr ? 1 : 0 }); }
  rename(name) { this.name = name; if (this.status === "solo") { this.me.name = name; this.emit("players"); } else this._send({ t: "name", name }); }
  rtc(to, data) { this._send({ t: "rtc", to, data }); }
  say(data) { this._send({ t: "say", data }); }
}
