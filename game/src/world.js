// Neon Vice — Vice Harbor (Builder B). One open night city, 1200 x 900 m:
// downtown (west) + harbor strip (centre-east) + beach + water (east edge).
// All geometry is PRE-BUILT once at load (instanced / merged); nothing is
// built per frame.
//
// Frustum-culling lesson from Neon Bay v7, VERIFIED against this vendored
// three.js r149: Frustum.intersectsObject reads ONLY geometry.boundingSphere,
// and InstancedMesh has NO computeBoundingSphere / boundingSphere of its own
// (verified in the browser: typeof is 'undefined'). A unit-box geometry's
// sphere (r~0.87) would cull a city-wide InstancedMesh whenever its origin
// leaves the frustum. So every InstancedMesh here gets BOTH a city-sized
// geometry.boundingSphere (via secureInstanced) AND frustumCulled = false;
// merged meshes get a computed geometry bounding sphere + frustumCulled false.
// The city is therefore full from second 1, with no pop-in.

import { CONFIG } from './config.js';
import * as TEX from './textures.js';
import { buildRoadGraph, trafficLightState } from './roadgraph.js';
import {
  XS, ZS, V_WIDTHS, H_WIDTHS, WATER_X0, SAND_X0,
  zoneOf, RESERVED, PARK_CELL, PLAZA_CELL, NEON_COLORS,
  FLYOVERS, FLYOVER,
  mulberry32, randRange, pick,
} from './data.js';

// Merge indexed BufferGeometries (position/normal/uv) into one geometry.
function mergeGeometries(geoms) {
  let vCount = 0;
  let iCount = 0;
  for (const g of geoms) {
    vCount += g.attributes.position.count;
    iCount += g.index.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vOff = 0;
  let iOff = 0;
  for (const g of geoms) {
    pos.set(g.attributes.position.array, vOff * 3);
    nor.set(g.attributes.normal.array, vOff * 3);
    uv.set(g.attributes.uv.array, vOff * 2);
    const src = g.index.array;
    for (let i = 0; i < src.length; i++) idx[iOff + i] = src[i] + vOff;
    vOff += g.attributes.position.count;
    iOff += src.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// See the header note: r149 culls InstancedMesh by geometry.boundingSphere
// only. Give the (unit) geometry a city-sized sphere and switch culling off.
function secureInstanced(mesh) {
  mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1200);
  mesh.frustumCulled = false;
  return mesh;
}

// Flat ground strip (road / sidewalk / zebra) with UVs baked for a repeating
// texture: u runs along the strip length (tile = 6 m), v across its width.
// alongX: strip runs along X (else along Z). cx/cz: centre. y: height.
function stripGeo(len, wid, alongX, cx, cz, y, uRepeat) {
  const g = new THREE.PlaneGeometry(wid, len, 1, 1);
  g.rotateX(-Math.PI / 2);
  if (alongX) g.rotateY(Math.PI / 2);
  // Swap UVs so u follows the strip length, scaled to the tile repeat.
  const uvAttr = g.attributes.uv;
  for (let i = 0; i < uvAttr.count; i++) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    uvAttr.setXY(i, v * uRepeat, u);
  }
  g.translate(cx, y, cz);
  return g;
}

export function createWorld(scene) {
  const t0 = performance.now();
  const rng = mulberry32(20261120);
  const W = CONFIG.world.width;
  const D = CONFIG.world.depth;

  // ---- Night sky, fog, lights -------------------------------------------
  // Builder C v4: windowMats / lampHeadMat / skyStars are collected here so
  // weather.js can drive window glow, lamp glow and moon/stars per time
  // phase. Additive only — no existing world behaviour changes.
  const windowMats = []; // [{mat, base}] building materials with lit windows
  let lampHeadMat = null;
  let skyStars = null;
  scene.background = new THREE.Color(0x070b1a);
  scene.fog = new THREE.Fog(0x0a0f22, 200, 1500);
  const hemi = new THREE.HemisphereLight(0x46587e, 0x1a1e26, 1.3);
  // Flat lift so the play area stays readable at night (windows are emissive
  // and unaffected by this, so the night contrast is kept).
  scene.add(new THREE.AmbientLight(0x36405a, 0.55));
  scene.add(hemi);
  const moonLight = new THREE.DirectionalLight(0xbdd0ff, 1.0);
  moonLight.position.set(-160, 300, -140);
  scene.add(moonLight);

  // Moon + glow, stars. fog:false so they stay bright.
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(38, 32),
    new THREE.MeshBasicMaterial({ color: 0xe8eefc, fog: false }),
  );
  moon.position.set(-380, 300, -680);
  moon.lookAt(0, 0, 0);
  scene.add(moon);
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(62, 32),
    new THREE.MeshBasicMaterial({ color: 0x8fa8d8, transparent: true, opacity: 0.14, fog: false }),
  );
  glow.position.copy(moon.position).multiplyScalar(1.001);
  glow.lookAt(0, 0, 0);
  scene.add(glow);
  {
    const starPos = new Float32Array(450 * 3);
    for (let i = 0; i < 450; i++) {
      const a = rng() * Math.PI * 2;
      const e = randRange(rng, 0.15, 1.4);
      const r = randRange(rng, 850, 1200);
      starPos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      starPos[i * 3 + 1] = Math.sin(e) * r;
      starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({
      color: 0xcdd8ff, size: 1.6, sizeAttenuation: false, fog: false,
      transparent: true, opacity: 0.85,
    }));
    stars.frustumCulled = false;
    skyStars = stars; // Builder C v4: weather fades stars out by day.
    scene.add(stars);
  }

  // ---- Ground surfaces ---------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshStandardMaterial({ map: TEX.makeGroundTexture(), roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 0);
  scene.add(ground);

  // Quay concrete (x 360..420), beach sand (420..470), water (470..600).
  const quay = new THREE.Mesh(
    new THREE.PlaneGeometry(60, D),
    new THREE.MeshStandardMaterial({ map: TEX.makeConcreteTexture(), roughness: 0.9, metalness: 0 }),
  );
  quay.rotation.x = -Math.PI / 2;
  quay.position.set(390, 0.02, 0);
  scene.add(quay);
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(SAND_X0 - 420 + 50, D),
    new THREE.MeshStandardMaterial({ map: TEX.makeSandTexture(), roughness: 1, metalness: 0 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(445, 0.03, 0);
  scene.add(sand);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(600 - WATER_X0, D),
    new THREE.MeshStandardMaterial({
      color: 0x14507e, roughness: 0.12, metalness: 0.5,
      emissive: 0x0a2438, emissiveIntensity: 0.7,
      transparent: true, opacity: 0.9,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set((WATER_X0 + 600) / 2, 0.12, 0);
  scene.add(water);

  // Park grass.
  const parkX0 = XS[PARK_CELL.col];
  const parkX1 = XS[PARK_CELL.col + 1];
  const parkZ0 = ZS[PARK_CELL.row];
  const parkZ1 = ZS[PARK_CELL.row + 1];
  const park = new THREE.Mesh(
    new THREE.PlaneGeometry(parkX1 - parkX0 - 4, parkZ1 - parkZ0 - 4),
    new THREE.MeshStandardMaterial({ map: TEX.makeGrassTexture(), roughness: 1, metalness: 0 }),
  );
  park.rotation.x = -Math.PI / 2;
  park.position.set((parkX0 + parkX1) / 2, 0.02, (parkZ0 + parkZ1) / 2);
  scene.add(park);

  // Lighter concrete plaza disc at the spawn (kept from the scaffold).
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(CONFIG.world.plazaRadius, 48),
    new THREE.MeshStandardMaterial({ color: CONFIG.colors.plaza, roughness: 0.9, metalness: 0 }),
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(0, 0.04, 0);
  scene.add(plaza);

  // Four neon pylons at the plaza corners (scaffold depth cues, kept).
  const pylonGeo = new THREE.BoxGeometry(1.2, 14, 1.2);
  const pylonMat = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.pylon, emissive: CONFIG.colors.pylon,
    emissiveIntensity: 0.55, roughness: 0.4,
  });
  for (const [px, pz] of [[-30, -30], [30, -30], [-30, 30], [30, 30]]) {
    const pylon = new THREE.Mesh(pylonGeo, pylonMat);
    pylon.position.set(px, 7, pz);
    scene.add(pylon);
  }

  // ---- Road graph + road / sidewalk / zebra meshes -----------------------
  const roadGraph = buildRoadGraph(XS, ZS, V_WIDTHS, H_WIDTHS);

  const roadGeos = [];
  const walkGeos = [];
  const zebraGeos = [];
  for (const s of roadGraph.segments) {
    const alongX = s.kind === 'horizontal';
    const cx = (s.ax + s.bx) / 2;
    const cz = (s.az + s.bz) / 2;
    roadGeos.push(stripGeo(s.length, s.width, alongX, cx, cz, 0.05, s.length / 6));
    // Sidewalks (v5): 3 m strips on both sides, slightly raised — TRIMMED
    // at each end by the crossing street's half-width, so no strip juts
    // into the cross road, over the zebra, or across the intersection
    // box. (Before: full node-to-node length, so every strip ran through
    // the crossing road's asphalt band and overlapped the perpendicular
    // strips at the corners.)
    const nA = roadGraph.nodes[s.a];
    const nB = roadGraph.nodes[s.b];
    const trimA = alongX ? V_WIDTHS[nA.col] / 2 : H_WIDTHS[nA.row] / 2;
    const trimB = alongX ? V_WIDTHS[nB.col] / 2 : H_WIDTHS[nB.row] / 2;
    const wLen = s.length - trimA - trimB;
    // Trimmed midpoint: shifted (trimA - trimB)/2 toward B along the
    // segment direction (segments always run low -> high col/row).
    const wcx = cx + (alongX ? (trimA - trimB) / 2 : 0);
    const wcz = cz + (alongX ? 0 : (trimA - trimB) / 2);
    const off = s.width / 2 + 1.5;
    const px = alongX ? 0 : off;
    const pz = alongX ? off : 0;
    walkGeos.push(stripGeo(wLen, 3, alongX, wcx + px, wcz + pz, 0.08, wLen / 6));
    walkGeos.push(stripGeo(wLen, 3, alongX, wcx - px, wcz - pz, 0.08, wLen / 6));
  }
  // Sidewalk corner pads (v5): a 3x3 pad fills each intersection corner
  // between the two trimmed strips, so the corner follows the
  // intersection shape. A pad exists ONLY where both adjacent arms exist
  // (a horizontal arm toward sx AND a vertical arm toward sz); at road
  // ends the missing arm gets no pad, so the sidewalk stops flush with
  // the road end instead of jutting out past it.
  for (const n of roadGraph.nodes) {
    const vW = V_WIDTHS[n.col];
    const hW = H_WIDTHS[n.row];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const hasH = n.col + sx >= 0 && n.col + sx < XS.length;
        const hasV = n.row + sz >= 0 && n.row + sz < ZS.length;
        if (!hasH || !hasV) continue;
        walkGeos.push(stripGeo(3, 3, true, n.x + sx * (vW / 2 + 1.5), n.z + sz * (hW / 2 + 1.5), 0.08, 0.5));
      }
    }
  }
  // Zebra crossings: one per approach at every intersection.
  for (const n of roadGraph.nodes) {
    const vW = V_WIDTHS[n.col];
    const hW = H_WIDTHS[n.row];
    const approaches = [
      { alongX: false, cx: n.x, cz: n.z - (hW / 2 + 2.5), w: vW },
      { alongX: false, cx: n.x, cz: n.z + (hW / 2 + 2.5), w: vW },
      { alongX: true, cx: n.x - (vW / 2 + 2.5), cz: n.z, w: hW },
      { alongX: true, cx: n.x + (vW / 2 + 2.5), cz: n.z, w: hW },
    ];
    for (const ap of approaches) {
      const g = new THREE.PlaneGeometry(ap.w, 3);
      g.rotateX(-Math.PI / 2);
      if (ap.alongX) g.rotateY(Math.PI / 2);
      const uvAttr = g.attributes.uv;
      for (let i = 0; i < uvAttr.count; i++) uvAttr.setX(i, uvAttr.getX(i) * (ap.w / 1.2));
      g.translate(ap.cx, 0.06, ap.cz);
      zebraGeos.push(g);
    }
  }
  const roadsMesh = new THREE.Mesh(
    mergeGeometries(roadGeos),
    new THREE.MeshStandardMaterial({ map: TEX.makeAsphaltTexture(), roughness: 0.9, metalness: 0 }),
  );
  roadsMesh.frustumCulled = false;
  scene.add(roadsMesh);
  const walksMesh = new THREE.Mesh(
    mergeGeometries(walkGeos),
    new THREE.MeshStandardMaterial({ map: TEX.makeSidewalkTexture(), roughness: 0.95, metalness: 0 }),
  );
  walksMesh.frustumCulled = false;
  scene.add(walksMesh);
  const zebraMesh = new THREE.Mesh(
    mergeGeometries(zebraGeos),
    new THREE.MeshStandardMaterial({ map: TEX.makeZebraTexture(), roughness: 0.9, metalness: 0 }),
  );
  zebraMesh.frustumCulled = false;
  scene.add(zebraMesh);

  // ---- Flyovers (Builder B v4, v5: signs removed, markings + solid
  // barriers added) ------------------------------------------------------
  // Deck + ramps are solid slabs ON the NS road (see data.js FLYOVERS for
  // the layout note). The ground road under the deck stays driveable at
  // y=0 — only the deck footprint is elevated.
  {
    const H = FLYOVER.deckH;
    const RAMP = FLYOVER.rampLen;
    const W2 = FLYOVER.width / 2;
    const slopeLen = Math.hypot(RAMP, H);
    const slopeAng = Math.atan2(H, RAMP);
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x2e333b, roughness: 0.9, metalness: 0 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.6, metalness: 0.2 });
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.9 });
    // Deck markings (v5): centre dashed amber line + solid pale edge
    // lines, like the ground roads' asphalt texture, on the flat deck top.
    const markAmber = new THREE.MeshBasicMaterial({ color: 0xc9a227 });
    const markPale = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
    for (const f of FLYOVERS) {
      // Flat deck over the intersection box (z ±10), top at y = H.
      const deck = new THREE.Mesh(new THREE.BoxGeometry(FLYOVER.width, 0.6, FLYOVER.deckHalf * 2), slabMat);
      deck.position.set(f.x, H - 0.3, f.z);
      deck.frustumCulled = false;
      scene.add(deck);
      // Deck edge lines (solid) + centre dashes (3 m dash, 3.5 m gap).
      for (const ex of [-4.3, 4.3]) {
        const line = new THREE.Mesh(new THREE.PlaneGeometry(0.15, FLYOVER.deckHalf * 2), markPale);
        line.rotation.x = -Math.PI / 2;
        line.position.set(f.x + ex, H + 0.02, f.z);
        line.frustumCulled = false;
        scene.add(line);
      }
      for (const dz of [-6.5, 0, 6.5]) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 3), markAmber);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(f.x, H + 0.02, f.z + dz);
        dash.frustumCulled = false;
        scene.add(dash);
      }
      // Ramps: inclined slabs, top surface 0 at |z| = 60, H at |z| = 10.
      for (const side of [-1, 1]) {
        const ramp = new THREE.Mesh(new THREE.BoxGeometry(FLYOVER.width, 0.6, slopeLen), slabMat);
        ramp.position.set(f.x, H / 2 - 0.3, f.z + side * (FLYOVER.deckHalf + RAMP / 2));
        ramp.rotation.x = side > 0 ? slopeAng : -slopeAng;
        ramp.frustumCulled = false;
        scene.add(ramp);
        // Side barriers on deck + ramps (visual; the deck edge is a drop).
        for (const bx of [-W2 + 0.15, W2 - 0.15]) {
          const deckBar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, FLYOVER.deckHalf * 2), edgeMat);
          deckBar.position.set(f.x + bx, H + 0.45, f.z);
          deckBar.frustumCulled = false;
          scene.add(deckBar);
          const rampBar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, slopeLen), edgeMat);
          rampBar.position.set(f.x + bx, H / 2 + 0.45, f.z + side * (FLYOVER.deckHalf + RAMP / 2));
          rampBar.rotation.x = side > 0 ? slopeAng : -slopeAng;
          rampBar.frustumCulled = false;
          scene.add(rampBar);
        }
      }
      // Support pillars under the deck ends, on the sidewalk edge
      // (|z| = 9, clear of the 12 m road) so ground traffic passes under.
      for (const [px, pz] of [[-3.5, -9], [3.5, -9], [-3.5, 9], [3.5, 9]]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, H, 1.2), pillarMat);
        pillar.position.set(f.x + px, H / 2, f.z + pz);
        pillar.frustumCulled = false;
        scene.add(pillar);
      }
    }
  }

  // Road-surface height (Builder B v4, v5 item 1d fix): 0 on the ground,
  // the ramp/deck profile inside a flyover corridor. currentY is the
  // caller's present height — it disambiguates the deck box (|z| <= 10),
  // where BOTH levels exist: already up there (> 3 m) stays up, on the
  // ground stays down.
  // RAMP ZONES ARE ENTRY-AWARE (v5 item 1d): the old code returned the
  // slope height unconditionally for any (x, z) with |x - f.x| <= 5.
  // The ramp slab is 10 m wide but the NS road is 12 m wide, so the slab
  // covers both turn lanes: a car turning left/right at the intersection
  // (arc ends x ≈ f.x - 1.7..-3.9, z ≈ ±5) drives south/north straight
  // into the ramp footprint at |z| > 10, where the slope height jumps
  // 0 -> ~5.9 m in one step. The y-lerp hauled it onto the top edge of
  // the ramp, and once y > 1.5 the height-gated deck-edge barrier
  // collider (x = f.x - 5..-4.7) froze it: every move/rotation check
  // failed, so the car sat wedged at (f.x - 3.9, 6, ±10) and no escape
  // (steer + gas, reverse) could free it. Measured trap: left turn at
  // both flyovers ended (296.1, 6.0, 10.2) / (55.9, 6.0, 10.3).
  // The ramp slab is only 0.6 m thick with open space underneath (at
  // z = 15 the slab underside is ~4.8 m up; a car is ~1.5 m tall), so
  // ground traffic can pass UNDER it exactly like under the flat deck.
  // A caller is only lifted onto the ramp when the slope height is
  // close above its present height (STEP = 0.6 m): a car genuinely
  // climbing the ramp enters at the foot (|z| = 60, height 0) and the
  // slope rises 0.12 m per metre, so its per-frame height gain is
  // ~0.02-0.08 m and the lerp tracks it with <= ~0.3 m lag even at
  // 38 m/s — well inside STEP. A turning car entering from the side
  // faces a ~5.4-5.9 m jump, so it stays at its present height (y = 0)
  // and drives under the ramp, on the road, instead of onto the deck.
  // Side effect, accepted: within ~5 m of a ramp foot the slope height
  // is < STEP, so a ground car there rides a <= 0.6 m hump over the
  // ramp toe and settles back to 0 — the toe is the slab meeting the
  // road, so that is driving over it, not clipping through it.
  const FLYOVER_STEP = 0.6;
  function flyoverHeightAt(x, z, currentY = 0) {
    const H = FLYOVER.deckH;
    const RAMP = FLYOVER.rampLen;
    const W2 = FLYOVER.width / 2;
    for (const f of FLYOVERS) {
      if (Math.abs(x - f.x) > W2) continue;
      const dz = z - f.z;
      const adz = Math.abs(dz);
      if (adz <= FLYOVER.deckHalf) return currentY > 3 ? H : 0;
      let h = -1;
      if (dz < -FLYOVER.deckHalf && dz >= -(FLYOVER.deckHalf + RAMP)) {
        h = H * (dz + FLYOVER.deckHalf + RAMP) / RAMP;
      } else if (dz > FLYOVER.deckHalf && dz <= FLYOVER.deckHalf + RAMP) {
        h = H * (FLYOVER.deckHalf + RAMP - dz) / RAMP;
      }
      if (h >= 0) return h - currentY > FLYOVER_STEP ? currentY : h;
    }
    return 0;
  }

  // ---- Buildings (instanced, pre-built once) ----------------------------
  const colliders = []; // {minX,maxX,minZ,maxZ}
  const byKind = { tower: [], mid: [], house: [], warehouse: [] };
  const downtownBuildings = []; // for neon signs

  function rectOverlapsReserved(x, z, w, d, margin) {
    for (const r of RESERVED) {
      if (Math.abs(x - r.x) < (w + r.w) / 2 + margin && Math.abs(z - r.z) < (d + r.d) / 2 + margin) return true;
    }
    return false;
  }

  for (let c = 0; c < XS.length - 1; c++) {
    for (let r = 0; r < ZS.length - 1; r++) {
      if (c === PARK_CELL.col && r === PARK_CELL.row) continue; // park
      if (c === PLAZA_CELL.col && r === PLAZA_CELL.row) continue; // plaza
      const x0 = XS[c] + 10;
      const x1 = XS[c + 1] - 10;
      const z0 = ZS[r] + 10;
      const z1 = ZS[r + 1] - 10;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const zone = zoneOf((XS[c] + XS[c + 1]) / 2, (ZS[r] + ZS[r + 1]) / 2);
      const isWarehouse = zone === 'harbor' || zone === 'quay';
      const nx = isWarehouse ? (zone === 'quay' ? 1 : 2) : 3;
      const nz = isWarehouse ? 2 : 3;
      const plotW = (x1 - x0) / nx;
      const plotD = (z1 - z0) / nz;
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          let w;
          let d;
          let h;
          let kind;
          if (isWarehouse) {
            kind = 'warehouse';
            w = Math.min(plotW * randRange(rng, 0.6, 0.85), 44);
            d = Math.min(plotD * randRange(rng, 0.6, 0.85), 38);
            h = randRange(rng, 8, 13);
          } else if (zone === 'downtown' && Math.abs(cx) < 280 && Math.abs(cz) < 260) {
            kind = 'tower';
            w = plotW * randRange(rng, 0.55, 0.8);
            d = plotD * randRange(rng, 0.5, 0.75);
            h = randRange(rng, 28, 58);
          } else if (zone === 'downtown') {
            kind = 'mid';
            w = plotW * randRange(rng, 0.55, 0.8);
            d = plotD * randRange(rng, 0.5, 0.75);
            h = randRange(rng, 12, 26);
          } else if (zone === 'beach' && rng() < 0.7) {
            kind = 'house';
            w = plotW * randRange(rng, 0.5, 0.7);
            d = plotD * randRange(rng, 0.45, 0.65);
            h = randRange(rng, 5, 9);
          } else {
            kind = 'mid';
            w = plotW * randRange(rng, 0.55, 0.8);
            d = plotD * randRange(rng, 0.5, 0.75);
            h = randRange(rng, 10, 18);
          }
          const bx = x0 + (i + 0.5) * plotW + randRange(rng, -2, 2);
          const bz = z0 + (j + 0.5) * plotD + randRange(rng, -2, 2);
          if (rectOverlapsReserved(bx, bz, w, d, 5)) continue;
          const b = { x: bx, z: bz, w, d, h };
          byKind[kind].push(b);
          colliders.push({ minX: bx - w / 2, maxX: bx + w / 2, minZ: bz - d / 2, maxZ: bz + d / 2 });
          if (zone === 'downtown' && (kind === 'tower' || kind === 'mid')) downtownBuildings.push(b);
        }
      }
    }
  }

  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  function makeInstancedBox(list, texture, emissiveIntensity) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      map: texture, emissiveMap: texture, emissive: 0xffca7a,
      emissiveIntensity, roughness: 0.85, metalness: 0.05,
    });
    windowMats.push({ mat, base: emissiveIntensity }); // Builder C v4
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((b, i) => {
      dummy.position.set(b.x, b.h / 2, b.z);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const tint = randRange(rng, 0.85, 1.05);
      mesh.setColorAt(i, tmpColor.setRGB(tint, tint, tint));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // Neon Bay v7 lesson: correct sphere + never culled.
    secureInstanced(mesh);
    scene.add(mesh);
    return mesh;
  }
  makeInstancedBox(byKind.tower, TEX.makeBuildingTexture('tower'), 0.85);
  makeInstancedBox(byKind.mid, TEX.makeBuildingTexture('mid'), 0.85);
  makeInstancedBox(byKind.house, TEX.makeBuildingTexture('house'), 0.8);
  makeInstancedBox(byKind.warehouse, TEX.makeBuildingTexture('warehouse'), 0.6);
  // Roof caps for warehouses: the box texture puts windows on the roof too,
  // which reads as glowing slabs from above. A thin dark cap hides that.
  {
    const capGeo = new THREE.BoxGeometry(1, 1, 1);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.95 });
    const caps = new THREE.InstancedMesh(capGeo, capMat, byKind.warehouse.length);
    byKind.warehouse.forEach((b, i) => {
      dummy.position.set(b.x, b.h + 0.12, b.z);
      dummy.scale.set(b.w + 0.4, 0.3, b.d + 0.4);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      caps.setMatrixAt(i, dummy.matrix);
    });
    caps.instanceMatrix.needsUpdate = true;
    secureInstanced(caps);
    scene.add(caps);
  }

  // ---- Worship + vital (reserved plots, distinct look) -------------------
  const worshipList = RESERVED.filter((p) => p.kind === 'worship');
  const vitalHList = RESERVED.filter((p) => p.kind === 'vital-hospital');
  const vitalPList = RESERVED.filter((p) => p.kind === 'vital-police');
  makeInstancedBox(worshipList, TEX.makeBuildingTexture('worship'), 1.0);
  makeInstancedBox(vitalHList, TEX.makeBuildingTexture('vital-hospital'), 0.7);
  makeInstancedBox(vitalPList, TEX.makeBuildingTexture('vital-police'), 0.7);
  for (const p of RESERVED) {
    colliders.push({ minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minZ: p.z - p.d / 2, maxZ: p.z + p.d / 2 });
  }
  // Spires on worship buildings.
  {
    const spireGeo = new THREE.ConeGeometry(1, 1, 6);
    const spireMat = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.7 });
    const spires = new THREE.InstancedMesh(spireGeo, spireMat, worshipList.length);
    worshipList.forEach((p, i) => {
      dummy.position.set(p.x, p.h + 4, p.z);
      dummy.scale.set(3.2, 8, 3.2);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      spires.setMatrixAt(i, dummy.matrix);
    });
    spires.instanceMatrix.needsUpdate = true;
    secureInstanced(spires);
    scene.add(spires);
  }

  const buildingCount =
    byKind.tower.length + byKind.mid.length + byKind.house.length + byKind.warehouse.length;

  // ---- Neon signs on downtown facades ------------------------------------
  const neonSigns = [];
  for (const b of downtownBuildings) {
    if (neonSigns.length >= 70) break;
    if (rng() < 0.35) continue;
    // Face the nearest street: vertical road vs horizontal road distance.
    let dv = Infinity;
    for (const x of XS) dv = Math.min(dv, Math.abs(b.x - x));
    let dh = Infinity;
    for (const z of ZS) dh = Math.min(dh, Math.abs(b.z - z));
    const y = randRange(rng, 6, Math.min(b.h - 2, 22));
    if (dv <= dh) {
      const side = b.x < 0 ? 1 : -1; // face outward toward the nearer street side
      neonSigns.push({ x: b.x + side * (b.w / 2 + 0.35), z: b.z, y, rotY: side * Math.PI / 2 });
    } else {
      const side = b.z < 0 ? 1 : -1;
      neonSigns.push({ x: b.x, z: b.z + side * (b.d / 2 + 0.35), y, rotY: side > 0 ? 0 : Math.PI });
    }
  }
  {
    const geo = new THREE.PlaneGeometry(3.4, 1.2);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const signs = new THREE.InstancedMesh(geo, mat, neonSigns.length);
    neonSigns.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, s.rotY, 0);
      dummy.updateMatrix();
      signs.setMatrixAt(i, dummy.matrix);
      signs.setColorAt(i, tmpColor.setHex(pick(rng, NEON_COLORS)));
    });
    signs.instanceMatrix.needsUpdate = true;
    if (signs.instanceColor) signs.instanceColor.needsUpdate = true;
    secureInstanced(signs);
    scene.add(signs);
  }

  // ---- Traffic lights: one pole per entry corner, on the sidewalk --------
  const arterialCols = V_WIDTHS.map((w, i) => (w >= 12 ? i : -1)).filter((i) => i >= 0);
  const arterialRows = H_WIDTHS.map((w, i) => (w >= 12 ? i : -1)).filter((i) => i >= 0);
  const tlHeads = []; // {index, axis}
  const tlPoles = [];
  const tlPositions = [];
  for (const c of arterialCols) {
    for (const r of arterialRows) {
      const ix = XS[c];
      const iz = ZS[r];
      const vW = V_WIDTHS[c];
      const hW = H_WIDTHS[r];
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const px = ix + sx * (vW / 2 + 3);
        const pz = iz + sz * (hW / 2 + 3);
        const axis = (sx > 0) === (sz > 0) ? 'NS' : 'EW';
        tlPoles.push({ x: px, z: pz, axis, sx, sz });
        tlPositions.push({ x: px, z: pz, axis });
      }
    }
  }
  {
    const poleGeo = new THREE.CylinderGeometry(0.14, 0.16, 5.5, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.5 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, tlPoles.length);
    const armGeo = new THREE.BoxGeometry(0.18, 0.18, 4);
    const arms = new THREE.InstancedMesh(armGeo, poleMat, tlPoles.length);
    const headGeo = new THREE.BoxGeometry(0.55, 1.15, 0.55);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const heads = new THREE.InstancedMesh(headGeo, headMat, tlPoles.length);
    tlPoles.forEach((p, i) => {
      dummy.position.set(p.x, 2.75, p.z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);
      // Arm reaches from the pole toward the intersection centre.
      const armAlongZ = p.axis === 'NS';
      dummy.position.set(
        p.x + (armAlongZ ? 0 : -p.sx * 1.8),
        5.2,
        p.z + (armAlongZ ? -p.sz * 1.8 : 0),
      );
      dummy.rotation.set(0, armAlongZ ? 0 : Math.PI / 2, 0);
      dummy.updateMatrix();
      arms.setMatrixAt(i, dummy.matrix);
      dummy.position.set(
        p.x + (armAlongZ ? 0 : -p.sx * 3.6),
        5.0,
        p.z + (armAlongZ ? -p.sz * 3.6 : 0),
      );
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
      heads.setColorAt(i, tmpColor.setHex(0xff2222));
      tlHeads.push({ index: i, axis: p.axis });
    });
    for (const m of [poles, arms, heads]) {
      m.instanceMatrix.needsUpdate = true;
      secureInstanced(m);
      scene.add(m);
    }
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
    // Signal cycle: NS green 0-8 s, yellow 8-10 s, EW green 10-18 s, yellow
    // 18-20 s — the same cycle trafficLightState() reports to the drivers,
    // so the heads and the cars always agree.
    const RED = new THREE.Color(0xff2222);
    const YELLOW = new THREE.Color(0xffcc00);
    const GREEN = new THREE.Color(0x22ff66);
    const updateLights = () => {
      const ns = trafficLightState('NS');
      const ew = trafficLightState('EW');
      const col = (s) => (s === 'green' ? GREEN : s === 'yellow' ? YELLOW : RED);
      for (const h of tlHeads) heads.setColorAt(h.index, h.axis === 'NS' ? col(ns) : col(ew));
      heads.instanceColor.needsUpdate = true;
    };
    updateLights();
    setInterval(updateLights, 500);
  }

  // ---- Street lamps (instanced poles + glowing heads) ---------------------
  const lampSpots = [];
  for (const s of roadGraph.segments) {
    const alongX = s.kind === 'horizontal';
    const steps = Math.max(1, Math.floor(s.length / 55));
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const lx = s.ax + (s.bx - s.ax) * t;
      const lz = s.az + (s.bz - s.az) * t;
      const side = k % 2 === 0 ? 1 : -1;
      const off = s.width / 2 + 2.2;
      lampSpots.push({
        x: lx + (alongX ? 0 : side * off),
        z: lz + (alongX ? side * off : 0),
      });
    }
  }
  {
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 6, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.6, metalness: 0.5 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampSpots.length);
    const headGeo = new THREE.SphereGeometry(0.3, 8, 6);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    lampHeadMat = headMat; // Builder C v4: weather dims lamp heads by day.
    const heads = new THREE.InstancedMesh(headGeo, headMat, lampSpots.length);
    lampSpots.forEach((p, i) => {
      dummy.position.set(p.x, 3, p.z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x, 6.1, p.z);
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
    });
    for (const m of [poles, heads]) {
      m.instanceMatrix.needsUpdate = true;
      secureInstanced(m);
      scene.add(m);
    }
  }

  // ---- Trees: oaks in the park, palms on the beach, street trees ---------
  // ROAD CLEARANCE (Builder Markers+Trees): NO tree may stand on a road.
  // A street tree sits width/2 + 4.6 m from its own street's centreline,
  // which clears that street — but near an intersection it can still land
  // ON the cross street (that was the "tree in the middle of the road"
  // report: the trunk was fine vs its own segment, not vs the crossing
  // one). So every candidate is checked against EVERY segment via
  // roadGraph.nearestOnRoad: trunk distance must exceed the nearest
  // segment's half-width + ROAD_CLEAR_M (4 m: trunk clear of the asphalt
  // AND the crown, r ≤ 3.2 m, clear of the road edge). A candidate that
  // fails is retried elsewhere; after N tries the tree is dropped, never
  // planted on a road. treePositions is exposed for the harness check.
  const ROAD_CLEAR_M = 4;
  const treePositions = []; // {x, z, kind} — every planted tree, for verification
  let treesDropped = 0;
  let treesRetried = 0; // candidates rejected by clearOfRoads and re-placed elsewhere
  function clearOfRoads(x, z) {
    const near = roadGraph.nearestOnRoad(x, z);
    if (!near) return false;
    const seg = roadGraph.segments[near.segment];
    if (near.dist <= seg.width / 2 + ROAD_CLEAR_M) return false;
    // Builder B v4: never plant on a flyover ramp/deck corridor either.
    for (const f of FLYOVERS) {
      if (Math.abs(x - f.x) < FLYOVER.width / 2 + 2 && Math.abs(z - f.z) < FLYOVER.deckHalf + FLYOVER.rampLen + 2) return false;
    }
    return true;
  }
  const oakTrunks = [];
  const oakCrowns = [];
  const palmTrunks = [];
  const palmCrowns = [];
  function addOak(x, z) {
    const h = randRange(rng, 3.5, 5);
    oakTrunks.push({ x, z, h, tilt: randRange(rng, -0.05, 0.05) });
    oakCrowns.push({ x, z, y: h + 1.2, r: randRange(rng, 2.2, 3.2) });
    treePositions.push({ x, z, kind: 'oak' });
  }
  function addPalm(x, z) {
    const h = randRange(rng, 5, 7);
    palmTrunks.push({ x, z, h, tilt: randRange(rng, -0.09, 0.09) });
    palmCrowns.push({ x, z, y: h + 0.8, r: randRange(rng, 2.2, 2.8) });
    treePositions.push({ x, z, kind: 'palm' });
  }
  for (let i = 0; i < 22; i++) {
    // Park oaks: retry inside the park until clear of the bordering roads.
    let placed = false;
    for (let attempt = 0; attempt < 20 && !placed; attempt++) {
      const x = parkX0 + randRange(rng, 12, parkX1 - parkX0 - 12);
      const z = parkZ0 + randRange(rng, 12, parkZ1 - parkZ0 - 12);
      if (clearOfRoads(x, z)) { addOak(x, z); placed = true; }
      else treesRetried += 1;
    }
    if (!placed) treesDropped += 1;
  }
  for (let z = -420; z <= 420; z += 35) {
    // Beach palms: x is already ≥24 m east of the last road end; retry the
    // z jitter if a palm ever lands near a horizontal road's east end.
    let placed = false;
    for (let attempt = 0; attempt < 10 && !placed; attempt++) {
      const x = randRange(rng, 428, 456);
      const pz = z + randRange(rng, -8, 8);
      if (clearOfRoads(x, pz)) { addPalm(x, pz); placed = true; }
      else treesRetried += 1;
    }
    if (!placed) treesDropped += 1;
  }
  for (let i = 0; i < 40; i++) {
    // Street trees: retry segment / position / side until the candidate
    // clears ALL segments (own street + any cross street near a corner).
    let placed = false;
    for (let attempt = 0; attempt < 25 && !placed; attempt++) {
      const s = pick(rng, roadGraph.segments);
      const t = rng();
      const alongX = s.kind === 'horizontal';
      const side = rng() < 0.5 ? 1 : -1;
      const off = s.width / 2 + 4.6;
      const x = s.ax + (s.bx - s.ax) * t + (alongX ? 0 : side * off);
      const z = s.az + (s.bz - s.az) * t + (alongX ? side * off : 0);
      if (clearOfRoads(x, z)) { addOak(x, z); placed = true; }
      else treesRetried += 1;
    }
    if (!placed) treesDropped += 1;
  }
  function makeTrunks(list, mat) {
    const geo = new THREE.CylinderGeometry(0.2, 0.3, 1, 6);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((tr, i) => {
      dummy.position.set(tr.x, tr.h / 2, tr.z);
      dummy.scale.set(1, tr.h, 1);
      dummy.rotation.set(0, 0, tr.tilt);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    secureInstanced(mesh);
    scene.add(mesh);
    return mesh;
  }
  function makeCrowns(list, mat, squashY, lightMin = 0.16, lightMax = 0.24) {
    const geo = new THREE.SphereGeometry(1, 8, 6);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((cr, i) => {
      dummy.position.set(cr.x, cr.y, cr.z);
      dummy.scale.set(cr.r, cr.r * squashY, cr.r);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tmpColor.setHSL(0.33 + randRange(rng, -0.03, 0.03), 0.45, randRange(rng, lightMin, lightMax)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    secureInstanced(mesh);
    scene.add(mesh);
    return mesh;
  }
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 });
  makeTrunks(oakTrunks, trunkMat);
  makeTrunks(palmTrunks, trunkMat);
  makeCrowns(oakCrowns, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), 1);
  makeCrowns(palmCrowns, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), 0.55, 0.26, 0.36);
  const treeCount = oakTrunks.length + palmTrunks.length;

  // ---- Props: benches (plaza / park / beach) + hydrants ------------------
  const benches = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    benches.push({ x: Math.cos(a) * 18, z: Math.sin(a) * 18, rotY: -a + Math.PI / 2 });
  }
  for (let i = 0; i < 8; i++) {
    benches.push({
      x: parkX0 + randRange(rng, 14, parkX1 - parkX0 - 14),
      z: parkZ0 + randRange(rng, 14, parkZ1 - parkZ0 - 14),
      rotY: randRange(rng, 0, Math.PI),
    });
  }
  for (let i = 0; i < 6; i++) {
    benches.push({ x: 436, z: -300 + i * 120 + randRange(rng, -10, 10), rotY: -Math.PI / 2 });
  }
  {
    const geo = new THREE.BoxGeometry(1.8, 0.45, 0.6);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });
    const mesh = new THREE.InstancedMesh(geo, mat, benches.length);
    benches.forEach((b, i) => {
      dummy.position.set(b.x, 0.45, b.z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, b.rotY, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    secureInstanced(mesh);
    scene.add(mesh);
  }
  {
    const spots = [];
    for (let i = 0; i < 14; i++) {
      const c = pick(rng, arterialCols);
      const r = pick(rng, arterialRows);
      const sx = rng() < 0.5 ? 1 : -1;
      const sz = rng() < 0.5 ? 1 : -1;
      spots.push({
        x: XS[c] + sx * (V_WIDTHS[c] / 2 + 4.5),
        z: ZS[r] + sz * (H_WIDTHS[r] / 2 + 4.5),
      });
    }
    const geo = new THREE.CylinderGeometry(0.22, 0.26, 0.75, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.6 });
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach((p, i) => {
      dummy.position.set(p.x, 0.38, p.z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    secureInstanced(mesh);
    scene.add(mesh);
  }

  // ---- Boats in the harbor water (slow drift + bob) -----------------------
  const boats = [];
  for (let i = 0; i < 8; i++) {
    boats.push({
      baseX: randRange(rng, 488, 575),
      baseZ: randRange(rng, -400, 400),
      heading: randRange(rng, 0, Math.PI * 2),
      len: randRange(rng, 7, 11),
      phase: rng() * Math.PI * 2,
      x: 0, z: 0,
    });
  }
  let hullMesh;
  let cabinMesh;
  let mastMesh;
  let mastLightMesh;
  {
    const hullGeo = new THREE.BoxGeometry(1, 1, 1);
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.2 });
    hullMesh = new THREE.InstancedMesh(hullGeo, hullMat, boats.length);
    const cabinGeo = new THREE.BoxGeometry(1, 1, 1);
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.6 });
    cabinMesh = new THREE.InstancedMesh(cabinGeo, cabinMat, boats.length);
    const mastGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 5);
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.8 });
    mastMesh = new THREE.InstancedMesh(mastGeo, mastMat, boats.length);
    const lightGeo = new THREE.SphereGeometry(0.18, 6, 5);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0 });
    mastLightMesh = new THREE.InstancedMesh(lightGeo, lightMat, boats.length);
    boats.forEach((b, i) => {
      hullMesh.setColorAt(i, tmpColor.setHex(pick(rng, [0x1e3a5f, 0x7a2020, 0xe2e8f0, 0x14532d, 0x92400e])));
    });
    for (const m of [hullMesh, cabinMesh, mastMesh, mastLightMesh]) {
      secureInstanced(m);
      scene.add(m);
    }
    if (hullMesh.instanceColor) hullMesh.instanceColor.needsUpdate = true;
  }
  function updateBoats() {
    const t = Date.now() / 1000;
    boats.forEach((b, i) => {
      b.x = b.baseX + Math.sin(t * 0.05 + b.phase) * 4;
      b.z = b.baseZ + Math.cos(t * 0.04 + b.phase) * 3;
      const y = 0.12 + Math.sin(t * 0.6 + b.phase) * 0.07;
      const roll = Math.sin(t * 0.5 + b.phase) * 0.02;
      dummy.position.set(b.x, y + 0.55, b.z);
      dummy.scale.set(2.6, 1.1, b.len);
      dummy.rotation.set(roll, b.heading, 0);
      dummy.updateMatrix();
      hullMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(b.x, y + 1.4, b.z);
      dummy.scale.set(2.0, 1.3, 2.6);
      dummy.updateMatrix();
      cabinMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(b.x, y + 3.2, b.z);
      dummy.scale.set(1, 4, 1);
      dummy.updateMatrix();
      mastMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(b.x, y + 5.3, b.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mastLightMesh.setMatrixAt(i, dummy.matrix);
    });
    hullMesh.instanceMatrix.needsUpdate = true;
    cabinMesh.instanceMatrix.needsUpdate = true;
    mastMesh.instanceMatrix.needsUpdate = true;
    mastLightMesh.instanceMatrix.needsUpdate = true;
  }
  updateBoats();
  setInterval(updateBoats, 150);

  // ---- API ---------------------------------------------------------------
  const spawn = { x: CONFIG.spawn.x, z: CONFIG.spawn.z, heading: CONFIG.spawn.heading };

  function isInWater(x, z) {
    return x > WATER_X0 - 2 && x <= 600 && z >= -D / 2 && z <= D / 2;
  }

  // Flyover deck/ramp edge barriers, as 2D rects matching the yellow
  // barrier boxes (0.3 m thick at x = f.x ± (W2 - 0.15), z ±60 covering
  // deck + both ramps). HEIGHT-GATED: they only block callers that pass
  // their y and are clearly elevated (y > 1.5). Ground traffic and
  // pedestrians under the deck pass at y = 0 and are never blocked — a
  // plain 2D collider here would wall off the under-flyover turns
  // (item 1d). A jumping player peaks at ~1.1 m, so 1.5 keeps jumps
  // under the deck free too. Callers that don't pass y default to 0
  // (ground) and keep the old behaviour.
  const flyoverBarriers = [];
  for (const f of FLYOVERS) {
    const W2 = FLYOVER.width / 2;
    const z0 = f.z - (FLYOVER.deckHalf + FLYOVER.rampLen);
    const z1 = f.z + (FLYOVER.deckHalf + FLYOVER.rampLen);
    // Barrier box footprint: 0.3 m thick, centred at f.x ± (W2 - 0.15).
    flyoverBarriers.push({ minX: f.x + W2 - 0.3, maxX: f.x + W2, minZ: z0, maxZ: z1 });
    flyoverBarriers.push({ minX: f.x - W2, maxX: f.x - W2 + 0.3, minZ: z0, maxZ: z1 });
  }

  function collides(x, z, r, y = 0) {
    if (x > WATER_X0 - 2) return true; // water is not walkable
    for (const c of colliders) {
      if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
    }
    if (y > 1.5) {
      for (const b of flyoverBarriers) {
        if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return true;
      }
    }
    return false;
  }

  function findOpenGround(x, z, maxR = 60) {
    if (!collides(x, z, 1.5) && Math.abs(x) < W / 2 - 5 && Math.abs(z) < D / 2 - 5) return { x, z };
    for (let radius = 2; radius <= maxR; radius += 2) {
      const steps = 16;
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const px = x + Math.cos(a) * radius;
        const pz = z + Math.sin(a) * radius;
        if (Math.abs(px) >= W / 2 - 5 || Math.abs(pz) >= D / 2 - 5) continue;
        if (!collides(px, pz, 1.5)) return { x: px, z: pz };
      }
    }
    return null;
  }

  // Sidewalk spots nearest to (x, z): the centre of each 3 m sidewalk strip
  // flanking the nearest road segment, nearest side first. A sidewalk point
  // is walkable by construction (between the road edge and the building
  // line) — this is what the vehicle-exit code uses so Vera steps onto the
  // pavement, never onto the asphalt or into a wall. Returns [] when the
  // point is nowhere near a road (e.g. mid-block), so callers fall back.
  function nearestSidewalk(x, z) {
    const near = roadGraph.nearestOnRoad(x, z);
    if (!near || near.dist > 60) return [];
    const s = roadGraph.segments[near.segment];
    const alongX = s.kind === 'horizontal';
    const off = s.width / 2 + 1.5;
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const len2 = dx * dx + dz * dz;
    let t = len2 === 0 ? 0 : ((x - s.ax) * dx + (z - s.az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = s.ax + dx * t;
    const cz = s.az + dz * t;
    const out = [];
    for (const side of [1, -1]) {
      const px = cx + (alongX ? 0 : side * off);
      const pz = cz + (alongX ? side * off : 0);
      out.push({ x: px, z: pz, dist: Math.hypot(px - x, pz - z), side, segment: near.segment });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }

  const destinations = [
    { id: 'plaza', name: 'Plaza Vera', x: 0, z: 40, kind: 'plaza' },
    { id: 'park', name: 'Taman Merdeka', x: -240, z: 180, kind: 'park' },
    { id: 'beach', name: 'Pantai Vice', x: 445, z: 100, kind: 'beach' },
    { id: 'harbor', name: 'Dermaga Utara', x: 390, z: -180, kind: 'harbor' },
    { id: 'downtown', name: 'Downtown Vice', x: -240, z: -180, kind: 'downtown' },
    ...RESERVED.map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      z: p.z,
      kind: p.kind === 'worship' ? 'worship' : p.kind === 'vital-hospital' ? 'hospital' : 'police',
    })),
  ];

  const counts = {
    buildings: buildingCount,
    trees: treeCount,
    treesDropped,
    treesRetried,
    trafficLights: tlPoles.length,
    worship: worshipList.length,
    vital: vitalHList.length + vitalPList.length,
    roads: roadGraph.segments.length,
    flyovers: FLYOVERS.length,
  };

  const loadMs = performance.now() - t0;

  const api = {
    ground,
    clamp(x, z) {
      const halfW = W / 2 - CONFIG.player.radius;
      const halfD = D / 2 - CONFIG.player.radius;
      return {
        x: Math.max(-halfW, Math.min(halfW, x)),
        z: Math.max(-halfD, Math.min(halfD, z)),
      };
    },
    spawn,
    roadGraph,
    flyovers: FLYOVERS.map((f) => ({ ...f, deckH: FLYOVER.deckH, rampLen: FLYOVER.rampLen, width: FLYOVER.width })),
    groundHeightAt(x, z, currentY = 0) {
      return flyoverHeightAt(x, z, currentY);
    },
    findOpenGround,
    nearestSidewalk,
    collides,
    isInWater,
    destinations,
    counts,
    boats,
    trees: treePositions,
    treesDropped,
    treesRetried,
    roadClearM: ROAD_CLEAR_M,
    trafficLightPositions: tlPositions,
    loadMs,
    // Builder C v4: phase-driven materials for weather.js (window glow,
    // lamp glow, moon/glow/stars fade). Read-only exposure, no behaviour.
    windowMats,
    lampHeadMat,
    skyMeshes: { moon, glow, stars: skyStars },
    // No per-frame work: the city is static except the interval-driven
    // traffic-light cycle and boat bob. Kept for Builder C's loop if wanted.
    update() {},
  };

  window.NEON_VICE_WORLD = {
    version: 'world-b1',
    counts,
    roadGraph,
    flyovers: api.flyovers,
    destinations,
    spawn,
    boats,
    trees: treePositions,
    treesDropped,
    treesRetried,
    roadClearM: ROAD_CLEAR_M,
    trafficLightPositions: tlPositions,
    scene,
    loadMs,
    world: api,
    groundHeightAt: api.groundHeightAt,
    findOpenGround: api.findOpenGround,
    nearestSidewalk: api.nearestSidewalk,
    collides: api.collides,
    isInWater: api.isInWater,
  };

  return api;
}
