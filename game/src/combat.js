// Neon Vice — Builder C: combat + wanted.
// Two weapons only: pistol (start) + SMG (gun shop). The weapon mesh is
// visible in Vera's right hand while armed and slung on her back while
// holstered (H). 1/2 switch weapons. Click / FIRE shoots a hitscan ray;
// enemies are simple armed NPCs with HP that shoot back. Wanted is capped
// at 3 stars: police peds spawn and chase while wanted > 0; stars decay
// after a quiet period with no crimes.

import { CONFIG } from './config.js';

function makeWeaponMesh(kind) {
  // Pistol vs SMG must read as DIFFERENT weapons from the 9 m chase camera
  // at night (tester: both were the same small dark blob). Pistol: short,
  // gunmetal + amber grip accent. SMG: ~2x longer, olive body, long bright
  // orange magazine + stock + amber muzzle stripe, scaled up ~1.6x.
  const group = new THREE.Group();
  if (kind === 'pistol') {
    const mat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.3, metalness: 0.8 });
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.17, 0.62), mat);
    group.add(barrel);
    const gripMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.5, emissive: 0x92400e, emissiveIntensity: 0.7 });
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.38, 0.17), gripMat);
    grip.position.set(0, -0.22, -0.18);
    group.add(grip);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 1.2 }));
    sight.position.set(0, 0.13, 0.22);
    group.add(sight);
  } else {
    const mat = new THREE.MeshStandardMaterial({ color: 0x4d7c0f, roughness: 0.4, metalness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.21, 0.98), mat);
    group.add(body);
    const magMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.45, emissive: 0x7c2d12, emissiveIntensity: 0.8 });
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.48, 0.15), magMat);
    mag.position.set(0, -0.3, 0.08);
    group.add(mag);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.17, 0.38),
      new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.4, metalness: 0.6 }));
    stock.position.set(0, 0, -0.64);
    group.add(stock);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 1.4 }));
    stripe.position.set(0, 0.12, 0.32);
    group.add(stripe);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.6 }));
    grip.position.set(0, -0.2, -0.3);
    group.add(grip);
  }
  return group;
}

function makeNpcMesh(color, armed, opts = {}) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.1, 0.42),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
  );
  body.position.y = 0.95;
  group.add(body);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.46, 0.42),
    new THREE.MeshStandardMaterial({ color: 0xe8b88a, roughness: 0.6 }),
  );
  head.position.y = 1.75;
  group.add(head);
  if (opts.police) {
    // Navy cap + pale badge so a cop reads as a cop at night, not a thug
    // (thugs are red-bodied, no cap). Cheap: 2 extra boxes per cop.
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.12, 0.46),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 }),
    );
    cap.position.y = 2.02;
    group.add(cap);
    const badge = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.14, 0.05),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xfacc15, emissiveIntensity: 0.7, roughness: 0.4 }),
    );
    badge.position.set(-0.18, 1.25, 0.22);
    group.add(badge);
  }
  if (armed) {
    const gun = makeWeaponMesh('pistol');
    gun.position.set(0.45, 1.05, 0.25);
    group.add(gun);
  }
  return group;
}

export function createCombat(scene, world, player, audio) {
  const weapons = {
    pistol: { ...CONFIG.weapons.pistol, owned: true, mag: CONFIG.weapons.pistol.magSize, reserve: 60 },
    smg: { ...CONFIG.weapons.smg, owned: false, mag: 0, reserve: 0 },
  };
  let current = 'pistol';
  let holstered = true; // start holstered so the intro reads clean
  let fireCooldown = 0;
  let reloadTimer = 0;
  let lastShotAt = -99;
  let gameTime = 0;

  // --- Aim mode (Builder A v4) -------------------------------------------
  // While aiming, aim assist locks the NEAREST living shootable target
  // (thug / police / patrol car) inside a forward cone; shots then hit
  // that target directly instead of relying on the narrow hitscan cone.
  // Ambient sidewalk pedestrians are NOT lockable — they have no HP.
  let aiming = false;
  let locked = null; // currently locked unit, or null
  const AIM_CONE_DOT = 0.7; // ~45-degree half-angle forward cone
  const AIM_LABEL = { thug: 'Thug', police: 'Police', policeCar: 'Patrol car' };

  function acquireLock() {
    const w = weapons[current];
    const px = player.group.position.x;
    const pz = player.group.position.z;
    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    let best = null;
    let bestDist = Infinity;
    for (const e of [...enemies, ...police, ...policeCars]) {
      if (e.dead) continue;
      const dx = e.mesh.position.x - px;
      const dz = e.mesh.position.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist > w.range) continue;
      const dot = (dx * fx + dz * fz) / (dist || 1);
      if (dot < AIM_CONE_DOT) continue;
      if (dist < bestDist) { bestDist = dist; best = e; }
    }
    return best;
  }

  function setAiming(b) {
    const want = !!b;
    if (want === aiming) return;
    aiming = want;
    locked = want ? acquireLock() : null;
  }

  // Plain-data snapshot for the HUD lock marker + test hooks (no meshes:
  // this crosses page.evaluate, which only carries plain data).
  function aimInfo() {
    if (!aiming || !locked || locked.dead) return { aiming, locked: null };
    const px = player.group.position.x;
    const pz = player.group.position.z;
    const dist = Math.hypot(locked.mesh.position.x - px, locked.mesh.position.z - pz);
    return {
      aiming,
      locked: {
        kind: locked.kind,
        label: AIM_LABEL[locked.kind] || locked.kind,
        hp: locked.hp,
        dist: +dist.toFixed(1),
        x: locked.mesh.position.x,
        y: 1.2,
        z: locked.mesh.position.z,
      },
    };
  }

  const weaponMeshes = {
    pistol: makeWeaponMesh('pistol'),
    smg: makeWeaponMesh('smg'),
  };
  // Attach both; visibility decides which shows.
  player.handMount.add(weaponMeshes.pistol);
  player.handMount.add(weaponMeshes.smg);

  const enemies = [];
  const police = [];
  let wanted = 0;
  // v6.3 escape timer (replaces the old per-star decay): counts how long
  // the player has stayed unseen (no police unit in sight range). When it
  // reaches escapeSeconds[wanted], ALL stars clear at once. Being seen
  // again, or a new crime, resets it to 0 — there is no partial progress.
  let escapeTimer = 0;
  let escapeEvent = false; // set when an escape completes; main.js toasts it once
  let lastCrimeAt = -99;
  let policeCanSee = false;

  function escapeNeeded() {
    const table = CONFIG.wanted.escapeSeconds || { 1: 5, 2: 6, 3: 12, 4: 16, 5: 20 };
    return table[wanted] || 5;
  }

  function nearestPoliceDist() {
    const px = player.group.position.x;
    const pz = player.group.position.z;
    let best = null;
    for (const u of [...police, ...policeCars]) {
      if (u.dead) continue;
      const d = Math.hypot(u.mesh.position.x - px, u.mesh.position.z - pz);
      if (best === null || d < best) best = d;
    }
    return best === null ? null : +best.toFixed(1);
  }

  // --- Line-of-sight escape (v6.3 fix) ------------------------------------
  // The old "sees" check was distance-only: a patrol car 17 m away on the
  // road kept seeing a runner on foot forever, so escaping on foot at 2+
  // stars was practically impossible (the car is faster than the runner
  // and the gap never passed 70 m). A unit now "sees" the player only
  // when the segment unit -> player is clear of buildings: hiding behind
  // a building breaks line-of-sight and lets the escape timer run even
  // while a cop is still within sightRange.
  // hasLineOfSight samples world.collides() along the segment (~4 m
  // steps, endpoints excluded — both ends stand on open ground). Water
  // (x > WATER_X0) counts as a blocker via collides(): a small accepted
  // inaccuracy, no special case. Throttle: the per-unit LOS is recomputed
  // at most every 0.25 s of game time, only while wanted > 0, only for
  // living units (max 4 foot + 4 cars, each <= ~18 samples inside
  // sightRange, so one refresh is at most ~150 collides() calls — no
  // new per-frame O(n^2) loop; between refreshes the cached value is
  // reused, and a unit spawned since the last refresh is computed once
  // on demand). maintainForce's `hot` stays distance-based (untouched).
  let losCacheTime = -99;
  let losCache = new Map(); // unit -> true when LOS unit->player is clear

  function hasLineOfSight(ax, az, bx, bz) {
    if (!world.collides) return true;
    const dx = bx - ax;
    const dz = bz - az;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return true;
    const n = Math.max(1, Math.ceil(dist / 4));
    for (let i = 1; i < n; i += 1) {
      const t = i / n;
      if (world.collides(ax + dx * t, az + dz * t, 0)) return false;
    }
    return true;
  }

  function nearestLivingPolice(px, pz) {
    let best = null;
    let bestD = Infinity;
    for (const u of [...police, ...policeCars]) {
      if (u.dead) continue;
      const d = Math.hypot(u.mesh.position.x - px, u.mesh.position.z - pz);
      if (d < bestD) { bestD = d; best = u; }
    }
    return best ? { unit: best, dist: bestD } : null;
  }

  function refreshLos(px, pz) {
    const sight = CONFIG.wanted.sightRange || 70;
    const near = nearestLivingPolice(px, pz);
    const fresh = new Map();
    for (const u of [...police, ...policeCars]) {
      if (u.dead) continue;
      const ux = u.mesh.position.x;
      const uz = u.mesh.position.z;
      const d = Math.hypot(ux - px, uz - pz);
      // LOS only matters inside sightRange — except for the nearest unit,
      // whose LOS is exposed by the debug API at any distance.
      if (d < sight || (near && u === near.unit)) {
        fresh.set(u, hasLineOfSight(ux, uz, px, pz));
      }
    }
    losCache = fresh;
    losCacheTime = gameTime;
  }

  // LOS to the nearest living police unit (cached; computed on demand
  // only when that unit is not in the cache, e.g. spawned since the last
  // refresh). null when no living police unit exists.
  function nearestPoliceLos() {
    const px = player.group.position.x;
    const pz = player.group.position.z;
    const near = nearestLivingPolice(px, pz);
    if (!near) return null;
    if (losCache.has(near.unit)) return losCache.get(near.unit);
    const los = hasLineOfSight(near.unit.mesh.position.x, near.unit.mesh.position.z, px, pz);
    losCache.set(near.unit, los);
    return los;
  }

  // Snapshot for the HUD + debug API (stats()): whether the escape timer
  // is running, its 0..1 progress, the seconds needed at this wanted
  // level, and the nearest living police unit (foot or car).
  function escapeInfo() {
    const needed = wanted > 0 ? escapeNeeded() : 0;
    return {
      escaping: wanted > 0 && !policeCanSee,
      // v6.3 tune: seen again while wanted — the HUD shows SPOTTED!/
      // TERLIHAT! in the same slot as the escape meter.
      spotted: wanted > 0 && policeCanSee,
      progress: needed > 0 ? Math.max(0, Math.min(1, escapeTimer / needed)) : 0,
      needed,
      nearestPoliceDist: nearestPoliceDist(),
      // LOS to the nearest living police unit (true = clear, false =
      // blocked by a building, null = no living police). policeCanSee
      // above is now LOS-aware too.
      nearestPoliceLos: nearestPoliceLos(),
    };
  }

  // --- Visible bullet tracers (Builder B v3) ------------------------------
  // One thin emissive box per tracer, pooled (10) and reused: a police shot
  // must be SEEN, not just heard — the tracer streaks from the muzzle to
  // the player (or to the miss point) for ~0.09 s. 10 meshes total, shared
  // by foot police, patrol cars and thugs.
  const TRACER_COUNT = 10;
  const tracers = [];
  function initTracers() {
    if (tracers.length) return;
    const geo = new THREE.BoxGeometry(0.07, 0.07, 1);
    for (let i = 0; i < TRACER_COUNT; i += 1) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.95 });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      tracers.push({ mesh: m, life: 0 });
    }
  }
  const _tracerFrom = new THREE.Vector3();
  const _tracerTo = new THREE.Vector3();
  function fireTracer(fromX, fromY, fromZ, toX, toY, toZ) {
    initTracers();
    let t = tracers.find((x) => x.life <= 0);
    if (!t) t = tracers[0];
    _tracerFrom.set(fromX, fromY, fromZ);
    _tracerTo.set(toX, toY, toZ);
    const dist = _tracerFrom.distanceTo(_tracerTo);
    if (dist < 0.5) return;
    t.mesh.position.copy(_tracerFrom).lerp(_tracerTo, 0.5);
    t.mesh.lookAt(_tracerTo);
    t.mesh.scale.set(1, 1, dist);
    t.mesh.visible = true;
    t.life = 0.09;
  }
  function updateTracers(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
    }
  }

  function refreshWeaponVisibility() {
    // Tell the player rig whether the weapon is in hand: armed, the right
    // arm holds the aim pose; holstered, it swings with the walk.
    player.armed = !holstered;
    for (const [kind, mesh] of Object.entries(weaponMeshes)) {
      const owned = weapons[kind].owned;
      const isCurrent = kind === current;
      // The current weapon is always visible: in the hand when armed, slung
      // on the back when holstered. Other weapons stay hidden.
      mesh.visible = owned && isCurrent;
      if (!mesh.visible) continue;
      if (!holstered) {
        if (mesh.parent !== player.handMount) player.handMount.add(mesh);
        mesh.position.set(0, 0, 0);
        mesh.rotation.set(0, 0, 0);
        mesh.scale.setScalar(1.3); // armed: oversize slightly so the weapon
        // reads from the 9 m chase camera at night
      } else {
        if (mesh.parent !== player.backMount) player.backMount.add(mesh);
        mesh.position.set(0, 0, 0);
        mesh.rotation.set(0, 0, 0);
        mesh.scale.setScalar(1);
      }
    }
  }
  refreshWeaponVisibility();

  function spawnEnemy(x, z, opts = {}) {
    const mesh = makeNpcMesh(opts.color || 0x7f1d1d, true);
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    const e = {
      mesh, hp: opts.hp || 100, kind: opts.kind || 'thug',
      shootTimer: 1 + Math.random(), speed: opts.speed || 4.5,
      damage: opts.damage || 8, range: opts.range || 42, dead: false,
      mission: !!opts.mission,
    };
    enemies.push(e);
    return e;
  }

  // Per-star foot-police stats (Builder B v3): speed, damage, hit chance
  // and fire interval all escalate with the wanted level. Defaults match
  // the old flat values (6.5 m/s, 6 dmg, 30 m range) at 1 star.
  function footStats(stars) {
    return {
      speed: 7 + 0.5 * (stars - 1), // 7.0 -> 9.0 m/s (player runs 11)
      damage: 6 + (stars >= 3 ? 2 : 0) + (stars >= 5 ? 2 : 0), // 6 / 8 / 10
      range: 30,
      hitChance: 0.35 + 0.05 * (stars - 1), // 0.35 -> 0.55
      shootInterval: 1.3 - 0.1 * (stars - 1), // 1.3 -> 0.9 s
    };
  }

  function spawnPolice(x, z, opts = {}) {
    // Wanted chasers spawn on OPEN ground: a raw 35 m offset can land
    // inside a building, where the axis-separated slide never moves and
    // the cop stands there forever (star-1 repro: both cops stuck at 35 m,
    // never in range to shoot). Mission guards keep exact coordinates.
    if (!opts.mission && world.findOpenGround) {
      const g = world.findOpenGround(x, z, 20);
      if (g) { x = g.x; z = g.z; }
    }
    const st = footStats(opts.stars || Math.max(1, wanted));
    const mesh = makeNpcMesh(0x1d4ed8, true, { police: true });
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    const p = {
      mesh, hp: 100, kind: 'police', shootTimer: 1.5,
      speed: opts.speed || st.speed,
      damage: opts.damage || st.damage,
      range: opts.range || st.range,
      hitChance: opts.hitChance || st.hitChance,
      shootInterval: opts.shootInterval || st.shootInterval,
      dead: false,
      // Mission-spawned guards (e.g. mission 10's impound guards) must
      // survive clearPolice: the harness clears the wanted chasers between
      // missions, and wiping the guards made the kill stage unfinishable
      // (the mission still counted them alive, but shoot() could never hit
      // an object that left the police array).
      mission: !!opts.mission,
    };
    police.push(p);
    return p;
  }

  // --- Patrol cars (Builder B v3) -----------------------------------------
  // Merged single-mesh body (1 draw call) + 2 beacon boxes (flashing
  // red/blue, like Neon Bay's light bar) = 3 draw calls per car, max 4
  // cars = 12 draws at 5 stars. Cars chase on the road graph, hold ~16 m
  // from the player and shoot from the lane; while chasing they run red
  // lights with siren (traffic rules apply only when not chasing — and a
  // police car never patrols: at wanted 0 it despawns, like Neon Bay).
  const policeCars = [];
  const CAR_STATS = { hp: 80, range: 48, damage: 8, hitChance: 0.4, shootInterval: 0.9, ramDamage: 8 };

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

  function makePoliceCarMesh() {
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
    box(2.0, 0.7, bodyLen, 0, 0.55, 0, 0x111827); // black body
    box(1.7, 0.6, bodyLen * 0.45, 0, 1.15, -bodyLen * 0.05, 0x111827); // cabin
    // White doors (both flanks) — the black/white patrol look.
    box(0.06, 0.55, 2.0, -1.01, 0.62, 0, 0xf8fafc);
    box(0.06, 0.55, 2.0, 1.01, 0.62, 0, 0xf8fafc);
    for (const [wx, wz] of [[-0.95, bodyLen * 0.32], [0.95, bodyLen * 0.32], [-0.95, -bodyLen * 0.32], [0.95, -bodyLen * 0.32]]) {
      box(0.3, 0.72, 0.72, wx, 0.36, wz, 0x0a0a0a); // wheels
    }
    for (const lx of [-0.6, 0.6]) box(0.35, 0.18, 0.1, lx, 0.6, bodyLen / 2 + 0.02, 0xfff7cc); // headlights
    const group = new THREE.Group();
    group.add(new THREE.Mesh(
      mergeCarGeos(geos),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.5 }),
    ));
    const redMat = new THREE.MeshStandardMaterial({ color: 0x7f1d1d, emissive: 0xef4444, emissiveIntensity: 0.4, roughness: 0.3 });
    const blueMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, emissive: 0x3b82f6, emissiveIntensity: 0.4, roughness: 0.3 });
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.55), redMat);
    red.position.set(0, 1.55, -0.35);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.55), blueMat);
    blue.position.set(0, 1.55, 0.35);
    group.add(red);
    group.add(blue);
    group.userData = { lightRed: redMat, lightBlue: blueMat };
    return group;
  }

  function carChaseSpeed(stars) {
    // v5 item 4: 20 -> 28 m/s (was 18 -> 26). A flat-out player car
    // (32-38 m/s) still escapes, but at city speeds the cars now close
    // instead of watching the player drive away.
    return 20 + 2 * (stars - 1);
  }

  // v5 item 4: the player may be driving. maintainForce needs to know so
  // it can spawn an intercept car ahead of a driven player.
  let drivingNow = false;

  function spawnPoliceCar(x, z, opts = {}) {
    // Start ON a road: snap the spawn to the nearest road point so the car
    // never begins inside a block (same rule as Neon Bay's spawnPoint).
    if (world.roadGraph && world.roadGraph.nearestOnRoad) {
      const near = world.roadGraph.nearestOnRoad(x, z);
      if (near) { x = near.x; z = near.z; }
    }
    const mesh = makePoliceCarMesh();
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    const c = {
      mesh, kind: 'policeCar', hp: CAR_STATS.hp, dead: false,
      heading: opts.heading || 0, speed: 0,
      shootTimer: 1 + Math.random(), ramCd: 0,
      path: null, pathIdx: 0, pathTarget: null, stuckT: 0,
      lastX: x, lastZ: z,
    };
    mesh.rotation.y = c.heading;
    policeCars.push(c);
    return c;
  }

  function clearPoliceCars() {
    for (const c of policeCars) scene.remove(c.mesh);
    policeCars.length = 0;
  }

  // Road-graph chase for one patrol car. Same steering discipline as the
  // ambient traffic cars (slow for turns / near nodes, re-path only when
  // the target moved far or the car is stuck), but the car holds ~16 m
  // from the player and shoots from the lane instead of driving onto the
  // sidewalk where the player stands.
  // Drop leading waypoints that lie BEHIND the chase: a BFS path starts
  // at the node nearest the car, and on a long segment that node can be
  // 50+ m behind the car while the player is ahead — the old code drove
  // the car there first (probe: both cars drove 50 m SOUTH to node
  // (60,0) while the player drove north, then did it again after every
  // re-path, so they never closed). A waypoint whose direction from the
  // car points away from the player is useless; skip it. The last
  // waypoint is never skipped (it is the goal).
  function trimChasePath(c, px, pz) {
    if (!c.path || c.path.length < 2) return;
    while (c.pathIdx < c.path.length - 1) {
      const wp = c.path[c.pathIdx];
      const dx1 = wp.x - c.mesh.position.x;
      const dz1 = wp.z - c.mesh.position.z;
      const dx2 = px - c.mesh.position.x;
      const dz2 = pz - c.mesh.position.z;
      if (dx1 * dx2 + dz1 * dz2 < 0) c.pathIdx += 1;
      else break;
    }
  }

  function updatePoliceCar(c, dt, px, pz, topSpeed) {
    const dist = Math.hypot(px - c.mesh.position.x, pz - c.mesh.position.z);
    const graph = world.roadGraph;
    const targetMoved = !c.pathTarget || Math.hypot(px - c.pathTarget.x, pz - c.pathTarget.z) > 40;
    if (!c.path || targetMoved || c.stuckT > 1.2) {
      let path = null;
      try {
        path = graph && graph.findPath
          ? graph.findPath({ x: c.mesh.position.x, z: c.mesh.position.z }, { x: px, z: pz })
          : null;
      } catch { /* hold in place */ }
      if (Array.isArray(path) && path.length > 1) {
        c.path = path;
        c.pathIdx = 0;
        c.pathTarget = { x: px, z: pz };
      } else {
        const lane = graph && graph.nearestOnRoad ? graph.nearestOnRoad(px, pz) : { x: px, z: pz };
        c.path = [{ x: lane.x, z: lane.z }];
        c.pathIdx = 0;
        c.pathTarget = { x: px, z: pz };
      }
      c.stuckT = 0;
    }
    trimChasePath(c, px, pz);
    let wx = px;
    let wz = pz;
    if (c.path && c.pathIdx < c.path.length) {
      wx = c.path[c.pathIdx].x;
      wz = c.path[c.pathIdx].z;
      if (Math.hypot(wx - c.mesh.position.x, wz - c.mesh.position.z) < 5) {
        c.pathIdx += 1;
        trimChasePath(c, px, pz);
        if (c.pathIdx < c.path.length) { wx = c.path[c.pathIdx].x; wz = c.path[c.pathIdx].z; }
      }
    }
    // At the end of the path the car drives at the PLAYER, not at the
    // last node: the goal node is only the node nearest the player, and
    // the old code parked the car there while the player kept moving
    // (the "hold ~16 m" braking below still stops it at shooting range).
    // (wx, wz stay px, pz when pathIdx ran past the end.)
    // Hold on the road once close (speed-aware braking distance).
    const atEnd = !c.path || c.pathIdx >= c.path.length;
    const dT = Math.hypot(wx - c.mesh.position.x, wz - c.mesh.position.z);
    const hold = dist < 16 + (c.speed * c.speed) / 104 || (atEnd && dT < 6);
    const targetHeading = Math.atan2(wx - c.mesh.position.x, wz - c.mesh.position.z);
    let diff = targetHeading - c.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    c.heading += Math.max(-2.5 * dt, Math.min(2.5 * dt, diff));
    let want = hold ? 0 : topSpeed * (Math.abs(diff) > 0.9 ? 0.35 : Math.abs(diff) > 0.45 ? 0.6 : 1);
    if (c.path && c.pathIdx >= c.path.length - 1) {
      want = Math.min(want, Math.sqrt(104 * Math.max(0, dT - 1)));
    }
    c.speed += Math.max(-52 * dt, Math.min(20 * dt, want - c.speed));
    if (c.speed < 0) c.speed = 0;
    const nx = c.mesh.position.x + Math.sin(c.heading) * c.speed * dt;
    const nz = c.mesh.position.z + Math.cos(c.heading) * c.speed * dt;
    const blocked = (x, z) => world.collides && world.collides(x, z, 1.4);
    if (!blocked(nx, c.mesh.position.z)) c.mesh.position.x = nx;
    if (!blocked(c.mesh.position.x, nz)) c.mesh.position.z = nz;
    c.mesh.rotation.y = c.heading;
    // Stuck: barely moving while trying to drive — re-path with a nudge.
    const moved = Math.hypot(c.mesh.position.x - c.lastX, c.mesh.position.z - c.lastZ);
    if (c.speed > 8 && moved < c.speed * dt * 0.3) {
      c.stuckT += dt;
      if (c.stuckT > 1.2) c.heading += (Math.random() - 0.5) * 1.4;
    } else {
      c.stuckT = Math.max(0, c.stuckT - dt * 2);
    }
    c.lastX = c.mesh.position.x;
    c.lastZ = c.mesh.position.z;
    // Shoot from the lane.
    c.shootTimer -= dt;
    if (c.shootTimer <= 0 && dist < CAR_STATS.range) {
      c.shootTimer = CAR_STATS.shootInterval + Math.random() * 0.4;
      audio.enemyShot();
      const hit = Math.random() < CAR_STATS.hitChance * (1 - dist / (CAR_STATS.range * 2));
      const mx = c.mesh.position.x;
      const mz = c.mesh.position.z;
      if (hit) {
        fireTracer(mx, 1.4, mz, px, 1.2, pz);
        player.damage(CAR_STATS.damage);
      } else {
        fireTracer(mx, 1.4, mz, px + (Math.random() - 0.5) * 4, 1.2, pz + (Math.random() - 0.5) * 4);
      }
    }
    // Ram: point-blank contact hurts (Neon Bay: 8 dmg at <4 m).
    c.ramCd -= dt;
    if (dist < 4 && c.ramCd <= 0) {
      c.ramCd = 1;
      player.damage(CAR_STATS.ramDamage);
    }
    return dist;
  }

  function maintainForce() {
    const tier = CONFIG.wanted.tiers[Math.max(0, Math.min(CONFIG.wanted.max, wanted))] || { foot: 0, cars: 0 };
    if (wanted === 0) {
      clearPoliceCars();
      return;
    }
    const px = player.group.position.x;
    const pz = player.group.position.z;
    const distOf = (u) => Math.hypot(u.mesh.position.x - px, u.mesh.position.z - pz);
    // The chase is "hot" while any unit is close enough to see the player
    // (sight range): reinforcements spawn near the player. Once EVERY unit
    // is beyond sight, no new units spawn — that is how wanted decays
    // (Neon Bay's teleport-back rule made escape nearly impossible; Vice
    // drops it on purpose so hiding works). A frozen foot cop 120 m away
    // must NOT keep the chase hot, or fresh cops would spawn next to the
    // player forever.
    const foot = police.filter((p) => !p.dead && !p.mission);
    const cars = policeCars.filter((c) => !c.dead);
    const sight = CONFIG.wanted.sightRange || 70;
    const hot = [...foot, ...cars].some((u) => distOf(u) < sight);
    // Spawn a fresh force only while the chase is hot, or right after the
    // crime that raised wanted (fresh heat brings reinforcements). If the
    // player killed every cop and stayed quiet, nobody comes — that is a
    // real escape, and wanted decays.
    // v6.4: the fresh-heat branch used to require the force to be EMPTY
    // (foot.length + cars.length === 0), so escalating wanted while old
    // units were still alive but far away (> sightRange, hot false)
    // spawned nothing — the "fresh heat brings reinforcements" comment
    // never happened. The branch is now just the 10 s window: the
    // top-up loops below only fill the DEFICIT to the tier, so this is
    // self-limiting, and after 10 s only `hot` spawns (unchanged).
    // Both raisers set lastCrimeAt, so both paths top up: commitCrime
    // (real crimes) and debug.setWanted.
    const spawn = hot || (gameTime - lastCrimeAt < 10);
    // Shrink: when the tier drops (decay), the farthest units leave first.
    const shrink = (list, want, remove) => {
      if (list.length <= want) return;
      const sorted = [...list].sort((a, b) => distOf(b) - distOf(a));
      for (const u of sorted.slice(want)) remove(u);
    };
    shrink(foot, tier.foot, (u) => {
      scene.remove(u.mesh);
      police.splice(police.indexOf(u), 1);
    });
    shrink(cars, tier.cars, (u) => {
      scene.remove(u.mesh);
      policeCars.splice(policeCars.indexOf(u), 1);
    });
    if (!spawn) return;
    for (let i = foot.length; i < tier.foot; i += 1) {
      const ang = Math.random() * Math.PI * 2;
      spawnPolice(px + Math.cos(ang) * 35, pz + Math.sin(ang) * 35, { stars: wanted });
    }
    for (let i = cars.length; i < tier.cars; i += 1) {
      // v5 item 4: cars spawn closer (40-55 m, was 60-80 m) so a driving
      // player meets them before they fall behind. When the player is
      // driving, the FIRST car spawns as an INTERCEPT: ~50 m ahead along
      // the player's heading, snapped to the road by spawnPoliceCar — the
      // player drives straight at it, so the chase is visible at once
      // instead of starting 70 m behind a faster car.
      const first = cars.length === 0 && i === 0;
      if (drivingNow && first) {
        const ax = px + Math.sin(player.heading) * 50;
        const az = pz + Math.cos(player.heading) * 50;
        spawnPoliceCar(ax, az, { heading: Math.atan2(px - ax, pz - az) });
        continue;
      }
      const ang = Math.random() * Math.PI * 2;
      const d = 40 + Math.random() * 15;
      spawnPoliceCar(px + Math.cos(ang) * d, pz + Math.sin(ang) * d);
    }
  }

  function clearEnemies() {
    for (const list of [enemies, police]) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const e = list[i];
        if (e.dead || !e.mission) { scene.remove(e.mesh); list.splice(i, 1); }
      }
    }
  }

  function clearPolice() {
    for (let i = police.length - 1; i >= 0; i -= 1) {
      const p = police[i];
      if (p.dead || !p.mission) { scene.remove(p.mesh); police.splice(i, 1); }
    }
    clearPoliceCars();
  }

  // Nearest living police unit (foot or car) within `dist` metres, or null.
  // Used by the car-theft crime ("seen" only when a cop is close).
  function policeNear(dist) {
    const px = player.group.position.x;
    const pz = player.group.position.z;
    for (const p of police) {
      if (p.dead) continue;
      if (Math.hypot(p.mesh.position.x - px, p.mesh.position.z - pz) < dist) return true;
    }
    for (const c of policeCars) {
      if (c.dead) continue;
      if (Math.hypot(c.mesh.position.x - px, c.mesh.position.z - pz) < dist) return true;
    }
    return false;
  }

  function commitCrime(stars) {
    wanted = Math.min(CONFIG.wanted.max, Math.max(wanted, stars));
    lastCrimeAt = gameTime;
    escapeTimer = 0; // a new crime restarts the escape from zero
  }

  function shoot() {
    if (player.swimming) return false; // cannot shoot while swimming
    if (holstered || reloadTimer > 0 || fireCooldown > 0) return false;
    const w = weapons[current];
    if (w.mag <= 0) {
      reload();
      return false;
    }
    fireCooldown = w.fireInterval;
    w.mag -= 1;
    lastShotAt = gameTime;
    audio.shot(current === 'smg');
    commitCrime(1);
    // Hitscan: nearest living enemy/police/police-car within range and a 12-degree cone.
    const px = player.group.position.x;
    const pz = player.group.position.z;
    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    const mx = px + fx * 0.8; // muzzle, just ahead of Vera
    const mz = pz + fz * 0.8;
    // Aim-locked shot (Builder A v4): a locked target is hit directly —
    // the tracer runs muzzle -> target chest, damage is the weapon's full
    // damage every shot, no cone roll, no spread.
    if (aiming && locked && !locked.dead) {
      locked.hp -= w.damage;
      fireTracer(mx, 1.3, mz, locked.mesh.position.x, 1.2, locked.mesh.position.z);
      if (locked.hp <= 0) {
        locked.dead = true;
        locked.mesh.visible = false;
        commitCrime(2);
        audio.chime();
      }
      return true;
    }
    let best = null;
    let bestScore = Infinity;
    for (const e of [...enemies, ...police, ...policeCars]) {
      if (e.dead) continue;
      const dx = e.mesh.position.x - px;
      const dz = e.mesh.position.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist > w.range) continue;
      const dot = (dx * fx + dz * fz) / (dist || 1);
      if (dot < 0.97) continue; // ~14-degree cone
      const score = dist - dot * 2;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) {
      best.hp -= w.damage;
      fireTracer(mx, 1.3, mz, best.mesh.position.x, 1.2, best.mesh.position.z);
      if (best.hp <= 0) {
        best.dead = true;
        best.mesh.visible = false;
        commitCrime(2);
        audio.chime();
      }
    } else {
      // Miss: the tracer still shows where the shot went (range end,
      // straight ahead), so a miss reads as a miss, not a silent nothing.
      fireTracer(mx, 1.3, mz, px + fx * w.range, 1.2, pz + fz * w.range);
    }
    return true;
  }

  function reload() {
    const w = weapons[current];
    if (reloadTimer > 0 || w.mag >= w.magSize || w.reserve <= 0) return;
    reloadTimer = w.reloadTime;
  }

  function updateNpcs(dt, list) {
    const px = player.group.position.x;
    const pz = player.group.position.z;
    for (const e of list) {
      if (e.dead) continue;
      const dx = px - e.mesh.position.x;
      const dz = pz - e.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 90) continue;
      // Chase the player, stop at shooting range. Slide along walls: a
      // straight step into a building used to pin the NPC there forever
      // (the impound guards never reached the player), so fall back to
      // axis-separated steps when the diagonal step is blocked.
      if (dist > e.range * 0.55) {
        const nx = e.mesh.position.x + (dx / dist) * e.speed * dt;
        const nz = e.mesh.position.z + (dz / dist) * e.speed * dt;
        const blocked = (x, z) => world.collides && world.collides(x, z, 0.6);
        if (!blocked(nx, nz)) {
          e.mesh.position.x = nx;
          e.mesh.position.z = nz;
        } else if (!blocked(nx, e.mesh.position.z)) {
          e.mesh.position.x = nx;
        } else if (!blocked(e.mesh.position.x, nz)) {
          e.mesh.position.z = nz;
        }
        e.mesh.rotation.y = Math.atan2(dx, dz);
      } else {
        e.mesh.rotation.y = Math.atan2(dx, dz);
        e.shootTimer -= dt;
        if (e.shootTimer <= 0) {
          e.shootTimer = (e.shootInterval || 1.1) + Math.random() * 0.5;
          audio.enemyShot();
          // Hit chance falls with distance; police are worse shots.
          const hitChance = e.hitChance || (e.kind === 'police' ? 0.35 : 0.45);
          const mx = e.mesh.position.x;
          const mz = e.mesh.position.z;
          if (Math.random() < hitChance * (1 - dist / (e.range * 2))) {
            // Tracer to the player: the shot is SEEN hitting.
            fireTracer(mx, 1.3, mz, px, 1.2, pz);
            player.damage(e.damage);
            if (player.hp <= 0) {
              // handled by main.js (mission fail / respawn)
            }
          } else {
            // Tracer to a miss point near the player.
            fireTracer(mx, 1.3, mz, px + (Math.random() - 0.5) * 4, 1.2, pz + (Math.random() - 0.5) * 4);
          }
        }
      }
    }
  }

  return {
    weapons,
    get current() { return current; },
    get holstered() { return holstered; },
    get wanted() { return wanted; },
    get policeCanSee() { return policeCanSee; },
    enemies,
    police,
    policeCars,
    spawnEnemy,
    spawnPolice,
    spawnPoliceCar,
    clearEnemies,
    clearPolice,
    policeNear,
    // Debug/verification snapshot: counts + nearest distances per unit kind.
    policeInfo() {
      const px = player.group.position.x;
      const pz = player.group.position.z;
      const foot = police.filter((p) => !p.dead && !p.mission);
      const cars = policeCars.filter((c) => !c.dead);
      const dists = (list) => list.map((u) => Math.hypot(u.mesh.position.x - px, u.mesh.position.z - pz));
      const fd = dists(foot);
      const cd = dists(cars);
      return {
        wanted,
        canSee: policeCanSee,
        foot: foot.length,
        cars: cars.length,
        nearestFoot: fd.length ? Math.min(...fd) : null,
        nearestCar: cd.length ? Math.min(...cd) : null,
        hp: player.hp,
      };
    },
    commitCrime,
    escapeInfo,
    // True once when an escape completes (main.js toasts it); consumes it.
    takeEscapeEvent() {
      const e = escapeEvent;
      escapeEvent = false;
      return e;
    },
    shoot,
    reload,
    setAiming,
    aimInfo,
    get aiming() { return aiming; },
    setWanted(n) {
      wanted = Math.max(0, Math.min(CONFIG.wanted.max, n));
      lastCrimeAt = gameTime;
      escapeTimer = 0; // debug set / respawn resets the escape timer too
    },
    switchWeapon(kind) {
      if (!weapons[kind] || !weapons[kind].owned) return false;
      current = kind;
      reloadTimer = 0;
      refreshWeaponVisibility();
      return true;
    },
    toggleHolster() {
      holstered = !holstered;
      refreshWeaponVisibility();
      return holstered;
    },
    buyWeapon(kind) {
      if (weapons[kind].owned) return false;
      weapons[kind].owned = true;
      weapons[kind].mag = weapons[kind].magSize;
      weapons[kind].reserve = weapons[kind].reserveMax;
      refreshWeaponVisibility();
      return true;
    },
    buyAmmo(kind, amount) {
      const w = weapons[kind];
      if (!w || !w.owned) return false;
      w.reserve = Math.min(w.reserveMax, w.reserve + amount);
      return true;
    },
    ammoText() {
      const w = weapons[current];
      return `${w.mag} / ${w.reserve}`;
    },
    isReloading() { return reloadTimer > 0; },
    update(dt, t, driving) {
      gameTime = t;
      drivingNow = !!driving;
      // Aim assist (Builder A v4): re-acquire the nearest target in the
      // forward cone every frame while aiming; drop the lock on release.
      if (aiming) {
        if (!locked || locked.dead) locked = acquireLock();
        else {
          const w = weapons[current];
          const dx = locked.mesh.position.x - player.group.position.x;
          const dz = locked.mesh.position.z - player.group.position.z;
          const dist = Math.hypot(dx, dz);
          const dot = (dx * Math.sin(player.heading) + dz * Math.cos(player.heading)) / (dist || 1);
          if (dist > w.range * 1.2 || dot < 0.5) locked = acquireLock();
        }
      } else locked = null;
      fireCooldown = Math.max(0, fireCooldown - dt);
      if (reloadTimer > 0) {
        reloadTimer -= dt;
        if (reloadTimer <= 0) {
          const w = weapons[current];
          const need = w.magSize - w.mag;
          const take = Math.min(need, w.reserve);
          w.mag += take;
          w.reserve -= take;
        }
      }
      updateNpcs(dt, enemies);
      // Wanted chasers only fight while wanted > 0. Once the heat is off
      // they walk away (below) and must NOT keep shooting: the old code
      // ran updateNpcs for every cop unconditionally, so a "retreating"
      // cop within 16 m re-chased the player and shot them at wanted 0
      // (5-star repro: Vera respawned after death, then kept taking fire
      // from cops that were supposed to have given up). Mission guards
      // (mission 10 impound) still fight at wanted 0 — they are the
      // mission's targets, not the wanted force.
      updateNpcs(dt, wanted > 0 ? police : police.filter((p) => p.mission));
      updateTracers(dt);
      // Wanted escape (v6.3, replaces the old per-star decay): the timer
      // runs ONLY while no police unit can see the player. When it
      // reaches escapeSeconds[wanted] every star clears AT ONCE and the
      // wanted===0 branch below disperses the police. Being seen again
      // resets the timer to 0 — no partial credit.
      const sight = CONFIG.wanted.sightRange || 70;
      const px = player.group.position.x;
      const pz = player.group.position.z;
      // "Sees" = inside sightRange AND line-of-sight clear (v6.3 LOS
      // fix). The LOS cache refreshes at most every 0.25 s of game time;
      // a unit spawned since the last refresh is computed once on demand.
      // maintainForce's `hot` below stays distance-based — untouched.
      policeCanSee = false;
      if (wanted > 0) {
        if (gameTime - losCacheTime >= 0.25) refreshLos(px, pz);
        const sees = (u) => {
          if (u.dead) return false;
          if (Math.hypot(u.mesh.position.x - px, u.mesh.position.z - pz) >= sight) return false;
          let los = losCache.get(u);
          if (los === undefined) {
            los = hasLineOfSight(u.mesh.position.x, u.mesh.position.z, px, pz);
            losCache.set(u, los);
          }
          return los;
        };
        for (const p of police) {
          if (sees(p)) { policeCanSee = true; break; }
        }
        if (!policeCanSee) {
          for (const c of policeCars) {
            if (sees(c)) { policeCanSee = true; break; }
          }
        }
        if (policeCanSee) {
          escapeTimer = 0;
        } else {
          escapeTimer += dt;
          if (escapeTimer >= escapeNeeded()) {
            wanted = 0;
            escapeTimer = 0;
            escapeEvent = true;
          }
        }
        // Keep the tier force on the player (foot + cars per star).
        maintainForce();
        // Patrol cars chase on the road graph; a car >250 m away has lost
        // the player and despawns (maintainForce only respawns while the
        // chase is hot, so outrunning the cars really loses them).
        const topSpeed = carChaseSpeed(wanted);
        for (let i = policeCars.length - 1; i >= 0; i -= 1) {
          const c = policeCars[i];
          if (c.dead) { scene.remove(c.mesh); policeCars.splice(i, 1); continue; }
          const d = Math.hypot(c.mesh.position.x - px, c.mesh.position.z - pz);
          if (d > 250) {
            scene.remove(c.mesh);
            policeCars.splice(i, 1);
          } else {
            updatePoliceCar(c, dt, px, pz, topSpeed);
          }
        }
        // Light bars flash red/blue, ~3 flashes a second (Neon Bay).
        const redOn = Math.sin(gameTime * 9) > 0;
        for (const c of policeCars) {
          const ud = c.mesh.userData || {};
          if (ud.lightRed && ud.lightBlue) {
            ud.lightRed.emissiveIntensity = redOn ? 2.6 : 0.25;
            ud.lightBlue.emissiveIntensity = redOn ? 0.25 : 2.6;
          }
        }
        audio.setSiren(true);
      } else {
        audio.setSiren(false);
        // Police give up and walk off once wanted clears; cars despawn
        // (maintainForce clears them) and far foot police are removed.
        for (let i = police.length - 1; i >= 0; i -= 1) {
          const p = police[i];
          if (p.dead || p.mission) continue;
          p.mesh.position.x += Math.sin(p.mesh.rotation.y + Math.PI) * 3 * dt;
          p.mesh.position.z += Math.cos(p.mesh.rotation.y + Math.PI) * 3 * dt;
          if (Math.hypot(p.mesh.position.x - px, p.mesh.position.z - pz) > 150) {
            scene.remove(p.mesh);
            police.splice(i, 1);
          }
        }
        if (policeCars.length) clearPoliceCars();
      }
      // Clean up dead / far police occasionally.
      if (police.length > 8) {
        const keep = police.filter((p) => !p.dead).slice(0, 4);
        for (const p of police) if (!keep.includes(p)) scene.remove(p.mesh);
        police.length = 0;
        police.push(...keep);
      }
    },
  };
}
