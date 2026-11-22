// Neon Vice — Builder C: vehicles.
// Cars (sedan + coupe), a motorbike, and a boat in the east water strip.
// E enters/exits the nearest vehicle; WASD drives (W accelerate, S brake /
// reverse, A/D steer), the camera follows the vehicle. Collisions use
// world.collides when the world provides it. Traffic cars drive along
// world.roadGraph when available, otherwise around a rectangular loop road.
// The boat only drives inside the water rect (CONFIG.water).

import { CONFIG } from './config.js';

function makeCarBody(color, kind) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.2, metalness: 0.4 });
  const bodyLen = kind === 'coupe' ? 4.2 : 4.6;
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, bodyLen), mat);
  body.position.y = 0.55;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, bodyLen * 0.45), dark);
  cabin.position.set(0, 1.15, -bodyLen * 0.05);
  group.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9 });
  for (const [wx, wz] of [[-0.95, bodyLen * 0.32], [0.95, bodyLen * 0.32], [-0.95, -bodyLen * 0.32], [0.95, -bodyLen * 0.32]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.36, wz);
    group.add(wheel);
  }
  // Headlights.
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff7cc, emissive: 0xfff2a8, emissiveIntensity: 0.9 });
  for (const lx of [-0.6, 0.6]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.1), lightMat);
    lamp.position.set(lx, 0.6, bodyLen / 2 + 0.02);
    group.add(lamp);
  }
  return group;
}

function makeBike(color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 2.0), mat);
  body.position.y = 0.7;
  group.add(body);
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.18, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9 });
  for (const wz of [0.85, -0.85]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(0, 0.34, wz);
    group.add(wheel);
  }
  return group;
}

function makeBoat(color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 5.2), mat);
  hull.position.y = 0.4;
  group.add(hull);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 2.0),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 }));
  cabin.position.set(0, 1.2, -0.4);
  group.add(cabin);
  return group;
}

export function createVehicles(scene, world) {
  const vehicles = [];
  let idCounter = 0;

  function addVehicle(kind, model, x, z, heading, opts = {}) {
    // Parked vehicles are snapped to open ground so they never spawn inside
    // one of Builder B's buildings. Boats are exempt: open ground for them
    // is water, and B's findOpenGround only returns walkable land.
    if (kind !== 'boat' && opts.parked !== false && world.findOpenGround) {
      try {
        const g = world.findOpenGround(x, z, 30);
        if (g) { x = g.x; z = g.z; }
      } catch { /* keep raw */ }
    }
    const mesh = kind === 'bike' ? makeBike(model) : kind === 'boat' ? makeBoat(model) : makeCarBody(model, kind);
    mesh.position.set(x, kind === 'boat' ? 0.15 : 0, z);
    // Parked on a flyover ramp? Sit on the ramp surface, not inside it.
    if (kind !== 'boat' && world.groundHeightAt) {
      try { mesh.position.y = world.groundHeightAt(x, z, 0); } catch { /* keep 0 */ }
    }
    mesh.rotation.y = heading;
    scene.add(mesh);
    const v = {
      id: idCounter += 1,
      kind, // 'sedan' | 'coupe' | 'bike' | 'boat'
      mesh,
      heading,
      speed: 0,
      maxSpeed: kind === 'bike' ? 34 : kind === 'boat' ? 22 : kind === 'coupe' ? 38 : 32,
      accel: kind === 'boat' ? 6 : 14,
      parked: opts.parked !== false,
      traffic: !!opts.traffic,
      missionCar: !!opts.missionCar,
      color: model,
      // Traffic state.
      path: null,
      pathIndex: 0,
      wait: 0,
    };
    vehicles.push(v);
    return v;
  }

  const W = CONFIG.world.width / 2;
  const D = CONFIG.world.depth / 2;

  // Parked vehicles near the plaza + around the map.
  addVehicle('sedan', 0xef4444, 12, 8, 0.4);
  addVehicle('coupe', 0x22d3ee, -14, 10, -0.6);
  addVehicle('bike', 0xf59e0b, 6, -12, 1.2);
  addVehicle('sedan', 0x8b5cf6, CONFIG.places.downtown.x + 8, CONFIG.places.downtown.z + 6, 0);
  addVehicle('coupe', 0x10b981, CONFIG.places.uptown.x + 10, CONFIG.places.uptown.z, 1.5);
  addVehicle('sedan', 0xec4899, CONFIG.places.airport.x + 12, CONFIG.places.airport.z + 4, -1);
  // Boat at the marina dock, just inside Builder B's water line (x > 470).
  const boat = addVehicle('boat', 0xf8fafc, 475, 120, Math.PI / 2);
  boat.parked = true;

  // Water plane (visual) over the east strip — only when Builder B's world
  // is not loaded (B's world renders its own water and exposes `boats`).
  if (!world.raw || !world.raw.boats || world.raw.boats.length === 0) {
    const waterGeo = new THREE.PlaneGeometry(CONFIG.water.x1 - CONFIG.water.x0, CONFIG.water.z1 - CONFIG.water.z0);
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x0e3a5c, roughness: 0.25, metalness: 0.4 });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.position.set((CONFIG.water.x0 + CONFIG.water.x1) / 2, 0.05, 0);
    scene.add(waterMesh);
  }

  // Traffic: 4 cars looping. With a road graph they follow real roads;
  // without it they loop a rectangle on the street grid (x=±300 and z=±120
  // are streets in Builder B's layout, so the loop stays on roads).
  const loop = [
    { x: -300, z: -120 }, { x: 300, z: -120 }, { x: 300, z: 120 }, { x: -300, z: 120 },
  ];
  const trafficColors = [0x94a3b8, 0xf97316, 0x3b82f6, 0xa3e635];
  const traffic = [];
  for (let i = 0; i < 4; i += 1) {
    const start = loop[i];
    const v = addVehicle('sedan', trafficColors[i], start.x, start.z, 0, { parked: false, traffic: true });
    v.path = loop;
    v.pathIndex = (i + 1) % loop.length;
    traffic.push(v);
  }

  function nearestVehicle(x, z, maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const v of vehicles) {
      const d = Math.hypot(v.mesh.position.x - x, v.mesh.position.z - z);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  // Car collision: the old single-point check (centre, r=1.4) let the car's
  // nose/tail (2.3 m from the centre) penetrate a building face, so a car
  // could sit with its centre in a free pocket 1-2 m from a building corner
  // — e.g. the warehouse SE corner at (42,-16) — where every forward move
  // rammed the wall and every reverse+steer arc clipped the corner, and the
  // car could not escape (mission 5 wedge, re-tester 1/3 runs). Check the
  // footprint instead: centre + nose + tail, each r=1.0 (the car's half
  // width). The car now bumps while its body is still clear of the wall,
  // so reversing out is always possible. Boats keep the water-rect check.
  // v5: y threads through so the flyover deck barriers (world.collides
  // 4th arg) block an elevated car but never ground traffic under the
  // deck. Boats pass no y (water level, barriers inactive).
  function carCollides(x, z, heading, y = 0) {
    if (!world.collides) return false;
    const sx = Math.sin(heading);
    const sz = Math.cos(heading);
    if (world.collides(x, z, 1.0, y)) return true;
    if (world.collides(x + sx * 1.7, z + sz * 1.7, 1.0, y)) return true;
    if (world.collides(x - sx * 1.7, z - sz * 1.7, 1.0, y)) return true;
    return false;
  }

  function driveVehicle(v, input, dt) {
    const isBoat = v.kind === 'boat';
    const accel = isBoat ? v.accel : v.accel;
    // Builder B v4 rev 3 — touch driving: the stick STEERS ONLY (left /
    // right). It never gives gas any more: throttle comes from the GAS
    // pedal (touch) or W (keyboard), braking from the REM pedal or S.
    // Keyboard is unchanged: W gas, S brake/reverse, A/D steer. Same
    // mapping for the bike and the boat.
    let forward = input.forward;
    let turn = input.turn;
    const stick = input.stick;
    if (stick && stick.active && Math.hypot(stick.x, stick.y) > 0.12) {
      // Stick Y is deliberately ignored while driving: pushing the stick
      // up must not move the car. Only the X axis steers.
      if (turn === 0) turn = Math.max(-1, Math.min(1, -stick.x));
    }
    if (input.gas) forward = Math.max(forward, 1);
    // v6 BUG 1: REM (touch) and S (keyboard) are the SAME control —
    // brake-then-reverse. The old REM branch braked to a full stop and
    // HELD at 0, so on touch (Ayub's phone) a car/motor could never
    // reverse at all (probe: 4 s game-time on REM, speed stayed 0.0,
    // 0.0 m moved). From forward motion both brake hard, then keep
    // going into reverse up to 45% of top speed (~40-50% of forward).
    // GAS still wins forward once REM is released.
    const braking = !!input.brake;
    if (forward > 0 && !braking) v.speed += accel * forward * dt;
    else if (braking || forward < 0) {
      if (v.speed > 0.5) v.speed -= (braking ? accel * 2.2 : accel * 1.4) * dt;
      else v.speed -= accel * 0.6 * dt;
    } else v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 8 * dt);
    v.speed = Math.max(-v.maxSpeed * 0.45, Math.min(v.maxSpeed, v.speed));
    // v6 BUG LAMA (v4): steering needs motion — at a standstill the
    // wheels cannot turn the car, so holding A/D (or the stick) with
    // speed 0 must not spin it in place (v5 probe: 0.96 rad in 2 s
    // game-time). Authority ramps with |speed| so low-speed manoeuvres
    // still steer; reversing inverts it, as before.
    const steer = turn * (v.speed >= 0 ? 1 : -1) * Math.min(1, Math.abs(v.speed) / 4);
    // Same sign as on foot (player.js): A / turn +1 raises the heading,
    // which turns the car to screen-left. (Was inverted: cars steered away
    // from the target and could never complete a driven mission.)
    // Rotation is collision-checked too: an unchecked turn can swing the
    // nose/tail INTO a wall, after which every small translation step keeps
    // a check point inside the collider zone and the car freezes in place
    // (mission-5 wedge at (318,-296): nose 0.4 m from the warehouse face,
    // no step out accepted). If the turn would put a check point inside a
    // collider, keep the old heading — the car can still reverse out and
    // turn once clear. Boats skip this (water-rect check below).
    const newHeading = v.heading + steer * (isBoat ? 1.1 : 1.9) * dt;
    if (isBoat || !world.collides || !carCollides(v.mesh.position.x, v.mesh.position.z, newHeading, v.mesh.position.y)) {
      v.heading = newHeading;
    }
    const nx = v.mesh.position.x + Math.sin(v.heading) * v.speed * dt;
    const nz = v.mesh.position.z + Math.cos(v.heading) * v.speed * dt;
    if (isBoat) {
      const w = CONFIG.water;
      v.mesh.position.x = Math.max(w.x0 + 3, Math.min(w.x1 - 3, nx));
      v.mesh.position.z = Math.max(w.z0 + 3, Math.min(w.z1 - 3, nz));
    } else if (world.collides && carCollides(nx, nz, v.heading, v.mesh.position.y)) {
      v.speed *= -0.25; // bump: kill speed, small bounce
    } else {
      const clamped = world.clamp(nx, nz);
      v.mesh.position.x = clamped.x;
      v.mesh.position.z = clamped.z;
    }
    v.mesh.rotation.y = v.heading;
    // Builder B v4 rev 6: ride the flyover profile (ramps/deck) — lerped
    // so driving off a deck edge drops instead of teleporting down.
    if (isBoat) {
      v.mesh.position.y = 0.15 + Math.sin(Date.now() * 0.001 + v.id) * 0.05;
    } else if (world.groundHeightAt) {
      const gy = world.groundHeightAt(v.mesh.position.x, v.mesh.position.z, v.mesh.position.y);
      v.mesh.position.y += (gy - v.mesh.position.y) * Math.min(1, 12 * dt);
    } else {
      v.mesh.position.y = 0;
    }
  }

  // Fresh graph route from the car's current position. The car drives to
  // path[0] (the nearest node) FIRST: steering straight at path[1] from
  // mid-street cuts the corner across blocks — the car ends up off-road,
  // beelining diagonally, and wedges on a building.
  // v6.1: inside a flyover corridor (|x-fx| < 15, |z| < 70 — the same
  // box the traffic probe watches). Used to suppress random re-paths
  // there (see below).
  function nearFlyover(v) {
    if (!world.flyovers) return false;
    for (const f of world.flyovers) {
      if (Math.abs(v.mesh.position.x - f.x) < 15 && Math.abs(v.mesh.position.z - f.z) < 70) return true;
    }
    return false;
  }

  function repathStock(v) {
    if (!world.roadGraph || !world.roadGraph.findPath) return false;
    try {
      const p = world.roadGraph.findPath(
        { x: v.mesh.position.x, z: v.mesh.position.z },
        { x: (Math.random() - 0.5) * 800, z: (Math.random() - 0.5) * 600 },
      );
      if (Array.isArray(p) && p.length > 1) {
        v.path = p;
        v.pathIndex = 0;
        return true;
      }
    } catch { /* keep the loop */ }
    return false;
  }

  // v6.1 unstuck: a traffic car that cannot move (displacement < 6 m)
  // for 15 s of game time is teleported to the nearest point on a road
  // centreline and re-pathed. This is the backstop for any wedge
  // anywhere on the map — no traffic car may freeze forever.
  // 15 s, not 10: a legitimate wait is bounded by the 20 s signal cycle
  // (red at most 10 s) plus a few seconds of queue drain, and the
  // timer is POSITION-only on purpose — run 2 proved a hold-aware
  // timer never fires, because a wedged car interleaves red-light /
  // queue holds with blocked reverse steps, and every hold reset the
  // clock. A car that has not moved 6 m in 15 s is stuck, held or not.
  function unstickCar(v) {
    const graph = world.roadGraph;
    let tx = v.mesh.position.x;
    let tz = v.mesh.position.z;
    if (graph && graph.nearestOnRoad) {
      try {
        const near = graph.nearestOnRoad(tx, tz);
        if (near) { tx = near.x; tz = near.z; }
      } catch { /* keep position */ }
    }
    // Centreline points are clear by construction; if one ever is not,
    // fall back to open ground so the car is never teleported into a wall.
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
    repathStock(v);
  }

  // v6.1: still-time tracking for one car. Call at the top of the
  // per-car update, before any early return. Position-only: the timer
  // accumulates whenever the car has moved < 6 m from its window
  // anchor, whether it is reversing, held, or colliding — a wedged car
  // interleaves all three, so any hold-aware pause/reset lets it sit
  // forever (run 2). 6 m, not 1 m: a wedged car BOUNCES ~4 m back and
  // forth (forward-blocked, reverse 3.2 m, repeat — run 3: id=11
  // z 47.6 <-> 51.7), and a 1 m anchor resets on every bounce. 6 m is
  // above the bounce amplitude and below real progress (a car at a red
  // light moves > 6 m within ~2 s of green). Teleports the car (via
  // unstickCar) at 15 s — inside the probe's 20 s window, so a flagged
  // car always recovers and drives on within the window.
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

  function updateTraffic(dt, driven) {
    for (const v of traffic) {
      // The player stole this one: driveVehicle owns it, not the AI
      // (and the unstuck must never teleport a car Vera is driving).
      if (driven && v === driven) continue;
      trackStill(v, dt);
      // Backing out of a wedge (same as the ambient cars): reverse along
      // the way the car came instead of retrying a blocked beeline.
      if (v.reverse > 0) {
        v.reverse -= dt;
        const bx = v.mesh.position.x - Math.sin(v.heading) * 4 * dt;
        const bz = v.mesh.position.z - Math.cos(v.heading) * 4 * dt;
        // v6.1: the escape check uses the FOOTPRINT (carCollides, r=1.0)
        // and the height AT THE DESTINATION. The old single-point r=1.4
        // check with the car's CURRENT (elevated) y blocked the reverse
        // step itself on a flyover ramp: the car could neither go forward
        // nor back, and sat at speed -4 forever. Backing down the ramp
        // drops the destination height below the 1.5 m barrier gate, so
        // the car now always escapes downhill.
        const by = world.groundHeightAt
          ? world.groundHeightAt(bx, bz, v.mesh.position.y) : v.mesh.position.y;
        if (!world.collides || !carCollides(bx, bz, v.heading, by)) {
          v.mesh.position.x = bx;
          v.mesh.position.z = bz;
        } else {
          v.reverse = 0;
        }
        v.speed = -4;
        v.mesh.rotation.y = v.heading;
        continue;
      }
      if (v.wait > 0) {
        v.wait -= dt;
        continue;
      }
      let target = v.path[v.pathIndex];
      // Use the road graph when the world has one: re-path occasionally —
      // but only from a node, never mid-street (see repathStock).
      // v6.1: never re-path at random while ELEVATED (y > 0.5 — on a ramp
      // or the deck). A random re-route mid-crossing could turn a
      // straight-through car west/east at the node while it was still on
      // the deck, steering it into the deck-edge barrier (baseline probe:
      // id=9 froze 20 s on the deck at (301.25, 6, -2.14) exactly this
      // way). The car keeps its route until it is back on the ground.
      // And never at random inside a flyover CORRIDOR either: a re-path
      // at the ramp foot can pick the node BEHIND the car (nearest-node
      // tie, 60 m from both nodes) and U-turn it back over the deck —
      // a round trip the probe flags as stuck even though the car never
      // stops (run 4: id=9 south over the deck, U-turn at (300.78,60.19),
      // back north, disp 2.27 m in 20 s). The car keeps its route until
      // it has left the corridor.
      if (v.mesh.position.y < 0.5 && !nearFlyover(v) && Math.random() < 0.002) {
        if (repathStock(v)) target = v.path[v.pathIndex];
      }
      // v6: at a flyover intersection steer for the lane the car must use
      // (world.laneTarget: flyover lane straight over, surface lane to
      // turn). The red-light check below still uses the raw node — except
      // a straight NS crossing passes OVER the intersection, so it never
      // meets the signal (viaFlyover skips the hold).
      const prev = v.pathIndex > 0 ? v.path[v.pathIndex - 1] : null;
      const next = v.pathIndex + 1 < v.path.length ? v.path[v.pathIndex + 1] : null;
      const steer = world.laneTarget
        ? world.laneTarget(target, prev, next)
        : { x: target.x, z: target.z, viaFlyover: false };
      // v6.1: never TURN while ELEVATED on a flyover (y > 0.5 — on a
      // ramp or the deck). A car routed to a turn at the node while it
      // is still climbing, or re-pathed mid-deck, steers diagonally
      // across the 6 m deck; its nose swings into the deck-edge barrier
      // and the footprint check wedges it (probe run 2: ambient cars
      // froze ~20 s on the deck at (61.46,6,3.74) and (298.57,6,3.69)).
      // While elevated, force the straight-through flyover lane in the
      // car's current travel direction (viaFlyover, so the signal hold
      // below is skipped too — the car is OVER the intersection). The
      // turn is deferred to the next intersection; the car just detours.
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
      // Red light + anti-pileup (same rules as the ambient cars): stop
      // before a signalised arterial intersection on red, crawl on yellow,
      // and never drive into the vehicle ahead.
      let hold = false;
      let cap = Infinity;
      const graph = world.roadGraph;
      if (graph && graph.arterialNodeNear && !steerTarget.viaFlyover) {
        const node = graph.arterialNodeNear(target.x, target.z, 3);
        if (node && dist < 22) {
          const axis = Math.abs(dx) > Math.abs(dz) ? 'EW' : 'NS';
          const state = graph.trafficLight(axis);
          if (state === 'red') hold = true;
          else if (state === 'yellow') cap = 3;
        }
      }
      if (!hold) {
        const fx = Math.sin(v.heading);
        const fz = Math.cos(v.heading);
        for (const o of vehicles) {
          // Traffic cars going the same direction only: parked / mission /
          // driven cars and opposite-direction cars are excluded — holding
          // for them deadlocks (a mission car never moves; a head-on car
          // waits for you while you wait for it).
          // v6.1: height guard — a car on the deck (y≈6) is NOT in the
          // way of ground traffic underneath it, and vice versa. Without
          // it a ground car queues forever behind a deck car 7 m ahead
          // in 2D (probe run 2: id=1017 froze 20 s at (54.45,0,0) behind
          // id=1016 on the deck above it).
          if (o === v || !o.traffic) continue;
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
        continue;
      }
      if (dist < 6) {
        v.pathIndex = (v.pathIndex + 1) % v.path.length;
        continue;
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
      // Same steering as the ambient cars (their loop measured 0 off-road
      // samples): the old 12 m/s + 1.4 rad/s cap swung wide over every
      // 90-degree corner, and once off the road the car beelined across
      // blocks toward the next node instead of following the graph — car 11
      // sat off-road 27/30 samples and barely moved. Slow for turns and
      // near nodes (4 m/s), steer up to 2.5 rad/s, cruise at 10 m/s; a car
      // that ever does end up off-road (e.g. abandoned by the player
      // mid-block) crawls at 4 m/s back to the nearest node.
      v.heading += Math.max(-2.5 * dt, Math.min(2.5 * dt, diff));
      let wantSpeed = (Math.abs(diff) > 0.5 || dist < 14) ? 4 : 10;
      // v6.1: a straight flyover crossing steers for a 3 m lane whose
      // centre is 1.5 m from the road centreline and only 0.2 m (at the
      // car's real half-width) from the deck barrier — cap the approach
      // at 6 m/s so the coarse SwiftShader steps track the lane centre
      // instead of overshooting into the barrier.
      if (steerTarget.viaFlyover) wantSpeed = Math.min(wantSpeed, 6);
      if (graph && graph.isOnRoad && !graph.isOnRoad(v.mesh.position.x, v.mesh.position.z)) {
        wantSpeed = Math.min(wantSpeed, 4);
      }
      v.speed += Math.sign(wantSpeed - v.speed) * Math.min(Math.abs(wantSpeed - v.speed), 8 * dt);
      if (cap < Infinity) v.speed = Math.min(v.speed, cap);
      const nx = v.mesh.position.x + Math.sin(v.heading) * v.speed * dt;
      const nz = v.mesh.position.z + Math.cos(v.heading) * v.speed * dt;
      // v6.1: footprint check (carCollides: centre + nose + tail, r=1.0)
      // with the height AT THE DESTINATION, not the single-point r=1.4
      // check with the current y. Root cause of the v6 ramp wedge: the
      // flyover lane centre is 1.5 m from the centreline and the deck
      // barrier starts at 2.7 m, so 1.5 + 1.4 = 2.9 already overlaps the
      // barrier — a perfectly centred car collided once y passed the
      // 1.5 m gate. With the real half-width (1.0) the centred car
      // clears it by 0.2 m (1.5 + 1.0 = 2.5 < 2.7).
      const ny = world.groundHeightAt
        ? world.groundHeightAt(nx, nz, v.mesh.position.y) : v.mesh.position.y;
      if (world.collides && carCollides(nx, nz, v.heading, ny)) {
        v.reverse = 0.8; // back out of the wedge, then take a fresh route
        v.speed = -4;
        repathStock(v);
      } else {
        v.mesh.position.x = nx;
        v.mesh.position.z = nz;
      }
      v.mesh.rotation.y = v.heading;
    }
  }

  return {
    list: vehicles,
    traffic,
    boat,
    nearestVehicle,
    driveVehicle,
    addVehicle,
    update(dt, driven) {
      updateTraffic(dt, driven);
      return driven;
    },
  };
}
