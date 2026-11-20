// Neon Vice — scaffold v1: the placeholder hero. Three boxes (body, head,
// hair) in a THREE.Group — deliberately a mannequin, not a character model.
// Movement is heading-based: W / stick-up walks forward along the heading,
// A/D (stick X) turn the heading, Shift / RUN sprints. The camera sits behind
// the heading, so W is always "up the screen". Builder B/C replaces this
// mannequin with a real model and camera-relative movement if wanted.

import { CONFIG } from './config.js';

export function createPlayer(scene) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.1, 0.42),
    new THREE.MeshStandardMaterial({ color: CONFIG.colors.heroBody, roughness: 0.7 }),
  );
  body.position.y = 0.95;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.46, 0.42),
    new THREE.MeshStandardMaterial({ color: CONFIG.colors.heroHead, roughness: 0.6 }),
  );
  head.position.y = 1.75;
  group.add(head);

  const hair = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.16, 0.46),
    new THREE.MeshStandardMaterial({ color: CONFIG.colors.heroHair, roughness: 0.9 }),
  );
  hair.position.y = 2.0;
  group.add(hair);

  // A small nose marker on the front (+Z is the facing direction after the
  // group rotation is applied) so the facing direction reads at a glance.
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.12),
    new THREE.MeshStandardMaterial({ color: CONFIG.colors.heroHead, roughness: 0.6 }),
  );
  nose.position.set(0, 1.72, 0.26);
  group.add(nose);

  group.position.set(CONFIG.spawn.x, 0, CONFIG.spawn.z);
  group.rotation.y = CONFIG.spawn.heading;
  scene.add(group);

  return {
    group,
    heading: CONFIG.spawn.heading,
    speed: 0,

    // input: { forward: -1..1, turn: -1..1, run: boolean } from input.js.
    // world: the object createWorld returns (for the bounds clamp).
    update(dt, input, world) {
      // turn +1 (A / stick-left) raises the heading, which swings the facing
      // vector toward screen-left; turn -1 (D / stick-right) the other way.
      this.heading += input.turn * CONFIG.player.turnSpeed * dt;
      const speed = input.run ? CONFIG.player.runSpeed : CONFIG.player.walkSpeed;
      this.speed = Math.abs(input.forward) > 0.01 ? speed * Math.sign(input.forward) : 0;
      if (this.speed !== 0) {
        const nx = this.group.position.x + Math.sin(this.heading) * this.speed * dt;
        const nz = this.group.position.z + Math.cos(this.heading) * this.speed * dt;
        const clamped = world.clamp(nx, nz);
        this.group.position.x = clamped.x;
        this.group.position.z = clamped.z;
      }
      this.group.rotation.y = this.heading;
    },

    reset() {
      this.group.position.set(CONFIG.spawn.x, 0, CONFIG.spawn.z);
      this.heading = CONFIG.spawn.heading;
      this.group.rotation.y = this.heading;
      this.speed = 0;
    },
  };
}
