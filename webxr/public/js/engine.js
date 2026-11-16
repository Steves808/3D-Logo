// Runs Logo programs with the REAL desktop engine (public/engine/logo3d.js), loaded in a hidden frame.
// To move the VR build to a newer Logo 3D, replace the files in public/engine/ - nothing here changes.

export async function loadEngine() {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;left:-2000px;top:0;width:900px;height:600px;border:0;visibility:hidden;pointer-events:none";
  frame.src = "./engine/index.html";
  document.body.appendChild(frame);
  await new Promise((resolve, reject) => {
    frame.addEventListener("load", resolve, { once: true });
    frame.addEventListener("error", () => reject(new Error("engine page failed to load")), { once: true });
    setTimeout(() => reject(new Error("engine page took too long to load")), 20000);
  });
  let L = null;
  for (let i = 0; i < 100 && !L; i++) {
    L = frame.contentWindow && frame.contentWindow.Logo3D;
    if (!L) await new Promise(r => setTimeout(r, 50));
  }
  if (!L) throw new Error("engine/logo3d.js did not start");

  return {
    version: L.version || "?",
    // run({ code, seed, time, frame, sliders:{NAME:value} })
    run(o) {
      const t0 = performance.now();
      const opts = { seed: o.seed, time: o.time || 0, frame: o.frame || 0 };
      let r = L.runSource(o.code, opts);
      // shared slider positions: apply any that differ, then run once more
      if (o.sliders && L.setSlider && r.sliderInfo && r.sliderInfo.length) {
        let changed = false;
        for (const s of r.sliderInfo) {
          const want = o.sliders[s.name];
          if (want != null && Math.abs(want - s.value) > 1e-9) { if (L.setSlider(s.name, want)) changed = true; }
        }
        if (changed) r = L.runSource(o.code, opts);
      }
      let turtle = r.turtle;
      if (!turtle) {     // older engine without the extra hook: guess from the last thing drawn
        const last = r.segments[r.segments.length - 1];
        turtle = last ? { pos: last.b, R: last.R || [1, 0, 0, 0, 1, 0, 0, 0, 1], penDown: true, color: last.color }
                      : { pos: { x: 0, y: 0, z: 0 }, R: [1, 0, 0, 0, 1, 0, 0, 0, 1], penDown: true, color: "#ffffff" };
      }
      return {
        error: r.error, segs: r.segments, events: r.events || [], usesTime: !!r.usesTime,
        scene: r.scene || {}, sliders: r.sliderInfo || [], canSlide: !!L.setSlider, turtle,
        steps: r.segments.length ? r.segments[r.segments.length - 1].step : 0,
        ms: performance.now() - t0
      };
    }
  };
}

// examples.txt: blocks separated by a line of slashes; the first line ";Title" names the block.
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
