// Pretend players, for testing alone.  Add  ?bots=2  to the address (and  &botsdraw=1  to let them
// press tablet buttons too).  Each bot is a real extra connection to the room, so everything a
// second and third person would cause - avatars, joins, edits arriving mid-edit - really happens.

import { Net } from "./net.js";

const MOVES = [
  "FD 50", "FD 25", "RT 90", "LT 90", "RT 45", "UP 45", "DN 45", "SC RED", "SC CYAN", "SC YELLOW", "SC GREEN",
  "REPEAT 4 [FD 40 RT 90]", "REPEAT 3 [FD 60 RT 120]", "REPEAT 5 [FD 50 RT 144]", "AR 180 20", "BALL 6", "RL 90", "SC RC"
];

export class Bots {
  constructor(url, room) { this.url = url; this.room = room; this.list = []; this.draw = false; }
  get count() { return this.list.length; }

  add() {
    const net = new Net({ url: this.url, room: this.room, bot: true, allowSolo: false });
    const bot = { net, phase: Math.random() * 6.28, speed: 0.12 + Math.random() * 0.12, radius: 1.5 + Math.random() * 0.8,
                  nextPose: 0, nextDraw: performance.now() + 3000 + Math.random() * 4000 };
    net.connect();
    this.list.push(bot);
    return bot;
  }
  remove() { const b = this.list.pop(); if (b) b.net.close(); }
  setCount(n) { n = Math.max(0, Math.min(6, n | 0)); while (this.list.length < n) this.add(); while (this.list.length > n) this.remove(); }

  update(now) {
    for (const b of this.list) {
      if (b.net.status !== "online") continue;
      if (now >= b.nextPose) {
        b.nextPose = now + 90;
        const t = now / 1000, a = b.phase + t * b.speed;
        const x = Math.sin(a) * b.radius, z = Math.cos(a) * b.radius, y = 1.55 + Math.sin(t * 0.7 + b.phase) * 0.05;
        // face the middle: yaw = a (same convention as a player's spawn), with a little nod
        const yaw = a + Math.sin(t * 0.5 + b.phase) * 0.35, half = yaw / 2;
        const q = [0, Math.sin(half), 0, Math.cos(half)];
        const hand = (side) => {
          const hx = x + Math.cos(a) * 0.22 * side - Math.sin(a) * 0.3, hz = z - Math.sin(a) * 0.22 * side - Math.cos(a) * 0.3;
          return [r3(hx), r3(1.05 + Math.sin(t * 1.3 + side + b.phase) * 0.08), r3(hz), q[0], r3(q[1]), q[2], r3(q[3])];
        };
        b.net.pose({ h: [r3(x), r3(y), r3(z), 0, r3(q[1]), 0, r3(q[3])], l: hand(-1), r: hand(1) }, true);
      }
      if (this.draw && now >= b.nextDraw) {
        b.nextDraw = now + 5000 + Math.random() * 6000;
        const lines = (b.net.state && b.net.state.doc.lines.length) || 0;
        if (lines > 40 && Math.random() < 0.5) b.net.op({ kind: "undo" });
        else b.net.op({ kind: "append", text: MOVES[(Math.random() * MOVES.length) | 0] });
      }
    }
  }
}
function r3(n) { return Math.round(n * 1000) / 1000; }
