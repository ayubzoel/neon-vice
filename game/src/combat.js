// Neon Vice — Builder C: combat + wanted.
// Two weapons only: pistol (start) + SMG (gun shop). The weapon mesh is
// visible in Vera's right hand while armed and slung on her back while
// holstered (H). 1/2 switch weapons. Click / FIRE shoots a hitscan ray;
// enemies are simple armed NPCs with HP that shoot back. Wanted is capped
// at 3 stars: police peds spawn and chase while wanted > 0; stars decay
// after a quiet period with no crimes.

import { CONFIG } from './config.js';

function boxPart(w, h, d, x, y, z, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

function makeWeaponMesh(kind) {
  // Pistol vs SMG must read as DIFFERENT weapons from the 9 m chase camera
  // at night (tester: both were the same small dark blob). Pistol: short,
  // gunmetal + amber grip accent. SMG: ~2x longer, olive body, long bright
  // orange magazine + stock + amber muzzle stripe, scaled up ~1.6x.
  const group = new THREE.Group();
  if (kind === 'pistol') {
    const steel = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.3, metalness: 0.8 });
    const amber = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.5, emissive: 0x92400e, emissiveIntensity: 0.7 });
    const glow = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 1.2 });
    group.add(boxPart(0.14, 0.17, 0.62, 0, 0, 0, steel));
    group.add(boxPart(0.13, 0.38, 0.17, 0, -0.22, -0.18, amber));
    group.add(boxPart(0.05, 0.09, 0.1, 0, 0.13, 0.22, glow));
  } else {
    const olive = new THREE.MeshStandardMaterial({ color: 0x4d7c0f, roughness: 0.4, metalness: 0.6 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.45, emissive: 0x7c2d12, emissiveIntensity: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.4, metalness: 0.6 });
    const cyan = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 1.4 });
    const black = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.6 });
    group.add(boxPart(0.17, 0.21, 0.98, 0, 0, 0, olive));
    group.add(boxPart(0.12, 0.48, 0.15, 0, -0.3, 0.08, orange));
    group.add(boxPart(0.13, 0.17, 0.38, 0, 0, -0.64, dark));
    group.add(boxPart(0.18, 0.06, 0.2, 0, 0.12, 0.32, cyan));
    group.add(boxPart(0.12, 0.3, 0.14, 0, -0.2, -0.3, black));
  }
  return group;
}

function makeNpcMesh(color, armed, opts = {}) {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8b88a, roughness: 0.6 });
  const shirt = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  group.add(boxPart(0.7, 1.1, 0.42, 0, 0.95, 0, shirt));
  group.add(boxPart(0.46, 0.46, 0.42, 0, 1.75, 0, skin));
  if (opts.police) {
    // Navy cap + pale badge so a cop reads as a cop at night, not a thug
    // (thugs are red-bodied, no cap). Cheap: 2 extra boxes per cop.
    const navy = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xfacc15, emissiveIntensity: 0.7, roughness: 0.4 });
    group.add(boxPart(0.5, 0.12, 0.46, 0, 2.02, 0, navy));
    group.add(boxPart(0.14, 0.14, 0.05, -0.18, 1.25, 0.22, gold));
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
    const lx = locked.mesh.position.x;
    const lz = locked.mesh.position.z;
    return {
      aiming,
      locked: {
        kind: locked.kind,
        label: AIM_LABEL[locked.kind] || locked.kind,
        hp: locked.hp,
        dist: +Math.hypot(lx - px, lz - pz).toFixed(1),
        x: lx,
        y: 1.2,
        z: lz,
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
    let closest = null;
    for (const u of [...police, ...policeCars]) {
      if (u.dead) continue;
      const d = Math.hypot(u.mesh.position.x - px, u.mesh.position.z - pz);
      if (closest === null || d < closest) closest = d;
    }
    return closest === null ? null : +closest.toFixed(1);
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
    const probes = Math.max(1, Math.ceil(dist / 4));
    for (let k = 1; k < probes; k++) {
      const f = k / probes;
      if (world.collides(ax + dx * f, az + dz * f, 0)) return false;
    }
    return true;
  }

  function livingUnits() {
    return [...police, ...policeCars].filter((u) => !u.dead);
  }

  function nearestLivingPolice(px, pz) {
    let best = null;
    let bestD = Infinity;
    for (const u of livingUnits()) {
      const d = Math.hypot(u.mesh.position.x - px, u.mesh.position.z - pz);
      if (d < bestD) { bestD = d; best = u; }
    }
    return best ? { unit: best, dist: bestD } : null;
  }

  function refreshLos(px, pz) {
    const sight = CONFIG.wanted.sightRange || 70;
    const near = nearestLivingPolice(px, pz);
    const fresh = new Map();
    for (const u of livingUnits()) {
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
    const clamped = needed > 0 ? Math.max(0, Math.min(1, escapeTimer / needed)) : 0;
    return {
      escaping: wanted > 0 && !policeCanSee,
      // v6.3 tune: seen again while wanted — the HUD shows SPOTTED!/
      // TERLIHAT! in the same slot as the escape meter.
      spotted: wanted > 0 && policeCanSee,
      progress: clamped,
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
  // by foot police, patrol cars and thugs. Allocation is a ring: each
  // shot takes the next slot, so a burst reuses the oldest tracer.
  const TRACER_COUNT = 10;
  const TRACER_LIFE = 0.09;
  const tracers = [];
  let tracerCursor = 0;
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
    let slot = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % TRACER_COUNT;
    if (slot.life > 0) {
      const idle = tracers.find((x) => x.life <= 0);
      if (idle) slot = idle;
    }
    _tracerFrom.set(fromX, fromY, fromZ);
    _tracerTo.set(toX, toY, toZ);
    const dist = _tracerFrom.distanceTo(_tracerTo);
    if (dist < 0.5) return;
    slot.mesh.position.copy(_tracerFrom).lerp(_tracerTo, 0.5);
    slot.mesh.lookAt(_tracerTo);
    slot.mesh.scale.set(1, 1, dist);
    slot.mesh.visible = true;
    slot.life = TRACER_LIFE;
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
      mesh,
      hp: opts.hp || 100,
      kind: opts.kind || 'thug',
      shootTimer: 1 + Math.random(),
      speed: opts.speed || 4.5,
      damage: opts.damage || 8,
      range: opts.range || 42,
      dead: false,
      mission: !!opts.mission,
    };
    enemies.push(e);
    return e;
  }

  // Per-star foot-police stats (Builder B v3): speed, damage, hit chance
  // and fire interval all escalate with the wanted level. Defaults match
  // the old flat values (6.5 m/s, 6 dmg, 30 m range) at 1 star.
  function footStats(stars) {
    const step = stars - 1;
    return {
      speed: 7 + 0.5 * step, // 7.0 -> 9.0 m/s (player runs 11)
      damage: 6 + (stars >= 3 ? 2 : 0) + (stars >= 5 ? 2 : 0), // 6 / 8 / 10
      range: 30,
      hitChance: 0.35 + 0.05 * step, // 0.35 -> 0.55
      shootInterval: 1.3 - 0.1 * step, // 1.3 -> 0.9 s
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
      mesh,
      hp: 100,
      kind: 'police',
      shootTimer: 1.5,
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

  // v6.5 item 5 — police helicopter (wanted 4-5 only). One merged mesh
  // (body + tail + static rotor + skids + searchlight lens) + one
  // translucent searchlight cone = +2 draw calls. It NEVER shoots and is
  // NEVER in police/policeCars/enemies, so it cannot count in
  // policeCanSee/escapeTimer — from the air LOS is almost always clear,
  // and counting it would make a 4-5 star escape impossible. It orbits at
  // 25 m (above the 6 m flyover deck) and climbs above any roof it passes
  // over (world.tallestAt; towers reach 58 m). The orbit is wide (55 m)
  // and low on purpose: the third-person camera looks down at the player
  // (frame top ~+12 deg at default pitch, ~+23 deg at minimum pitch), so
  // a 30 m / 35 m orbit would sit above the frame and the player would
  // never see the heli at all — the searchlight beam sweeping the street
  // is what makes it unmistakable even when the heli itself is high.
  const HELI_Y = 25;
  const HELI_R = 55;
  const HELI_SPEED = 0.32; // rad/s — a full orbit takes ~20 s
  let heli = null;
  let heliAngle = 0;
  let heliY = HELI_Y;

  // A painted-box collector: every part of a merged vehicle mesh is a
  // box with a solid colour; the collector paints each box's vertices
  // and keeps the list for one fused geometry.
  function paintedParts() {
    const geos = [];
    const paint = (g, hex) => {
      const c = new THREE.Color(hex);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        arr[i * 3] = c.r;
        arr[i * 3 + 1] = c.g;
        arr[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      geos.push(g);
    };
    const box = (w, h, d, x, y, z, hex) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      paint(g, hex);
    };
    return { geos, box };
  }

  function makeHeliMesh() {
    const { geos, box } = paintedParts();
    const parts = [
      [2.4, 1.3, 4.6, 0, 0, 0, 0x1e3a5f], // police-blue body
      [2.0, 0.9, 1.2, 0, 0.1, 1.9, 0x0f172a], // dark nose glass
      [2.44, 0.35, 3.0, 0, 0.15, -0.2, 0xf8fafc], // white stripe
      [0.8, 0.8, 4.2, 0, 0.2, -4.2, 0x1e3a5f], // tail boom
      [0.15, 1.6, 1.0, 0, 0.9, -6.0, 0x1e3a5f], // tail fin
      [0.12, 1.6, 0.3, -0.55, 0.3, -5.8, 0x94a3b8], // tail rotor
      [0.3, 0.5, 0.3, 0, 0.85, 0, 0x334155], // rotor mast
      [8.0, 0.1, 0.6, 0, 1.15, 0, 0x334155], // main rotor (static)
      [0.15, 0.15, 3.6, -1.0, -0.95, 0, 0x475569], // skids
      [0.15, 0.15, 3.6, 1.0, -0.95, 0, 0x475569],
      [0.15, 0.35, 0.15, -1.0, -0.75, 1.2, 0x475569], // skid struts
      [0.15, 0.35, 0.15, 1.0, -0.75, 1.2, 0x475569],
      [0.15, 0.35, 0.15, -1.0, -0.75, -1.2, 0x475569],
      [0.15, 0.35, 0.15, 1.0, -0.75, -1.2, 0x475569],
      [0.6, 0.3, 0.4, 0, -0.7, 1.6, 0xfff7cc], // searchlight lens (unlit, bright)
    ];
    for (const p of parts) box(...p);
    const group = new THREE.Group();
    group.userData.isHeli = true; // probe hook: identify the heli in the scene
    group.add(new THREE.Mesh(
      mergeCarGeos(geos),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.4 }),
    ));
    // Searchlight cone: apex at the heli, base on the ground (scaled per
    // frame in updateHeli). Translucent so the street stays readable
    // through it; the beam is what the player actually sees sweeping the
    // ground when the heli itself is above the camera frame.
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(6, HELI_Y, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xfff7cc, transparent: true, opacity: 0.16,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    group.add(cone);
    group.userData.cone = cone;
    return group;
  }

  function updateHeli(dt) {
    if (wanted < 4) {
      if (heli) {
        scene.remove(heli);
        heli = null;
      }
      return;
    }
    if (!heli) {
      heli = makeHeliMesh();
      scene.add(heli);
      // Spawn in front of the player so it is seen at once: the orbit
      // offset points along the player's heading.
      heliAngle = Math.PI / 2 - player.heading;
      heliY = HELI_Y;
    }
    heliAngle += HELI_SPEED * dt;
    const px = player.group.position.x;
    const pz = player.group.position.z;
    const hx = px + Math.cos(heliAngle) * HELI_R;
    const hz = pz + Math.sin(heliAngle) * HELI_R;
    // Roof avoidance: tallestAt is a step function — at a building edge
    // the roof jumps from 0 to 58 m instantly, and no climb rate can
    // react in time. So look ahead along the orbit (up to 3 s) and climb
    // BEFORE reaching a tall roof; the max over the arc ahead sets the
    // target altitude. Climb fast, sink gently.
    let targetY = HELI_Y;
    for (let k = 0; k <= 6; k += 1) {
      const a = heliAngle + (k / 6) * HELI_SPEED * 3;
      const orbitX = px + Math.cos(a) * HELI_R;
      const orbitZ = pz + Math.sin(a) * HELI_R;
      const roof = (world.tallestAt ? world.tallestAt(orbitX, orbitZ) : 0) || 0;
      targetY = Math.max(targetY, roof + 6);
    }
    const rate = targetY > heliY ? 18 : 6;
    heliY += Math.max(-rate * dt, Math.min(rate * dt, targetY - heliY));
    heli.position.set(hx, heliY + Math.sin(gameTime * 1.3) * 0.8, hz);
    heli.rotation.y = Math.atan2(px - hx, pz - hz);
    // Searchlight cone: stretch it so the base stays on the ground
    // (apex at the heli, base at y=0). Cone geometry is HELI_Y tall,
    // centred — scale + offset put the apex at the group origin.
    const cone = heli.userData.cone;
    if (cone) {
      const s = heliY / HELI_Y;
      cone.scale.set(1, s, 1);
      cone.position.y = -HELI_Y * s / 2;
    }
  }
  const CAR_STATS = { hp: 80, range: 48, damage: 8, hitChance: 0.4, shootInterval: 0.9, ramDamage: 8 };

  function mergeCarGeos(geos) {
    const blocks = geos.map((g) => ({
      verts: g.attributes.position.count,
      tris: g.index.count,
      pos: g.attributes.position.array,
      nor: g.attributes.normal.array,
      col: g.attributes.color.array,
      idx: g.index.array,
    }));
    const totalVerts = blocks.reduce((sum, b) => sum + b.verts, 0);
    const totalTris = blocks.reduce((sum, b) => sum + b.tris, 0);
    const pos = new Float32Array(totalVerts * 3);
    const nor = new Float32Array(totalVerts * 3);
    const col = new Float32Array(totalVerts * 3);
    const idx = new Uint32Array(totalTris);
    let vBase = 0;
    let iBase = 0;
    for (const b of blocks) {
      pos.set(b.pos, vBase * 3);
      nor.set(b.nor, vBase * 3);
      col.set(b.col, vBase * 3);
      for (let k = 0; k < b.tris; k++) idx[iBase + k] = b.idx[k] + vBase;
      vBase += b.verts;
      iBase += b.tris;
    }
    const fused = new THREE.BufferGeometry();
    fused.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    fused.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    fused.setAttribute('color', new THREE.BufferAttribute(col, 3));
    fused.setIndex(new THREE.BufferAttribute(idx, 1));
    fused.computeBoundingSphere();
    return fused;
  }

  function makePoliceCarMesh() {
    const { geos, box } = paintedParts();
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

  // Pick the chase waypoint for this frame: the next path node, or the
  // player directly once the path is exhausted. Nodes closer than 5 m
  // are consumed, and stale leading nodes behind the chase are trimmed
  // first (see trimChasePath). When the last node is consumed, the
  // waypoint stays that node (not the player) — the caller drives at
  // the player only once the path is genuinely exhausted.
  function chaseWaypoint(c, px, pz) {
    trimChasePath(c, px, pz);
    if (!c.path || c.pathIdx >= c.path.length) return { x: px, z: pz, atEnd: true };
    let wp = c.path[c.pathIdx];
    if (Math.hypot(wp.x - c.mesh.position.x, wp.z - c.mesh.position.z) < 5) {
      c.pathIdx += 1;
      trimChasePath(c, px, pz);
      if (c.pathIdx < c.path.length) wp = c.path[c.pathIdx];
      else return { x: wp.x, z: wp.z, atEnd: true };
    }
    return { x: wp.x, z: wp.z, atEnd: false };
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
    const wp = chaseWaypoint(c, px, pz);
    const wx = wp.x;
    const wz = wp.z;
    // At the end of the path the car drives at the PLAYER, not at the
    // last node: the goal node is only the node nearest the player, and
    // the old code parked the car there while the player kept moving
    // (the "hold ~16 m" braking below still stops it at shooting range).
    // Hold on the road once close (speed-aware braking distance).
    const dT = Math.hypot(wx - c.mesh.position.x, wz - c.mesh.position.z);
    const hold = dist < 16 + (c.speed * c.speed) / 104 || (wp.atEnd && dT < 6);
    const targetHeading = Math.atan2(wx - c.mesh.position.x, wz - c.mesh.position.z);
    let diff = targetHeading - c.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    c.heading += Math.max(-2.5 * dt, Math.min(2.5 * dt, diff));
    const turnPenalty = Math.abs(diff) > 0.9 ? 0.35 : Math.abs(diff) > 0.45 ? 0.6 : 1;
    let want = hold ? 0 : topSpeed * turnPenalty;
    if (c.path && c.pathIdx >= c.path.length - 1) {
      want = Math.min(want, Math.sqrt(104 * Math.max(0, dT - 1)));
    }
    c.speed += Math.max(-52 * dt, Math.min(20 * dt, want - c.speed));
    if (c.speed < 0) c.speed = 0;
    // v6.6 item 5: police cars are slow on sand too (same 6 m/s cap as
    // the player) — a chase onto the beach bogs down instead of keeping
    // highway speed. A speed cap only, not a lethality/tier change.
    if (world.isOnSand && world.isOnSand(c.mesh.position.x, c.mesh.position.z)) {
      c.speed = Math.min(c.speed, 6);
    }
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
    const foot = police.filter((p) => !p.dead && !p.mission);
    const cars = policeCars.filter((c) => !c.dead);
    const sight = CONFIG.wanted.sightRange || 70;
    // The chase is "hot" while any unit is close enough to see the player
    // (sight range): reinforcements spawn near the player. Once EVERY unit
    // is beyond sight, no new units spawn — that is how wanted decays
    // (Neon Bay's teleport-back rule made escape nearly impossible; Vice
    // drops it on purpose so hiding works). A frozen foot cop 120 m away
    // must NOT keep the chase hot, or fresh cops would spawn next to the
    // player forever.
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
    const trimTo = (list, want, remove) => {
      if (list.length <= want) return;
      const farthestFirst = [...list].sort((a, b) => distOf(b) - distOf(a));
      for (const u of farthestFirst.slice(want)) remove(u);
    };
    trimTo(foot, tier.foot, (u) => {
      scene.remove(u.mesh);
      police.splice(police.indexOf(u), 1);
    });
    trimTo(cars, tier.cars, (u) => {
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
    if (heli) { scene.remove(heli); heli = null; } // v6.5 item 5
  }

  // Nearest living police unit (foot or car) within `dist` metres, or null.
  // Used by the car-theft crime ("seen" only when a cop is close).
  function policeNear(dist) {
    const px = player.group.position.x;
    const pz = player.group.position.z;
    const close = (u) => !u.dead
      && Math.hypot(u.mesh.position.x - px, u.mesh.position.z - pz) < dist;
    return police.some(close) || policeCars.some(close);
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
    const killTarget = (t) => {
      t.hp -= w.damage;
      if (t.hp <= 0) {
        t.dead = true;
        t.mesh.visible = false;
        commitCrime(2);
        audio.chime();
      }
    };
    // Aim-locked shot (Builder A v4): a locked target is hit directly —
    // the tracer runs muzzle -> target chest, damage is the weapon's full
    // damage every shot, no cone roll, no spread.
    if (aiming && locked && !locked.dead) {
      fireTracer(mx, 1.3, mz, locked.mesh.position.x, 1.2, locked.mesh.position.z);
      killTarget(locked);
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
      fireTracer(mx, 1.3, mz, best.mesh.position.x, 1.2, best.mesh.position.z);
      killTarget(best);
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
    const blocked = (x, z) => world.collides && world.collides(x, z, 0.6);
    for (const e of list) {
      if (e.dead) continue;
      const dx = px - e.mesh.position.x;
      const dz = pz - e.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 90) continue;
      const facePlayer = () => { e.mesh.rotation.y = Math.atan2(dx, dz); };
      // Chase the player, stop at shooting range. Slide along walls: a
      // straight step into a building used to pin the NPC there forever
      // (the impound guards never reached the player), so fall back to
      // axis-separated steps when the diagonal step is blocked.
      if (dist > e.range * 0.55) {
        const nx = e.mesh.position.x + (dx / dist) * e.speed * dt;
        const nz = e.mesh.position.z + (dz / dist) * e.speed * dt;
        if (!blocked(nx, nz)) {
          e.mesh.position.x = nx;
          e.mesh.position.z = nz;
        } else if (!blocked(nx, e.mesh.position.z)) {
          e.mesh.position.x = nx;
        } else if (!blocked(e.mesh.position.x, nz)) {
          e.mesh.position.z = nz;
        }
        facePlayer();
        continue;
      }
      facePlayer();
      e.shootTimer -= dt;
      if (e.shootTimer > 0) continue;
      e.shootTimer = (e.shootInterval || 1.1) + Math.random() * 0.5;
      audio.enemyShot();
      // Hit chance falls with distance; police are worse shots.
      const hitChance = e.hitChance || (e.kind === 'police' ? 0.35 : 0.45);
      const mx = e.mesh.position.x;
      const mz = e.mesh.position.z;
      const hit = Math.random() < hitChance * (1 - dist / (e.range * 2));
      if (hit) {
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
        // v6.5 item 5: helicopter position while active, else null.
        heli: heli ? {
          x: +heli.position.x.toFixed(1),
          y: +heli.position.y.toFixed(1),
          z: +heli.position.z.toFixed(1),
        } : null,
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
      const seesPlayer = (u) => {
        if (u.dead) return false;
        const d = Math.hypot(u.mesh.position.x - px, u.mesh.position.z - pz);
        if (d >= sight) return false;
        let los = losCache.get(u);
        if (los === undefined) {
          los = hasLineOfSight(u.mesh.position.x, u.mesh.position.z, px, pz);
          losCache.set(u, los);
        }
        return los;
      };
      policeCanSee = false;
      if (wanted > 0) {
        if (gameTime - losCacheTime >= 0.25) refreshLos(px, pz);
        policeCanSee = [...police, ...policeCars].some((u) => seesPlayer(u));
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
      // v6.5 item 5: police helicopter at wanted 4-5 (never shoots, never
      // counts toward policeCanSee/escapeTimer — see updateHeli).
      updateHeli(dt);
    },
  };
}
