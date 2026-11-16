// Pretend players from the command line (handy on the VPS, or to fill a room before you put the headset on):
//   node test/bots.js                         2 bots in room "main" on http://localhost:3000
//   node test/bots.js 3 myroom draw           3 bots in "myroom" that also press tablet buttons
//   node test/bots.js 2 main draw wss://elekah.com:3001/ws
import { Net } from "../public/js/net.js";
const n = Math.max(1, Math.min(6, parseInt(process.argv[2] || "2", 10) || 2));
const room = process.argv[3] || "main";
const draw = process.argv[4] === "draw";
const url = process.argv[5] || "ws://localhost:" + (process.env.PORT || 3000) + "/ws";
const MOVES = ["FD 50", "RT 90", "LT 45", "UP 45", "SC RC", "REPEAT 4 [FD 40 RT 90]", "REPEAT 3 [FD 60 RT 120]", "AR 180 20", "BALL 6"];
console.log(n + " bot(s) joining room '" + room + "' at " + url + (draw ? " (drawing)" : "") + "  -  Ctrl+C to stop");
for (let i = 0; i < n; i++) {
  const net = new Net({ url, room, bot: true, allowSolo: false });
  const phase = i * 2.1, radius = 1.6 + i * 0.25;
  net.on("welcome", () => console.log("  " + net.me.name + " joined (" + net.players.size + " in room)"));
  net.connect();
  setInterval(() => {
    if (net.status !== "online") return;
    const t = Date.now() / 1000, a = phase + t * 0.15, x = Math.sin(a) * radius, z = Math.cos(a) * radius;
    const r = (v) => Math.round(v * 1000) / 1000, qy = r(Math.sin(a / 2)), qw = r(Math.cos(a / 2));
    net.pose({ h: [r(x), 1.55, r(z), 0, qy, 0, qw], l: [r(x - 0.2), 1.05, r(z), 0, qy, 0, qw], r: [r(x + 0.2), 1.05, r(z), 0, qy, 0, qw] }, true);
  }, 100);
  if (draw) setInterval(() => { if (net.status === "online") net.op({ kind: "append", text: MOVES[(Math.random() * MOVES.length) | 0] }); }, 6000 + i * 1500);
}
