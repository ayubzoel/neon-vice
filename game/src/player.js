// Neon Vice — Vera Cruz, the hero.
//
// Keyboard movement is heading-based (W forward, A/D turn), matching the
// scaffold; the touch stick is CAMERA-RELATIVE — main.js hands over the
// camera basis (forward/right on the ground plane) and the stick vector
// becomes a world direction, so stick-right always walks Vera to
// screen-right. Vera also jumps (Space / JUMP), and carries a visible
// weapon in her right hand while armed, slung on her back while holstered
// (the weapon mesh itself is owned by combat.js).
//
// Vera is a full humanoid: torso, head, two arms and two legs as separate
// meshes on shoulder/hip pivots (a THREE.Group per limb), with a walk/run
// swing driven from update(). Every visible mesh lives under an inner
// `frame` group so the walk bob and run lean never touch root.position —
// jump, swim, spawn, collision radius and heading all behave exactly as
// they did before; missions depend on them.

import { CONFIG as GAME_CFG } from './config.js';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v) { // 0..1 clamp
  return v < 0 ? 0 : v > 1 ? 1 : v; // clamped
}

function stdMat(color, rough) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough });
}

function part(geo, mat, x, y, z, parent) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z); parent.add(mesh);
  return mesh; // placed
}

function boxGeo(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

function pivotAt(x, y) {
  const pivot = new THREE.Group(); // limb pivot
  pivot.position.set(x, y, 0);
  return pivot; // fresh pivot
}

export function createPlayer(scene) { // Vera Cruz
  const root = new THREE.Group(); // Vera's root
  // frame: every visible mesh hangs under here; bob and lean go on it only.
  const frame = new THREE.Group();
  root.add(frame);

  const jacketMat = stdMat(GAME_CFG.colors.heroBody, 0.7);
  const skinMat = stdMat(GAME_CFG.colors.heroHead, 0.6);
  // Trousers in mid-light denim blue, light enough to stay visible on
  // the night ground (never close to black).
  const pantsMat = stdMat(0x4f74a8, 0.8);
  // Near-white shoes, so the feet still read at night from the chase cam.
  const shoeMat = stdMat(0xd6d3d1, 0.7);

  part(boxGeo(0.7, 1.1, 0.42), jacketMat, 0, 0.95, 0, frame); // torso
  part(boxGeo(0.46, 0.46, 0.42), skinMat, 0, 1.75, 0, frame); // head
  part(boxGeo(0.5, 0.16, 0.46), stdMat(GAME_CFG.colors.heroHair, 0.9), 0, 2.0, 0, frame); // hair
  part(boxGeo(0.12, 0.12, 0.12), skinMat, 0, 1.72, 0.26, frame); // nose

  // One pivot Group per limb, mesh hung below the pivot so rotation.x
  // swings it like a pendulum. Torso spans y 0.40–1.50, so the hips sit
  // at y 0.42 and the shoulders at y 1.42; total height ~2.06 m (head
  // top), unchanged from before.
  function makeArm(side) { // side: -1 is left, +1 is right
    const pivot = pivotAt(0.46 * side, 1.42);
    // A touch of outward splay, so the arms separate from the torso
    // silhouette seen from the chase camera (teal like the jacket).
    pivot.rotation.z = 0.1 * side; // slight outward splay
    // Sleeve in jacket teal, sharing jacketMat (the shop recolours it).
    part(boxGeo(0.2, 0.6, 0.24), jacketMat, 0, -0.3, 0, pivot); // sleeve
    // Skin hand at the end of the arm, so it reads from behind.
    part(boxGeo(0.18, 0.16, 0.2), skinMat, 0, -0.66, 0, pivot); // hand
    frame.add(pivot); return pivot;
  }
  function makeLeg(side) { // side: -1 is left, +1 is right
    const pivot = pivotAt(0.18 * side, 0.42);
    part(boxGeo(0.26, 0.4, 0.3), pantsMat, 0, -0.2, 0, pivot); // leg
    part(boxGeo(0.27, 0.12, 0.42), shoeMat, 0, -0.38, 0.05, pivot); // shoe
    frame.add(pivot); return pivot;
  }
  const [armL, armR] = [-1, 1].map(makeArm);
  const [legL, legR] = [-1, 1].map(makeLeg);

  // Weapon mounts. backMount stays on the torso (holstered = slung on
  // the back). handMount is a child of the RIGHT ARM pivot, at the hand,
  // so the weapon follows the hand instead of floating beside the body;
  // player.update() counter-rotates it so the barrel stays level while
  // the arm swings or aims. combat.js attaches the weapon mesh to one
  // of these and only ever sets the mesh's own position/rotation.
  const handMount = new THREE.Group(); // right-hand weapon mount
  handMount.position.set(0, -0.7, 0.1); // at the hand
  armR.add(handMount); // follows the hand
  const backMount = new THREE.Group(); // slung-on-back mount
  backMount.position.set(0, 1.25, -0.28); // on the torso
  backMount.rotation.x = Math.PI / 2.4; // slung angle
  frame.add(backMount);

  root.position.set(GAME_CFG.spawn.x, 0, GAME_CFG.spawn.z);
  root.rotation.y = GAME_CFG.spawn.heading;
  scene.add(root); // Vera enters the scene

  // Turn toward a target heading, clamped to cap per frame; the
  // difference wraps to ±PI so Vera always takes the short way round.
  function turnTo(target, dt) {
    let diff = target - state.heading;
    while (diff > Math.PI) { diff -= Math.PI * 2; }
    while (diff < -Math.PI) { diff += Math.PI * 2; }
    const cap = GAME_CFG.player.turnSpeed * 3 * dt;
    state.heading += clamp(diff, -cap, cap);
  }

  const state = { // Vera's live state
    group: root, // root group
    handMount, // right-hand mount
    backMount, // slung-on-back mount
    heading: GAME_CFG.spawn.heading,
    speed: 0, // current m/s
    hp: 100, // current health
    maxHp: 100, // full health
    y: 0, // jump height above the ground
    vy: 0, // vertical speed
    grounded: true, // on the ground
    swimming: false, // east water strip: slow swim, no shooting
    swimSpeed: 2.6, // m/s — slow, yet always enough to reach the shore
    jacketColor: GAME_CFG.colors.heroBody,
    // Animation state. armed is set by combat.js
    // (refreshWeaponVisibility): true = weapon in hand, right arm holds
    // the aim pose.
    armed: false, // weapon in hand?
    walkPhase: 0, // stride clock
    limbs: { armL, armR, legL, legR, rig: frame }, // animation handles
    groundY: 0, // smoothed road-surface height (flyover ramps/deck)

    setJacket(color) { // recolour the jacket
      this.jacketColor = color; // remember the new colour
      jacketMat.color.setHex(color); // repaint
    },

    damage(amount) { // take a hit
      this.hp = clamp(this.hp - amount, 0, this.maxHp);
      return this.hp; // remaining health
    },
    heal(amount) { // restore health
      this.hp = clamp(this.hp + amount, 0, this.maxHp);
    },

    // Walk/run animation. Targets come from speed, then ease so the
    // pose never snaps (idle -> neutral, walk -> opposite-phase swing).
    animate(dt) { // pose this frame
      const speed = Math.abs(this.speed); // pace, always positive
      const moving = speed > 0.1 && this.grounded && !this.swimming; // actually walking/running
      const ease = clamp01(dt * 10); // pose easing
      if (moving) { // stride on
        this.walkPhase += dt * speed * 1.6; // stride pace follows speed
      } else if (this.swimming) { // kick cycle
        this.walkPhase += dt * 3; // slow kick cycle in the water
      }
      const runFactor = clamp01(speed / GAME_CFG.player.runSpeed);
      const amp = (0.45 + 0.4 * runFactor) * (moving ? 1 : 0); // swing size
      const s = Math.sin(this.walkPhase); // stride sine
      // Legs swing in opposite phase. Arms swing opposite to the legs;
      // the right arm only swings while holstered — armed, it holds the
      // aim pose (raised forward, barrel level) with a small step bob.
      let tLegL = s * amp; // left leg target
      let tLegR = -s * amp; // right leg target
      let tArmL = -s * amp * 0.8; // left arm target
      let tArmR = s * amp * 0.8; // right arm target
      if (this.swimming) { // in the water
        // Gentle kick, arms slightly raised while swimming.
        const kick = Math.sin(this.walkPhase) * 0.25; // gentle kick
        tLegL = kick; // left kick
        tLegR = -kick; // right kick
        tArmL = -0.6; // arms raised
        tArmR = -0.6; // arms raised
      } else if (!this.grounded) { // airborne
        // Mid-air: legs tucked, arms slightly out.
        tLegL = -0.45; // tucked
        tLegR = 0.3; // tucked
        tArmL = -0.3; // out
        tArmR = this.armed ? -1.0 : -0.3; // aim or out
      } else if (this.armed) { // aim pose
        tArmR = -1.0 + s * 0.08; // aim + step bob
      }
      for (const [limb, target] of [[legL, tLegL], [legR, tLegR], [armL, tArmL], [armR, tArmR]]) {
        limb.rotation.x += (target - limb.rotation.x) * ease;
      }
      // Keep the held weapon level: counter-rotate the hand mount
      // so the barrel points forward instead of tilting with the arm.
      handMount.rotation.x = -armR.rotation.x; // keep the barrel level
      // Bob twice per stride cycle; a slight forward lean at run speed.
      const bobAmp = moving ? 0.05 * (0.6 + 0.4 * runFactor) : 0; // bob size
      const targetBob = moving ? Math.abs(Math.cos(this.walkPhase)) * bobAmp : 0; // two bobs per stride
      frame.position.y += (targetBob - frame.position.y) * ease;
      const targetLean = moving ? 0.08 * runFactor : 0; // run lean
      frame.rotation.x += (targetLean - frame.rotation.x) * ease;
    },

    // input: from input.js read(). cam: {fx, fz, rx, rz} camera basis on
    // the ground plane (forward = where the camera looks, right =
    // screen-right). world: normalized world (clamp + optional collides).
    update(dt, input, world, cam) { // one frame of movement
      let moveX = 0; // world-space step x
      let moveZ = 0; // world-space step z
      let speed = 0; // m/s this frame

      const stickMag = input.stick ? Math.hypot(input.stick.x, input.stick.y) : 0;
      if (input.stick && input.stick.active && stickMag > 0.12) {
        // Camera-relative: stick up = away from camera, stick right =
        // screen-right.
        const mag = stickMag > 1 ? 1 : stickMag;
        const dx = cam.fx * input.stick.y + cam.rx * input.stick.x; // stick -> world x
        const dz = cam.fz * input.stick.y + cam.rz * input.stick.x; // stick -> world z
        const len = Math.hypot(dx, dz) || 1; // never zero
        moveX = dx / len; // normalized
        moveZ = dz / len; // normalized
        speed = (input.run ? GAME_CFG.player.runSpeed : GAME_CFG.player.walkSpeed) * mag;
        // Face the movement direction, fast but smooth.
        turnTo(Math.atan2(moveX, moveZ), dt);
      } else {
        // Keyboard: CAMERA-RELATIVE, like the stick. W/S move along the
        // camera forward/back, A/D strafe left/right while moving; heading
        // turns toward the movement direction, so after the camera is
        // orbited 180°, W walks away from the camera instead of toward
        // it. A/D alone (no W/S) still turn in place, so aiming a shot
        // with A/D is unchanged.
        if (input.forward !== 0) { // driving forward/back
          let mx = cam.fx * input.forward + cam.rx * -input.turn; // camera-relative x
          let mz = cam.fz * input.forward + cam.rz * -input.turn; // camera-relative z
          const len = Math.hypot(mx, mz) || 1; // never zero
          mx /= len; // normalize
          mz /= len; // normalize
          moveX = mx; // world step
          moveZ = mz; // world step
          speed = input.run ? GAME_CFG.player.runSpeed : GAME_CFG.player.walkSpeed;
          turnTo(Math.atan2(moveX, moveZ), dt);
        } else if (input.turn !== 0) { // turn in place
          this.heading += input.turn * GAME_CFG.player.turnSpeed * dt;
          speed = 0; // standing still
          moveX = Math.sin(this.heading); // face direction
          moveZ = Math.cos(this.heading); // face direction
        } else {
          speed = 0; // idle
          moveX = Math.sin(this.heading); // still facing
          moveZ = Math.cos(this.heading); // still facing
        }
      }

      this.speed = speed; // record the pace
      // Swimming: water is not walkable (collides() says so), but Vera
      // must never freeze in it. In the water strip she swims slowly in
      // the steered direction; the step is allowed regardless of
      // collides(), clamped to the water rect, so she can always reach
      // the sand. No jumping while swimming.
      const inWater = world.isInWater // water check
        ? world.isInWater(root.position.x, root.position.z)
        : false; // dry land
      this.swimming = inWater; // swim state
      if (speed !== 0) { // actually moving
        const nx = root.position.x + moveX * speed * dt;
        const nz = root.position.z + moveZ * speed * dt;
        if (inWater) { // swim step
          const swim = this.swimSpeed * Math.sign(speed || 1); // slow swim pace
          const sx = root.position.x + moveX * swim * dt;
          const sz = root.position.z + moveZ * swim * dt;
          const clamped = world.clamp(sx, sz); // stay in bounds
          // Never swim past the water's east edge.
          root.position.x = Math.min(clamped.x, 598);
          root.position.z = clamped.z;
          this.speed = swim; // swimming pace
        } else if (world.collides && world.collides(nx, nz, GAME_CFG.player.radius, root.position.y)) {
          // Slide: try the X step alone, then the Z step alone.
          if (!world.collides(nx, root.position.z, GAME_CFG.player.radius, root.position.y)) {
            root.position.x = nx;
          } else if (!world.collides(root.position.x, nz, GAME_CFG.player.radius, root.position.y)) {
            root.position.z = nz;
          }
        } else {
          const clamped = world.clamp(nx, nz); // stay in bounds
          root.position.x = clamped.x;
          root.position.z = clamped.z;
        }
      }

      // Jump: plain vertical velocity, ground at y = 0 (flat city).
      // No jumping in the water.
      if (this.grounded && input.jump && !this.swimming) { // jump!
        this.vy = 7; // launch
        this.grounded = false; // airborne
      }
      if (!this.grounded) { // falling
        this.vy -= 22 * dt; // gravity
        this.y += this.vy * dt; // rise/fall
        if (this.y <= 0) { // landed
          this.y = 0; // back on the ground
          this.vy = 0; // stop falling
          this.grounded = true; // landed
        }
      }
      // Flyover: the ground under Vera follows the ramp/deck profile,
      // smoothed so stepping off a deck edge drops instead of snapping.
      // Jump height (this.y) rides on top of it.
      const gyTarget = world.groundHeightAt // ground under Vera
        ? world.groundHeightAt(root.position.x, root.position.z, this.groundY)
        : 0; // flat ground
      this.groundY += (gyTarget - this.groundY) * clamp01(10 * dt); // smooth the ground
      root.position.y = this.swimming ? -0.55 : this.groundY + this.y; // waist-deep in water
      root.rotation.y = this.heading;
      this.animate(dt); // pose for this frame
    },

    reset() { // back to spawn
      root.position.set(GAME_CFG.spawn.x, 0, GAME_CFG.spawn.z);
      this.heading = GAME_CFG.spawn.heading;
      root.rotation.y = this.heading;
      this.speed = 0; // stopped
      this.hp = this.maxHp; // full health
      this.swimming = false; // dry
      this.y = 0; // on the ground
      this.groundY = 0; // flat
      this.vy = 0; // no fall speed
      this.grounded = true; // standing
      this.walkPhase = 0; // neutral pose
      for (const limb of [armL, armR, legL, legR]) limb.rotation.x = 0;
      frame.position.y = 0; // no bob
      frame.rotation.x = 0; // no lean
    },
  };
  return state; // Vera is ready
}
