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
    const mesh = kind === 'bike' ? makeBike(model) : kind === 'boat' ? makeBoat(model) : makeCarBody(model, kind);
    mesh.position.set(x, kind === 'boat' ? 0.15 : 0, z);
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
  // Boat at the marina dock.
  const boat = addVehicle('boat', 0xf8fafc, 530, 120, Math.PI / 2);
  boat.parked = true;

  // Water plane (visual) over the east strip so the boat reads as on water.
  const waterGeo = new THREE.PlaneGeometry(CONFIG.water.x1 - CONFIG.water.x0, CONFIG.water.z1 - CONFIG.water.z0);
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x0e3a5c, roughness: 0.25, metalness: 0.4 });
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.set((CONFIG.water.x0 + CONFIG.water.x1) / 2, 0.05, 0);
  scene.add(waterMesh);

  // Traffic: 4 cars looping. With a road graph they follow real roads;
  // without it they loop a rectangle around the plaza.
  const loop = [
    { x: -200, z: -150 }, { x: 200, z: -150 }, { x: 200, z: 150 }, { x: -200, z: 150 },
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

  function driveVehicle(v, input, dt) {
    const isBoat = v.kind === 'boat';
    const accel = isBoat ? v.accel : v.accel;
    if (input.forward > 0) v.speed += accel * dt;
    else if (input.forward < 0) v.speed -= (v.speed > 0.5 ? accel * 1.4 : accel * 0.6) * dt;
    else v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 8 * dt);
    v.speed = Math.max(-v.maxSpeed * 0.35, Math.min(v.maxSpeed, v.speed));
    const steer = input.turn * (v.speed >= 0 ? 1 : -1) * Math.min(1, Math.abs(v.speed) / 6 + 0.25);
    v.heading -= steer * (isBoat ? 1.1 : 1.9) * dt;
    const nx = v.mesh.position.x + Math.sin(v.heading) * v.speed * dt;
    const nz = v.mesh.position.z + Math.cos(v.heading) * v.speed * dt;
    if (isBoat) {
      const w = CONFIG.water;
      v.mesh.position.x = Math.max(w.x0 + 3, Math.min(w.x1 - 3, nx));
      v.mesh.position.z = Math.max(w.z0 + 3, Math.min(w.z1 - 3, nz));
    } else if (world.collides && world.collides(nx, nz, 1.4)) {
      v.speed *= -0.25; // bump: kill speed, small bounce
    } else {
      const clamped = world.clamp(nx, nz);
      v.mesh.position.x = clamped.x;
      v.mesh.position.z = clamped.z;
    }
    v.mesh.rotation.y = v.heading;
    v.mesh.position.y = isBoat ? 0.15 + Math.sin(Date.now() * 0.001 + v.id) * 0.05 : 0;
  }

  function updateTraffic(dt) {
    for (const v of traffic) {
      if (v.wait > 0) {
        v.wait -= dt;
        continue;
      }
      let target = v.path[v.pathIndex];
      // Use the road graph when the world has one: re-path occasionally.
      if (world.roadGraph && world.roadGraph.findPath && Math.random() < 0.002) {
        try {
          const p = world.roadGraph.findPath(
            { x: v.mesh.position.x, z: v.mesh.position.z },
            { x: (Math.random() - 0.5) * 800, z: (Math.random() - 0.5) * 600 },
          );
          if (Array.isArray(p) && p.length > 1) {
            v.path = p;
            v.pathIndex = 1;
            target = v.path[1];
          }
        } catch { /* keep the loop */ }
      }
      const dx = target.x - v.mesh.position.x;
      const dz = target.z - v.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 6) {
        v.pathIndex = (v.pathIndex + 1) % v.path.length;
        continue;
      }
      const targetHeading = Math.atan2(dx, dz);
      let diff = targetHeading - v.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      v.heading += Math.max(-1.4 * dt, Math.min(1.4 * dt, diff));
      v.speed = Math.min(v.speed + 8 * dt, 12);
      const nx = v.mesh.position.x + Math.sin(v.heading) * v.speed * dt;
      const nz = v.mesh.position.z + Math.cos(v.heading) * v.speed * dt;
      if (world.collides && world.collides(nx, nz, 1.4)) {
        v.wait = 1.5; // blocked: pause, then the loop re-paths past it
        v.speed = 0;
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
