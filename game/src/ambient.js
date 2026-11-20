// Neon Vice — Builder NPC: ambient pedestrians + extra traffic cars.
// Pedestrians walk ONLY on sidewalks (3 m strips flanking every road, per
// world.js: centreline offset = road half-width + 1.5 m), never on the road
// surface and never through buildings — sidewalks sit between the road edge
// and the building line (buildings are inset 10 m from the street), so a
// sidewalk position is collision-free by construction. At each intersection
// a pedestrian picks a random adjoining street and keeps walking, so routes
// loop forever. Traffic cars reuse vehicles.js (addVehicle + the existing
// updateTraffic loop): they follow the road graph on the road centreline.
//
// Rendering is instanced: 3 draw calls for all pedestrians (bodies, heads,
// legs) and 1 reused car Group per traffic car. Ambient NPCs never touch
// missions, wanted, or the player: they have no collision with Vera and no
// interaction radius.

import { mulberry32, randRange, pick } from './data.js';

const PED_COUNT = 24;
const EXTRA_TRAFFIC = 8; // +4 existing traffic cars = 12 total
const NEAR_SPAWN_COUNT = 6; // guaranteed visible around the spawn plaza
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
  const pedestrians = [];
  const nearSpawnSegs = segments.filter((s) => {
    const mx = (s.ax + s.bx) / 2;
    const mz = (s.az + s.bz) / 2;
    return Math.hypot(mx, mz) <= NEAR_SPAWN_RADIUS;
  });

  function spawnPed(segIdx) {
    const s = segments[segIdx];
    return {
      seg: segIdx,
      side: rng() < 0.5 ? -1 : 1,
      t: rng(),
      dir: rng() < 0.5 ? -1 : 1,
      speed: randRange(rng, 0.9, 1.7), // m/s, a relaxed walk
      phase: rng() * Math.PI * 2,
      x: 0, z: 0, heading: 0,
      shirt: pick(rng, SHIRTS),
      skin: pick(rng, SKINS),
      pants: pick(rng, PANTS),
    };
  }
  for (let i = 0; i < PED_COUNT; i += 1) {
    const segIdx = i < NEAR_SPAWN_COUNT
      ? segments.indexOf(pick(rng, nearSpawnSegs))
      : Math.floor(rng() * segments.length);
    pedestrians.push(spawnPed(segIdx));
  }

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

  function arriveAtNode(p, nodeId) {
    // Pick a random adjoining street (never the one just walked, unless it
    // is a dead end — the grid has none, every node has degree >= 2).
    const options = adjacency[nodeId].filter((e) => e.seg !== p.seg);
    const next = options.length > 0 ? pick(rng, options) : adjacency[nodeId][0];
    const ns = segments[next.seg];
    p.seg = next.seg;
    p.t = ns.a === nodeId ? 0 : 1;
    p.dir = ns.a === nodeId ? 1 : -1;
    p.side = rng() < 0.5 ? -1 : 1; // may cross to the other sidewalk
  }

  function updatePedestrians(dt) {
    for (const p of pedestrians) {
      const s = segments[p.seg];
      p.t += (p.dir * p.speed * dt) / s.length;
      if (p.t >= 1) { p.t = 1; arriveAtNode(p, s.b); }
      else if (p.t <= 0) { p.t = 0; arriveAtNode(p, s.a); }
      p.phase += dt * p.speed * 2.6; // stride frequency scales with speed
      placePed(p);
    }
  }

  // ---- Instanced pedestrian meshes (3 draw calls for all 24) -------------
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  const bodyGeo = new THREE.BoxGeometry(0.55, 0.85, 0.32);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const bodies = secureInstanced(new THREE.InstancedMesh(bodyGeo, bodyMat, PED_COUNT));
  const headGeo = new THREE.SphereGeometry(0.17, 8, 6);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  const heads = secureInstanced(new THREE.InstancedMesh(headGeo, headMat, PED_COUNT));
  const legGeo = new THREE.BoxGeometry(0.17, 0.55, 0.17);
  const legMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  const legs = secureInstanced(new THREE.InstancedMesh(legGeo, legMat, PED_COUNT * 2));
  pedestrians.forEach((p, i) => {
    bodies.setColorAt(i, tmpColor.setHex(p.shirt));
    heads.setColorAt(i, tmpColor.setHex(p.skin));
    legs.setColorAt(i * 2, tmpColor.setHex(p.pants));
    legs.setColorAt(i * 2 + 1, tmpColor.setHex(p.pants));
  });
  for (const m of [bodies, heads, legs]) {
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
        v.pathIndex = 1;
        return true;
      }
    } catch { /* keep current path */ }
    return false;
  }

  function updateTrafficCar(v, dt) {
    if (v.wait > 0) { v.wait -= dt; return; }
    if (!v.path || v.pathIndex >= v.path.length) {
      if (v.loop) { v.pathIndex = 0; }
      else if (!repathCar(v)) { v.wait = 1; return; }
    }
    const target = v.path[v.pathIndex];
    const dx = target.x - v.mesh.position.x;
    const dz = target.z - v.mesh.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 4) {
      v.pathIndex += 1;
      if (v.pathIndex >= v.path.length) {
        if (v.loop) v.pathIndex = 0;
        else repathCar(v);
      }
      return;
    }
    const targetHeading = Math.atan2(dx, dz);
    let diff = targetHeading - v.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    // Slow for turns and near nodes; cruise on straights.
    const wantSpeed = (Math.abs(diff) > 0.5 || dist < 14) ? 4 : 10;
    v.speed += Math.sign(wantSpeed - v.speed) * Math.min(Math.abs(wantSpeed - v.speed), 8 * dt);
    v.heading += Math.max(-2.5 * dt, Math.min(2.5 * dt, diff));
    const nx = v.mesh.position.x + Math.sin(v.heading) * v.speed * dt;
    const nz = v.mesh.position.z + Math.cos(v.heading) * v.speed * dt;
    if (world.collides && world.collides(nx, nz, 1.4)) {
      v.wait = 1.0; // blocked: pause, then re-path past it
      v.speed = 0;
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

  return {
    pedestrians,
    trafficCars,
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
