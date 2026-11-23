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

  // Boardwalk (v6.6 item 5): a wooden promenade along the quay/sand
  // boundary (x 412..420, z -420..420) — the east edge of the quay,
  // right where the sand starts. A distinct wooden deck (not concrete,
  // not sand) so the beach reads as a destination, not just empty sand.
  // Walkable (no colliders, same ground as the quay/sand); +1 draw call
  // for the deck mesh itself. The sand driving corridor (x 420..450,
  // z -50..170) stays prop-free — boardwalk lamps/benches sit at x
  // 413/418, west of the sand.
  const BOARDWALK = { x0: 412, x1: 420, z0: -420, z1: 420 };
  const boardwalk = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARDWALK.x1 - BOARDWALK.x0, BOARDWALK.z1 - BOARDWALK.z0),
    new THREE.MeshStandardMaterial({ map: TEX.makeBoardwalkTexture(), roughness: 0.9, metalness: 0 }),
  );
  boardwalk.rotation.x = -Math.PI / 2;
  boardwalk.position.set((BOARDWALK.x0 + BOARDWALK.x1) / 2, 0.04, 0);
  scene.add(boardwalk);

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

  // ---- Flyover gardens (v6.3) ------------------------------------------
  // Four corner plots under/next to the two flyovers, OUTSIDE every road,
  // ramp, turn lane and sidewalk. Each rect was verified empty against
  // the ACTUAL building footprints (world.collides grid scan, 0.5 m step)
  // and road clearance (nearest road centreline > half-width + 4 m):
  //   (60,0) SW: the plaza cell (no buildings) · (60,0) SE: gap between plots
  //   (300,0) NW: open block · (300,0) SE: gap between plots
  // gapSide: the hedge edge carrying the ONE foot gap (4.4 m wide,
  // 0.6 m bollard in the middle -> 1.9 m clear each side). gapC is the
  // gap centre along that edge: an x for 'N'/'S', a z for 'E'/'W'.
  // NOTE on the gap width: the spec's 0.7 m per side cannot pass a player
  // (radius 0.6 needs a >= 1.2 m slot under collides()); 1.9 m passes the
  // player with 0.7 m of steering slack, while a car (collision radius
  // 1.0, centre + nose + tail) needs >= 2.0 m and stays out.
  // v6.6 (item 1): the gaps of A/B/C moved to the SOUTH edge. Before,
  // the gap faced the road (B 'W' at x=72, A/C 'E'), and a sedan
  // turning right at the south end of flyover x=60 drove straight east
  // at z~77 into B's gap and wedged its nose on the bollard (parent
  // verifier 3/3 at (69.6,78); reproduced here 3/3 at (69.5,77)).
  // An east shift alone does NOT fix it — the car just drives 10 m
  // further east into the shifted gap. With the gap on the south edge
  // the road-facing edge is a CONTINUOUS hedge: the same manoeuvre now
  // stops on the hedge and reverses out. Pedestrians enter from the
  // south: B via the 2.25 m corridor (garden hedge z=83.75, building
  // wall z=86), A/C across open ground. D keeps its 'W' gap: the
  // median garden blocks a car's approach to it (parent manoeuvre
  // 2/2 clear at fx=300), so it is not a trap.
  const FLYOVER_GARDENS = [
    { x0: 30, x1: 48, z0: 12, z1: 30, gapSide: 'S', gapC: 39 },
    { x0: 72, x1: 84, z0: 72, z1: 84, gapSide: 'S', gapC: 78 },
    { x0: 270, x1: 288, z0: -30, z1: -12, gapSide: 'S', gapC: 279 },
    { x0: 324, x1: 336, z0: 36, z1: 48, gapSide: 'W', gapC: 42 },
  ];
  // Garden grass + a 2 m path slab from the gap to the garden centre.
  for (const g of FLYOVER_GARDENS) {
    const gg = new THREE.Mesh(
      new THREE.PlaneGeometry(g.x1 - g.x0, g.z1 - g.z0),
      new THREE.MeshStandardMaterial({ map: TEX.makeGrassTexture(), roughness: 1, metalness: 0 }),
    );
    gg.rotation.x = -Math.PI / 2;
    gg.position.set((g.x0 + g.x1) / 2, 0.02, (g.z0 + g.z1) / 2);
    scene.add(gg);
    const cx = (g.x0 + g.x1) / 2;
    const alongX = g.gapSide === 'E' || g.gapSide === 'W';
    const edge = g.gapSide === 'E' ? g.x1 : g.gapSide === 'W' ? g.x0
      : g.gapSide === 'N' ? g.z0 : g.z1;
    const pathLen = Math.abs(edge - (alongX ? cx : (g.z0 + g.z1) / 2));
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(alongX ? pathLen : 2, alongX ? 2 : pathLen),
      new THREE.MeshStandardMaterial({ map: TEX.makeConcreteTexture(), roughness: 0.9, metalness: 0 }),
    );
    path.rotation.x = -Math.PI / 2;
    path.position.set(
      alongX ? (cx + edge) / 2 : cx,
      0.03,
      alongX ? g.gapC : ((g.z0 + g.z1) / 2 + edge) / 2,
    );
    scene.add(path);
  }

  // ---- Median gardens under the flyover ramps (v6.4) ---------------------
  // Ayub (13:26 WIB): the middle strip under the flyover — the ground
  // between the two surface turn lanes — becomes a garden, at BOTH
  // flyovers, with only 2 surface lanes left (x = f.x ± 4.5, one per
  // direction). Per flyover the garden is TWO segments, z ±[10, 60]:
  // the strip |z| < 10 stays open road on purpose — it is the
  // intersection box (EW road z ±6, zebras z ±8.5, turn space). Each
  // segment is the strip x f.x±3 (exactly the deck footprint) under
  // one ramp (deck height 6 m at |z| = 10 falling to 0 at |z| = 60).
  // NO oak: even the smallest oak tops out at ~6.9 m, above the 5.5 m
  // clearance under the deck edge — shrubs/benches/short lamps only,
  // each top checked < flyoverHeightAt(x,z) − 0.5 m (see medianObjects
  // tops: bench 0.68 m, lamp 1.83 m, shrub ≤ 0.92 m).
  // The strip ends are OPEN (no hedge across them): the ends are the
  // ramp-mount corridor — cars enter the ramp from the surface at
  // |z| ≈ 60 in the flyover lanes (x f.x±1.5) — and the intersection
  // opening, so both must stay free of colliders. The garden is
  // enclosed only on its long sides, by hedges at x = f.x ± 2.825
  // (0.25 m thick -> [2.7, 2.95]): a flyover-lane car (r = 1.0 at
  // x ±1.5) clears it by 0.2 m, a turn-lane car (r = 1.0 at x ±4.5)
  // by 0.55 m. The hedge is THIN on purpose (v6.4 traffic-probe
  // finding): a 0.5 m hedge at ±2.95 left only 0.3 m to the turn
  // lane, and a traffic car's NOSE circle (1.7 m ahead, r = 1.0)
  // clips it at ~7 deg of eastward yaw — the cars steer toward
  // centreline nodes with a steady ~3.5 deg eastward bias plus
  // pursuit overshoot, so three cars stalled and bounced in the
  // turn lane until the v6.2 unstuck fired (run 1: ids 1011/1017
  // west lane z≈-43, 1001 east lane z≈+43, plus 1016 queued on the
  // ramp behind them). 0.55 m needs ~19 deg of yaw to clip, far
  // above the observed ~7 deg peak; the flyover side keeps its
  // proven 0.2 m (mounts pass). The garden interior is unchanged
  // (hedge inner face stays at 2.7 m) — only the grass margin
  // between hedge and turn lane grows by 0.25 m.
  // Hedge/bollard colliders are HEIGHT-GATED (maxY 1.5,
  // see collides()): a car on the deck/ramp (y > 1.5) passes over
  // them; ground callers (y <= 1.5) are blocked as usual. One foot
  // gap per segment (v6.3 pattern: 4.4 m + 0.6 m bollard -> 1.9 m
  // sub-gaps; player r = 0.6 passes, car r = 1.0 does not) on the
  // east side at the segment midpoint (z = ±35).
  const MEDIAN_GARDENS = [];
  for (const f of FLYOVERS) {
    for (const s of [-1, 1]) {
      MEDIAN_GARDENS.push({
        fx: f.x, x0: f.x - 3, x1: f.x + 3,
        z0: s > 0 ? 10 : -60, z1: s > 0 ? 60 : -10,
        gapSide: 'E', gapC: s * 35,
      });
    }
  }
  // Verifiable object list for the harness: {kind, x, z, top}.
  const medianObjects = [];

  // Median garden grass (y = 0.07: the strip is road asphalt at 0.05,
  // so the grass must sit just above it) + a 2 m path slab down the
  // middle of each segment. The path ENDS at |z| = 38: beyond that the
  // ramp is too low for a pedestrian (underside < ~1.85 m for |z| >
  // ~40 — the same clipping a walker meets under the low ramp on the
  // open road in v6, not new here), so the walkable garden is
  // z ±[10, 38]; the grass/hedge/planting run the full segment.
  for (const g of MEDIAN_GARDENS) {
    const gg = new THREE.Mesh(
      new THREE.PlaneGeometry(g.x1 - g.x0, g.z1 - g.z0),
      new THREE.MeshStandardMaterial({ map: TEX.makeGrassTexture(), roughness: 1, metalness: 0 }),
    );
    gg.rotation.x = -Math.PI / 2;
    gg.position.set((g.x0 + g.x1) / 2, 0.07, (g.z0 + g.z1) / 2);
    scene.add(gg);
    const s = g.gapC > 0 ? 1 : -1;
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 26),
      new THREE.MeshStandardMaterial({ map: TEX.makeConcreteTexture(), roughness: 0.9, metalness: 0 }),
    );
    path.rotation.x = -Math.PI / 2;
    path.position.set(g.fx, 0.08, s * 25);
    scene.add(path);
  }

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
  // barriers added; v6: 4 lanes 2 directions, deck narrowed to the two
  // flyover lanes only) --------------------------------------------------
  // Deck + ramps are solid slabs ON the NS road (see data.js FLYOVERS for
  // the layout note). The ground road under the deck stays driveable at
  // y=0 — only the deck footprint is elevated. The surface turn lanes
  // run OUTSIDE the deck (x = f.x ± 3..6), so a turning car never meets
  // the ramp at all. No support pillars under the deck: every point
  // under it is a driving lane (EW road below, flyover lanes above), so
  // a pillar would stand in traffic — the deck reads as one continuous
  // beam held by its two ramp slabs.
  {
    const H = FLYOVER.deckH;
    const RAMP = FLYOVER.rampLen;
    const W2 = FLYOVER.width / 2;
    const slopeLen = Math.hypot(RAMP, H);
    const slopeAng = Math.atan2(H, RAMP);
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x2e333b, roughness: 0.9, metalness: 0 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.6, metalness: 0.2 });
    // Deck markings (v5): centre dashed amber line + solid pale edge
    // lines, like the ground roads' asphalt texture, on the flat deck top.
    const markAmber = new THREE.MeshBasicMaterial({ color: 0xc9a227 });
    const markPale = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
    // Ground-lane paint (v6): a flat pale plane / arrowhead helper.
    // Roads sit at y=0.05, zebras at 0.06 — paint floats at 0.10 so it
    // never z-fights either.
    const arrowHeadGeo = (() => {
      const s = new THREE.Shape();
      s.moveTo(0, 1.1); s.lineTo(-0.65, 0); s.lineTo(0.65, 0); s.closePath();
      const g = new THREE.ShapeGeometry(s);
      g.rotateX(-Math.PI / 2); // tip points -z; mesh.rotation.y aims it
      return g;
    })();
    function flatMark(geo, x, y, z, rotY = 0) {
      const m = new THREE.Mesh(geo, markPale);
      if (rotY) m.rotation.y = rotY;
      m.position.set(x, y, z);
      m.frustumCulled = false;
      scene.add(m);
      return m;
    }
    function flatPlane(w, l, x, z) {
      const g = new THREE.PlaneGeometry(w, l);
      g.rotateX(-Math.PI / 2);
      return flatMark(g, x, 0.10, z);
    }
    // Straight-ahead arrow, centred at (cx, cz), pointing dir (+1 = +z
    // south, -1 = -z north). Shaft + head, ~3.6 m long.
    function straightArrow(cx, cz, dir) {
      flatPlane(0.35, 2.4, cx, cz - dir * 0.55);
      flatMark(arrowHeadGeo, cx, 0.10, cz + dir * 0.7, dir > 0 ? Math.PI : 0);
    }
    // Turn arrow (left OR right): horizontal bar with a head at each end.
    function turnArrow(cx, cz) {
      flatPlane(2.4, 0.35, cx, cz);
      flatMark(arrowHeadGeo, cx + 0.15, 0.10, cz, -Math.PI / 2); // head +x
      flatMark(arrowHeadGeo, cx - 0.15, 0.10, cz, Math.PI / 2); // head -x
    }
    for (const f of FLYOVERS) {
      // Flat deck over the intersection box (z ±10), top at y = H.
      const deck = new THREE.Mesh(new THREE.BoxGeometry(FLYOVER.width, 0.6, FLYOVER.deckHalf * 2), slabMat);
      deck.position.set(f.x, H - 0.3, f.z);
      deck.frustumCulled = false;
      scene.add(deck);
      // Deck edge lines (solid) + centre dashes (3 m dash, 3.5 m gap).
      for (const ex of [-W2 + 0.45, W2 - 0.45]) {
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
      // Ground lane paint (v6): solid divider between the flyover lane
      // and the turn lane on each side (broken only across the
      // intersection box, where turns happen), a straight arrow on each
      // flyover-lane approach and a left-or-right arrow on each
      // turn-lane approach, 15 m before the ramp foot (|z| = 75).
      // Left-hand traffic: southbound (+z) lanes on the +x side,
      // northbound (-z) lanes on the -x side.
      for (const side of [-1, 1]) {
        for (const [z0, z1] of [[-75, -10], [10, 75]]) {
          const g = new THREE.PlaneGeometry(0.15, z1 - z0);
          g.rotateX(-Math.PI / 2);
          flatMark(g, f.x + side * W2, 0.10, (z0 + z1) / 2);
        }
        // Southbound approach (from the north, z = -75): flyover lane
        // x = f.x + 1.5 straight, turn lane x = f.x + 4.5 turns.
        // Northbound approach (from the south, z = +75): mirrored.
        const s = side; // +1: southbound side (+x); -1: northbound (-x)
        straightArrow(f.x + s * FLYOVER.flyLaneX, -s * 75, s);
        turnArrow(f.x + s * FLYOVER.turnLaneX, -s * 75);
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
  // The ramp slab is 6 m wide (v6) but the NS road is 12 m wide, so the
  // slab covers only the two flyover lanes: a car turning left/right at
  // the intersection from a surface turn lane (x = f.x ± 3..6) never
  // enters the slab footprint at all. The STEP guard below still
  // protects the old trap for a car that does cross the slab edge:
  // entering from the side faces a ~5.4-5.9 m jump, so it stays at its
  // present height (y = 0) and drives under the ramp, on the road,
  // instead of onto the deck.
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

  // v6: lane discipline at flyover intersections (4 lanes, 2
  // directions). AI cars steer at graph nodes on the road centreline;
  // at a flyover node that centreline is the divider between the two
  // flyover lanes, and a car that climbs the ramp and then turns would
  // meet the solid deck-edge barrier (stock cars, whose collision check
  // passes y) or drive off the deck edge (ambient cars, whose check has
  // no y). So the steering target is shifted into the lane the car must
  // use — left-hand traffic:
  //   straight NS through -> flyover lane (offset 1.5 to its side)
  //   turning at the node  -> surface turn lane (offset 4.5 to its side)
  //   straight EW under the deck -> no shift (both EW lanes are ground)
  // `prev`/`next` are the neighbouring waypoints (null at path ends).
  // viaFlyover is true for a straight NS crossing: that car passes OVER
  // the intersection and never meets the red light below, so callers
  // skip the signal hold for it.
  function laneTarget(node, prev, next) {
    for (const f of FLYOVERS) {
      if (Math.abs(node.x - f.x) > 0.5 || Math.abs(node.z - f.z) > 0.5) continue;
      const inDx = prev ? node.x - prev.x : 0;
      const inDz = prev ? node.z - prev.z : 0;
      const inNS = Math.abs(inDz) >= Math.abs(inDx);
      const outDx = next ? next.x - node.x : inDx;
      const outDz = next ? next.z - node.z : inDz;
      const outNS = Math.abs(outDz) >= Math.abs(outDx);
      if (inNS) {
        // Southbound (+z) drives the +x side, northbound (-z) the -x side.
        const side = inDz >= 0 ? 1 : -1;
        const off = outNS ? FLYOVER.flyLaneX : FLYOVER.turnLaneX;
        return { x: node.x + side * off, z: node.z, viaFlyover: outNS };
      }
      if (!outNS) return { x: node.x, z: node.z, viaFlyover: false };
      // EW in, NS out: join the surface turn lane of the outgoing road.
      const side = outDz >= 0 ? 1 : -1;
      return { x: node.x + side * FLYOVER.turnLaneX, z: node.z, viaFlyover: false };
    }
    // v6.4 (median garden): a car that just left a flyover on the
    // surface stays in its turn lane for this leg instead of steering
    // at the centreline. Without this, a car that turned onto the NS
    // road at a flyover steers at the centreline of the next leg and
    // drifts across the turn lane toward the garden hedge: it enters
    // the lane wide (x≈±6.5 off the intersection turn), converges on
    // the centreline at ~3 deg, and its nose (1.7 m ahead, r=1.0)
    // clips the hedge around |z|≈46-50 — then it bounces
    // (forward-blocked, reverse 3.2 m, repeat) until the v6.2 unstuck
    // fires (traffic runs: 1 unstuck/run, all in the turn lanes).
    // The turn lane is the car's lane for this leg; the centreline is
    // only correct once it is past the garden (|z| > 60), which is
    // exactly where the next node sits. Straight-through deck cars
    // are unaffected: they are elevated, so flyoverExit overrides the
    // steer target before this is used.
    if (prev) {
      const f = FLYOVERS.find((fl) => Math.abs(prev.x - fl.x) <= 0.5 && Math.abs(prev.z - fl.z) <= 0.5);
      if (f) {
        const legDx = node.x - prev.x;
        const legDz = node.z - prev.z;
        if (Math.abs(legDz) >= Math.abs(legDx)) {
          const side = legDz >= 0 ? 1 : -1;
          return { x: node.x + side * FLYOVER.turnLaneX, z: node.z, viaFlyover: false };
        }
      }
    }
    return { x: node.x, z: node.z, viaFlyover: false };
  }

  // v6.2: flyover recovery helpers (shared by the traffic drivers in
  // vehicles.js / ambient.js). The v6.1 unstuck teleported a wedged car
  // to the nearest road point — but nearestOnRoad is 2D, so for a car
  // already ON the deck the nearest road point IS its own position:
  // teleports of 0.14 m and 0 m, car frozen ~39 s (probe run2 id=10 at
  // (300,6,4.97)). And the v6.1 "never turn while elevated" guard only
  // forced straight when the CURRENT target was a flyover node: reaching
  // the node mid-deck advanced the path to an EW node and steered the
  // car into the deck-edge barrier (same car, heading 4.67 west).
  // Ramp foot, in the direction of travel: ground level, flyover lane,
  // 5 m past the ramp toe (|z| = deckHalf + rampLen + 5 = 65).
  function flyoverAt(x, z, y) {
    if (y <= 0.5) return null;
    for (const f of FLYOVERS) {
      if (Math.abs(x - f.x) <= FLYOVER.width / 2 + 1
        && Math.abs(z - f.z) <= FLYOVER.deckHalf + FLYOVER.rampLen + 5) return f;
    }
    return null;
  }
  // Exit point for a car elevated inside a flyover corridor: the ramp
  // foot past the flyover, in the direction of travel. The direction
  // comes from the heading's NS component when it is decisive; a car
  // facing a barrier (heading ~EW) falls back to the nearer foot, so
  // the exit never points the car at a barrier. Null when the car is
  // not elevated inside a corridor.
  function flyoverExit(x, z, y, heading) {
    const f = flyoverAt(x, z, y);
    if (!f) return null;
    let s;
    if (Math.cos(heading) >= 0.5) s = 1;
    else if (Math.cos(heading) <= -0.5) s = -1;
    else s = z >= f.z ? 1 : -1;
    return {
      x: f.x + s * FLYOVER.flyLaneX,
      z: f.z + s * (FLYOVER.deckHalf + FLYOVER.rampLen + 5),
      viaFlyover: true,
    };
  }
  // v6.2: nearest node ahead of (x, z) along the travel direction.
  // Prefer a node on the SAME street the car is on (same x-column for
  // NS travel, same z-row for EW travel); fall back to the nearest
  // node ahead at all. Used by the missed-turn recovery: after a car
  // crosses a flyover on the deck, the route is re-based at this node
  // so the car drives on to the next intersection instead of steering
  // back at the node it just passed. Returns a node {id, x, z} or null.
  function aheadNode(x, z, heading) {
    const hx = Math.sin(heading);
    const hz = Math.cos(heading);
    const ns = Math.abs(hz) >= Math.abs(hx);
    let best = null;
    let bestD = Infinity;
    for (const n of roadGraph.nodes) {
      const dx = n.x - x;
      const dz = n.z - z;
      if (dx * hx + dz * hz <= 0) continue; // behind
      const lat = ns ? Math.abs(n.x - x) : Math.abs(n.z - z);
      if (lat > 1) continue; // not on the same street
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = n; }
    }
    if (best) return best;
    for (const n of roadGraph.nodes) {
      const dx = n.x - x;
      const dz = n.z - z;
      if (dx * hx + dz * hz <= 0) continue; // behind
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }
  // Unstuck teleport target for a stuck car. Returns {x, z, heading}
  // (heading null = keep the current heading), or null when no
  // candidate is safe. Rules, both branches:
  //   - NEVER the car's own position: every candidate must be >= 2 m
  //     away (2D), otherwise the next candidate is tried.
  //   - every candidate must be clear at ground level (collides r=1.5).
  // Elevated (on a ramp/deck): the ramp feet — travel direction first
  // (forced heading along the road in that direction), then the other
  // foot (forced heading away from the flyover). Never nearestOnRoad.
  // Ground: the nearest road point (>= 2 m away), else the nearest
  // node (>= 2 m away). A car wedged inside a building is >= 10 m
  // from the nearest road, so the building case is unaffected.
  function unstuckTarget(x, z, y, heading) {
    const farEnough = (p) => Math.hypot(p.x - x, p.z - z) >= 2;
    const clear = (p) => !collides(p.x, p.z, 1.5, 0);
    const f = flyoverAt(x, z, y);
    if (f) {
      const exit = flyoverExit(x, z, y, heading);
      const s = exit.z >= f.z ? 1 : -1;
      const foot = (dir) => ({
        x: f.x + dir * FLYOVER.flyLaneX,
        z: f.z + dir * (FLYOVER.deckHalf + FLYOVER.rampLen + 5),
        heading: dir > 0 ? 0 : Math.PI,
      });
      for (const cand of [foot(s), foot(-s)]) {
        if (farEnough(cand) && clear(cand)) return cand;
      }
      // Both feet blocked (should not happen — they are open road):
      // fall through to the ground candidates below.
    }
    if (roadGraph && roadGraph.nearestOnRoad) {
      try {
        const near = roadGraph.nearestOnRoad(x, z);
        if (near && farEnough(near) && clear(near)) return { x: near.x, z: near.z, heading: null };
      } catch { /* try the node */ }
    }
    if (roadGraph && roadGraph.nearestNode) {
      try {
        const n = roadGraph.nearestNode(x, z);
        if (n && farEnough(n) && clear(n)) return { x: n.x, z: n.z, heading: null };
      } catch { /* no candidate */ }
    }
    return null;
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

  // ---- Neon signs on facades (v6.5 item 4, densified v6.6 item 4) -------
  // Was: downtown towers/mids only, max 70 signs, one per building, all
  // 3.4 x 1.2 m. v6.5: every tower/mid in the city, up to 300 signs +
  // 120 strips + rooflines + 900 lit-window quads. v6.6: the caps were
  // hit before the later cells were reached, so the city read dim away
  // from downtown — caps raised (signs 500, strips 220) and every
  // probability raised, with DOWNTOWN FIRST in the iteration order so
  // the centre gets the densest glow before any cap binds. All of it
  // still lives in the same 5 instanced meshes, so the draw-call cost
  // is unchanged (only the instance counts grow).
  const neonSigns = []; // {x, y, z, rotY, w, h}
  const neonStrips = []; // {x, y, z, rotY, w, h} vertical
  const neonRooflines = []; // {x, y, z, rotY, w, h} thin glow along the roof edge
  const downtownSet = new Set(downtownBuildings);
  const neonOrder = [
    ...downtownBuildings,
    ...byKind.tower.filter((b) => !downtownSet.has(b)),
    ...byKind.mid.filter((b) => !downtownSet.has(b)),
  ];
  // Street-facing side for a building: the nearer road axis, and the side
  // TOWARD that road (v6.5 item 4 fix: the old sign code picked the side
  // from the sign of the coordinate — b.x < 0 ? east : west — which faces
  // AWAY from the road for any building just east of a western road, so
  // most signs were invisible from the street they were meant for).
  function facadeOf(b) {
    let dv = Infinity, vx = null;
    for (const x of XS) { const d = Math.abs(b.x - x); if (d < dv) { dv = d; vx = x; } }
    let dh = Infinity, hz = null;
    for (const z of ZS) { const d = Math.abs(b.z - z); if (d < dh) { dh = d; hz = z; } }
    if (dv <= dh) {
      const side = vx >= b.x ? 1 : -1; // toward the nearest vertical road
      return { x: b.x + side * (b.w / 2 + 0.35), z: b.z, rotY: side * Math.PI / 2, along: 'z', half: b.d / 2 };
    }
    const side = hz >= b.z ? 1 : -1; // toward the nearest horizontal road
    return { x: b.x, z: b.z + side * (b.d / 2 + 0.35), rotY: side > 0 ? 0 : Math.PI, along: 'x', half: b.w / 2 };
  }
  for (const b of neonOrder) {
    if (neonSigns.length >= 800) break;
    const isDowntown = downtownSet.has(b);
    if (!isDowntown && rng() < 0.08) continue;
    const f = facadeOf(b);
    const y = randRange(rng, 6, Math.min(b.h - 2, 24));
    // v6.6 item 4 (round 3): EVERY tower/mid gets TWO signs (a lower
    // and a higher one) — one sign per building left the street view
    // sparse (3-4 signs visible) even after the cap raise, because a
    // street canyon only shows a few facades. Downtown towers get a
    // third. Cap 800; still one instanced mesh, one draw call.
    neonSigns.push({
      ...f, y,
      w: randRange(rng, 4.0, 8.0), h: randRange(rng, 1.4, 2.4),
    });
    if (rng() < 0.85) {
      neonSigns.push({
        ...f, y: randRange(rng, Math.min(b.h - 2, 14), Math.min(b.h - 2, 26)),
        w: randRange(rng, 3.0, 5.0), h: randRange(rng, 1.2, 1.9),
      });
    }
    if (isDowntown && b.h > 18 && rng() < 0.6 && neonSigns.length < 800) {
      neonSigns.push({
        ...f, y: randRange(rng, 4, Math.min(b.h - 2, 10)),
        w: randRange(rng, 2.4, 4.0), h: randRange(rng, 1.0, 1.6),
      });
    }
    // Roofline glow: a thin neon line along the top edge of the same
    // facade — the skyline reads as lit from street level even far away.
    if (rng() < 0.85) {
      neonRooflines.push({
        ...f, y: b.h - 0.6,
        w: Math.max(4, f.half * 2 - 1), h: 0.5,
      });
    }
    // A vertical strip near a facade corner; tall buildings get two
    // (one near each corner).
    const stripCount = b.h > 18 ? 2 : 1;
    for (let si = 0; si < stripCount; si++) {
      if (rng() < 0.7 && neonStrips.length < 300) {
        const off = randRange(rng, -f.half + 2, f.half - 2);
        const sx = f.along === 'z' ? f.x : f.x + off;
        const sz = f.along === 'z' ? f.z + off : f.z;
        neonStrips.push({
          x: sx, z: sz, y: randRange(rng, 5, Math.max(6, b.h - 8)), rotY: f.rotY,
          w: randRange(rng, 0.7, 1.0), h: randRange(rng, 5, Math.min(13, b.h - 4)),
        });
      }
    }
  }
  {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const signs = new THREE.InstancedMesh(geo, mat, Math.max(neonSigns.length, 1));
    neonSigns.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.scale.set(s.w, s.h, 1);
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
  // Vertical neon strips: thin tall planes, same neon palette.
  if (neonStrips.length) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const strips = new THREE.InstancedMesh(geo, mat, neonStrips.length);
    neonStrips.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.scale.set(s.w, s.h, 1);
      dummy.rotation.set(0, s.rotY, 0);
      dummy.updateMatrix();
      strips.setMatrixAt(i, dummy.matrix);
      strips.setColorAt(i, tmpColor.setHex(pick(rng, NEON_COLORS)));
    });
    strips.instanceMatrix.needsUpdate = true;
    if (strips.instanceColor) strips.instanceColor.needsUpdate = true;
    secureInstanced(strips);
    scene.add(strips);
  }
  // Roofline glows: thin horizontal neon lines along the roof edge.
  if (neonRooflines.length) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const lines = new THREE.InstancedMesh(geo, mat, neonRooflines.length);
    neonRooflines.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.scale.set(s.w, s.h, 1);
      dummy.rotation.set(0, s.rotY, 0);
      dummy.updateMatrix();
      lines.setMatrixAt(i, dummy.matrix);
      lines.setColorAt(i, tmpColor.setHex(pick(rng, NEON_COLORS)));
    });
    lines.instanceMatrix.needsUpdate = true;
    if (lines.instanceColor) lines.instanceColor.needsUpdate = true;
    secureInstanced(lines);
    scene.add(lines);
  }
  // Extra lit windows: bright quads on street-facing facades, beyond what
  // the building texture already draws. Two instanced meshes (warm /
  // cool) with emissive materials, so weather.js dims them by day exactly
  // like the texture windows (windowMats, base 1.6/1.3) instead of glowing
  // at noon. One draw call per mesh. v6.6 item 4: cap 900 -> 2000, more
  // windows lit per floor (skip 30% not 45%), 4 per floor on tall
  // buildings (2 on the rest), bigger quads, downtown first — same 2
  // draw calls, denser glow.
  let neonWindowCount = 0; // filled below, exposed for the harness
  {
    const winQuads = { warm: [], cool: [] };
    const winOrder = [
      ...downtownBuildings,
      ...byKind.tower.filter((b) => !downtownSet.has(b)),
      ...byKind.mid.filter((b) => !downtownSet.has(b)),
      ...byKind.house,
    ];
    for (const b of winOrder) {
      if (winQuads.warm.length + winQuads.cool.length >= 2000) break;
      const f = facadeOf(b);
      const floors = Math.max(1, Math.floor((b.h - 4) / 3));
      const perFloor = b.h > 14 ? 4 : 2;
      for (let fl = 0; fl < floors; fl++) {
        if (rng() < 0.3) continue; // not every window is lit
        for (let k = 0; k < perFloor; k++) {
          if (winQuads.warm.length + winQuads.cool.length >= 2000) break;
          const off = randRange(rng, -f.half + 2, f.half - 2);
          const q = {
            x: f.along === 'z' ? f.x : f.x + off,
            z: f.along === 'z' ? f.z + off : f.z,
            y: 4 + fl * 3 + randRange(rng, 0, 0.8),
            rotY: f.rotY,
            w: randRange(rng, 1.2, 1.6), h: randRange(rng, 1.6, 2.2),
          };
          (rng() < 0.55 ? winQuads.warm : winQuads.cool).push(q);
        }
      }
    }
    for (const [key, list] of Object.entries(winQuads)) {
      if (!list.length) continue;
      const base = key === 'warm' ? 1.6 : 1.3; // cool quads dimmer, less "white panel"
      const mat = new THREE.MeshStandardMaterial({
        color: 0x111111, emissive: key === 'warm' ? 0xffc46b : 0x9fd8ff,
        emissiveIntensity: base, roughness: 0.4, metalness: 0, side: THREE.DoubleSide,
      });
      windowMats.push({ mat, base }); // weather dims by day
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, list.length);
      list.forEach((q, i) => {
        dummy.position.set(q.x, q.y, q.z);
        dummy.scale.set(q.w, q.h, 1);
        dummy.rotation.set(0, q.rotY, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      secureInstanced(mesh);
      scene.add(mesh);
    }
    neonWindowCount = winQuads.warm.length + winQuads.cool.length;
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
  // Garden lamps (v6.3): one lamp just inside each garden gap, so the
  // entrance reads at night. Poles are visual only, like street lamps.
  // For an 'E'/'W' gap the lamp sits 1.5 m inside the edge, 2.5 m along
  // it from the gap centre (off the 2 m path slab); for an 'N'/'S' gap
  // the same, mirrored: 2.5 m along the edge, 1.5 m inside it.
  for (const g of FLYOVER_GARDENS) {
    const lx = g.gapSide === 'E' ? g.x1 - 1.5 : g.gapSide === 'W' ? g.x0 + 1.5 : g.gapC + 2.5;
    const lz = g.gapSide === 'E' || g.gapSide === 'W' ? g.gapC + 2.5
      : g.gapSide === 'N' ? g.z0 + 1.5 : g.z1 - 1.5;
    lampSpots.push({ x: lx, z: lz });
  }
  // Median garden lamps (v6.4): SHORT posts (sy 0.3 -> 1.8 m pole, head
  // at 1.83 m) so they stay under the ramp: clearance at |z| = 38 is
  // 2.14 m, at |z| = 14 is 5.02 m. One just past the foot gap (east
  // side, z = ±38, like the v6.3 gap lamps) and one at the deck end
  // (west side, z = ±14).
  for (const g of MEDIAN_GARDENS) {
    const s = g.gapC > 0 ? 1 : -1;
    lampSpots.push({ x: g.fx + 1.6, z: s * 38, sy: 0.3 });
    medianObjects.push({ kind: 'lamp', x: g.fx + 1.6, z: s * 38, top: 1.83 });
    lampSpots.push({ x: g.fx - 1.6, z: s * 14, sy: 0.3 });
    medianObjects.push({ kind: 'lamp', x: g.fx - 1.6, z: s * 14, top: 1.83 });
  }
  // Boardwalk lamps (v6.6 item 5): full-height street lamps along the
  // west edge of the boardwalk (x 413, 1 m from the edge, so the 8 m
  // walk stays clear), every 50 m. They share the street-lamp instanced
  // meshes — +0 draw calls. Not under any flyover, so full height is
  // fine. Poles are visual only, like all street lamps.
  for (let z = -400; z <= 400; z += 50) {
    lampSpots.push({ x: 413, z });
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
      const sy = p.sy || 1; // v6.4: median lamps are short posts (sy 0.3)
      dummy.position.set(p.x, 3 * sy, p.z);
      dummy.scale.set(1, sy, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x, 6.1 * sy, p.z);
      dummy.scale.set(1, 1, 1);
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
  // Boardwalk palms (v6.6 item 6): a palm row along the east edge of the
  // boardwalk (x 419, 1 m from the sand), every 35 m, z offset 17.5 m
  // from the boardwalk benches (benches at z -350..350 step 70) so a palm
  // never sits on a bench. clearOfRoads is belt-and-braces — the
  // boardwalk is 20+ m east of the last road end (x 400), so every palm
  // clears; a failed check drops the palm, never plants on a road.
  for (let z = -402.5; z <= 402.5; z += 35) {
    if (clearOfRoads(419, z)) addPalm(419, z);
    else treesDropped += 1;
  }
  // Main-road palms (v6.6 item 6): a palm row along BOTH sidewalks of
  // the z=0 arterial (12 m wide, so the sidewalk offset is 6 + 4.6 =
  // 10.6 m, the same offset as the street trees), x step 40 m from
  // -520 to 380. Every candidate is checked against EVERY road segment
  // via clearOfRoads (own street + cross streets near corners + the
  // flyover corridors at x 60/300) — a candidate that fails is shifted
  // by +-6/+-12 m, and dropped if no shift clears. Palms are visual
  // only (no colliders) and share the instanced trunk/crown meshes:
  // +0 draw calls.
  for (const side of [1, -1]) {
    for (let x = -520; x <= 380; x += 40) {
      let placed = false;
      for (const dx of [0, 6, -6, 12, -12]) {
        if (clearOfRoads(x + dx, side * 10.6)) { addPalm(x + dx, side * 10.6); placed = true; break; }
      }
      if (!placed) treesDropped += 1;
    }
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
  // Garden oaks (v6.3): 4 in the 18 m gardens, 2 in the 12 m ones, at the
  // corners clear of the path and benches. clearOfRoads is a belt-and-
  // braces check — the rects were pre-verified empty (probe v4, 0.5 m).
  for (const g of FLYOVER_GARDENS) {
    const big = (g.x1 - g.x0) >= 18;
    const spots = big
      ? [[g.x0 + 4, g.z0 + 4], [g.x1 - 4, g.z0 + 4], [g.x0 + 4, g.z1 - 4], [g.x1 - 4, g.z1 - 4]]
      : [[g.x0 + 3.5, g.z0 + 3.5], [g.x1 - 3.5, g.z1 - 3.5]];
    for (const [tx, tz] of spots) {
      if (clearOfRoads(tx, tz)) addOak(tx, tz);
      else treesDropped += 1;
    }
  }
  // Median garden shrubs (v6.4): low spheres only — no oaks (too tall
  // under the ramp, see MEDIAN_GARDENS note). Squashed crowns (squashY
  // 0.7, see the makeCrowns call below): top = y + r * 0.7, i.e. 0.92 m
  // at |z| = 24 (clearance 3.82 m) and 0.80 m at |z| = 46 (clearance
  // 1.18 m). Two per segment, off the path slab. Visual only, like
  // benches — the hedge is the barrier, not the planting.
  const shrubCrowns = [];
  for (const g of MEDIAN_GARDENS) {
    const s = g.gapC > 0 ? 1 : -1;
    shrubCrowns.push({ x: g.fx - 1.6, z: s * 24, y: 0.5, r: 0.6 });
    medianObjects.push({ kind: 'shrub', x: g.fx - 1.6, z: s * 24, top: 0.92 });
    shrubCrowns.push({ x: g.fx + 1.6, z: s * 46, y: 0.45, r: 0.5 });
    medianObjects.push({ kind: 'shrub', x: g.fx + 1.6, z: s * 46, top: 0.8 });
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
  makeCrowns(shrubCrowns, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), 0.7, 0.10, 0.18);
  const treeCount = oakTrunks.length + palmTrunks.length;

  // ---- Props: benches (plaza / park / beach) + hydrants ------------------
  // Plaza ring (v6.6 item 2): rotated 30 deg so NO bench sits on the
  // z=0 arterial. Before, the ring at 0/60/120/... deg put two benches
  // at (+-18,0) — dead centre on the arterial (road band z +-6). At
  // 30/90/150/... deg the benches sit at z=+-9 / +-18 (off the asphalt;
  // the nearest vertical road is x=+-60) and x=0 / +-15.6.
  const benches = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
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
  // Boardwalk benches (v6.6 item 5): along the east edge of the
  // boardwalk (x 418, 2 m from the edge), facing the sea (rotY -PI/2,
  // same as the beach benches), every 70 m. Visual only, like all
  // benches — they never block walking or driving. West of the sand
  // driving corridor (x >= 420), so M4/M8/M12 keep a clear lane.
  for (let z = -350; z <= 350; z += 70) {
    benches.push({ x: 418, z, rotY: -Math.PI / 2 });
  }
  // Garden benches (v6.3): one facing the path per garden, two in the
  // 18 m gardens (benches are visual only, like the park benches).
  for (const g of FLYOVER_GARDENS) {
    const cx = (g.x0 + g.x1) / 2;
    const cz = (g.z0 + g.z1) / 2;
    benches.push({ x: cx, z: cz - 3, rotY: 0 });
    if (g.x1 - g.x0 >= 18) benches.push({ x: cx, z: cz + 3, rotY: Math.PI });
  }
  // Median benches (v6.4): long axis along z (rotY ±PI/2) so each sits
  // beside the 2 m path slab, clear of it and of the hedges. Top
  // 0.68 m (bench box 0.45 high centred at 0.45): clearance at |z| =
  // 30 is 3.10 m, at |z| = 18 is 4.54 m.
  for (const g of MEDIAN_GARDENS) {
    const s = g.gapC > 0 ? 1 : -1;
    benches.push({ x: g.fx - 1.6, z: s * 18, rotY: Math.PI / 2 });
    medianObjects.push({ kind: 'bench', x: g.fx - 1.6, z: s * 18, top: 0.68 });
    benches.push({ x: g.fx + 1.6, z: s * 30, rotY: -Math.PI / 2 });
    medianObjects.push({ kind: 'bench', x: g.fx + 1.6, z: s * 30, top: 0.68 });
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
  // ---- Flyover garden hedges + bollards (v6.3) -------------------------
  // A low hedge ring (0.9 m high, 0.5 m thick) around each garden, in
  // `colliders` so cars AND pedestrians are blocked — except for ONE foot
  // gap on the road-facing edge. The gap is 4.4 m wide with a 0.6 m
  // bollard in the middle: 1.9 m clear on each side, so a player on foot
  // (radius 0.6) walks in while a car (radius 1.0, centre + nose + tail)
  // cannot. The hedge sits 0.5 m inside the verified rect, so no segment
  // can touch a road, ramp, turn lane or sidewalk.
  {
    const GAP_W = 4.4;
    const BOL_W = 0.6;
    const hedgeGeos = [];
    const bollards = [];
    for (const g of FLYOVER_GARDENS) {
      const hx0 = g.x0 + 0.5;
      const hx1 = g.x1 - 0.5;
      const hz0 = g.z0 + 0.5;
      const hz1 = g.z1 - 0.5;
      const segs = []; // [ax, az, bx, bz] hedge centre-lines
      // North edge — gap if gapSide 'N' (gapC = gap centre x).
      if (g.gapSide === 'N') {
        const g0 = g.gapC - GAP_W / 2;
        const g1 = g.gapC + GAP_W / 2;
        segs.push([hx0, hz0, g0, hz0]);
        segs.push([g1, hz0, hx1, hz0]);
        bollards.push({ x: g.gapC, z: hz0 });
        colliders.push({
          minX: g.gapC - BOL_W / 2, maxX: g.gapC + BOL_W / 2,
          minZ: hz0 - BOL_W / 2, maxZ: hz0 + BOL_W / 2,
        });
      } else {
        segs.push([hx0, hz0, hx1, hz0]); // north edge
      }
      // South edge — gap if gapSide 'S' (gapC = gap centre x). v6.6:
      // A/B/C carry their gap here so the road-facing edge stays
      // continuous (see FLYOVER_GARDENS note).
      if (g.gapSide === 'S') {
        const g0 = g.gapC - GAP_W / 2;
        const g1 = g.gapC + GAP_W / 2;
        segs.push([hx0, hz1, g0, hz1]);
        segs.push([g1, hz1, hx1, hz1]);
        bollards.push({ x: g.gapC, z: hz1 });
        colliders.push({
          minX: g.gapC - BOL_W / 2, maxX: g.gapC + BOL_W / 2,
          minZ: hz1 - BOL_W / 2, maxZ: hz1 + BOL_W / 2,
        });
      } else {
        segs.push([hx0, hz1, hx1, hz1]); // south edge
      }
      for (const [ex, isGap] of [[hx1, g.gapSide === 'E'], [hx0, g.gapSide === 'W']]) {
        if (!isGap) { segs.push([ex, hz0, ex, hz1]); continue; }
        const g0 = g.gapC - GAP_W / 2;
        const g1 = g.gapC + GAP_W / 2;
        segs.push([ex, hz0, ex, g0]);
        segs.push([ex, g1, ex, hz1]);
        bollards.push({ x: ex, z: g.gapC });
        colliders.push({
          minX: ex - BOL_W / 2, maxX: ex + BOL_W / 2,
          minZ: g.gapC - BOL_W / 2, maxZ: g.gapC + BOL_W / 2,
        });
      }
      for (const [ax, az, bx, bz] of segs) {
        const alongX = az === bz;
        const len = alongX ? bx - ax : bz - az;
        if (len <= 0) continue;
        const geo = new THREE.BoxGeometry(len, 0.9, 0.5);
        if (!alongX) geo.rotateY(Math.PI / 2);
        geo.translate((ax + bx) / 2, 0.45, (az + bz) / 2);
        hedgeGeos.push(geo);
        if (alongX) colliders.push({ minX: ax, maxX: bx, minZ: az - 0.25, maxZ: az + 0.25 });
        else colliders.push({ minX: ax - 0.25, maxX: ax + 0.25, minZ: az, maxZ: bz });
      }
    }
    if (hedgeGeos.length) {
      const mesh = new THREE.Mesh(
        mergeGeometries(hedgeGeos),
        new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 1, metalness: 0 }),
      );
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    if (bollards.length) {
      const geo = new THREE.CylinderGeometry(0.25, 0.3, 0.9, 8);
      const mat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.5, metalness: 0.6 });
      const inst = new THREE.InstancedMesh(geo, mat, bollards.length);
      bollards.forEach((b, i) => {
        dummy.position.set(b.x, 0.45, b.z);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      secureInstanced(inst);
      scene.add(inst);
    }
  }
  // ---- Median garden hedges + bollards (v6.4) -------------------------
  // Side edges ONLY (no hedge across either strip end — the ends are
  // the ramp-mount corridor and the intersection opening). Hedge centre
  // x = f.x ± 2.825, 0.25 m thick, 0.9 m high (THIN: a 0.5 m hedge
  // left only 0.3 m to the turn lane and traffic cars nose-clipped it
  // at ~7 deg yaw — see MEDIAN_GARDENS note; 0.25 m leaves 0.55 m,
  // clip threshold ~19 deg, while the flyover side keeps 0.2 m).
  // One foot gap per segment on the east side at the midpoint (v6.3
  // pattern: 4.4 m gap + 0.6 m bollard -> 1.9 m sub-gaps). Colliders
  // are HEIGHT-GATED (maxY 1.5, see collides()): they block ground
  // callers but never a car on the deck/ramp above.
  // INTERSECTION-END INSET (v6.4 fix, found by the builder self-test):
  // the hedge starts 4 m back from the intersection mouth (z = ±14,
  // not ±10.5). A sedan turning right out of the turn lane wedges its
  // centre circle (r = 1.0) on the hedge's end corner at (then
  // f.x±2.95, ±10.5): the turn apex is (f.x±4.2, ±10.2), the nose cannot swing
  // east past the corner and the car cannot move at all (speed pinned
  // at -0.05, heading frozen — reproduced 2x in the self-test). With
  // the corner at ±14 the apex clears it by 2.8 m (centre) / 1.5 m
  // (tail). The 4 m of hedge-less strip at the mouth is part of the
  // already-open intersection end, not a new entrance: the strip ends
  // were open by design (ramp-mount corridor).
  {
    const GAP_W = 4.4;
    const BOL_W = 0.6;
    const hedgeGeos = [];
    const bollards = [];
    for (const g of MEDIAN_GARDENS) {
      const hz0 = g.z0 + (g.z0 > 0 ? 4 : 0.5);
      const hz1 = g.z1 - (g.z1 < 0 ? 4 : 0.5);
      for (const side of [-1, 1]) {
        const ex = g.fx + side * 2.825;
        const isGap = side > 0; // east side only (gapSide 'E')
        const runs = [];
        if (!isGap) {
          runs.push([hz0, hz1]);
        } else {
          const g0 = g.gapC - GAP_W / 2;
          const g1 = g.gapC + GAP_W / 2;
          runs.push([hz0, g0], [g1, hz1]);
          bollards.push({ x: ex, z: g.gapC });
          colliders.push({
            minX: ex - BOL_W / 2, maxX: ex + BOL_W / 2,
            minZ: g.gapC - BOL_W / 2, maxZ: g.gapC + BOL_W / 2, maxY: 1.5,
          });
        }
        for (const [za, zb] of runs) {
          const len = zb - za;
          if (len <= 0) continue;
          const geo = new THREE.BoxGeometry(0.25, 0.9, len);
          geo.translate(ex, 0.45, (za + zb) / 2);
          hedgeGeos.push(geo);
          colliders.push({ minX: ex - 0.125, maxX: ex + 0.125, minZ: za, maxZ: zb, maxY: 1.5 });
        }
      }
    }
    if (hedgeGeos.length) {
      const mesh = new THREE.Mesh(
        mergeGeometries(hedgeGeos),
        new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 1, metalness: 0 }),
      );
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    if (bollards.length) {
      const geo = new THREE.CylinderGeometry(0.25, 0.3, 0.9, 8);
      const mat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.5, metalness: 0.6 });
      const inst = new THREE.InstancedMesh(geo, mat, bollards.length);
      bollards.forEach((b, i) => {
        dummy.position.set(b.x, 0.45, b.z);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      secureInstanced(inst);
      scene.add(inst);
    }
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

  // v6.6 item 5: beach sand (x 420..470) — cars drive on it, but slowly
  // (see the SAND_MAX cap in vehicles.js driveVehicle and the police
  // cap in combat.js). Pedestrians walk freely; the sand is not a
  // collider. The boardwalk (x 412..420) is NOT sand — full speed on
  // it is impossible anyway (no road there), but it is not capped.
  function isOnSand(x, z) {
    return x >= SAND_X0 && x < WATER_X0 && z >= -D / 2 && z <= D / 2;
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
      // Height-gated colliders (v6.4 median hedges/bollards, maxY 1.5):
      // they block ground callers only — a car on the deck/ramp above
      // (y > 1.5) passes over them, exactly like the deck-edge barriers
      // below (which gate the other way). Plain colliders (buildings,
      // v6.3 hedges) have no maxY and behave exactly as before.
      if (c.maxY !== undefined && y > c.maxY) continue;
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

  // Park spot (v6.6 item 2): open ground AND clear of every road band
  // by the car's full footprint (nose 1.7 m + radius 1.0 = 2.7 m), so
  // a parked car snapped out of a building can never land on — or
  // overhang — a road. findOpenGround is road-blind: it only avoids
  // building colliders, which is how the plaza sedan's tail ended up
  // 0.44 m over the z=0 arterial's edge. Same spiral search, plus the
  // road-clearance test on every candidate.
  function findParkSpot(x, z, maxR = 60) {
    const clear = (px, pz) => {
      if (collides(px, pz, 1.5)) return false;
      const n = roadGraph.nearestOnRoad(px, pz);
      if (!n) return true;
      const seg = roadGraph.segments[n.segment];
      return n.dist > seg.width / 2 + 2.7;
    };
    if (clear(x, z) && Math.abs(x) < W / 2 - 5 && Math.abs(z) < D / 2 - 5) return { x, z };
    for (let radius = 2; radius <= maxR; radius += 2) {
      const steps = 16;
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const px = x + Math.cos(a) * radius;
        const pz = z + Math.sin(a) * radius;
        if (Math.abs(px) >= W / 2 - 5 || Math.abs(pz) >= D / 2 - 5) continue;
        if (clear(px, pz)) return { x: px, z: pz };
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
    gardens: FLYOVER_GARDENS.length,
    medianGardens: MEDIAN_GARDENS.length,
    medianObjects: medianObjects.length,
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
    flyovers: FLYOVERS.map((f) => ({ ...f, deckH: FLYOVER.deckH, rampLen: FLYOVER.rampLen, width: FLYOVER.width, deckHalf: FLYOVER.deckHalf, flyLaneX: FLYOVER.flyLaneX })),
    flyoverGardens: FLYOVER_GARDENS,
    medianGardens: MEDIAN_GARDENS,
    medianObjects,
    // v6: steering-target lane shift at flyover intersections (see
    // laneTarget above). Exposed for the traffic drivers (vehicles.js /
    // ambient.js) and the debug API.
    laneTarget,
    // v6.2: flyover recovery — exit foot for an elevated car, and the
    // unstuck teleport target (see flyoverExit / unstuckTarget above).
    flyoverExit,
    unstuckTarget,
    // v6.2: nearest node ahead, for the missed-turn recovery.
    aheadNode,
    groundHeightAt(x, z, currentY = 0) {
      return flyoverHeightAt(x, z, currentY);
    },
    // v6.5 item 5: tallest building roof under a point (0 = open ground),
    // for the police helicopter's roof avoidance — downtown towers reach
    // 58 m, so a fixed 30 m orbit would fly straight through them.
    tallestAt(x, z) {
      let h = 0;
      for (const list of [byKind.tower, byKind.mid, byKind.house, byKind.warehouse]) {
        for (const b of list) {
          if (Math.abs(x - b.x) <= b.w / 2 + 1 && Math.abs(z - b.z) <= b.d / 2 + 1 && b.h > h) h = b.h;
        }
      }
      return h;
    },
    findOpenGround,
    findParkSpot,
    nearestSidewalk,
    collides,
    isInWater,
    isOnSand,
    boardwalk: BOARDWALK,
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
    flyoverGardens: FLYOVER_GARDENS,
    medianGardens: MEDIAN_GARDENS,
    medianObjects,
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
    findParkSpot: api.findParkSpot,
    benches,
    // v6.6 item 4: neon instance counts, so the harness can verify the
    // density increase directly (pixel metrics at one viewpoint are noisy
    // across rng reshuffles).
    neonCounts: {
      signs: neonSigns.length, strips: neonStrips.length,
      rooflines: neonRooflines.length, windows: neonWindowCount,
    },
    nearestSidewalk: api.nearestSidewalk,
    collides: api.collides,
    isInWater: api.isInWater,
    // v6.6 item 5: sand test + boardwalk bounds, for the harness
    // (sand-speed cap verification, boardwalk walk probe).
    isOnSand: api.isOnSand,
    boardwalk: BOARDWALK,
  };

  return api;
}
