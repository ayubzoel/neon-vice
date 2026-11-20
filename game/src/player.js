// Neon Vice — Builder C: Vera Cruz, the hero.
// Movement: keyboard is heading-based (W forward, A/D turn) as in the
// scaffold; the touch stick is CAMERA-RELATIVE — main.js passes the camera
// basis (forward/right on the ground plane) and the stick vector becomes a
// world direction, so stick-right always moves Vera to screen-right.
// Vera also jumps (Space / JUMP), carries a visible weapon in her right hand
// when armed and slung on her back when holstered (combat.js owns the mesh).
//
// Builder Character (v2): Vera is a full humanoid — torso, head, two arms
// and two legs as separate meshes on shoulder/hip pivots (THREE.Group per
// limb), with a walk/run swing driven from update(). All visible meshes live
// under an inner `rig` group so the walk bob / run lean never touches
// group.position (jump, swim, spawn, collision radius and heading are
// byte-for-byte the v1 behaviour — missions depend on them).

import { CONFIG } from './config.js';

export function createPlayer(scene) {
  const group = new THREE.Group();
  // rig: every visible mesh hangs under here; bob/lean go on rig only.
  const rig = new THREE.Group();
  group.add(rig);

  const jacketMat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.heroBody, roughness: 0.7 });
  const skinMat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.heroHead, roughness: 0.6 });
  // Trousers: mid-light denim blue — light enough to stay visible against
  // the night ground (never near-black).
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x4f74a8, roughness: 0.8 });
  // Shoes: near-white so the feet read at night from the chase camera.
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0xd6d3d1, roughness: 0.7 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.42), jacketMat);
  body.position.y = 0.95;
  rig.add(body);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.46, 0.42),
    skinMat,
  );
  head.position.y = 1.75;
  rig.add(head);

  const hair = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.16, 0.46),
    new THREE.MeshStandardMaterial({ color: CONFIG.colors.heroHair, roughness: 0.9 }),
  );
  hair.position.y = 2.0;
  rig.add(hair);

  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.12),
    skinMat,
  );
  nose.position.set(0, 1.72, 0.26);
  rig.add(nose);

  // --- Limbs: one pivot Group per limb, mesh hung below the pivot so
  // rotation.x swings it like a pendulum. Torso spans y 0.40–1.50, so the
  // hips sit at y 0.42 and the shoulders at y 1.42; total height ~2.06 m
  // (head top), unchanged from v1. ---
  function makeArm(side) { // side: -1 left, +1 right
    const pivot = new THREE.Group();
    pivot.position.set(0.46 * side, 1.42, 0);
    // Slight outward splay so the arms separate from the torso silhouette
    // when seen from the chase camera (same teal as the jacket otherwise).
    pivot.rotation.z = 0.1 * side;
    // Sleeve: jacket teal, shares jacketMat (clothing shop recolours it).
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.24), jacketMat);
    sleeve.position.y = -0.3;
    pivot.add(sleeve);
    // Hand: skin, at the end of the arm so it reads from behind.
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.2), skinMat);
    hand.position.y = -0.66;
    pivot.add(hand);
    rig.add(pivot);
    return pivot;
  }
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(0.18 * side, 0.42, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.4, 0.3), pantsMat);
    leg.position.y = -0.2;
    pivot.add(leg);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.12, 0.42), shoeMat);
    shoe.position.set(0, -0.38, 0.05);
    pivot.add(shoe);
    rig.add(pivot);
    return pivot;
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // Weapon mounts. backMount stays on the torso (holstered = slung on the
  // back, as in v1). handMount is a child of the RIGHT ARM pivot, at the
  // hand, so the weapon follows the hand instead of floating beside the
  // body; player.update() counter-rotates it so the barrel stays level
  // while the arm swings or aims. combat.js attaches the weapon mesh to
  // one of these and only ever sets the mesh's own position/rotation.
  const handMount = new THREE.Group();
  handMount.position.set(0, -0.7, 0.1);
  armR.add(handMount);
  const backMount = new THREE.Group();
  backMount.position.set(0, 1.25, -0.28);
  backMount.rotation.x = Math.PI / 2.4;
  rig.add(backMount);

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
    swimming: false, // in the east water strip: slow swim, no shooting
    swimSpeed: 2.6, // m/s — slow, but always enough to reach the shore
    jacketColor: CONFIG.colors.heroBody,
    // Animation state. armed is set by combat.js (refreshWeaponVisibility):
    // true = weapon in hand, right arm holds the aim pose.
    armed: false,
    walkPhase: 0,
    limbs: { armL, armR, legL, legR, rig },

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

    // Walk/run animation. Targets are computed from speed, then eased so
    // the pose never snaps (idle -> neutral, walk -> opposite-phase swing).
    animate(dt) {
      const speed = Math.abs(this.speed);
      const moving = speed > 0.1 && this.grounded && !this.swimming;
      const ease = Math.min(1, dt * 10);
      if (moving) {
        this.walkPhase += dt * speed * 1.6; // stride rate follows speed
      } else if (this.swimming) {
        this.walkPhase += dt * 3; // slow kick cycle while swimming
      }
      const runFactor = Math.min(1, speed / CONFIG.player.runSpeed);
      const amp = (0.45 + 0.4 * runFactor) * (moving ? 1 : 0);
      const s = Math.sin(this.walkPhase);
      // Legs: opposite phase. Arms: opposite phase to the legs; the right
      // arm only swings while holstered — armed, it holds the aim pose
      // (raised forward, barrel level) with a small step bob.
      let tLegL = s * amp;
      let tLegR = -s * amp;
      let tArmL = -s * amp * 0.8;
      let tArmR = s * amp * 0.8;
      if (this.swimming) {
        // Gentle kick + arms slightly raised while swimming.
        const kick = Math.sin(this.walkPhase) * 0.25;
        tLegL = kick;
        tLegR = -kick;
        tArmL = -0.6;
        tArmR = -0.6;
      } else if (!this.grounded) {
        // Airborne: legs tucked, arms slightly out.
        tLegL = -0.45;
        tLegR = 0.3;
        tArmL = -0.3;
        tArmR = this.armed ? -1.0 : -0.3;
      } else if (this.armed) {
        tArmR = -1.0 + s * 0.08;
      }
      legL.rotation.x += (tLegL - legL.rotation.x) * ease;
      legR.rotation.x += (tLegR - legR.rotation.x) * ease;
      armL.rotation.x += (tArmL - armL.rotation.x) * ease;
      armR.rotation.x += (tArmR - armR.rotation.x) * ease;
      // Counter-rotate the hand mount so the held weapon stays level
      // (barrel forward) instead of tilting with the arm.
      handMount.rotation.x = -armR.rotation.x;
      // Bob: two bobs per stride cycle; slight forward lean at run speed.
      const bobAmp = moving ? 0.05 * (0.6 + 0.4 * runFactor) : 0;
      const targetBob = moving ? Math.abs(Math.cos(this.walkPhase)) * bobAmp : 0;
      rig.position.y += (targetBob - rig.position.y) * ease;
      const targetLean = moving ? 0.08 * runFactor : 0;
      rig.rotation.x += (targetLean - rig.rotation.x) * ease;
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
      // BUG-1 — swimming: water is not walkable (collides() says so), but
      // Vera must never freeze in it. In the water strip she swims slowly
      // in the steered direction; the step is allowed regardless of
      // collides(), clamped to the water rect, so she can always reach the
      // sand. No jumping while swimming.
      const inWater = world.isInWater
        ? world.isInWater(this.group.position.x, this.group.position.z)
        : false;
      this.swimming = inWater;
      if (speed !== 0) {
        const nx = this.group.position.x + moveX * speed * dt;
        const nz = this.group.position.z + moveZ * speed * dt;
        if (inWater) {
          const swim = this.swimSpeed * Math.sign(speed || 1);
          const sx = this.group.position.x + moveX * swim * dt;
          const sz = this.group.position.z + moveZ * swim * dt;
          const clamped = world.clamp(sx, sz);
          // Never swim past the east edge of the water.
          this.group.position.x = Math.min(clamped.x, 598);
          this.group.position.z = clamped.z;
          this.speed = swim;
        } else if (world.collides && world.collides(nx, nz, CONFIG.player.radius)) {
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
      // No jumping while swimming.
      if (this.grounded && input.jump && !this.swimming) {
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
      this.group.position.y = this.swimming ? -0.55 : this.y; // waist-deep while swimming
      this.group.rotation.y = this.heading;
      this.animate(dt);
    },

    reset() {
      this.group.position.set(CONFIG.spawn.x, 0, CONFIG.spawn.z);
      this.heading = CONFIG.spawn.heading;
      this.group.rotation.y = this.heading;
      this.speed = 0;
      this.hp = this.maxHp;
      this.swimming = false;
      this.y = 0;
      this.vy = 0;
      this.grounded = true;
      this.walkPhase = 0;
      armL.rotation.x = 0;
      armR.rotation.x = 0;
      legL.rotation.x = 0;
      legR.rotation.x = 0;
      rig.position.y = 0;
      rig.rotation.x = 0;
    },
  };
  return state;
}
