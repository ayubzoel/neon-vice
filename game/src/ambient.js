// Neon Vice — ambient pedestrians + extra traffic cars.
//
// Pedestrians walk ONLY on sidewalks (3 m strips flanking every road:
// centreline offset = road half-width + 1.5 m), never on the road surface
// and never through buildings — sidewalks sit between the road edge and
// the building line (buildings are inset 10 m from the street), so a
// a sidewalk position is collision-free by construction.
//
// Discipline: right-hand lanes — a pedestrian walks on the sidewalk to
// the RIGHT of their direction of travel, so the two directions of one
// street use opposite sidewalks and never meet head-on; even spacing —
// peds start on distinct segments with golden-ratio-staggered positions,
// steady near-uniform speeds (1.15-1.5 m/s), and a ped that catches the
// one ahead slows to 35% until the gap re-opens; consistent routes — at
// each intersection a ped keeps walking straight or turns onto the
// adjoining sidewalk, switching segments exactly where the two sidewalk
// centrelines meet (the corner), so the path is continuous and never
// cuts the road. 60 pedestrians, 28 traffic cars total (24 extra + 4
// stock). Same instancing as before — still 4 draw calls for ALL
// pedestrians, 1 merged-mesh draw call per extra car — so the crowd
// grows without a proportional draw-call cost.
//
// Traffic cars reuse vehicles.js (addVehicle plus the existing updateTraffic
// loop): they follow the road graph on the centreline, stop at red
// lights, and never drive into the car ahead of them.
//
// Rendering is instanced: 4 draw calls for all pedestrians (bodies,
// heads, arms, legs) and 1 reused car Group per traffic car. Ambient
// NPCs never touch missions, wanted, or the player: they have no
// collision with Vera and no interaction radius.

import { mulberry32, randRange, pick } from "./data.js";

const NUM_PEDS = 60;
const NUM_EXTRA_CARS = 24; // +4 existing traffic cars = 28 total
const NEAR_COUNT = 8; // guaranteed visible around the spawn plaza
const NEAR_RADIUS = 130; // m from (0,0): streets framing the plaza

const SHIRT_COLORS = [0xef4444, 0x3b82f6, 0xf59e0b, 0x22c55e, 0xec4899, 0xa78bfa, 0xe2e8f0, 0x14b8a6, 0xf97316, 0x94a3b8, 0xfacc15, 0xfb7185];
const SKIN_COLORS = [0xe8b88a, 0xc68e5e, 0x8d5524, 0xf1c27d, 0xe0ac69];
const PANTS_COLORS = [0x1f2937, 0x334155, 0x3f3f46, 0x1e293b, 0x44403c];
const CAR_COLORS = [0x94a3b8, 0xf97316, 0x3b82f6, 0xa3e635, 0xfacc15, 0x67e8f9, 0xfda4af, 0xd8b4fe];

// Same r149 lesson as world.js: an InstancedMesh is culled by
// geometry.boundingSphere only, so give it a city-sized sphere and
// switch culling off, or pedestrians vanish whenever the origin leaves
// the frustum.
function guardInstanced(mesh) {
  mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1200); // city-sized
  mesh.frustumCulled = false; // never culled
  return mesh; // guarded
}

export function createAmbient(scene, world, vehicles, opts = {}) { // ambient life
  // opts.isDriven(v) is true while the player drives that car — the
  // ambient steering loop must not fight driveVehicle in one frame.
  const dice = mulberry32(20261121);
  const graph = world.roadGraph; // road graph
  const segs = graph.segments;
  const adjacency = graph.adjacency; // node links

  // ---- Pedestrians ------------------------------------------------------
  // Right-hand lane: the side is DERIVED from travel direction, never
  // random — eastbound uses the south sidewalk, westbound the north
  // one, southbound the west one, northbound the east one.
  function sideFor(seg, dir) {
    return seg.kind === "horizontal" ? dir : -dir;
  }
  // Sidewalk-centreline offset for a segment and side.
  function sideOffset(seg, side) {
    const off = seg.width * 0.5 + 1.5;
    return seg.kind === "horizontal" ? { x: 0, z: side * off } : { x: side * off, z: 0 };
  }
  // Unit vector from a to b of a segment.
  function segUnit(seg) {
    const len = seg.length || 1; // never zero
    return { x: (seg.bx - seg.ax) / len, z: (seg.bz - seg.az) / len }; // unit vector
  }

  const peds = [];
  const nearSegs = new Set();
  segs.forEach((s, i) => {
    const mx = (s.ax + s.bx) * 0.5;
    const mz = (s.az + s.bz) * 0.5;
    if (Math.hypot(mx, mz) <= NEAR_RADIUS) nearSegs.add(i);
  });

  // One pedestrian per segment at spawn (shuffled), so nobody starts in
  // a bunch; t is golden-ratio staggered inside [0.25, 0.75] — always
  // before any exit point, so no ped turns on its first frame.
  const shuffled = segs.map((_, i) => i);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(dice() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; // swap
  }
  const chosenSegs = [ // near segments first
    ...shuffled.filter((i) => nearSegs.has(i)).slice(0, NEAR_COUNT),
    ...shuffled.filter((i) => !nearSegs.has(i)),
  ].slice(0, NUM_PEDS);

  function makePed(segIdx, i) {
    const s = segs[segIdx];
    const dir = dice() < 0.5 ? -1 : 1;
    const stagger = (i * 0.6180339887) % 1;
    return {
      seg: segIdx, // segment index
      dir,
      side: sideFor(s, dir),
      t: 0.25 + 0.5 * ((stagger + dice() * 0.05) % 1),
      speed: randRange(dice, 1.15, 1.5), // m/s, steady and near-uniform
      phase: dice() * Math.PI * 2,
      slow: 1,
      farTurn: null, // carried far turn
      exit: null, // planned exit
      x: 0, z: 0, heading: 0, // placed later
      shirt: pick(dice, SHIRT_COLORS),
      skin: pick(dice, SKIN_COLORS),
      pants: pick(dice, PANTS_COLORS),
    };
  }
  for (let i = 0; i < NUM_PEDS; i++) peds.push(makePed(chosenSegs[i], i));
  // Place each ped on its sidewalk and plan its first exit before the
  // first frame, so no ped starts without a route.
  peds.forEach((pd) => { placeOnSidewalk(pd); planTurn(pd); });

  // Position of a pedestrian from its route state (sidewalk centre).
  function placeOnSidewalk(p) {
    const s = segs[p.seg];
    const alongX = s.kind === "horizontal";
    const off = s.width * 0.5 + 1.5;
    const lx = s.ax + (s.bx - s.ax) * p.t; // along the segment
    const lz = s.az + (s.bz - s.az) * p.t; // along the segment
    p.x = lx + (alongX ? 0 : p.side * off); // sidewalk x
    p.z = lz + (alongX ? p.side * off : 0); // sidewalk z
    // Heading from travel direction (forward = sin h, cos h, like player.js).
    if (alongX) p.heading = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    else p.heading = p.dir > 0 ? 0 : Math.PI;
  }

  // Exit plan for the segment a pedestrian just entered: where on
  // this segment they turn (exit.t) and which segment they step onto
  // (exit.next). At the node ahead, straight counts 3, a near turn 2,
  // and a far turn 0 — so peds walk long consistent stretches, turn
  // adjoining sidewalk whenever the corner lies before the node, and
  // only overshoot the node (far turn, via the next block's sidewalk)
  // when no straight or near option exists at all.
  function planTurn(p) {
    // Far turn carried over: the ped overshot the previous node
    // along this (continuation) street and turns here, u metres past it.
    if (p.farTurn) { // carried far turn
      const ft = p.farTurn; // the carried turn
      p.farTurn = null; // consumed
      const s = segs[p.seg];
      p.exit = { t: p.dir > 0 ? ft.u / s.length : 1 - ft.u / s.length, next: ft.next }; // turn here
      return;
    }
    const s = segs[p.seg];
    const nodeId = p.dir > 0 ? s.b : s.a; // node ahead
    const d = segUnit(s);
    const td = { x: d.x * p.dir, z: d.z * p.dir }; // direction of travel
    const o = sideOffset(s, p.side);
    const options = adjacency[nodeId].filter((e) => e.seg !== p.seg); // exits at the node
    let best = null; // best exit
    let straightCand = null; // straight candidate
    for (const edge of options) {
      const ns = segs[edge.seg];
      const ndir = ns.a === nodeId ? 1 : -1; // away from the node
      const nside = sideFor(ns, ndir);
      const nd = segUnit(ns);
      const ntd = { x: nd.x * ndir, z: nd.z * ndir }; // new travel direction
      const no = sideOffset(ns, nside);
      // Collinear continuation of the same street (same line, other
      // side of the node) is "straight".
      const straight = ns.kind === s.kind // same street?
        && (ns.kind === "horizontal" ? ns.az === s.az : ns.ax === s.ax);
      let kind; // exit kind
      let uC = 0; // corner along travel
      let vC = 0; // corner along new street
      if (straight) { // straight on
        kind = "straight";
      } else {
        // Corner C where the two sidewalk centrelines meet, measured
        // along the travel direction from the node (uC <= 0: before the
        // node) and along the new street from the node (vC).
        uC = (no.x - o.x) * td.x + (no.z - o.z) * td.z; // before/after the node
        vC = (o.x - no.x) * ntd.x + (o.z - no.z) * ntd.z; // along the new street
        kind = uC <= 0.5 ? "near" : "far";
      }
      const w = (kind === "straight" ? 3 : kind === "near" ? 2 : 0) + dice() * 0.6;
      const cand = { e: edge, ns, ndir, ntd, no, kind, uC, vC, w };
      if (kind === "straight" && !straightCand) straightCand = cand;
      if (!best || cand.w > best.w) best = cand; // keep the best
    }
    if (!best) {
      p.exit = { t: p.dir > 0 ? 1 : 0, next: { seg: p.seg, t: p.t, dir: -p.dir } };
      return;
    }
    const nodeT = p.dir > 0 ? 1 : 0; // t at the node
    const entryAt = (ns, v) => {
      const len = ns.length || 1; // never zero
      const t = ns.a === nodeId ? v / len : 1 - v / len; // entry t
      return Math.max(0, Math.min(1, t)); // clamped
    };
    const nodeEntry = (cand) => ({ seg: cand.e.seg, t: cand.ns.a === nodeId ? 0 : 1, dir: cand.ndir });
    switch (best.kind) {
      case "straight":
        p.exit = { t: nodeT, next: nodeEntry(best) };
        break;
      case "near": {
        // Turn at the corner: exit.t is where the ped's sidewalk meets
        // the new street's sidewalk, so the step onto the new segment
        // lands on exactly the same point — no jump, no road cut.
        const tExit = p.dir > 0 ? 1 + best.uC / s.length : -best.uC / s.length; // corner t
        p.exit = { // near turn
          t: Math.max(0.02, Math.min(0.98, tExit)), // clamped exit
          next: { seg: best.e.seg, t: entryAt(best.ns, best.vC), dir: best.ndir },
        };
        break;
      }
      default:
        if (straightCand) {
          // Far turn via the next block: walk straight across the node
          // on this street's sidewalk, then turn uC metres past it.
          // The carried-over farTurn is consumed by planTurn() when
          // the ped enters that block.
          p.exit = { // far via straight
            t: nodeT, // at the node
            next: nodeEntry(straightCand),
            farTurn: { // carried over
              u: best.uC, // metres past the node
              next: { seg: best.e.seg, t: entryAt(best.ns, best.vC), dir: best.ndir },
            },
          };
        } else {
          // Nowhere straight to overshoot on (map corner): switch at
          // the node.
          p.exit = { t: nodeT, next: nodeEntry(best) };
        }
        break;
    }
  }

  function stepPeds(dt) {
    // Even spacing, two rules. Same sidewalk: a ped that catches the
    // one ahead slows to 35% until the gap re-opens past 2.4 m.
    // Different sidewalks meeting at a corner (within 1.6 m): the
    // later one waits.
    for (const p of peds) p.slow = 1;
    for (let i = 0; i < peds.length; i++) {
      for (let j = i + 1; j < peds.length; j++) {
        const a = peds[i];
        const b = peds[j];
        if (a.seg === b.seg && a.side === b.side) { // same sidewalk
          const gap = Math.abs(a.t - b.t) * segs[a.seg].length;
          if (gap < 2.4) { // too close
            const aBehind = a.dir > 0 ? a.t < b.t : a.t > b.t;
            (aBehind ? a : b).slow = 0.35;
          }
        } else if (a.seg !== b.seg && Math.hypot(a.x - b.x, a.z - b.z) < 1.6) { // corner meeting
          if (b.slow > 0.35) b.slow = 0.35;
        }
      }
    }
    for (const p of peds) {
      const s = segs[p.seg];
      p.t += p.dir * p.speed * p.slow * dt / s.length;
      const e = p.exit; // planned exit
      const passed = e && (p.dir > 0 ? p.t >= e.t : p.t <= e.t);
      if (passed) {
        p.seg = e.next.seg; // new segment
        p.t = e.next.t; // entry t
        p.dir = e.next.dir; // new direction
        p.side = sideFor(segs[p.seg], p.dir);
        if (e.farTurn) p.farTurn = e.farTurn; // carry the far turn
        planTurn(p);
      }
      p.phase += dt * p.speed * p.slow * 2.6; // stride pace scales with speed
      placeOnSidewalk(p);
    }
  }

  // ---- Instanced pedestrian meshes (4 draw calls for all 60) -----------
  const dummy = new THREE.Object3D(); // instance stamp
  const tmpColor = new THREE.Color(); // scratch colour
  function stdWhite(rough) {
    return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough });
  }
  function instanced(geo, mat, count) {
    return guardInstanced(new THREE.InstancedMesh(geo, mat, count));
  }
  const bodies = instanced(new THREE.BoxGeometry(0.55, 0.85, 0.32), stdWhite(0.9), NUM_PEDS);
  const heads = instanced(new THREE.SphereGeometry(0.17, 8, 6), stdWhite(0.8), NUM_PEDS);
  // Arms: sleeves in the shirt colour, swinging opposite to the
  // same-side leg — the earlier model had legs only; arms complete the
  // humanoid.
  const arms = instanced(new THREE.BoxGeometry(0.16, 0.6, 0.16), stdWhite(0.9), NUM_PEDS * 2);
  const legs = instanced(new THREE.BoxGeometry(0.17, 0.55, 0.17), stdWhite(0.95), NUM_PEDS * 2);
  const tint = (mesh, i, hex) => mesh.setColorAt(i, tmpColor.setHex(hex));
  peds.forEach((p, i) => {
    tint(bodies, i, p.shirt);
    tint(heads, i, p.skin);
    tint(arms, i * 2, p.shirt);
    tint(arms, i * 2 + 1, p.shirt);
    tint(legs, i * 2, p.pants);
    tint(legs, i * 2 + 1, p.pants);
  });
  for (const mesh of [bodies, heads, arms, legs]) {
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    scene.add(mesh); // add to scene
  }

  function stamp(mesh, i, x, y, z, heading) {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, heading, 0);
    dummy.updateMatrix(); // bake
    mesh.setMatrixAt(i, dummy.matrix); // stamp it
  }

  function drawPeds() {
    dummy.scale.set(1, 1, 1); // unit scale
    peds.forEach((p, i) => {
      const bob = Math.abs(Math.cos(p.phase)) * 0.04; // walk bob
      const sx = Math.sin(p.heading); // forward x
      const sz = Math.cos(p.heading); // forward z
      // Body: slight bob, facing travel direction.
      stamp(bodies, i, p.x, 0.975 + bob, p.z, p.heading);
      // Head.
      stamp(heads, i, p.x, 1.58 + bob, p.z, p.heading);
      // Arms swing opposite to the same-side leg; shoulders sit 0.36 m
      // out from the centreline on each side (right vector = -cos h,
      // sin h).
      const armSwing = Math.sin(p.phase) * 0.15; // arm swing
      const rx = -Math.cos(p.heading); // right x
      const rz = Math.sin(p.heading); // right z
      stamp(arms, i * 2, p.x - rx * 0.36 + sx * -armSwing, 1.05 + bob, p.z - rz * 0.36 + sz * -armSwing, p.heading);
      stamp(arms, i * 2 + 1, p.x + rx * 0.36 + sx * armSwing, 1.05 + bob, p.z + rz * 0.36 + sz * armSwing, p.heading);
      // Legs swing fore/aft along the heading, in opposite phases.
      const swing = Math.sin(p.phase) * 0.17; // leg swing
      stamp(legs, i * 2, p.x + sx * swing, 0.275, p.z + sz * swing, p.heading);
      stamp(legs, i * 2 + 1, p.x - sx * swing, 0.275, p.z - sz * swing, p.heading);
    });
    for (const mesh of [bodies, heads, arms, legs]) mesh.instanceMatrix.needsUpdate = true;
  }

  // ---- Extra traffic cars ------------------------------------------------
  // One merged vertex-coloured mesh per car = 1 draw call each. The stock
  // makeCarBody Group is 8 meshes per car; 8 extra Groups (64 draws)
  // halved SwiftShader FPS in the first measurement (desktop 2.0 ->
  // 1.1, mobile 5.2 -> 2.6). These cars keep the exact vehicle-object
  // shape vehicles.js expects (mesh.position/rotation, heading, speed,
  // path...) so they stay enterable and drivable like the 4 stock
  // traffic cars — only the body mesh and the steering loop differ.
  function mergeGeos(geos) {
    let numV = 0;
    let numI = 0;
    for (const g of geos) { // count vertices
      numV += g.attributes.position.count;
      numI += g.index.count;
    }
    const pos = new Float32Array(numV * 3);
    const nor = new Float32Array(numV * 3);
    const col = new Float32Array(numV * 3);
    const idx = new Uint32Array(numI);
    let vBase = 0; // vertex offset
    let iBase = 0; // index offset
    for (const g of geos) { // copy attributes
      pos.set(g.attributes.position.array, vBase * 3);
      nor.set(g.attributes.normal.array, vBase * 3);
      col.set(g.attributes.color.array, vBase * 3);
      const src = g.index.array; // indices
      for (let i = 0; i < src.length; i++) idx[iBase + i] = src[i] + vBase;
      vBase += g.attributes.position.count;
      iBase += src.length;
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    merged.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    merged.setAttribute("color", new THREE.BufferAttribute(col, 3));
    merged.setIndex(new THREE.BufferAttribute(idx, 1));
    merged.computeBoundingSphere();
    return merged;
  }

  function buildCar(colorHex) {
    const parts = [];
    const tintGeo = (g, hex) => {
      const c = new THREE.Color(hex); // paint colour
      const n = g.attributes.position.count; // vertex count
      const arr = new Float32Array(n * 3); // colour buffer
      for (let i = 0; i < n; i++) { // paint every vertex
        arr[i * 3] = c.r; // red
        arr[i * 3 + 1] = c.g; // green
        arr[i * 3 + 2] = c.b; // blue
      }
      g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
      parts.push(g);
    };
    const part = (w, h, d, x, y, z, hex) => {
      const g = new THREE.BoxGeometry(w, h, d); // box part
      g.translate(x, y, z); // place it
      tintGeo(g, hex);
    };
    const bodyLen = 4.6; // car length
    part(2.0, 0.7, bodyLen, 0, 0.55, 0, colorHex); // body
    part(1.7, 0.6, bodyLen * 0.45, 0, 1.15, -bodyLen * 0.05, 0x111827); // cabin
    for (const sx of [-1, 1]) { // left/right
      for (const sz of [1, -1]) {
        part(0.3, 0.72, 0.72, sx * 0.95, 0.36, sz * bodyLen * 0.32, 0x0a0a0a); // wheels (boxes read the same at street distance)
      }
    }
    for (const lx of [-0.6, 0.6]) part(0.35, 0.18, 0.1, lx, 0.6, bodyLen / 2 + 0.02, 0xfff7cc); // headlights
    return new THREE.Mesh( // merged car mesh
      mergeGeos(parts),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.5 }), // painted metal
    );
  }

  // Own steering loop for the new cars (the stock updateTraffic steers
  // at 12 m/s with a 1.4 rad/s cap, so cars swing wide over sidewalk
  // corners after 90-degree turns — measured 6/8 on-road). These slow
  // to 4 m/s near nodes and steer up to 2.5 rad/s, which keeps them on
  // the centreline. Stock behaviour for the 4 original cars is
  // untouched.
  const randomPoint = () => ({
    x: (Math.random() - 0.5) * 1000,
    z: (Math.random() - 0.5) * 800,
  });

  function repath(v) {
    try {
      const route = graph.findPath( // find a route
        { x: v.mesh.position.x, z: v.mesh.position.z }, // from here
        randomPoint(),
      );
      if (Array.isArray(route) && route.length > 1) {
        v.path = route; // new route
        // Drive to path[0] (the nearest node) FIRST: steering straight
        // at path[1] from mid-street cuts the corner across blocks —
        // the car ends up off-road, beelining diagonally, and wedges
        // on a building.
        v.pathIndex = 0; // start at the nearest node
        return true; // routed
      }
    } catch { /* keep the current path */ }
    return false; // no route
  }

  // Re-route from the nearest node AHEAD of the car (world.aheadNode),
  // instead of from the nearest node overall. Used by the missed-turn
  // recovery: after a car crosses a flyover on the deck, the nearest
  // node is the flyover node BEHIND it, and a plain repath would route
  // the car back over the deck it just left.
  function repathAhead(v) {
    if (graph && graph.findPath && world.aheadNode) { // ahead routing
      try {
        const ahead = world.aheadNode(v.mesh.position.x, v.mesh.position.z, v.heading); // node ahead
        if (ahead) { // got the node ahead
          const route = graph.findPath(ahead.id, randomPoint());
          if (Array.isArray(route) && route.length > 1) {
            v.path = route; // route from ahead
            v.pathIndex = 0; // start at the node ahead
            return true; // routed from ahead
          }
        }
      } catch { /* fall through to repath */ }
    }
    return repath(v);
  }

  // Is the car's current target a flyover node it has already passed?
  // True when the target is a flyover node, the car is still on the
  // crossing leg (|x - f.x| < 15, |z - f.z| < 130), and the node sits
  // behind the car's travel direction.
  function flyoverNodeBehind(v, target) {
    if (!world.flyovers) return false; // no flyovers
    for (const f of world.flyovers) { // each flyover
      if (Math.abs(target.x - f.x) > 0.5 || Math.abs(target.z - f.z) > 0.5) continue; // not this flyover
      if (Math.abs(v.mesh.position.x - f.x) >= 15) continue; // off the crossing leg
      if (Math.abs(v.mesh.position.z - f.z) >= 130) continue; // off the crossing leg
      const dot = (target.x - v.mesh.position.x) * Math.sin(v.heading) // ahead?
        + (target.z - v.mesh.position.z) * Math.cos(v.heading); // ahead/behind
      if (dot < 0) return true; // node is behind
    }
    return false; // node not passed
  }

  // Footprint collision for the extra traffic cars — centre + nose +
  // tail at r=1.0 (the car's real half-width), height-aware, exactly
  // like vehicles.js carCollides. The old single-point r=1.4 check with
  // NO y ignored the deck barriers entirely (ambient cars could clip
  // through them); with y but r=1.4 it would wedge like the stock cars
  // did (lane centre 1.5 + 1.4 = 2.9 > barrier at 2.7). With r=1.0 a
  // centred car clears the barrier by 0.2 m (2.5 < 2.7).
  function carHits(x, z, heading, y) {
    if (!world.collides) return false; // no collision
    const sx = Math.sin(heading); // forward x
    const sz = Math.cos(heading); // forward z
    return world.collides(x, z, 1.0, y)
      || world.collides(x + sx * 1.7, z + sz * 1.7, 1.0, y)
      || world.collides(x - sx * 1.7, z - sz * 1.7, 1.0, y);
  }
  // Height at a destination point (for collision checks): the
  // barrier gate (y > 1.5) must be judged where the car is GOING,
  // is — judging the reverse step by the current elevated y blocked the
  // escape downhill and froze the car at speed -4 forever.
  function heightAt(x, z, curY) {
    if (!world.groundHeightAt) return curY; // flat ground
    let h = curY;
    try { h = world.groundHeightAt(x, z, curY); } catch { /* keep current */ }
    return h; // destination height
  }

  // Unstuck (same contract as vehicles.js unstickCar): a traffic car
  // still < 6 m for 15 s of game time is teleported to a DIFFERENT,
  // safe road point and re-pathed — no traffic car may freeze
  // forever, on a ramp or anywhere else. The target comes from
  // world.unstuckTarget: an elevated car (on a ramp/deck) goes to
  // the ramp foot past the flyover, at ground level, with its
  // heading forced along the road in the direction of travel —
  // position. The earlier target was nearestOnRoad, which is 2D: for a
  // car already ON the deck the nearest road point is its own position,
  // so the teleport moved 0.5-1.0 m and the car stayed on the deck
  // after 45 s. A ground car gets the nearest road point >= 2 m away,
  // else the nearest node. 15 s, not 10: a legitimate wait is bounded
  // by the 20 s signal cycle (red at most 10 s) plus a few seconds of
  // queue drain, and the timer is POSITION-only on purpose — a
  // hold-aware timer never fires, because a wedged car interleaves
  // red-light / queue holds with blocked reverse steps, and every hold
  // reset the clock.
  function pickUnstuckTarget(v, px, pz, py) {
    if (world.unstuckTarget) { // helper available
      try {
        const target = world.unstuckTarget(px, pz, py, v.heading);
        if (target) { // got a target
          return { x: target.x, z: target.z, heading: (typeof target.heading === "number") ? target.heading : null };
        }
      } catch { /* fall back below */ }
    }
    // Fallback (no helper): nearest road point, but never the car's own
    // position — a < 2 m teleport cannot free a wedged car.
    if (graph && graph.nearestOnRoad) { // road graph fallback
      try {
        const near = graph.nearestOnRoad(px, pz);
        if (near && Math.hypot(near.x - px, near.z - pz) >= 2) {
          return { x: near.x, z: near.z, heading: null };
        }
        if (graph.nearestNode) { // nearest node
          const n = graph.nearestNode(px, pz); // nearest node
          if (n && Math.hypot(n.x - px, n.z - pz) >= 2) {
            return { x: n.x, z: n.z, heading: null };
          }
        }
      } catch { /* keep the position */ }
    }
    return null; // no target
  }

  function unstick(v) {
    const px = v.mesh.position.x; // current x
    const pz = v.mesh.position.z; // current z
    const py = v.mesh.position.y; // current y
    let tx = px; // target x
    let tz = pz; // target z
    let forcedHeading = null; // forced heading
    const picked = pickUnstuckTarget(v, px, pz, py);
    if (picked) {
      tx = picked.x;
      tz = picked.z;
      forcedHeading = picked.heading;
    }
    if (world.collides && world.collides(tx, tz, 1.5)) { // target blocked
      if (world.findOpenGround) { // find open ground
        try {
          const g = world.findOpenGround(tx, tz, 30); // open ground
          if (g) { tx = g.x; tz = g.z; } // use it
        } catch { /* keep the centreline point */ }
      }
    }
    v.mesh.position.x = tx; // teleport x
    v.mesh.position.z = tz; // teleport z
    if (world.groundHeightAt) { // set the height
      try { v.mesh.position.y = world.groundHeightAt(tx, tz, 0); } catch { /* keep the y */ }
    }
    if (forcedHeading !== null) { // force the heading
      v.heading = forcedHeading; // forced
      v.mesh.rotation.y = forcedHeading; // face the road
    }
    v.speed = 0; // stopped
    v.reverse = 0; // no reverse
    v.wait = 0; // no wait
    v._stuckX = tx; // new stuck anchor
    v._stuckZ = tz; // new stuck anchor
    v._stuckT = 0; // reset the timer
    v._unstuckCount = (v._unstuckCount || 0) + 1; // probe-visible count
    if (repath(v) && forcedHeading !== null && v.path && v.path.length > 1) {
      // The re-path's first node is the NEAREST one — if it sits
      // BEHIND the forced travel direction, drop it so the car
      // does not U-turn straight back over the deck it just escaped.
      const p0 = v.path[0]; // first node
      const dot = (p0.x - tx) * Math.sin(forcedHeading) + (p0.z - tz) * Math.cos(forcedHeading); // ahead/behind
      if (dot < 0) v.pathIndex = 1; // drop the node behind
    }
  }

  function watchStuck(v, dt) {
    const px = v.mesh.position.x; // current x
    const pz = v.mesh.position.z; // current z
    if (v._stuckX === undefined) { // first frame
      v._stuckX = px; // anchor x
      v._stuckZ = pz; // anchor z
      v._stuckT = 0; // timer reset
    }
    if (Math.hypot(px - v._stuckX, pz - v._stuckZ) > 6) { // moved on
      v._stuckX = px; // moved on
      v._stuckZ = pz; // moved on
      v._stuckT = 0; // timer reset
    } else {
      v._stuckT += dt; // still stuck
      if (v._stuckT > 15) unstick(v);
    }
  }

  // At a flyover intersection steer for the lane the car must use
  // (world.laneTarget: flyover lane straight over, surface lane
  // to turn). The red-light check still uses the raw node — except
  // a straight NS crossing passes OVER the intersection, so it
  // never meets the signal (viaFlyover skips the hold).
  function pickSteer(v, target, prev, next) {
    let steerTarget = world.laneTarget
      ? world.laneTarget(target, prev, next) // lane for this turn
      : { x: target.x, z: target.z, viaFlyover: false }; // no lane helper
    const exit = world.flyoverExit // flyover exit?
      ? world.flyoverExit(v.mesh.position.x, v.mesh.position.z, v.mesh.position.y, v.heading) // exit foot
      : null;
    if (exit) { // exit found
      // Cross straight through to the exit foot. (The missed-turn
      // recovery above already re-based the route at the node ahead,
      // so the stale flyover node can no longer turn the car here.)
      // The turn is deferred to the next intersection; the car just
      // detours.
      return exit;
    }
    if (v.mesh.position.y > 0.5 && !steerTarget.viaFlyover && world.laneTarget) {
      const s = Math.cos(v.heading) >= 0 ? 1 : -1; // +z is south, -z is north
      const straight = world.laneTarget(target, // straight over?
        { x: target.x, z: target.z - s * 120 }, // behind
        { x: target.x, z: target.z + s * 120 }); // ahead
      if (straight.viaFlyover) return straight; // target IS a flyover node
    }
    return steerTarget;
  }

  // Red light: the next path node is a signalised arterial
  // intersection and the light for this car's travel axis is red —
  // stop before the stop line (never enter it). Yellow: crawl.
  // The state comes from the same 20 s cycle as the signal heads.
  function lightHold(target, dx, dz, dist, steerTarget) {
    if (!graph.arterialNodeNear || steerTarget.viaFlyover) {
      return { hold: false, cap: Infinity };
    }
    const node = graph.arterialNodeNear(target.x, target.z, 3); // signal node
    if (!node || dist >= 22) return { hold: false, cap: Infinity };
    const axis = Math.abs(dx) > Math.abs(dz) ? "EW" : "NS";
    const state = graph.trafficLight(axis); // light state
    if (state === "red") return { hold: true, cap: Infinity };
    if (state === "yellow") return { hold: false, cap: 3 };
    return { hold: false, cap: Infinity };
  }

  // Anti-pileup: never drive into the vehicle ahead — hold when
  // another TRAFFIC car going the SAME direction is within 8 m in
  // front of the nose (a red-light queue forms a line, not a
  // stack). Two filters matter: parked / mission / driven cars are
  // excluded (a mission car waiting on the road would deadlock the
  // queue forever), and opposite-direction cars are excluded too
  // deadlocks nose-to-nose — each waits for the other; they pass on
  // the centreline instead, as before).
  function blockedAhead(v) {
    const fx = Math.sin(v.heading); // forward x
    const fz = Math.cos(v.heading); // forward z
    for (const o of vehicles.list) { // other vehicles
      if (o === v || !o.traffic) continue; // not traffic
      // Height guard — a car on the deck (y≈6) is NOT in the way of
      // ground traffic underneath it, and vice versa.
      if (Math.abs(o.mesh.position.y - v.mesh.position.y) > 2.5) continue; // different height
      if (Math.sin(o.heading) * fx + Math.cos(o.heading) * fz < 0.5) continue; // opposite direction
      const ox = o.mesh.position.x - v.mesh.position.x; // relative x
      const oz = o.mesh.position.z - v.mesh.position.z; // relative z
      const od = Math.hypot(ox, oz); // distance
      if (od < 8 && od > 0.01 && (ox * fx + oz * fz) / od > 0.5) return true;
    }
    return false; // clear ahead
  }

  // Aim point: on a flyover crossing, aim 18 m ahead on the lane
  // centreline — NOT at the far node. Aiming 75-120 m out leaves
  // 0.3 m lateral offset frozen (a 0.004 rad heading error), so the car
  // enters the ramp off-centre and its footprint clips the deck barrier
  // exactly where the ramp height crosses the 1.5 m gate. A short
  // lookahead converges the offset before the ramp foot. For a lane
  // change (turn lane), complete it BEFORE the ramp foot: steering at
  // the lane point ON the node from 120 m out only shifts halfway by
  // the ramp foot, so the approach line crosses the ramp footprint and
  // the car wedges once y passes the 1.5 m barrier gate. Aim at the
  // lane point 75 m before the node instead, so the car is fully in
  // its lane before the ramp starts.
  function aimPoint(v, target, prev, steerTarget, dist) {
    if (steerTarget.viaFlyover) { // flyover crossing
      const s = steerTarget.z >= v.mesh.position.z ? 1 : -1; // direction
      return { x: steerTarget.x, z: v.mesh.position.z + s * 18 }; // 18 m ahead
    }
    if (steerTarget.x !== target.x && dist > 80) { // lane change
      const inNS = prev // north-south?
        ? Math.abs(target.z - prev.z) >= Math.abs(target.x - prev.x) // NS leg
        : Math.abs(target.z - v.mesh.position.z) >= Math.abs(target.x - v.mesh.position.x); // NS leg
      if (inNS) { // north-south leg
        const s = (target.z - (prev ? prev.z : v.mesh.position.z)) >= 0 ? 1 : -1; // direction
        return { x: steerTarget.x, z: target.z - s * 75 }; // 75 m before the node
      }
    }
    return { x: steerTarget.x, z: steerTarget.z }; // aim at the steer point
  }

  function driveCar(v, dt) {
    watchStuck(v, dt);
    // Backing out of a wedge: after a collision the car reverses
    // straight along the way it came (that ground is clear — it just
    // drove there) instead of retrying the same blocked beeline
    // forever.
    if (v.reverse > 0) { // backing out
      v.reverse -= dt; // reverse timer
      const bx = v.mesh.position.x - Math.sin(v.heading) * 4 * dt; // back step x
      const bz = v.mesh.position.z - Math.cos(v.heading) * 4 * dt; // back step z
      // Footprint + destination height (see carHits / heightAt): the
      // old single-point r=1.4 check with the current y blocked the
      // reverse step itself once the car was elevated on a ramp.
      if (!world.collides || !carHits(bx, bz, v.heading, heightAt(bx, bz, v.mesh.position.y))) {
        v.mesh.position.x = bx; // step back
        v.mesh.position.z = bz; // step back
      } else {
        v.reverse = 0; // blocked
      }
      v.speed = -4; // reversing
      return;
    }
    if (v.wait > 0) { v.wait -= dt; return; } // waiting
    if (!v.path || v.pathIndex >= v.path.length) { // no route
      if (v.loop) { v.pathIndex = 0; } // loop around
      else if (!repath(v)) { v.wait = 1; return; }
    }
    let target = v.path[v.pathIndex]; // next node
    // Missed-turn recovery at a flyover node. A car that crossed the
    // flyover on the deck has PASSED the node underneath it; the
    // route's next leg may be a turn AT that node, which the car can
    // no longer make. Steering back at it U-turns the car across the
    // block off-road. Once the node sits behind the car's travel
    // direction while the car is still on the crossing leg, drop the
    // stale route and re-route from the nearest node AHEAD.
    if (flyoverNodeBehind(v, target) && repathAhead(v)) {
      target = v.path[v.pathIndex]; // re-routed target
    }
    const prev = v.pathIndex > 0 ? v.path[v.pathIndex - 1] : null; // previous node
    const next = v.pathIndex + 1 < v.path.length ? v.path[v.pathIndex + 1] : null; // next node
    const steerTarget = pickSteer(v, target, prev, next);
    const dx = steerTarget.x - v.mesh.position.x; // to steer x
    const dz = steerTarget.z - v.mesh.position.z; // to steer z
    const dist = Math.hypot(dx, dz); // distance to steer
    const light = lightHold(target, dx, dz, dist, steerTarget);
    let hold = light.hold;
    const cap = light.cap;
    if (!hold && blockedAhead(v)) hold = true;
    if (hold) { // hold position
      v.speed = Math.max(0, v.speed - 24 * dt); // brake
      return;
    }
    if (dist < 4) { // reached the node
      v.pathIndex += 1; // next leg
      if (v.pathIndex >= v.path.length) { // route done
        if (v.loop) v.pathIndex = 0; // loop around
        else repath(v);
      }
      return;
    }
    const aim = aimPoint(v, target, prev, steerTarget, dist);
    const targetHeading = Math.atan2(aim.x - v.mesh.position.x, aim.z - v.mesh.position.z); // steer heading
    let diff = targetHeading - v.heading; // heading error
    while (diff > Math.PI) { diff -= Math.PI * 2; } // wrap
    while (diff < -Math.PI) { diff += Math.PI * 2; } // wrap
    // Slow for turns and near nodes; cruise on the straights.
    const wantSpeed = Math.min( // target speed
      (Math.abs(diff) > 0.5 || dist < 14) ? 4 : 10, // slow near turns
      // Cap a straight flyover crossing at 6 m/s — the lane is only
      // 3 m wide with 0.2 m of barrier clearance at the car's real
      // half-width, so coarse SwiftShader steps must track the
      // lane centre instead of overshooting into the barrier.
      steerTarget.viaFlyover ? 6 : Infinity, // flyover cap
      cap,
    );
    v.speed += Math.sign(wantSpeed - v.speed) * Math.min(Math.abs(wantSpeed - v.speed), 8 * dt); // ease to target
    v.heading += Math.max(-2.5 * dt, Math.min(2.5 * dt, diff)); // steer
    const nx = v.mesh.position.x + Math.sin(v.heading) * v.speed * dt; // next x
    const nz = v.mesh.position.z + Math.cos(v.heading) * v.speed * dt; // next z
    // Footprint + destination height (see carHits / heightAt). The old
    // single-point r=1.4 check with no y ignored the deck barriers;
    // with y it would wedge a centred car (1.5 + 1.4 = 2.9 > barrier
    // at 2.7). The real half-width (1.0) clears by 0.2 m.
    if (world.collides && carHits(nx, nz, v.heading, heightAt(nx, nz, v.mesh.position.y))) {
      v.reverse = 0.8; // back out of the wedge, then re-route
      v.speed = -4; // reverse now
      // On a flyover crossing keep the route — a random re-path
      // U-turns the car at the ramp. Back up and retry the same
      // centred approach instead.
      if (!steerTarget.viaFlyover) repath(v);
    } else {
      v.mesh.position.x = nx; // move
      v.mesh.position.z = nz; // move
    }
    v.mesh.rotation.y = v.heading; // face travel
  }

  const extraCars = [];
  // Two cars loop the plaza block itself (z=0 / x=60 / z=120 / x=-60)
  // so traffic is visible right at the spawn; the rest wander random
  // routes.
  const plazaLoop = [[-60, 0], [60, 0], [60, 120], [-60, 120]].map(([x, z]) => ({ x, z }));
  function randomRoute() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const a = graph.nodes[Math.floor(dice() * graph.nodes.length)];
      const b = graph.nodes[Math.floor(dice() * graph.nodes.length)];
      if (Math.hypot(a.x, a.z) < 20 || Math.hypot(b.x, b.z) < 20) continue; // keep the plaza clear
      try {
        const p = graph.findPath(a.id, b.id); // route between nodes
        if (Array.isArray(p) && p.length > 1) return { path: p, start: a };
      } catch { /* try again */ }
    }
    return null; // no route found
  }
  for (let i = 0; i < NUM_EXTRA_CARS; i++) {
    let path = null; // route
    let start = null; // start point
    let startIndex = 0; // start index
    let loop = false; // looping?
    if (i < 2) { // plaza loop cars
      path = plazaLoop; // plaza block
      startIndex = i * 2; // opposite corners
      start = plazaLoop[startIndex]; // opposite corner
      loop = true; // loops forever
    }
    // Random graph route: two random nodes, BFS path between them.
    // Fall back to the rectangular loop when no path comes back.
    if (!path) { // no plaza route
      const found = randomRoute();
      if (found) {
        path = found.path;
        start = found.start;
      }
    }
    if (!path) { // fallback rectangle
      path = [[-300, -120], [300, -120], [300, 120], [-300, 120]].map(([x, z]) => ({ x, z }));
      start = path[i % path.length]; // spread around the loop
    }
    const next = path[(startIndex + 1) % path.length]; // next waypoint
    const heading = Math.atan2(next.x - start.x, next.z - start.z); // face the next point
    const color = CAR_COLORS[i % CAR_COLORS.length];
    const mesh = buildCar(color);
    mesh.position.set(start.x, 0, start.z); // spawn here
    mesh.rotation.y = heading; // face the route
    scene.add(mesh); // add the car
    // Same object shape as vehicles.js addVehicle() returns, so the
    // car is enterable / drivable / nearest-vehicle-visible exactly
    // like a stock car.
    const v = { // traffic car
      // ids 1000+: addVehicle's own counter continues from the 12
      // stock cars, so list.length+1 here would collide with a later
      // mission car.
      id: 1000 + i, // unique id
      kind: "sedan",
      mesh,
      heading,
      speed: 0, // standing still
      maxSpeed: 32, // top speed
      accel: 14, // acceleration
      parked: false, // moving
      traffic: true, // traffic car
      missionCar: false, // not a mission car
      color,
      path,
      pathIndex: (startIndex + 1) % path.length, // first target
      wait: 0,
      wasDriven: false, // never driven
      loop,
    };
    vehicles.list.push(v); // register
    extraCars.push(v);
  }

  // Initial placement + first render so counts show immediately.
  stepPeds(0);
  drawPeds();

  // Hit-and-run: a pedestrian struck by the player's car is knocked
  // down and respawns on a random far sidewalk — the ped is NOT
  // deleted, so the instanced counts stay at 60. The caller (main.js)
  // the caller raises wanted for the hit.
  function knockOver(ped) {
    let segIdx = ped.seg; // current segment
    for (let tries = 0; tries < 12; tries++) {
      const cand = Math.floor(dice() * segs.length);
      const s = segs[cand];
      const mx = (s.ax + s.bx) * 0.5;
      const mz = (s.az + s.bz) * 0.5;
      if (Math.hypot(mx - ped.x, mz - ped.z) > 150) { segIdx = cand; break; } // far enough
    }
    ped.seg = segIdx; // new segment
    ped.dir = dice() < 0.5 ? -1 : 1;
    ped.side = sideFor(segs[segIdx], ped.dir);
    ped.t = 0.25 + dice() * 0.5;
    ped.farTurn = null; // no carried turn
    ped.exit = null; // no exit yet
    placeOnSidewalk(ped);
    planTurn(ped);
    ped.lastHit = Date.now(); // hit time
  }

  return {
    pedestrians: peds,
    trafficCars: extraCars,
    knockDown: knockOver,
    update(dt) { // one frame
      stepPeds(dt);
      drawPeds();
      for (const v of extraCars) {
        if (opts.isDriven && opts.isDriven(v)) { // player driving
          // Player took the wheel: hands off, and re-path from
          // wherever they leave the car when they get out.
          v.wasDriven = true; // driven now
          continue; // hands off
        }
        if (v.wasDriven) { v.wasDriven = false; v.speed = 0; repath(v); }
        driveCar(v, dt);
      }
    },
    stats() { // ambient stats
      const near = peds.filter((p) => Math.hypot(p.x, p.z) <= 100).length;
      return {
        pedestrians: peds.length,
        nearSpawn: near, // near the spawn
        trafficAdded: extraCars.length,
        trafficTotal: vehicles.traffic.length + extraCars.length,
      };
    },
  };
}
