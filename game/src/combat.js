// Neon Vice — Builder C: combat + wanted.
// Two weapons only: pistol (start) + SMG (gun shop). The weapon mesh is
// visible in Vera's right hand while armed and slung on her back while
// holstered (H). 1/2 switch weapons. Click / FIRE shoots a hitscan ray;
// enemies are simple armed NPCs with HP that shoot back. Wanted is capped
// at 3 stars: police peds spawn and chase while wanted > 0; stars decay
// after a quiet period with no crimes.

import { CONFIG } from './config.js';

function makeWeaponMesh(kind) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.35, metalness: 0.7 });
  if (kind === 'pistol') {
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.42), mat);
    group.add(barrel);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.26, 0.12), mat);
    grip.position.set(0, -0.14, -0.12);
    group.add(grip);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.62), mat);
    group.add(body);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.1), mat);
    mag.position.set(0, -0.18, 0.05);
    group.add(mag);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.24), mat);
    stock.position.set(0, 0, -0.4);
    group.add(stock);
  }
  return group;
}

function makeNpcMesh(color, armed) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.1, 0.42),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
  );
  body.position.y = 0.95;
  group.add(body);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.46, 0.42),
    new THREE.MeshStandardMaterial({ color: 0xe8b88a, roughness: 0.6 }),
  );
  head.position.y = 1.75;
  group.add(head);
  if (armed) {
    const gun = makeWeaponMesh('pistol');
    gun.position.set(0.45, 1.05, 0.25);
    group.add(gun);
  }
  return group;
}

export function createCombat(scene, world, player, audio) {
  const weapons = {
    pistol: { ...CONFIG.weapons.pistol, owned: true, mag: CONFIG.weapons.pistol.magSize, reserve: 60 },
    smg: { ...CONFIG.weapons.smg, owned: false, mag: 0, reserve: 0 },
  };
  let current = 'pistol';
  let holstered = true; // start holstered so the intro reads clean
  let fireCooldown = 0;
  let reloadTimer = 0;
  let lastShotAt = -99;
  let gameTime = 0;

  const weaponMeshes = {
    pistol: makeWeaponMesh('pistol'),
    smg: makeWeaponMesh('smg'),
  };
  // Attach both; visibility decides which shows.
  player.handMount.add(weaponMeshes.pistol);
  player.handMount.add(weaponMeshes.smg);

  const enemies = [];
  const police = [];
  let wanted = 0;
  let wantedTimer = 0; // counts quiet time for decay
  let lastCrimeAt = -99;
  let policeSpawnTimer = 0;

  function refreshWeaponVisibility() {
    for (const [kind, mesh] of Object.entries(weaponMeshes)) {
      const owned = weapons[kind].owned;
      const isCurrent = kind === current;
      // The current weapon is always visible: in the hand when armed, slung
      // on the back when holstered. Other weapons stay hidden.
      mesh.visible = owned && isCurrent;
      if (!mesh.visible) continue;
      if (!holstered) {
        if (mesh.parent !== player.handMount) player.handMount.add(mesh);
        mesh.position.set(0, 0, 0);
        mesh.rotation.set(0, 0, 0);
      } else {
        if (mesh.parent !== player.backMount) player.backMount.add(mesh);
        mesh.position.set(0, 0, 0);
        mesh.rotation.set(0, 0, 0);
      }
    }
  }
  refreshWeaponVisibility();

  function spawnEnemy(x, z, opts = {}) {
    const mesh = makeNpcMesh(opts.color || 0x7f1d1d, true);
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    const e = {
      mesh, hp: opts.hp || 100, kind: opts.kind || 'thug',
      shootTimer: 1 + Math.random(), speed: opts.speed || 4.5,
      damage: opts.damage || 8, range: opts.range || 42, dead: false,
      mission: !!opts.mission,
    };
    enemies.push(e);
    return e;
  }

  function spawnPolice(x, z, opts = {}) {
    const mesh = makeNpcMesh(0x1d4ed8, true);
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    const p = {
      mesh, hp: 100, kind: 'police', shootTimer: 1.5,
      speed: 6.5, damage: 6, range: 30, dead: false,
      // Mission-spawned guards (e.g. mission 10's impound guards) must
      // survive clearPolice: the harness clears the wanted chasers between
      // missions, and wiping the guards made the kill stage unfinishable
      // (the mission still counted them alive, but shoot() could never hit
      // an object that left the police array).
      mission: !!opts.mission,
    };
    police.push(p);
    return p;
  }

  function clearEnemies() {
    for (const list of [enemies, police]) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const e = list[i];
        if (e.dead || !e.mission) { scene.remove(e.mesh); list.splice(i, 1); }
      }
    }
  }

  function clearPolice() {
    for (let i = police.length - 1; i >= 0; i -= 1) {
      const p = police[i];
      if (p.dead || !p.mission) { scene.remove(p.mesh); police.splice(i, 1); }
    }
  }

  function commitCrime(stars) {
    wanted = Math.min(CONFIG.wanted.max, Math.max(wanted, stars));
    lastCrimeAt = gameTime;
    wantedTimer = 0;
  }

  function shoot() {
    if (holstered || reloadTimer > 0 || fireCooldown > 0) return false;
    const w = weapons[current];
    if (w.mag <= 0) {
      reload();
      return false;
    }
    fireCooldown = w.fireInterval;
    w.mag -= 1;
    lastShotAt = gameTime;
    audio.shot(current === 'smg');
    commitCrime(1);
    // Hitscan: nearest living enemy/police within range and a 12-degree cone.
    const px = player.group.position.x;
    const pz = player.group.position.z;
    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    let best = null;
    let bestScore = Infinity;
    for (const e of [...enemies, ...police]) {
      if (e.dead) continue;
      const dx = e.mesh.position.x - px;
      const dz = e.mesh.position.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist > w.range) continue;
      const dot = (dx * fx + dz * fz) / (dist || 1);
      if (dot < 0.97) continue; // ~14-degree cone
      const score = dist - dot * 2;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) {
      best.hp -= w.damage;
      if (best.hp <= 0) {
        best.dead = true;
        best.mesh.visible = false;
        commitCrime(2);
        audio.chime();
      }
    }
    return true;
  }

  function reload() {
    const w = weapons[current];
    if (reloadTimer > 0 || w.mag >= w.magSize || w.reserve <= 0) return;
    reloadTimer = w.reloadTime;
  }

  function updateNpcs(dt, list) {
    const px = player.group.position.x;
    const pz = player.group.position.z;
    for (const e of list) {
      if (e.dead) continue;
      const dx = px - e.mesh.position.x;
      const dz = pz - e.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 90) continue;
      // Chase the player, stop at shooting range. Slide along walls: a
      // straight step into a building used to pin the NPC there forever
      // (the impound guards never reached the player), so fall back to
      // axis-separated steps when the diagonal step is blocked.
      if (dist > e.range * 0.55) {
        const nx = e.mesh.position.x + (dx / dist) * e.speed * dt;
        const nz = e.mesh.position.z + (dz / dist) * e.speed * dt;
        const blocked = (x, z) => world.collides && world.collides(x, z, 0.6);
        if (!blocked(nx, nz)) {
          e.mesh.position.x = nx;
          e.mesh.position.z = nz;
        } else if (!blocked(nx, e.mesh.position.z)) {
          e.mesh.position.x = nx;
        } else if (!blocked(e.mesh.position.x, nz)) {
          e.mesh.position.z = nz;
        }
        e.mesh.rotation.y = Math.atan2(dx, dz);
      } else {
        e.mesh.rotation.y = Math.atan2(dx, dz);
        e.shootTimer -= dt;
        if (e.shootTimer <= 0) {
          e.shootTimer = 1.1 + Math.random() * 0.8;
          audio.enemyShot();
          // Hit chance falls with distance; police are worse shots.
          const hitChance = e.kind === 'police' ? 0.35 : 0.45;
          if (Math.random() < hitChance * (1 - dist / (e.range * 2))) {
            player.damage(e.damage);
            if (player.hp <= 0) {
              // handled by main.js (mission fail / respawn)
            }
          }
        }
      }
    }
  }

  return {
    weapons,
    get current() { return current; },
    get holstered() { return holstered; },
    get wanted() { return wanted; },
    enemies,
    police,
    spawnEnemy,
    spawnPolice,
    clearEnemies,
    clearPolice,
    commitCrime,
    shoot,
    reload,
    setWanted(n) {
      wanted = Math.max(0, Math.min(CONFIG.wanted.max, n));
      lastCrimeAt = gameTime;
    },
    switchWeapon(kind) {
      if (!weapons[kind] || !weapons[kind].owned) return false;
      current = kind;
      reloadTimer = 0;
      refreshWeaponVisibility();
      return true;
    },
    toggleHolster() {
      holstered = !holstered;
      refreshWeaponVisibility();
      return holstered;
    },
    buyWeapon(kind) {
      if (weapons[kind].owned) return false;
      weapons[kind].owned = true;
      weapons[kind].mag = weapons[kind].magSize;
      weapons[kind].reserve = weapons[kind].reserveMax;
      refreshWeaponVisibility();
      return true;
    },
    buyAmmo(kind, amount) {
      const w = weapons[kind];
      if (!w || !w.owned) return false;
      w.reserve = Math.min(w.reserveMax, w.reserve + amount);
      return true;
    },
    ammoText() {
      const w = weapons[current];
      return `${w.mag} / ${w.reserve}`;
    },
    isReloading() { return reloadTimer > 0; },
    update(dt, t, driving) {
      gameTime = t;
      fireCooldown = Math.max(0, fireCooldown - dt);
      if (reloadTimer > 0) {
        reloadTimer -= dt;
        if (reloadTimer <= 0) {
          const w = weapons[current];
          const need = w.magSize - w.mag;
          const take = Math.min(need, w.reserve);
          w.mag += take;
          w.reserve -= take;
        }
      }
      updateNpcs(dt, enemies);
      updateNpcs(dt, police);
      // Wanted decay: quiet for CONFIG.wanted.decaySeconds -> -1 star.
      if (wanted > 0) {
        wantedTimer += dt;
        if (wantedTimer >= CONFIG.wanted.decaySeconds) {
          wanted -= 1;
          wantedTimer = 0;
        }
        // Keep 1-2 police on the player while wanted.
        policeSpawnTimer -= dt;
        const alive = police.filter((p) => !p.dead).length;
        if (policeSpawnTimer <= 0 && alive < wanted) {
          policeSpawnTimer = 4;
          const ang = Math.random() * Math.PI * 2;
          spawnPolice(
            player.group.position.x + Math.cos(ang) * 35,
            player.group.position.z + Math.sin(ang) * 35,
          );
        }
        audio.setSiren(true);
      } else {
        audio.setSiren(false);
        // Police give up and walk off once wanted clears.
        for (const p of police) {
          if (!p.dead) {
            p.mesh.position.x += Math.sin(p.mesh.rotation.y + Math.PI) * 3 * dt;
            p.mesh.position.z += Math.cos(p.mesh.rotation.y + Math.PI) * 3 * dt;
          }
        }
      }
      // Clean up dead / far police occasionally.
      if (police.length > 8) {
        const keep = police.filter((p) => !p.dead).slice(0, 4);
        for (const p of police) if (!keep.includes(p)) scene.remove(p.mesh);
        police.length = 0;
        police.push(...keep);
      }
    },
  };
}
