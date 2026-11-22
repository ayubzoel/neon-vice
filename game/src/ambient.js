// Neon Vice — Builder NPC: ambient pedestrians + extra traffic cars.
// Pedestrians walk ONLY on sidewalks (3 m strips flanking every road, per
// world.js: centreline offset = road half-width + 1.5 m), never on the road
// surface and never through buildings — sidewalks sit between the road edge
// and the building line (buildings are inset 10 m from the street), so a
// sidewalk position is collision-free by construction.
//
// v3 discipline (Builder A): right-hand lanes — a pedestrian walks on the
// sidewalk to the RIGHT of their direction of travel, so the two directions
// of one street use opposite sidewalks and never meet head-on; even spacing
// — peds start on distinct segments with golden-ratio-staggered positions,
// steady near-uniform speeds (1.15-1.5 m/s), and a ped that catches the one
// ahead slows to 35% until the gap re-opens; consistent routes — at each
// intersection a ped keeps walking straight or turns onto the adjoining
// sidewalk, switching segments exactly where the two sidewalk centrelines
// meet (the corner), so the path is continuous and never cuts the road.
// v4 (Builder C): 60 pedestrians, 28 traffic cars total (24 extra + 4
// stock). Same instancing as v3 — still 4 draw calls for ALL pedestrians,
// 1 merged-mesh draw call per extra car — so the crowd grows without a
// proportional draw-call cost. See the FPS note in the v4 report before
// raising these numbers further.
// Traffic cars reuse vehicles.js (addVehicle + the existing updateTraffic
// loop): they follow the road graph on the road centreline, stop at red
// lights, and never drive into the car ahead.
//
// Rendering is instanced: 4 draw calls for all pedestrians (bodies, heads,
// arms, legs) and 1 reused car Group per traffic car. Ambient NPCs never
// touch missions, wanted, or the player: they have no collision with Vera
// and no interaction radius.

import { mulberry32, randRange, pick } from './data.js';

const PED_COUNT = 60;
const EXTRA_TRAFFIC = 24; // +4 existing traffic cars = 28 total
const NEAR_SPAWN_COUNT = 8; // guaranteed visible around the spawn plaza
const NEAR_SPAWN_RADIUS = 130; // m from (0,0): streets framing the plaza

const SHIRTS = [0xef4444, 0x3b82f6, 0xf59e0b, 0x22c55e, 0xec4899, 0xa78bfa, 0xe2e8f0, 0x14b8a6, 0xf97316, 0x94a3b8, 0xfacc15, 0xfb7185];
const SKINS = [0xe8b88a, 0xc68e5e, 0x8d5524, 0xf1c27d, 0xe0ac69];
const PANTS = [0x1f2937, 0x334155, 0x3f3f46, 0x1e293b, 0x44403c];
const TRAFFIC_COLORS = [0x94a3b8, 0xf97316, 0x3b82f6, 0xa3e635, 0xfacc15, 0x67e8f9, 0xfda4af, 0xd8b4fe];

// Same r149 lesson as world.js: InstancedMesh is culled by
// geometry.boundingSphere only, so give it a city-sized sphere and switch
// culling off, or pedestrians vanish whenever the origin leaves the frustum.
function secureInstanced(mesh) {
  mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1200);
  mesh.frustumCulled = false;
  return mesh;
}

export function createAmbient(scene, world, vehicles, opts = {}) {
  // opts.isDriven(v): true while the player is driving that car — the
  // ambient steering loop must not fight driveVehicle in the same frame.
  const rng = mulberry32(20261121);
  const graph = world.roadGraph;
  const segments = graph.segments;
  const adjacency = graph.adjacency;

  // ---- Pedestrians -------------------------------------------------------
  // Right-hand lane: side is DERIVED from the travel direction, never
  // random — eastbound uses the south sidewalk, westbound the north one,
  // southbound the west one, northbound the east one.
  function rightSide(seg, dir) {
    return seg.kind === 'horizontal' ? dir : -dir;
  }
  // Sidewalk-centreline offset of a segment for a given side.
  function segOffset(seg, side) {
    const off = seg.width / 2 + 1.5;
    return seg.kind === 'horizontal' ? { x: 0, z: side * off } : { x: side * off, z: 0 };
  }
  // Unit vector a -> b of a segment.
  function segDir(seg) {
    const len = seg.length || 1;
    return { x: (seg.bx - seg.ax) / len, z: (seg.bz - seg.az) / len };
  }

  const pedestrians = [];
  const nearSpawnSegs = new Set();
  segments.forEach((s, i) => {
    const mx = (s.ax + s.bx) / 2;
    const mz = (s.az + s.bz) / 2;
    if (Math.hypot(mx, mz) <= NEAR_SPAWN_RADIUS) nearSpawnSegs.add(i);
  });

  // One pedestrian per segment at spawn (shuffled), so nobody starts in a
  // bunch; t is golden-ratio staggered inside [0.25, 0.75] — always before
  // any exit point, so no ped turns on its first frame.
  const shuffled = segments.map((_, i) => i);
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const chosenSegs = [
    ...shuffled.filter((i) => nearSpawnSegs.has(i)).slice(0, NEAR_SPAWN_COUNT),
    ...shuffled.filter((i) => !nearSpawnSegs.has(i)),
  ].slice(0, PED_COUNT);

  function spawnPed(segIdx, i) {
    const s = segments[segIdx];
    const dir = rng() < 0.5 ? -1 : 1;
    return {
      seg: segIdx,
      dir,
      side: rightSide(s, dir),
      t: 0.25 + 0.5 * (((i * 0.6180339887) % 1 + rng() * 0.05) % 1),
      speed: randRange(rng, 1.15, 1.5), // m/s, steady and near-uniform
      phase: rng() * Math.PI * 2,
      slow: 1,
      farTurn: null,
      exit: null,
      x: 0, z: 0, heading: 0,
      shirt: pick(rng, SHIRTS),
      skin: pick(rng, SKINS),
      pants: pick(rng, PANTS),
    };
  }
  for (let i = 0; i < PED_COUNT; i += 1) pedestrians.push(spawnPed(chosenSegs[i], i));
  // Place every ped on its sidewalk and plan its first exit before the
  // first frame, so no ped ever starts without a route.
  pedestrians.forEach((pd) => { placePed(pd); planExit(pd); });

  // Position of a pedestrian from its route state (sidewalk centreline).
  function placePed(p) {
    const s = segments[p.seg];
    const alongX = s.kind === 'horizontal';
    const off = s.width / 2 + 1.5;
    const lx = s.ax + (s.bx - s.ax) * p.t;
    const lz = s.az + (s.bz - s.az) * p.t;
    p.x = lx + (alongX ? 0 : p.side * off);
    p.z = lz + (alongX ? p.side * off : 0);
    // Heading from travel direction (forward = sin h, cos h, as in player.js).
    p.heading = alongX ? (p.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (p.dir > 0 ? 0 : Math.PI);
  }

  // Exit plan for the segment a pedestrian just entered: where on this
  // segment they turn (exit.t) and which segment they step onto
  // (exit.next). At the node ahead, straight counts 3, a near turn 2, a
  // far turn 0 — so peds walk long consistent stretches, turn onto the
  // adjoining sidewalk whenever the corner lies before the node, and only
  // overshoot the node (far turn, via the next block's sidewalk) when no
  // straight or near option exists at all.
  function planExit(p) {
    // Far turn carried over: the ped overshot the previous node along
    // this (continuation) street and turns here, u metres past the node.
    if (p.farTurn) {
      const ft = p.farTurn;
      p.farTurn = null;
      const s = segments[p.seg];
      p.exit = { t: p.dir > 0 ? ft.u / s.length : 1 - ft.u / s.length, next: ft.next };
      return;
    }
    const s = segments[p.seg];
    const nodeId = p.dir > 0 ? s.b : s.a;
    const d = segDir(s);
    const td = { x: d.x * p.dir, z: d.z * p.dir };
    const o = segOffset(s, p.side);
    const options = adjacency[nodeId].filter((e) => e.seg !== p.seg);
    let best = null;
    let straightCand = null;
    for (const e of options) {
      const ns = segments[e.seg];
      const ndir = ns.a === nodeId ? 1 : -1; // travel away from the node
      const nside = rightSide(ns, ndir);
      const nd = segDir(ns);
      const ntd = { x: nd.x * ndir, z: nd.z * ndir };
      const no = segOffset(ns, nside);
      // Collinear continuation of the same street (same line, other side
      // of the node) is "straight".
      const straight = ns.kind === s.kind
        && (ns.kind === 'horizontal' ? ns.az === s.az : ns.ax === s.ax);
      let kind;
      let uC = 0;
      let vC = 0;
      if (straight) {
        kind = 'straight';
      } else {
        // Corner C where the two sidewalk centrelines meet, measured along
        // the travel direction from the node (uC <= 0: before the node) and
        // along the new street from the node (vC).
        uC = (no.x - o.x) * td.x + (no.z - o.z) * td.z;
        vC = (o.x - no.x) * ntd.x + (o.z - no.z) * ntd.z;
        kind = uC <= 0.5 ? 'near' : 'far';
      }
      const w = (kind === 'straight' ? 3 : kind === 'near' ? 2 : 0) + rng() * 0.6;
      const cand = { e, ns, ndir, ntd, no, kind, uC, vC, w };
      if (kind === 'straight' && !straightCand) straightCand = cand;
      if (!best || cand.w > best.w) best = cand;
    }
    if (!best) { p.exit = { t: p.dir > 0 ? 1 : 0, next: { seg: p.seg, t: p.t, dir: -p.dir } }; return; }
    const nodeT = p.dir > 0 ? 1 : 0;
    const entryT = (ns, v) => {
      const len = ns.length || 1;
      const t = ns.a === nodeId ? v / len : 1 - v / len;
      return Math.max(0, Math.min(1, t));
    };
    if (best.kind === 'straight') {
      p.exit = {
        t: nodeT,
        next: { seg: best.e.seg, t: best.ns.a === nodeId ? 0 : 1, dir: best.ndir },
      };
    } else if (best.kind === 'near') {
      // Turn at the corner: exit.t is where the ped's sidewalk meets the
      // new street's sidewalk, so the step onto the new segment lands on
      // exactly the same point — no jump, no road cut.
      const tExit = p.dir > 0 ? 1 + best.uC / s.length : -best.uC / s.length;
      p.exit = {
        t: Math.max(0.02, Math.min(0.98, tExit)),
        next: { seg: best.e.seg, t: entryT(best.ns, best.vC), dir: best.ndir },
      };
    } else if (straightCand) {
      // Far turn via the next block: walk straight across the node on this
      // street's sidewalk, then turn uC metres past it. The carried-over
      // farTurn is consumed by planExit() when the ped enters that block.
      p.exit = {
        t: nodeT,
        next: { seg: straightCand.e.seg, t: straightCand.ns.a === nodeId ? 0 : 1, dir: straightCand.ndir },
        farTurn: {
          u: best.uC,
          next: { seg: best.e.seg, t: entryT(best.ns, best.vC), dir: best.ndir },
        },
      };
    } else {
      // Nowhere straight to overshoot on (map corner): switch at the node.
      p.exit = {
        t: nodeT,
        next: { seg: best.e.seg, t: best.ns.a === nodeId ? 0 : 1, dir: best.ndir },
      };
    }
  }

  function updatePedestrians(dt) {
    // Even spacing, two rules. Same sidewalk: a ped that catches the one
    // ahead slows to 35% until the gap re-opens past 2.4 m. Different
    // sidewalks meeting at a corner (within 1.6 m): the later one waits.
    for (const p of pedestrians) p.slow = 1;
    for (let i = 0; i < pedestrians.length; i += 1) {
      for (let j = i + 1; j < pedestrians.length; j += 1) {
        const a = pedestrians[i];
        const b = pedestrians[j];
        if (a.seg === b.seg && a.side === b.side) {
          const gap = Math.abs(a.t - b.t) * segments[a.seg].length;
          if (gap < 2.4) {
            const behind = (a.dir > 0 ? a.t < b.t : a.t > b.t) ? a : b;
            behind.slow = 0.35;
          }
        } else if (a.seg !== b.seg && Math.hypot(a.x - b.x, a.z - b.z) < 1.6) {
          b.slow = Math.min(b.slow, 0.35);
        }
      }
    }
    for (const p of pedestrians) {
      const s = segments[p.seg];
      p.t += (p.dir * p.speed * p.slow * dt) / s.length;
      const e = p.exit;
      if (e && (p.dir > 0 ? p.t >= e.t : p.t <= e.t)) {
        p.seg = e.next.seg;
        p.t = e.next.t;
        p.dir = e.next.dir;
        p.side = rightSide(segments[p.seg], p.dir);
        if (e.farTurn) p.farTurn = e.farTurn;
        planExit(p);
      }
      p.phase += dt * p.speed * p.slow * 2.6; // stride frequency scales with speed
      placePed(p);
    }
  }

  // ---- Instanced pedestrian meshes (4 draw calls for all 60) ------------
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  const bodyGeo = new THREE.BoxGeometry(0.55, 0.85, 0.32);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const bodies = secureInstanced(new THREE.InstancedMesh(bodyGeo, bodyMat, PED_COUNT));
  const headGeo = new THREE.SphereGeometry(0.17, 8, 6);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  const heads = secureInstanced(new THREE.InstancedMesh(headGeo, headMat, PED_COUNT));
  // Arms: sleeves in the shirt colour, swinging opposite to the same-side
  // leg — the v2 model had legs only; arms complete the humanoid.
  const armGeo = new THREE.BoxGeometry(0.16, 0.6, 0.16);
  const armMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const arms = secureInstanced(new THREE.InstancedMesh(armGeo, armMat, PED_COUNT * 2));
  const legGeo = new THREE.BoxGeometry(0.17, 0.55, 0.17);
  const legMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  const legs = secureInstanced(new THREE.InstancedMesh(legGeo, legMat, PED_COUNT * 2));
  pedestrians.forEach((p, i) => {
    bodies.setColorAt(i, tmpColor.setHex(p.shirt));
    heads.setColorAt(i, tmpColor.setHex(p.skin));
    arms.setColorAt(i * 2, tmpColor.setHex(p.shirt));
    arms.setColorAt(i * 2 + 1, tmpColor.setHex(p.shirt));
    legs.setColorAt(i * 2, tmpColor.setHex(p.pants));
    legs.setColorAt(i * 2 + 1, tmpColor.setHex(p.pants));
  });
  for (const m of [bodies, heads, arms, legs]) {
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    scene.add(m);
  }

  function renderPedestrians() {
    pedestrians.forEach((p, i) => {
      const bob = Math.abs(Math.cos(p.phase)) * 0.04;
      const sx = Math.sin(p.heading);
      const sz = Math.cos(p.heading);
      // Body: slight bob, faces travel direction.
      dummy.position.set(p.x, 0.975 + bob, p.z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, p.heading, 0);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
      // Head.
      dummy.position.set(p.x, 1.58 + bob, p.z);
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
      // Arms swing opposite to the same-side leg; shoulders sit 0.36 m out
      // from the centreline on each side (right vector = -cos h, sin h).
      const armSwing = Math.sin(p.phase) * 0.15;
      const rx = -Math.cos(p.heading);
      const rz = Math.sin(p.heading);
      dummy.position.set(p.x - rx * 0.36 + sx * -armSwing, 1.05 + bob, p.z - rz * 0.36 + sz * -armSwing);
      dummy.rotation.set(0, p.heading, 0);
      dummy.updateMatrix();
      arms.setMatrixAt(i * 2, dummy.matrix);
      dummy.position.set(p.x + rx * 0.36 + sx * armSwing, 1.05 + bob, p.z + rz * 0.36 + sz * armSwing);
      dummy.updateMatrix();
      arms.setMatrixAt(i * 2 + 1, dummy.matrix);
      // Legs swing fore/aft along the heading, opposite phases.
      const swing = Math.sin(p.phase) * 0.17;
      dummy.position.set(p.x + sx * swing, 0.275, p.z + sz * swing);
      dummy.rotation.set(0, p.heading, 0);
      dummy.updateMatrix();
      legs.setMatrixAt(i * 2, dummy.matrix);
      dummy.position.set(p.x - sx * swing, 0.275, p.z - sz * swing);
      dummy.updateMatrix();
      legs.setMatrixAt(i * 2 + 1, dummy.matrix);
    });
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    arms.instanceMatrix.needsUpdate = true;
    legs.instanceMatrix.needsUpdate = true;
  }

  // ---- Extra traffic cars -------------------------------------------------
  // One merged vertex-colored mesh per car = 1 draw call each. The stock
  // makeCarBody Group is 8 meshes per car; 8 extra Groups (64 draws) halved
  // SwiftShader FPS in the first measurement (desktop 2.0 -> 1.1, mobile
  // 5.2 -> 2.6). These cars keep the exact vehicle-object shape vehicles.js
  // expects (mesh.position/rotation, heading, speed, path...) so they stay
  // enterable and drivable like the 4 stock traffic cars — only the body
  // mesh and the steering loop differ.
  function mergeCarGeos(geos) {
    let vCount = 0;
    let iCount = 0;
    for (const g of geos) { vCount += g.attributes.position.count; iCount += g.index.count; }
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const col = new Float32Array(vCount * 3);
    const idx = new Uint32Array(iCount);
    let vOff = 0;
    let iOff = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, vOff * 3);
      nor.set(g.attributes.normal.array, vOff * 3);
      col.set(g.attributes.color.array, vOff * 3);
      const src = g.index.array;
      for (let i = 0; i < src.length; i++) idx[iOff + i] = src[i] + vOff;
      vOff += g.attributes.position.count;
      iOff += src.length;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  }

  function makeMergedCar(colorHex) {
    const geos = [];
    const paint = (g, hex) => {
      const c = new THREE.Color(hex);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      geos.push(g);
    };
    const box = (w, h, d, x, y, z, hex) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      paint(g, hex);
    };
    const bodyLen = 4.6;
    box(2.0, 0.7, bodyLen, 0, 0.55, 0, colorHex); // body
    box(1.7, 0.6, bodyLen * 0.45, 0, 1.15, -bodyLen * 0.05, 0x111827); // cabin
    for (const [wx, wz] of [[-0.95, bodyLen * 0.32], [0.95, bodyLen * 0.32], [-0.95, -bodyLen * 0.32], [0.95, -bodyLen * 0.32]]) {
      box(0.3, 0.72, 0.72, wx, 0.36, wz, 0x0a0a0a); // wheels (boxes read the same at street distance)
    }
    for (const lx of [-0.6, 0.6]) box(0.35, 0.18, 0.1, lx, 0.6, bodyLen / 2 + 0.02, 0xfff7cc); // headlights
    return new THREE.Mesh(
      mergeCarGeos(geos),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.5 }),
    );
  }

  // Own steering loop for the new cars (the stock updateTraffic steers at
  // 12 m/s with a 1.4 rad/s cap, so cars swing wide over sidewalk corners
  // after 90-degree turns — measured 6/8 on-road). These slow to 4 m/s near
  // nodes and steer up to 2.5 rad/s, which keeps them on the centreline.
  // Stock behaviour for the 4 original cars is untouched.
  function repathCar(v) {
    try {
      const p = graph.findPath(
        { x: v.mesh.position.x, z: v.mesh.position.z },
        { x: (Math.random() - 0.5) * 1000, z: (Math.random() - 0.5) * 800 },
      );
      if (Array.isArray(p) && p.length > 1) {
        v.path = p;
        // Drive to path[0] (the nearest node) FIRST: steering straight at
        // path[1] from mid-street cuts the corner across blocks — the car
        // ends up off-road, beelining diagonally, and wedges on a building.
        v.pathIndex = 0;
        return true;
      }
    } catch { /* keep current path */ }
    return false;
  }

  // v6.1: footprint collision for the extra traffic cars — centre +
  // nose + tail at r=1.0 (the car's real half-width), height-aware,
  // exactly like vehicles.js carCollides. The old single-point r=1.4
  // check with NO y ignored the deck barriers entirely (ambient cars
  // could clip through them); with y but r=1.4 it would wedge like the
  // stock cars did (lane centre 1.5 + 1.4 = 2.9 > barrier at 2.7).
  // With r=1.0 a centred car clears the barrier by 0.2 m (2.5 < 2.7).
  function trafficCollides(x, z, heading, y) {
    if (!world.collides) return false;
    const sx = Math.sin(heading);
    const sz = Math.cos(heading);
    if (world.collides(x, z, 1.0, y)) return true;
    if (world.collides(x + sx * 1.7, z + sz * 1.7, 1.0, y)) return true;
    if (world.collides(x - sx * 1.7, z - sz * 1.7, 1.0, y)) return true;
    return false;
  }
  // Height at a destination point (for collision checks): the barrier
  // gate (y > 1.5) must be judged where the car is GOING, not where it
  // is — judging the reverse step by the current elevated y blocked
  // the escape downhill and froze the car at speed -4 forever.
  function destY(x, z, curY) {
    if (!world.groundHeightAt) return curY;
    try { return world.groundHeightAt(x, z, curY); } catch { return curY; }
  }

  // v6.1 unstuck (same contract as vehicles.js unstickCar): a traffic
  // car still < 6 m for 15 s of game time is teleported to the nearest
  // road centreline point and re-pathed — no traffic car may freeze
  // forever, on a ramp or anywhere else. 15 s, not 10: a legitimate
  // wait is bounded by the 20 s signal cycle (red at most 10 s) plus a
  // few seconds of queue drain, and the timer is POSITION-only on
  // purpose — run 2 proved a hold-aware timer never fires, because a
  // wedged car interleaves red-light / queue holds with blocked
  // reverse steps, and every hold reset the clock.
  function unstickCar(v) {
    let tx = v.mesh.position.x;
    let tz = v.mesh.position.z;
    if (graph && graph.nearestOnRoad) {
      try {
        const near = graph.nearestOnRoad(tx, tz);
        if (near) { tx = near.x; tz = near.z; }
      } catch { /* keep position */ }
    }
    if (world.collides && world.collides(tx, tz, 1.5)) {
      if (world.findOpenGround) {
        try {
          const g = world.findOpenGround(tx, tz, 30);
          if (g) { tx = g.x; tz = g.z; }
        } catch { /* keep centreline point */ }
      }
    }
    v.mesh.position.x = tx;
    v.mesh.position.z = tz;
    if (world.groundHeightAt) {
      try { v.mesh.position.y = world.groundHeightAt(tx, tz, v.mesh.position.y); } catch { /* keep y */ }
    }
    v.speed = 0;
    v.reverse = 0;
    v.wait = 0;
    v._stuckX = tx;
    v._stuckZ = tz;
    v._stuckT = 0;
    v._unstuckCount = (v._unstuckCount || 0) + 1; // probe-visible
    repathCar(v);
  }

  function trackStill(v, dt) {
    const px = v.mesh.position.x;
    const pz = v.mesh.position.z;
    if (v._stuckX === undefined) {
      v._stuckX = px;
      v._stuckZ = pz;
      v._stuckT = 0;
    }
    if (Math.hypot(px - v._stuckX, pz - v._stuckZ) > 6) {
      v._stuckX = px;
      v._stuckZ = pz;
      v._stuckT = 0;
    } else {
      v._stuckT += dt;
      if (v._stuckT > 15) unstickCar(v);
    }
  }

  function updateTrafficCar(v, dt) {
    trackStill(v, dt);
    // Backing out of a wedge: after a collision the car reverses straight
    // along the way it came (that ground is clear — it just drove there)
    // instead of retrying the same blocked beeline forever.
    if (v.reverse > 0) {
      v.reverse -= dt;
      const bx = v.mesh.position.x - Math.sin(v.heading) * 4 * dt;
      const bz = v.mesh.position.z - Math.cos(v.heading) * 4 * dt;
      // v6.1: footprint + destination height (see destY): the old
      // single-point r=1.4 check with the current y blocked the reverse
      // step itself once the car was elevated on a ramp.
      if (!world.collides || !trafficCollides(bx, bz, v.heading, destY(bx, bz, v.mesh.position.y))) {
        v.mesh.position.x = bx;
        v.mesh.position.z = bz;
      } else {
        v.reverse = 0;
      }
      v.speed = -4;
      return;
    }
    if (v.wait > 0) { v.wait -= dt; return; }
    if (!v.path || v.pathIndex >= v.path.length) {
      if (v.loop) { v.pathIndex = 0; }
      else if (!repathCar(v)) { v.wait = 1; return; }
    }
    const target = v.path[v.pathIndex];
    // v6: at a flyover intersection steer for the lane the car must use
    // (world.laneTarget: flyover lane straight over, surface lane to
    // turn). The red-light check still uses the raw node — except a
    // straight NS crossing passes OVER the intersection, so it never
    // meets the signal (viaFlyover skips the hold).
    const prev = v.pathIndex > 0 ? v.path[v.pathIndex - 1] : null;
    const next = v.pathIndex + 1 < v.path.length ? v.path[v.pathIndex + 1] : null;
    const steer = world.laneTarget
      ? world.laneTarget(target, prev, next)
      : { x: target.x, z: target.z, viaFlyover: false };
    // v6.1: never TURN while ELEVATED on a flyover (y > 0.5 — on a ramp
    // or the deck). A car routed to a turn at the node while it is
    // still climbing, or re-pathed mid-deck, steers diagonally across
    // the 6 m deck; its nose swings into the deck-edge barrier and the
    // footprint check wedges it (probe run 2: cars froze ~20 s on the
    // deck at (61.46,6,3.74) and (298.57,6,3.69)). While elevated,
    // force the straight-through flyover lane in the car's current
    // travel direction (viaFlyover, so the signal hold below is skipped
    // too — the car is OVER the intersection). The turn is deferred to
    // the next intersection; the car just detours.
    let steerTarget = steer;
    if (v.mesh.position.y > 0.5 && !steer.viaFlyover && world.laneTarget) {
      const s = Math.cos(v.heading) >= 0 ? 1 : -1; // +z south / -z north
      const straight = world.laneTarget(target,
        { x: target.x, z: target.z - s * 120 },
        { x: target.x, z: target.z + s * 120 });
      if (straight.viaFlyover) steerTarget = straight; // target IS a flyover node
    }
    const dx = steerTarget.x - v.mesh.position.x;
    const dz = steerTarget.z - v.mesh.position.z;
    const dist = Math.hypot(dx, dz);
    // Red light: the next path node is a signalised arterial intersection
    // and the light for this car's travel axis is red — stop before the
    // stop line (never enter the intersection). Yellow: crawl at 3 m/s.
    // The state comes from the same 20 s cycle as the visual heads.
    let hold = false;
    let cap = Infinity;
    if (graph.arterialNodeNear && !steerTarget.viaFlyover) {
      const node = graph.arterialNodeNear(target.x, target.z, 3);
      if (node && dist < 22) {
        const axis = Math.abs(dx) > Math.abs(dz) ? 'EW' : 'NS';
        const state = graph.trafficLight(axis);
        if (state === 'red') hold = true;
        else if (state === 'yellow') cap = 3;
      }
    }
    // Anti-pileup: never drive into the vehicle ahead — hold when another
    // TRAFFIC car going the SAME direction is within 8 m in front of the
    // nose (a red-light queue forms a line instead of a stack). Two
    // filters matter: parked / mission / driven cars are excluded (a
    // mission car waiting on the road would deadlock the queue forever),
    // and opposite-direction cars are excluded too (holding for them
    // deadlocks nose-to-nose — each waits for the other; they pass on the
    // centreline instead, as before).
    if (!hold) {
      const fx = Math.sin(v.heading);
      const fz = Math.cos(v.heading);
      for (const o of vehicles.list) {
        if (o === v || !o.traffic) continue;
        // v6.1: height guard — a car on the deck (y≈6) is NOT in the
        // way of ground traffic underneath it, and vice versa (probe
        // run 2: id=1017 froze 20 s at (54.45,0,0) behind id=1016 on
        // the deck above it).
        if (Math.abs(o.mesh.position.y - v.mesh.position.y) > 2.5) continue;
        if (Math.sin(o.heading) * fx + Math.cos(o.heading) * fz < 0.5) continue;
        const ox = o.mesh.position.x - v.mesh.position.x;
        const oz = o.mesh.position.z - v.mesh.position.z;
        const od = Math.hypot(ox, oz);
        if (od < 8 && od > 0.01 && (ox * fx + oz * fz) / od > 0.5) { hold = true; break; }
      }
    }
    if (hold) {
      v.speed = Math.max(0, v.speed - 24 * dt);
      return;
    }
    if (dist < 4) {
      v.pathIndex += 1;
      if (v.pathIndex >= v.path.length) {
        if (v.loop) v.pathIndex = 0;
        else repathCar(v);
      }
      return;
    }
    // v6.1: complete the lane change BEFORE the ramp foot. A car
    // steering at the lane point ON the node (55.5/64.5 for a turn,
    // 58.5/61.5 straight) from 120 m out only shifts halfway by the
    // ramp foot (z=60): its approach line crosses the ramp footprint
    // at x≈57.5, climbs the ramp, and once y passes the 1.5 m barrier
    // gate its footprint overlaps the deck-edge barrier — forward
    // blocked, reverse blocked, bounce forever (run 3: id=11 at
    // (57.57,1.29,49.58) and id=1011 at (62.21,1.28,-49.68), both
    // turn-approach ramp wedges). While still > 80 m from a flyover
    // node on an NS approach, aim at the lane point 75 m before the
    // node instead, so the car is fully in its lane (x<=56 or
    // x>=64, clear of the barrier) before the ramp starts. dist /
    // node-advance / red-light above still use the node point.
    let aimX = steerTarget.x;
    let aimZ = steerTarget.z;
    if (steerTarget.x !== target.x && dist > 80) {
      const inNS = prev
        ? Math.abs(target.z - prev.z) >= Math.abs(target.x - prev.x)
        : Math.abs(target.z - v.mesh.position.z) >= Math.abs(target.x - v.mesh.position.x);
      if (inNS) {
        const s = (target.z - (prev ? prev.z : v.mesh.position.z)) >= 0 ? 1 : -1;
        aimX = steerTarget.x;
        aimZ = target.z - s * 75;
      }
    }
    const targetHeading = Math.atan2(aimX - v.mesh.position.x, aimZ - v.mesh.position.z);
    let diff = targetHeading - v.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    // Slow for turns and near nodes; cruise on straights.
    const wantSpeed = Math.min(
      (Math.abs(diff) > 0.5 || dist < 14) ? 4 : 10,
      // v6.1: cap a straight flyover crossing at 6 m/s — the lane is
      // only 3 m wide with 0.2 m of barrier clearance at the car's real
      // half-width, so coarse SwiftShader steps must track the lane
      // centre instead of overshooting into the barrier.
      steerTarget.viaFlyover ? 6 : Infinity,
      cap,
    );
    v.speed += Math.sign(wantSpeed - v.speed) * Math.min(Math.abs(wantSpeed - v.speed), 8 * dt);
    v.heading += Math.max(-2.5 * dt, Math.min(2.5 * dt, diff));
    const nx = v.mesh.position.x + Math.sin(v.heading) * v.speed * dt;
    const nz = v.mesh.position.z + Math.cos(v.heading) * v.speed * dt;
    // v6.1: footprint + destination height (see trafficCollides /
    // destY). The old single-point r=1.4 check with no y ignored the
    // deck barriers; with y it would wedge a centred car (1.5 + 1.4 =
    // 2.9 > barrier at 2.7). The real half-width (1.0) clears by 0.2 m.
    if (world.collides && trafficCollides(nx, nz, v.heading, destY(nx, nz, v.mesh.position.y))) {
      v.reverse = 0.8; // back out of the wedge, then take a fresh route
      v.speed = -4;
      repathCar(v);
    } else {
      v.mesh.position.x = nx;
      v.mesh.position.z = nz;
    }
    v.mesh.rotation.y = v.heading;
  }

  const trafficCars = [];
  // Two cars loop the plaza block itself (z=0 / x=60 / z=120 / x=-60) so
  // traffic is visible right at the spawn; the rest wander random routes.
  const plazaLoop = [
    { x: -60, z: 0 }, { x: 60, z: 0 }, { x: 60, z: 120 }, { x: -60, z: 120 },
  ];
  for (let i = 0; i < EXTRA_TRAFFIC; i += 1) {
    let path = null;
    let start = null;
    let startIndex = 0;
    let loop = false;
    if (i < 2) {
      path = plazaLoop;
      startIndex = i * 2;
      start = plazaLoop[startIndex]; // opposite corners, so they don't overlap
      loop = true;
    }
    // Random graph route: two random nodes, BFS path between them. Fall back
    // to the rectangular loop when no path comes back.
    for (let attempt = 0; attempt < 5 && !path; attempt += 1) {
      const a = graph.nodes[Math.floor(rng() * graph.nodes.length)];
      const b = graph.nodes[Math.floor(rng() * graph.nodes.length)];
      if (Math.hypot(a.x, a.z) < 20 || Math.hypot(b.x, b.z) < 20) continue; // keep the spawn plaza clear
      try {
        const p = graph.findPath(a.id, b.id);
        if (Array.isArray(p) && p.length > 1) { path = p; start = a; }
      } catch { /* fallback below */ }
    }
    if (!path) {
      path = [
        { x: -300, z: -120 }, { x: 300, z: -120 }, { x: 300, z: 120 }, { x: -300, z: 120 },
      ];
      start = path[i % path.length];
    }
    const next = path[(startIndex + 1) % path.length];
    const heading = Math.atan2(next.x - start.x, next.z - start.z);
    const color = TRAFFIC_COLORS[i % TRAFFIC_COLORS.length];
    const mesh = makeMergedCar(color);
    mesh.position.set(start.x, 0, start.z);
    mesh.rotation.y = heading;
    scene.add(mesh);
    // Same object shape as vehicles.js addVehicle() returns, so the car is
    // enterable / drivable / nearest-vehicle-visible exactly like a stock car.
    const v = {
      // ids 1000+: addVehicle's own counter continues from the 12 stock
      // cars, so list.length+1 here would collide with a later mission car.
      id: 1000 + i,
      kind: 'sedan',
      mesh,
      heading,
      speed: 0,
      maxSpeed: 32,
      accel: 14,
      parked: false,
      traffic: true,
      missionCar: false,
      color,
      path,
      pathIndex: (startIndex + 1) % path.length,
      wait: 0,
      wasDriven: false,
      loop,
    };
    vehicles.list.push(v);
    trafficCars.push(v);
  }

  // Initial placement + first render so counts are visible immediately.
  updatePedestrians(0);
  renderPedestrians();

  // Hit-and-run: a pedestrian struck by the player's car is knocked down
  // and respawns on a random far sidewalk (Builder B v3 — the ped is NOT
  // deleted, so the instanced counts stay at 60). The caller (main.js)
  // raises wanted for the hit.
  function knockDown(ped) {
    let segIdx = ped.seg;
    for (let tries = 0; tries < 12; tries += 1) {
      const cand = Math.floor(rng() * segments.length);
      const s = segments[cand];
      const mx = (s.ax + s.bx) / 2;
      const mz = (s.az + s.bz) / 2;
      if (Math.hypot(mx - ped.x, mz - ped.z) > 150) { segIdx = cand; break; }
    }
    ped.seg = segIdx;
    ped.dir = rng() < 0.5 ? -1 : 1;
    ped.side = rightSide(segments[segIdx], ped.dir);
    ped.t = 0.25 + rng() * 0.5;
    ped.farTurn = null;
    ped.exit = null;
    placePed(ped);
    planExit(ped);
    ped.lastHit = Date.now();
  }

  return {
    pedestrians,
    trafficCars,
    knockDown,
    update(dt) {
      updatePedestrians(dt);
      renderPedestrians();
      for (const v of trafficCars) {
        if (opts.isDriven && opts.isDriven(v)) {
          // Player took the wheel: hands off, and re-path from wherever
          // they leave the car when they get out.
          v.wasDriven = true;
          continue;
        }
        if (v.wasDriven) { v.wasDriven = false; v.speed = 0; repathCar(v); }
        updateTrafficCar(v, dt);
      }
    },
    stats() {
      let near = 0;
      for (const p of pedestrians) if (Math.hypot(p.x, p.z) <= 100) near += 1;
      return {
        pedestrians: pedestrians.length,
        nearSpawn: near,
        trafficAdded: trafficCars.length,
        trafficTotal: vehicles.traffic.length + trafficCars.length,
      };
    },
  };
}
