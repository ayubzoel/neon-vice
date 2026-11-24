// Neon Vice — procedural canvas textures. No external assets: every
// surface in Vice Harbor is drawn on a canvas at load time. Speckle uses
// the seeded mulberry32 from data.js (not Math.random), so the textures
// are identical on every load — same city, same look.

import { mulberry32 } from "./data.js";

function paintTexture(w, h, draw) {
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width: w, height: h });
  draw(canvas.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(canvas); // GPU upload
  tex.anisotropy = 4; // crisp at grazing angles
  return tex; // ready to use
}

// One fresh seeded RNG per speckle call (the seed advances in call order,
// which is fixed at load time), so each texture keeps its own grain but
// every load draws the exact same grain.
let grainSeed = 1;
function speckle(ctx, w, h, n, color, maxSize = 2) { // seeded grain
  const rng = mulberry32((grainSeed++ * 2654435761) >>> 0);
  Object.assign(ctx, { fillStyle: color });
  for (let i = 0; i < n; i += 1) {
    const px = rng() * w, py = rng() * h;
    ctx.fillRect(px, py, 1 + rng() * maxSize, 1 + rng() * maxSize);
  }
}

function paintRect(ctx, color, x, y, w, h) {
  Object.assign(ctx, { fillStyle: color });
  ctx.fillRect(x, y, w, h);
}

function repeatWrap(tex, rx, ry) {
  Object.assign(tex, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
  tex.repeat.set(rx, ry);
}

function clampWrap(tex) {
  Object.assign(tex, { wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping });
}

function finish(tex, rx, ry) {
  repeatWrap(tex, rx, ry);
  return tex; // ready to use
}

function finishClamp(tex) {
  clampWrap(tex);
  return tex; // ready to use
}

// Night ground, dark asphalt-grey: speckle plus a faint 30 m grid line on each edge.
function makeGroundTexture() {
  const tex = paintTexture(512, 512, (ctx, w, h) => {
    paintRect(ctx, "#3a3e47", 0, 0, w, h);
    speckle(ctx, w, h, 1400, "rgba(255,255,255,0.035)");
    speckle(ctx, w, h, 500, "rgba(0,0,0,0.25)");
    ctx.strokeStyle = "#3a3f48";
    ctx.lineWidth = 3; // frame line
    ctx.strokeRect(1, 1, w - 2, h - 2); // edge frame
  });
  return finish(tex, 40, 30); // one tile = 30 m
}

// Road tile: 6 m long (u) by the full road width (v), with a centre dash
// and solid edges. UV u scales by length/6 at build time.
function makeAsphaltTexture() {
  const tex = paintTexture(128, 128, (ctx, w, h) => {
    paintRect(ctx, "#2b2f38", 0, 0, w, h);
    speckle(ctx, w, h, 260, "rgba(255,255,255,0.05)");
    speckle(ctx, w, h, 160, "rgba(0,0,0,0.35)");
    // Pale solid edge lines.
    paintRect(ctx, "rgba(226,232,240,0.75)", 0, 4, w, 3);
    paintRect(ctx, "rgba(226,232,240,0.75)", 0, h - 7, w, 3);
    // Amber centre dash.
    paintRect(ctx, "#c9a227", 14, h / 2 - 3, w - 28, 6);
  });
  return finishClamp(tex);
}

// Sidewalk tile: 6 m long (u) by 3 m wide (v), curb edge by the road.
function makeSidewalkTexture() {
  const tex = paintTexture(128, 128, (ctx, w, h) => {
    paintRect(ctx, "#7a7e89", 0, 0, w, h);
    speckle(ctx, w, h, 320, "rgba(255,255,255,0.06)");
    speckle(ctx, w, h, 200, "rgba(0,0,0,0.22)");
    // Joints every 2 m.
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    for (let x = 0; x <= w; x += 43) {
      ctx.fillRect(x, 0, 2, h);
    }
    // Curb face on the road side (v = 0).
    paintRect(ctx, "#3c4048", 0, 0, w, 10);
    paintRect(ctx, "rgba(255,255,255,0.14)", 0, 10, w, 2);
  });
  return finishClamp(tex);
}

// Crossing tile: white bars spanning the road width (u), 3 m deep (v).
function makeZebraTexture() {
  const tex = paintTexture(128, 32, (ctx, w, h) => {
    paintRect(ctx, "#1b1e24", 0, 0, w, h);
    ctx.fillStyle = "rgba(240,244,248,0.92)";
    for (let x = 0; x < w; x += 16) {
      ctx.fillRect(x, 1, 9, h - 2);
    }
  });
  return finishClamp(tex);
}

function makeSandTexture() {
  const tex = paintTexture(256, 256, (ctx, w, h) => {
    paintRect(ctx, "#8a7648", 0, 0, w, h);
    speckle(ctx, w, h, 900, "rgba(255,240,200,0.10)");
    speckle(ctx, w, h, 700, "rgba(60,45,20,0.20)");
  });
  return finish(tex, 12, 28);
}

// Boardwalk planks: weathered wooden boards. Each tile is one 8 m
// boardwalk width x ~35 m of length, with thin plank bands across the
// width (a plank is ~0.15 m wide in the walking direction) in
// alternating warm browns, a dark gap between planks, and a few grain
// strokes per plank. Seeded speckle, like every other texture, so the
// boardwalk looks identical on every load.
function makeBoardwalkTexture() {
  const tex = paintTexture(256, 256, (ctx, w, h) => {
    paintRect(ctx, "#6b4e2e", 0, 0, w, h);
    const plankH = 4; // 64 bands per tile
    for (let y = 0; y < h; y = y + plankH) {
      const band = y / plankH;
      const shade = 34 + (band % 4) * 4;
      paintRect(ctx, `hsl(28, 40%, ${shade}%)`, 0, y + 1, w, plankH - 1);
      ctx.strokeStyle = "rgba(50,32,16,0.35)";
      ctx.lineWidth = 1; // hairline grain
      const grain = new Path2D();
      grain.moveTo(0, y + 2.5);
      grain.bezierCurveTo(w * 0.3, y + 1.5, w * 0.7, y + 3.5, w, y + 2.5);
      ctx.stroke(grain);
      paintRect(ctx, "rgba(18,10,4,0.85)", 0, y, w, 1);
    }
    speckle(ctx, w, h, 400, "rgba(255,230,190,0.08)");
    speckle(ctx, w, h, 300, "rgba(30,20,10,0.25)");
  });
  return finish(tex, 1, 24); // 1 tile across the 8 m width, 24 along 840 m
}

function makeConcreteTexture() {
  const tex = paintTexture(256, 256, (ctx, w, h) => {
    paintRect(ctx, "#45484f", 0, 0, w, h);
    speckle(ctx, w, h, 800, "rgba(255,255,255,0.05)");
    speckle(ctx, w, h, 500, "rgba(0,0,0,0.25)");
    ctx.strokeStyle = "rgba(0,0,0,0.30)";
    ctx.lineWidth = 2; // grid lines
    const grid = new Path2D();
    for (let i = 0; i <= 4; i += 1) {
      grid.moveTo(0, i * 64);
      grid.lineTo(w, i * 64);
      grid.moveTo(i * 64, 0);
      grid.lineTo(i * 64, h);
    }
    ctx.stroke(grid);
  });
  return finish(tex, 6, 18);
}

function makeGrassTexture() {
  const tex = paintTexture(256, 256, (ctx, w, h) => {
    paintRect(ctx, "#1d3320", 0, 0, w, h);
    speckle(ctx, w, h, 1200, "rgba(120,200,120,0.10)");
    speckle(ctx, w, h, 600, "rgba(0,0,0,0.30)");
  });
  return finish(tex, 6, 6);
}

// Facades with glowing windows. kind is 'tower' | 'mid' | 'house' |
// 'warehouse' | 'worship' | 'vital-hospital' | 'vital-police'. One canvas
// serves as map + emissiveMap, so lit windows shine at night while the
// facade itself stays dark.
function makeBuildingTexture(kind) {
  return makeBuildingTextureBase(kind, null); // dark base
}

// Light-base variant for the pastel facades: the same window pattern, but
// a LIGHT grey base (#b5b5b5) instead of the dark one. A pastel
// per-instance color multiplies a dark base into a still-dark facade
// (0.14 x 1.0 = 0.14) — invisible as "pastel". Multiplying a light base
// gives a bright pastel (0.71 x 1.0 = 0.71 pink/tosca/mint), which is the
// Ocean Drive look. The windows are the same warm lit ones, so they
// still read at night.
function makeBuildingTextureLight(kind) {
  return makeBuildingTextureBase(kind, "#b5b5b5");
}

const FACADE_BASES = new Map([
  ["tower", "#232a36"],
  ["mid", "#2a2622"],
  ["house", "#33302a"],
  ["warehouse", "#2e2a26"],
  ["worship", "#3a2f26"],
  ["vital-hospital", "#3c4148"],
  ["vital-police", "#232c3e"],
]);
const FACADE_COLS = { warehouse: 5, house: 4 };
const FACADE_ROWS = { tower: 14, house: 2, warehouse: 2 };
const LIT_WINDOWS = ["#ffd28a", "#ffb347", "#ffe9b0", "#f9a8d4"];

function makeBuildingTextureBase(kind, lightBase) { // shared facade painter
  const base = lightBase ?? FACADE_BASES.get(kind) ?? "#2a2a2a";
  const cols = FACADE_COLS[kind] ?? 7;
  const rows = FACADE_ROWS[kind] ?? 9;
  return paintTexture(256, 256, (ctx, w, h) => {
    paintRect(ctx, base, 0, 0, w, h);
    // Faint vertical panel shading.
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    for (let x = 0; x < w; x += 36) {
      ctx.fillRect(x, 0, 2, h);
    }
    // Dark band along the ground floor.
    paintRect(ctx, "rgba(0,0,0,0.35)", 0, h - 18, w, 18);
    const cw = w / cols; // cell width
    const ch = h / rows; // cell height
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const x = cw * (c + 0.22);
        const y = ch * (r + 0.22);
        const ww = cw * 0.56; // window width
        const wh = ch * 0.56; // window height
        if (kind === "worship" && r < rows - 1) {
          // Tall arches: warm, usually lit.
          const tint = Math.random() < 0.8 ? "#ffca6a" : "#10151d";
          paintRect(ctx, tint, x, y - ch * 0.2, ww, wh + ch * 0.4);
          continue; // next window
        }
        const lit = Math.random() < 0.62; // most windows lit
        const tint = lit
          ? LIT_WINDOWS[Math.floor(Math.random() * 4)]
          : "#0d1219";
        paintRect(ctx, tint, x, y, ww, wh);
      }
    }
    if (kind === "vital-hospital") {
      // Red cross near the top.
      paintRect(ctx, "#c2272f", w * 0.32, 8, w * 0.36, 26);
      paintRect(ctx, "#f8fafc", w * 0.47, 12, w * 0.06, 18);
      paintRect(ctx, "#f8fafc", w * 0.4, 17, w * 0.2, 8);
    }
    if (kind === "vital-police") {
      paintRect(ctx, "#2563eb", 0, 8, w, 24);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 15px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("POLICE", w / 2, 26);
    }
    if (kind === "worship") {
      paintRect(ctx, "#ffd28a", w / 2 - 2, 4, 4, 22);
      paintRect(ctx, "#ffd28a", w / 2 - 8, 10, 16, 4);
    }
  });
}

export { makeGroundTexture, makeAsphaltTexture, makeSidewalkTexture, makeZebraTexture, makeSandTexture, makeBoardwalkTexture, makeConcreteTexture, makeGrassTexture, makeBuildingTexture, makeBuildingTextureLight };
