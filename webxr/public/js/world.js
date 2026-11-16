// The 3D room: renderer, lights, floor, the shared "view" (where the sculpture sits), the code wall,
// and the other players' avatars.

import * as THREE from "../vendor/three.module.min.js";
import { Sculpture } from "./render.js";
import { PLAYER_COLORS } from "./state.js";

export { THREE };

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, Menlo, Consolas, monospace";

// Where player number `slot` stands: on an arc around the sculpture, all facing it (and the code wall).
export function spawnFor(slot) {
  const angles = [0, -38, 38, -76, 76, -114, 114, 180];
  const a = angles[slot % angles.length] * Math.PI / 180, R = 1.7;
  return { x: Math.sin(a) * R, z: Math.cos(a) * R, yaw: a };
}

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local-floor");
  try { renderer.xr.setFoveation(1); } catch (e) { /* older browsers */ }

  const scene = new THREE.Scene();
  const bgColor = new THREE.Color("#0b0f14");
  scene.background = bgColor;

  const camera = new THREE.PerspectiveCamera(60, 1, 0.03, 400);
  const rig = new THREE.Group(); rig.name = "rig";       // move the rig to move the player
  rig.add(camera);
  scene.add(rig);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(2, 5, 3); scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fb6ff, 0.6); fill.position.set(-3, 2, -4); scene.add(fill);

  // floor: a quiet grid with a ring marking the middle
  const floor = new THREE.Group(); floor.name = "floor";
  const grid = new THREE.GridHelper(16, 32, 0x3d5a80, 0x1d2a3a);
  grid.material.transparent = true; grid.material.opacity = 0.7;
  floor.add(grid);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.48, 0.5, 48), new THREE.MeshBasicMaterial({ color: 0x4c6a94, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; floor.add(ring);
  scene.add(floor);

  // the shared transform: everything the turtle draws hangs under this
  const viewRoot = new THREE.Group(); viewRoot.name = "view";
  scene.add(viewRoot);
  const sculpture = new Sculpture();
  viewRoot.add(sculpture.group);

  const board = new Board();
  scene.add(board.mesh);

  const avatars = new Map();
  const avatarLayer = new THREE.Group(); scene.add(avatarLayer);

  function resize() {
    const w = canvas.clientWidth || 2, h = canvas.clientHeight || 2;
    if (renderer.xr.isPresenting) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  return {
    renderer, scene, camera, rig, floor, viewRoot, sculpture, board, avatars, bgColor,
    resize,
    setBackground(css, transparent) {
      try { bgColor.set(css || "#0b0f14"); } catch (e) { bgColor.set("#0b0f14"); }
      scene.background = transparent ? null : bgColor;
      renderer.setClearColor(0x000000, transparent ? 0 : 1);
    },
    setPlayers(players, myId, showTags) {
      for (const [id, av] of avatars) if (!players.has(id) || id === myId) { avatarLayer.remove(av.group); av.dispose(); avatars.delete(id); }
      for (const [id, p] of players) {
        if (id === myId) continue;
        let av = avatars.get(id);
        if (!av) { av = new Avatar(p); avatars.set(id, av); avatarLayer.add(av.group); }
        av.setInfo(p, showTags);
      }
    },
    updateAvatars(dt) { for (const av of avatars.values()) av.update(dt, camera); }
  };
}

// ---------- the code wall ----------
class Board {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1600; this.canvas.height = 1000;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, opacity: 0.94 }));
    this.mesh.position.set(0, 1.75, -3.0);
    this.mesh.name = "board";
    this.sig = "";
  }
  // d: { room, lines:[{t,by}], highlight, status:{text,error}, players:[{name,color}], hint }
  draw(d) {
    const sig = JSON.stringify([d.room, d.lines.length, d.lines.map(l => l.t + l.by).join("\n"), d.highlight, d.status, d.players.map(p => p.name + p.color), d.hint]);
    if (sig === this.sig) return;
    this.sig = sig;
    const g = this.canvas.getContext("2d"), W = 1600, H = 1000;
    g.fillStyle = "#0d1118"; g.fillRect(0, 0, W, H);
    g.strokeStyle = "#2b3a52"; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
    g.textBaseline = "middle"; g.textAlign = "left";
    g.fillStyle = "#9fb3d1"; g.font = "600 40px " + FONT;
    g.fillText("Logo 3D Together   ·   room: " + d.room, 36, 48);
    // players, right side of the header
    let x = W - 36; g.font = "600 34px " + FONT; g.textAlign = "right";
    for (const p of d.players.slice().reverse()) {
      const w = g.measureText(p.name).width;
      g.fillStyle = "#e8eefc"; g.fillText(p.name, x, 48);
      g.fillStyle = p.color; g.beginPath(); g.arc(x - w - 22, 48, 13, 0, 7); g.fill();
      x -= w + 64;
    }
    g.textAlign = "left";
    g.fillStyle = "#1a2231"; g.fillRect(24, 86, W - 48, 3);

    const rows = 20, lh = 41, y0 = 118;
    const lines = d.lines;
    let start = Math.max(0, lines.length - rows);
    if (d.highlight > 0) start = Math.max(0, Math.min(Math.max(0, lines.length - rows), d.highlight - Math.ceil(rows / 2)));
    g.font = "500 33px " + MONO;
    if (!lines.length) {
      g.fillStyle = "#6c7c96"; g.font = "500 40px " + FONT;
      g.fillText("The program is empty.", 60, 220);
      g.fillText("Press buttons on your tablet - each press adds a line here,", 60, 290);
      g.fillText("and everyone in the room sees the turtle draw it.", 60, 345);
    }
    for (let i = 0; i < Math.min(rows, lines.length - start); i++) {
      const l = lines[start + i], n = start + i + 1, y = y0 + i * lh;
      if (n === d.highlight) { g.fillStyle = "rgba(255,214,10,0.20)"; g.fillRect(28, y - lh / 2, W - 56, lh); }
      g.fillStyle = PLAYER_COLORS[(l.by >= 0 ? l.by : 0) % PLAYER_COLORS.length]; g.fillRect(34, y - 15, 9, 30);
      g.fillStyle = "#5e6c84"; g.fillText(String(n).padStart(3, " "), 54, y);
      g.fillStyle = "#eef2fb";
      let t = l.t; while (t.length > 3 && g.measureText(t).width > W - 190) t = t.slice(0, -2);
      g.fillText(t === l.t ? t : t + "…", 136, y);
    }
    if (start > 0) { g.fillStyle = "#6c7c96"; g.font = "500 26px " + FONT; g.fillText("▲ " + start + " more lines above", W - 380, 108); }

    g.fillStyle = "#1a2231"; g.fillRect(24, H - 76, W - 48, 3);
    g.font = "600 34px " + FONT;
    g.fillStyle = d.status.error ? "#ff8a80" : "#7fe0a3";
    let st = d.status.text; while (st.length > 3 && g.measureText(st).width > W - 80) st = st.slice(0, -2);
    g.fillText(st, 36, H - 38);
    if (d.hint) { g.textAlign = "right"; g.fillStyle = "#6c7c96"; g.font = "500 28px " + FONT; g.fillText(d.hint, W - 36, H - 38); }
    this.tex.needsUpdate = true;
  }
}

// ---------- other players ----------
function nameTag(name, color) {
  const cv = document.createElement("canvas"); cv.width = 384; cv.height = 80;
  const g = cv.getContext("2d");
  g.fillStyle = "rgba(10,12,18,0.72)";
  g.beginPath(); g.roundRect ? g.roundRect(4, 4, 376, 72, 24) : g.rect(4, 4, 376, 72); g.fill();
  g.fillStyle = color; g.beginPath(); g.arc(44, 40, 16, 0, 7); g.fill();
  g.fillStyle = "#ffffff"; g.font = "600 40px " + FONT; g.textBaseline = "middle"; g.textAlign = "left";
  g.fillText(name, 74, 42, 290);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(0.34, 0.07, 1);
  return sp;
}

class Avatar {
  constructor(info) {
    this.group = new THREE.Group();
    this.color = new THREE.Color(info.color);
    const mat = new THREE.MeshLambertMaterial({ color: this.color });
    this.head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), mat);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.065, 0.06), new THREE.MeshLambertMaterial({ color: 0x14161c }));
    visor.position.set(0, 0.015, -0.085);                       // shows which way they are looking
    this.head.add(skull, visor);
    this.body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.13, 0.42, 14), new THREE.MeshLambertMaterial({ color: this.color, transparent: true, opacity: 0.55 }));
    this.hands = [0, 1].map(() => {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.09), mat); h.visible = false; return h;
    });
    // their laser, so you can see what a friend is pointing at
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    this.laser = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: this.color, transparent: true, opacity: 0.5 }));
    this.laser.visible = false;
    this.group.add(this.head, this.body, this.hands[0], this.hands[1], this.laser);
    this.tag = null;
    this.target = null; this.seen = false; this.lastPose = 0;
    this.group.visible = false;
    this.name = "";
  }
  setInfo(info, showTags) {
    if (info.name !== this.name || !this.tag) {
      if (this.tag) { this.group.remove(this.tag); this.tag.material.map.dispose(); this.tag.material.dispose(); }
      this.name = info.name;
      this.tag = nameTag(info.name, info.color);
      this.group.add(this.tag);
    }
    this.tag.visible = !!showTags;
  }
  setPose(pose) { this.target = pose; this.lastPose = performance.now(); }
  update(dt) {
    const t = this.target;
    if (!t || !t.h) return;
    const k = this.seen ? Math.min(1, dt * 12) : 1;
    this.seen = true; this.group.visible = true;
    lerpPose(this.head, t.h, k);
    this.body.position.set(this.head.position.x, this.head.position.y - 0.36, this.head.position.z);
    if (this.tag) this.tag.position.set(this.head.position.x, this.head.position.y + 0.23, this.head.position.z);
    [t.l, t.r].forEach((hp, i) => {
      const h = this.hands[i];
      if (hp) { const first = !h.visible; h.visible = true; lerpPose(h, hp, first ? 1 : k); } else h.visible = false;
    });
    if (t.ray && t.ray.length >= 8) {
      this.laser.visible = true;
      lerpPose(this.laser, t.ray, 1);
      this.laser.scale.set(1, 1, t.ray[7]);
    } else this.laser.visible = false;
  }
  dispose() {
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  }
}

const _q = new THREE.Quaternion();
function lerpPose(obj, a, k) {
  obj.position.lerp(_v.set(a[0], a[1], a[2]), k);
  obj.quaternion.slerp(_q.set(a[3], a[4], a[5], a[6]), k);
}
const _v = new THREE.Vector3();

// pack an object's world position + rotation into 7 short numbers for the network
const _wp = new THREE.Vector3(), _wq = new THREE.Quaternion(), _ws = new THREE.Vector3();
export function packPose(obj) {
  obj.updateWorldMatrix(true, false);
  obj.matrixWorld.decompose(_wp, _wq, _ws);
  const r = (n) => Math.round(n * 1000) / 1000;
  return [r(_wp.x), r(_wp.y), r(_wp.z), r(_wq.x), r(_wq.y), r(_wq.z), r(_wq.w)];
}
