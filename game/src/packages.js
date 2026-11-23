// Neon Vice v6.5 item 2 — hidden money packages. 20 spots: 4 median
// gardens (v6.4), 4 corner gardens (v6.3), 2 Taman Merdeka, 10 near
// landmarks (just outside the footprint, snapped to open ground at
// build). Walk-over pickup (radius 2.2 m), $100 each, HUD counter,
// saved in the game save (autosaves on every pickup).

// Median gardens: flyovers at x=60 and x=300, strips x±3, walkable z ±[10,38].
// Corner gardens (v6.3 FLYOVER_GARDENS centres): (39,21) (78,78) (279,-21) (330,42).
export const PACKAGE_SPOTS = [
  // Median gardens sit behind a hedge with ONE gap per segment (gap at
  // z=±35 on the east side, v6.4): the packages sit right at the gap
  // mouth, on the garden path, so a player walking in through the gap
  // meets them at once — a package deeper in the strip (z=±24) is
  // unreachable from outside without threading the hedge. The gap
  // itself holds a 0.6 m bollard at its centre, so the packages sit at
  // z=±33.75 — the centre of the 1.9 m sub-gap — never on the bollard line.
  { id: 'median-60-n', x: 60, z: 33.75, label: 'Median Garden' },
  { id: 'median-60-s', x: 60, z: -33.75, label: 'Median Garden' },
  { id: 'median-300-n', x: 300, z: 33.75, label: 'Median Garden' },
  { id: 'median-300-s', x: 300, z: -33.75, label: 'Median Garden' },
  { id: 'garden-ne', x: 39, z: 21, label: 'Flyover Garden' },
  { id: 'garden-se', x: 78, z: 78, label: 'Flyover Garden' },
  { id: 'garden-nw', x: 279, z: -21, label: 'Flyover Garden' },
  { id: 'garden-sw', x: 330, z: 42, label: 'Flyover Garden' },
  { id: 'park-1', x: -240, z: 180, label: 'Taman Merdeka' },
  { id: 'park-2', x: -210, z: 210, label: 'Taman Merdeka' },
  { id: 'rs-umum', x: -480, z: 322, label: 'RS Umum Vice' },
  { id: 'masjid-nur', x: -120, z: 322, label: 'Masjid Al-Nur' },
  { id: 'gereja-maria', x: -480, z: -278, label: 'Gereja St. Maria' },
  { id: 'polsek-downtown', x: -240, z: -38, label: 'Polsek Downtown' },
  { id: 'kuil-harbor', x: 120, z: -278, label: 'Kuil Dewi Harbor' },
  { id: 'rs-harbor', x: 120, z: -158, label: 'RS Harbor' },
  { id: 'masjid-pantai', x: 120, z: 322, label: 'Masjid Pantai' },
  { id: 'vihara-lotus', x: 240, z: 202, label: 'Vihara Lotus' },
  { id: 'rs-pantai', x: 120, z: 82, label: 'RS Pantai' },
  { id: 'polsek-beach', x: 0, z: 322, label: 'Polsek Beach' },
];

export const PACKAGE_VALUE = 100; // $ per package, same for all 20
export const PACKAGE_PICKUP_RADIUS = 2.2; // walk over it — no key needed

export function createPackages(scene, world, ctx) {
  const collected = new Set();
  const dummy = new THREE.Object3D();
  // Snap every spot onto walkable open ground (never inside a wall).
  const spots = PACKAGE_SPOTS.map((s) => {
    let p = { x: s.x, z: s.z };
    try {
      const g = world.findOpenGround ? world.findOpenGround(s.x, s.z, 12) : null;
      if (g && typeof g.x === 'number') p = { x: g.x, z: g.z };
    } catch { /* keep the nominal spot */ }
    return { ...s, x: p.x, z: p.z };
  });
  // One instanced gold box per package + one instanced ground disc:
  // 2 draw calls total however many packages there are.
  const boxGeo = new THREE.BoxGeometry(0.7, 0.5, 0.7);
  const boxMat = new THREE.MeshBasicMaterial({ color: 0xffd400 });
  const boxes = new THREE.InstancedMesh(boxGeo, boxMat, spots.length);
  const discGeo = new THREE.CircleGeometry(1.1, 24);
  const discMat = new THREE.MeshBasicMaterial({
    color: 0x22ff88, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false,
  });
  const discs = new THREE.InstancedMesh(discGeo, discMat, spots.length);
  discs.renderOrder = 1;
  function placeInstance(i, visible, time) {
    const s = spots[i];
    if (!visible) {
      dummy.position.set(0, -50, 0);
      dummy.scale.set(0.001, 0.001, 0.001);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      boxes.setMatrixAt(i, dummy.matrix);
      discs.setMatrixAt(i, dummy.matrix);
      return;
    }
    const bob = 0.55 + Math.sin(time * 2 + i * 1.3) * 0.15;
    dummy.position.set(s.x, bob, s.z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, time * 0.8 + i, 0);
    dummy.updateMatrix();
    boxes.setMatrixAt(i, dummy.matrix);
    dummy.position.set(s.x, 0.06, s.z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.updateMatrix();
    discs.setMatrixAt(i, dummy.matrix);
  }
  spots.forEach((_, i) => placeInstance(i, true, 0));
  boxes.instanceMatrix.needsUpdate = true;
  discs.instanceMatrix.needsUpdate = true;
  // Instanced meshes need a correct bounding sphere (Neon Bay v7 lesson).
  for (const m of [boxes, discs]) {
    if (m.geometry) {
      m.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2000);
      m.frustumCulled = false;
    }
  }
  scene.add(boxes);
  scene.add(discs);

  let time = 0;
  function refreshHud() {
    if (ctx.ui && ctx.ui.setPackages) ctx.ui.setPackages(collected.size, spots.length);
  }
  refreshHud(); // HUD shows 0/20 from the first frame, not after pickup 1
  function collect(i) {
    const s = spots[i];
    collected.add(s.id);
    placeInstance(i, false, time);
    boxes.instanceMatrix.needsUpdate = true;
    discs.instanceMatrix.needsUpdate = true;
    ctx.addMoney(PACKAGE_VALUE);
    if (ctx.audio && ctx.audio.chime) ctx.audio.chime();
    if (ctx.onMessage) ctx.onMessage(`+$${PACKAGE_VALUE} — ${ctx.ui ? ctx.ui.t('packages') : 'Packages'} ${collected.size}/${spots.length}`);
    refreshHud();
    if (ctx.onCollect) ctx.onCollect();
  }
  return {
    // Live snapshot (a getter, not a creation-time copy): after a
    // save+reload the collected flags must reflect the loaded state.
    get spots() { return spots.map((s) => ({ id: s.id, x: s.x, z: s.z, label: s.label, collected: collected.has(s.id) })); },
    get collectedCount() { return collected.size; },
    get total() { return spots.length; },
    update(dt) {
      time += dt;
      const p = ctx.player.group.position;
      let changed = false;
      for (let i = 0; i < spots.length; i++) {
        if (collected.has(spots[i].id)) continue;
        placeInstance(i, true, time);
        changed = true;
        const d = Math.hypot(p.x - spots[i].x, p.z - spots[i].z);
        if (d < PACKAGE_PICKUP_RADIUS) collect(i);
      }
      if (changed) { boxes.instanceMatrix.needsUpdate = true; discs.instanceMatrix.needsUpdate = true; }
    },
    getState() { return { collected: [...collected] }; },
    setState(saved) {
      collected.clear();
      if (saved && Array.isArray(saved.collected)) {
        for (const id of saved.collected) collected.add(id);
      }
      spots.forEach((s, i) => placeInstance(i, !collected.has(s.id), time));
      boxes.instanceMatrix.needsUpdate = true;
      discs.instanceMatrix.needsUpdate = true;
      refreshHud();
    },
  };
}
