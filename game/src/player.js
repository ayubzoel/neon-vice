// Neon Vice — Builder C: Vera Cruz, the hero.
// Movement: keyboard is heading-based (W forward, A/D turn) as in the
// scaffold; the touch stick is CAMERA-RELATIVE — main.js passes the camera
// basis (forward/right on the ground plane) and the stick vector becomes a
// world direction, so stick-right always moves Vera to screen-right.
// Vera also jumps (Space / JUMP), carries a visible weapon in her right hand
// when armed and slung on her back when holstered (combat.js owns the mesh).

import { CONFIG } from './config.js';

export function createPlayer(scene) {
  const group = new THREE.Group();

  const jacketMat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.heroBody, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.42), jacketMat);
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

  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.12),
    new THREE.MeshStandardMaterial({ color: CONFIG.colors.heroHead, roughness: 0.6 }),
  );
  nose.position.set(0, 1.72, 0.26);
  group.add(nose);

  // Weapon mounts: right hand (armed) and back (holstered). combat.js
  // attaches the weapon mesh to one of these.
  const handMount = new THREE.Group();
  handMount.position.set(0.45, 1.05, 0.25);
  group.add(handMount);
  const backMount = new THREE.Group();
  backMount.position.set(0, 1.25, -0.28);
  backMount.rotation.x = Math.PI / 2.4;
  group.add(backMount);

  group.position.set(CONFIG.spawn.x, 0, CONFIG.spawn.z);
  group.rotation.y = CONFIG.spawn.heading;
  scene.add(group);

  const state = {
    group,
    handMount,
    backMount,
    heading: CONFIG.spawn.heading,
    speed: 0,
    hp: 100,
    maxHp: 100,
    y: 0, // jump height above ground
    vy: 0,
    grounded: true,
    jacketColor: CONFIG.colors.heroBody,

    setJacket(color) {
      this.jacketColor = color;
      jacketMat.color.setHex(color);
    },

    damage(amount) {
      this.hp = Math.max(0, this.hp - amount);
      return this.hp;
    },
    heal(amount) {
      this.hp = Math.min(this.maxHp, this.hp + amount);
    },

    // input: from input.js read(). cam: {fx, fz, rx, rz} camera basis on the
    // ground plane (forward = where the camera looks, right = screen-right).
    // world: normalized world (clamp + optional collides).
    update(dt, input, world, cam) {
      let moveX = 0;
      let moveZ = 0;
      let speed = 0;

      if (input.stick && input.stick.active && Math.hypot(input.stick.x, input.stick.y) > 0.12) {
        // Camera-relative: stick up = away from camera, stick right = screen-right.
        const mag = Math.min(1, Math.hypot(input.stick.x, input.stick.y));
        const dx = cam.fx * input.stick.y + cam.rx * input.stick.x;
        const dz = cam.fz * input.stick.y + cam.rz * input.stick.x;
        const len = Math.hypot(dx, dz) || 1;
        moveX = dx / len;
        moveZ = dz / len;
        speed = (input.run ? CONFIG.player.runSpeed : CONFIG.player.walkSpeed) * mag;
        // Turn to face the movement direction, fast but smooth.
        const target = Math.atan2(moveX, moveZ);
        let diff = target - this.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxTurn = CONFIG.player.turnSpeed * 3 * dt;
        this.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));
      } else {
        // Keyboard: heading-based, scaffold behaviour.
        this.heading += input.turn * CONFIG.player.turnSpeed * dt;
        const base = input.run ? CONFIG.player.runSpeed : CONFIG.player.walkSpeed;
        speed = Math.abs(input.forward) > 0.01 ? base * Math.sign(input.forward) : 0;
        moveX = Math.sin(this.heading);
        moveZ = Math.cos(this.heading);
      }

      this.speed = speed;
      if (speed !== 0) {
        const nx = this.group.position.x + moveX * speed * dt;
        const nz = this.group.position.z + moveZ * speed * dt;
        if (world.collides && world.collides(nx, nz, CONFIG.player.radius)) {
          // Slide along the obstacle: try X alone, then Z alone.
          if (!world.collides(nx, this.group.position.z, CONFIG.player.radius)) {
            this.group.position.x = nx;
          } else if (!world.collides(this.group.position.x, nz, CONFIG.player.radius)) {
            this.group.position.z = nz;
          }
        } else {
          const clamped = world.clamp(nx, nz);
          this.group.position.x = clamped.x;
          this.group.position.z = clamped.z;
        }
      }

      // Jump: simple vertical velocity, ground at y = 0 (flat city).
      if (this.grounded && input.jump) {
        this.vy = 7;
        this.grounded = false;
      }
      if (!this.grounded) {
        this.vy -= 22 * dt;
        this.y += this.vy * dt;
        if (this.y <= 0) {
          this.y = 0;
          this.vy = 0;
          this.grounded = true;
        }
      }
      this.group.position.y = this.y;
      this.group.rotation.y = this.heading;
    },

    reset() {
      this.group.position.set(CONFIG.spawn.x, 0, CONFIG.spawn.z);
      this.heading = CONFIG.spawn.heading;
      this.group.rotation.y = this.heading;
      this.speed = 0;
      this.hp = this.maxHp;
      this.y = 0;
      this.vy = 0;
      this.grounded = true;
    },
  };
  return state;
}
