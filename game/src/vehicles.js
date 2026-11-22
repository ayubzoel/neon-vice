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
    // REM pedal: brake to a full stop and HOLD at 0 — it never reverses
    // (there is no reverse pedal on touch; S on the keyboard still
    // brakes-then-reverses, as before).
    const braking = !!input.brake;
    if (braking) {
      v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), v.accel * 2.2 * dt);
      if (Math.abs(v.speed) < 0.05) v.speed = 0;
    } else if (forward > 0) v.speed += accel * forward * dt;
    else if (forward < 0) v.speed -= (v.speed > 0.5 ? accel * 1.4 : accel * 0.6) * Math.abs(forward) * dt;
    else v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 8 * dt);
    v.speed = Math.max(-v.maxSpeed * 0.35, Math.min(v.maxSpeed, v.speed));
    const steer = turn * (v.speed >= 0 ? 1 : -1) * Math.min(1, Math.abs(v.speed) / 6 + 0.25);
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

  function updateTraffic(dt) {
    for (const v of traffic) {
      // Backing out of a wedge (same as the ambient cars): reverse along
      // the way the car came instead of retrying a blocked beeline.
      if (v.reverse > 0) {
        v.reverse -= dt;
        const bx = v.mesh.position.x - Math.sin(v.heading) * 4 * dt;
        const bz = v.mesh.position.z - Math.cos(v.heading) * 4 * dt;
        if (!world.collides || !world.collides(bx, bz, 1.4, v.mesh.position.y)) {
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
      if (Math.random() < 0.002) {
        if (repathStock(v)) target = v.path[v.pathIndex];
      }
      const dx = target.x - v.mesh.position.x;
      const dz = target.z - v.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      // Red light + anti-pileup (same rules as the ambient cars): stop
      // before a signalised arterial intersection on red, crawl on yellow,
      // and never drive into the vehicle ahead.
      let hold = false;
      let cap = Infinity;
      const graph = world.roadGraph;
      if (graph && graph.arterialNodeNear) {
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
          if (o === v || !o.traffic) continue;
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
      const targetHeading = Math.atan2(dx, dz);
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
      if (graph && graph.isOnRoad && !graph.isOnRoad(v.mesh.position.x, v.mesh.position.z)) {
        wantSpeed = Math.min(wantSpeed, 4);
      }
      v.speed += Math.sign(wantSpeed - v.speed) * Math.min(Math.abs(wantSpeed - v.speed), 8 * dt);
      if (cap < Infinity) v.speed = Math.min(v.speed, cap);
      const nx = v.mesh.position.x + Math.sin(v.heading) * v.speed * dt;
      const nz = v.mesh.position.z + Math.cos(v.heading) * v.speed * dt;
      if (world.collides && world.collides(nx, nz, 1.4, v.mesh.position.y)) {
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
      updateTraffic(dt);
      return driven;
    },
  };
}
