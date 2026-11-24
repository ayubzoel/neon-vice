// Neon Vice — hidden money packages: 20 spots to find on foot.
//
// Four sit in the median gardens, four in the corner gardens, two in
// Taman Merdeka, and ten tucked just outside landmark footprints. Walk
// over one (radius 2.2 m) to pick it up: $100 each, a HUD counter, and
// the collection is stored in the game save — every pickup autosaves,
// so quitting right after a grab still keeps it.

const SPOT_ROWS = [
  ["median-60-n", 60, 33.75, "Median Garden"],
  ["median-60-s", 60, -33.75, "Median Garden"],
  ["median-300-n", 300, 33.75, "Median Garden"],
  ["median-300-s", 300, -33.75, "Median Garden"],
  ["garden-ne", 39, 21, "Flyover Garden"],
  ["garden-se", 78, 78, "Flyover Garden"],
  ["garden-nw", 279, -21, "Flyover Garden"],
  ["garden-sw", 330, 42, "Flyover Garden"],
  ["park-1", -240, 180, "Taman Merdeka"],
  ["park-2", -210, 210, "Taman Merdeka"],
  ["rs-umum", -480, 322, "RS Umum Vice"],
  ["masjid-nur", -120, 322, "Masjid Al-Nur"],
  ["gereja-maria", -480, -278, "Gereja St. Maria"],
  ["polsek-downtown", -240, -38, "Polsek Downtown"],
  ["kuil-harbor", 120, -278, "Kuil Dewi Harbor"],
  ["rs-harbor", 120, -158, "RS Harbor"],
  ["masjid-pantai", 120, 322, "Masjid Pantai"],
  ["vihara-lotus", 240, 202, "Vihara Lotus"],
  ["rs-pantai", 120, 82, "RS Pantai"],
  ["polsek-beach", 0, 322, "Polsek Beach"],
];

const PACKAGE_SPOTS = SPOT_ROWS.map(([id, x, z, label]) => ({ id, x, z, label }));
const PACKAGE_VALUE = 100; // $ per package, same for all 20
const PACKAGE_PICKUP_RADIUS = 2.2; // walk over it — no key needed

// Scratch math reused for every instance pose (no per-frame allocation).
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);
const _tiny = new THREE.Vector3(0.001, 0.001, 0.001);

function stampInto(mesh, i, x, y, z, yaw, tiltX, scaleVec) {
  _e.set(tiltX, yaw, 0);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _m.compose(_p, _q, scaleVec);
  mesh.setMatrixAt(i, _m);
}

function createPackages(scene, world, ctx) {
  const taken = new Set();
  // Snap every spot onto walkable open ground, never inside a wall.
  const spots = PACKAGE_SPOTS.map((spot) => {
    let at = { x: spot.x, z: spot.z };
    try {
      const g =
        typeof world.findOpenGround === "function"
          ? world.findOpenGround(spot.x, spot.z, 12)
          : null;
      if (g && typeof g.x === "number") at = { x: g.x, z: g.z };
    } catch (ignored) { /* keep the nominal spot */ }
    return { ...spot, x: at.x, z: at.z };
  });
  // One instanced gold box per package plus one instanced ground disc,
  // so the whole set costs 2 draw calls no matter how many there are.
  const boxes = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.7, 0.5, 0.7),
    new THREE.MeshBasicMaterial({ color: 0xFFD400 }),
    spots.length,
  );
  const discs = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1.1, 24),
    new THREE.MeshBasicMaterial({ color: 0x22FF88, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    spots.length,
  );
  Object.assign(discs, { renderOrder: 1 });

  function placeInstance(index, shown, t) {
    if (!shown) {
      stampInto(boxes, index, 0, -50, 0, 0, 0, _tiny);
      stampInto(discs, index, 0, -50, 0, 0, 0, _tiny);
      return;
    }
    const spot = spots[index];
    const bob = Math.sin(t * 2 + index * 1.3) * 0.15 + 0.55;
    stampInto(boxes, index, spot.x, bob, spot.z, index + t * 0.8, 0, _one);
    stampInto(discs, index, spot.x, 0.06, spot.z, 0, -Math.PI / 2, _one);
  }

  function markDirty() {
    for (const mesh of [boxes, discs]) mesh.instanceMatrix.needsUpdate = true;
  }

  for (let i = 0; i < spots.length; i++) placeInstance(i, true, 0);
  markDirty();
  // Keep instanced meshes drawable at any camera distance: give each
  // geometry a huge bounding sphere and switch off frustum culling
  // (a Neon Bay v7 lesson — culled packages vanished at the map edge).
  for (const mesh of [boxes, discs]) {
    if (mesh.geometry) {
      mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2000);
      Object.assign(mesh, { frustumCulled: false });
    }
  }
  scene.add(boxes, discs);

  let clock = 0;
  function pushHud() {
    if (ctx.ui && ctx.ui.setPackages) {
      ctx.ui.setPackages(taken.size, spots.length);
    }
  }
  pushHud(); // counter reads 0/20 from frame one, not after the first grab

  function collect(index) {
    const spot = spots[index];
    taken.add(spot.id);
    placeInstance(index, false, clock);
    markDirty();
    const grant = (n) => ctx.addMoney(n);
    grant(PACKAGE_VALUE);
    ctx.audio?.chime?.();
    if (ctx.onMessage) {
      const word = ctx.ui ? ctx.ui.t("packages") : "Packages";
      ctx.onMessage(`+$${PACKAGE_VALUE} — ${word} ${taken.size}/${spots.length}`);
    }
    pushHud();
    if (typeof ctx.onCollect === "function") ctx.onCollect();
  }

  return {
    // The snapshot is computed live on every read, never frozen at
    // build time: after a save+reload the flags must show the loaded
    // state, not the state from when the level was created.
    get spots() {
      return spots.map((spot) => ({
        id: spot.id,
        x: spot.x,
        z: spot.z,
        label: spot.label,
        collected: taken.has(spot.id),
      }));
    },
    get collectedCount() {
      return taken.size;
    },
    get total() {
      return spots.length;
    },
    update(step) {
      clock += step;
      const { x: px, z: pz } = ctx.player.group.position;
      let moved = false;
      for (let index = 0; index < spots.length; index++) {
        if (taken.has(spots[index].id)) continue;
        placeInstance(index, true, clock);
        moved = true;
        const d = Math.hypot(px - spots[index].x, pz - spots[index].z);
        if (d < PACKAGE_PICKUP_RADIUS) collect(index);
      }
      if (moved) markDirty();
    },
    getState() { // save shape: just the list of taken ids
      return { collected: [...taken] };
    },
    setState(saved) { // restore the taken ids after a load
      taken.clear();
      const ids = saved && saved.collected;
      if (Array.isArray(ids)) {
        for (const id of ids) taken.add(id);
      }
      spots.forEach((spot, i) => placeInstance(i, !taken.has(spot.id), clock));
      markDirty();
      pushHud();
    },
  };
}

export { PACKAGE_SPOTS, PACKAGE_VALUE, PACKAGE_PICKUP_RADIUS, createPackages };
