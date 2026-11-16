// Loads the real browser engine (public/engine/logo3d.js) in Node with a pretend page,
// so tests can run Logo programs without a browser.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadEngine() {
  const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === "measureText" ? () => ({ width: 10 }) : (k === "createRadialGradient" || k === "createLinearGradient") ? () => ({ addColorStop() {} }) : k === "getImageData" ? () => ({ data: [0, 0, 0, 255] }) : () => {})), set: (t, k, v) => { t[k] = v; return true; } });
  const el = () => new Proxy({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, children: [], dataset: {},
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {}, setAttribute() {}, getAttribute: () => null,
    querySelector: () => null, querySelectorAll: () => [], closest: () => null, getContext: () => ctx2d,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }), focus() {}, click() {},
    clientWidth: 800, clientHeight: 600, width: 800, height: 600, value: "", textContent: "", innerHTML: "", options: [] },
    { get: (t, k) => (k in t ? t[k] : undefined), set: (t, k, v) => { t[k] = v; return true; } });
  const canvas = el();
  const document = { getElementById: (id) => (id === "c" ? canvas : null), createElement: () => el(), addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], body: el(), documentElement: el() };
  const window = { document, location: { hash: "", search: "", href: "http://test/" }, addEventListener() {}, removeEventListener() {},
    devicePixelRatio: 1, innerWidth: 800, innerHeight: 600, localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, performance, console,
    fetch: () => Promise.reject(new Error("no fetch in tests")), navigator: { userAgent: "node" }, history: { replaceState() {} } };
  window.window = window; window.self = window; window.globalThis = window;
  const sandbox = vm.createContext(Object.assign(window, { URL, Blob: globalThis.Blob, Math, Date, JSON, Promise }));
  const src = fs.readFileSync(path.join(here, "../public/engine/logo3d.js"), "utf8");
  vm.runInContext(src, sandbox, { filename: "logo3d.js" });
  if (!sandbox.Logo3D) throw new Error("engine did not expose window.Logo3D");
  return sandbox.Logo3D;
}

export function parseExamples(text) {
  const out = [];
  for (const block of String(text).replace(/\r/g, "").split(/^\s*\/{5,}\s*$/m)) {
    const lines = block.split("\n");
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) continue;
    let title = "Example " + (out.length + 1);
    if (lines[0].trim().startsWith(";")) title = lines[0].trim().replace(/^;+\s*/, "") || title;
    out.push({ title, code: lines.join("\n") });
  }
  return out;
}
