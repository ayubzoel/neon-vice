// Neon Vice — scaffold v1: the world is flat ground, sky and light only.
// No buildings, roads or missions yet: those are Builder B/C's job. What this
// file owns: a ground plane the player can read motion against (procedural
// canvas grid, no downloaded texture), a lighter plaza disc at the spawn, four
// neon corner pylons so the empty field still has depth cues, and the bounds
// the player is clamped to.

import { CONFIG } from './config.js';

// Draw a 512x512 tile: dark ground with one grid line per edge, so a repeat
// of 30 m reads as a measuring grid from the third-person camera.
function makeGroundTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3a3f46';
  ctx.fillRect(0, 0, size, size);
  // Faint speckle so the ground is not one flat colour up close.
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let i = 0; i < 900; i++) {
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  ctx.strokeStyle = '#565d68';
  ctx.lineWidth = 3;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(CONFIG.world.width / 30, CONFIG.world.depth / 30);
  texture.anisotropy = 4;
  return texture;
}

export function createWorld(scene) {
  scene.background = new THREE.Color(CONFIG.colors.sky);
  scene.fog = new THREE.Fog(CONFIG.colors.fog, 250, 1600);

  // Light: hemisphere for soft ambient + one directional sun. No shadows in
  // the scaffold (keeps the frame cheap); Builder B/C can enable them.
  const hemi = new THREE.HemisphereLight(0xdff1ff, 0x3a3f46, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d9, 1.1);
  sun.position.set(120, 180, 60);
  scene.add(sun);

  // Flat ground, 1200 x 900 m, centred on the spawn.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.world.width, CONFIG.world.depth),
    new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 0);
  scene.add(ground);

  // Lighter concrete plaza disc at the spawn.
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(CONFIG.world.plazaRadius, 48),
    new THREE.MeshStandardMaterial({ color: CONFIG.colors.plaza, roughness: 0.9, metalness: 0 }),
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(0, 0.02, 0);
  scene.add(plaza);

  // Four neon pylons at the plaza corners: pure depth cues, not buildings.
  const pylonGeo = new THREE.BoxGeometry(1.2, 14, 1.2);
  const pylonMat = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.pylon,
    emissive: CONFIG.colors.pylon,
    emissiveIntensity: 0.55,
    roughness: 0.4,
  });
  for (const [px, pz] of [
    [-30, -30],
    [30, -30],
    [-30, 30],
    [30, 30],
  ]) {
    const pylon = new THREE.Mesh(pylonGeo, pylonMat);
    pylon.position.set(px, 7, pz);
    scene.add(pylon);
  }

  return {
    ground,
    // Clamp a position inside the playable field (minus the hero radius).
    clamp(x, z) {
      const halfW = CONFIG.world.width / 2 - CONFIG.player.radius;
      const halfD = CONFIG.world.depth / 2 - CONFIG.player.radius;
      return {
        x: Math.max(-halfW, Math.min(halfW, x)),
        z: Math.max(-halfD, Math.min(halfD, z)),
      };
    },
  };
}
