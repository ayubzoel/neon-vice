// Neon Vice — Builder C: the 12-mission debt arc + side jobs.
// Vera Cruz owes $50,000 to loan shark Rico Salas. Twelve main missions run
// the arc from first delivery to the last score; every mission is a small
// stage machine (goto / kill / hold / race / evade / enterVehicle) and every
// one can be finished through normal play. Side jobs (taxi, package, street
// race) are repeatable and pay cash. Debug hooks (window.NEON_VICE.debug)
// let a tester start any mission and drive it end-to-end.
//
// The engine only talks to the game through `ctx` (player, vehicles,
// combat, money, messaging) so it stays testable without the renderer loop.

import { CONFIG } from './config.js';

const P = CONFIG.places;

function gotoStage(place, text) {
  return { type: 'goto', x: P[place].x, z: P[place].z, radius: 10, text: text || `Go to ${P[place].name}` };
}

export const MISSION_DEFS = [
  {
    id: 1, title: 'First Delivery', giver: 'Rico Salas',
    brief: 'Rico needs a package at the North Market. No questions, no peeking. $500 when it lands.',
    reward: 500,
    stages: [gotoStage('ricosBar', 'Pick up the package at Rico\'s Bar'), gotoStage('northMarket', 'Deliver the package to North Market')],
  },
  {
    id: 2, title: 'Taxi Shift', giver: 'Dana the Dispatcher',
    brief: 'Dana runs the cab stand at the West Docks. One fare, one tip, keep the meter honest.',
    reward: 400,
    stages: [gotoStage('westDocks', 'Pick up the fare at West Docks'), gotoStage('downtown', 'Drop the fare at Downtown')],
  },
  {
    id: 3, title: 'The Collection', giver: 'Rico Salas',
    brief: 'Three shops owe Rico. Visit each one and collect. Be polite. Be firm.',
    reward: 800,
    stages: [gotoStage('uptown', 'Collect from Uptown shop (1/3)'), gotoStage('southBeach', 'Collect from South Beach shop (2/3)'), gotoStage('airport', 'Collect from Airport shop (3/3)')],
  },
  {
    id: 4, title: 'Hot Wheels', giver: 'Rico Salas',
    brief: 'A coupe is parked by the Warehouse. Take it — gently — and bring it to the Marina garage.',
    reward: 1200,
    stages: [
      { type: 'enterVehicle', x: P.warehouse.x, z: P.warehouse.z, radius: 14, kind: 'coupe', text: 'Get in the coupe at the Warehouse (E)' },
      gotoStage('eastMarina', 'Deliver the coupe to the East Marina garage'),
    ],
  },
  {
    id: 5, title: 'Race Night', giver: 'Jax the Racer',
    brief: 'Street race, four checkpoints, 150 seconds. Beat the clock and Jax pays out.',
    reward: 1500,
    stages: [{
      type: 'race', timeLimit: 150,
      // Checkpoints sit ON road-graph nodes (intersections), not mid-block:
      // the driver triggers a checkpoint at 12 m while still approaching
      // it, and findPath then starts the next leg from the nearest node —
      // a mid-block checkpoint (old cp1 (0,0), old cp2 (300,-300)) flips
      // that node BEHIND the car, forcing a 180-degree U-turn that swings
      // the car off the road into a building corner: (42,-16) in the old
      // route, (318,-296) in the (300,-300) route (re-tester + Builder E
      // 5x run: 2/5). Node-aligned checkpoints make every transition
      // "continue straight, then a 90-degree left turn" — a clean
      // rectangle: east along z=0, north along x=300, west along z=-360,
      // south along x=-300 to the finish.
      checkpoints: [
        { x: 300, z: 0 }, { x: 300, z: -360 }, { x: -300, z: -360 }, { x: -300, z: 240 },
      ],
      text: 'Hit all 4 checkpoints before the clock runs out',
    }],
  },
  {
    id: 6, title: 'Gun Run', giver: 'Rico Salas',
    brief: 'A drop at South Beach went sideways — two of Rico\'s rivals are waiting. Deal with them, then finish the drop Downtown.',
    reward: 2000,
    stages: [
      { type: 'kill', count: 2, spawn: [{ x: P.southBeach.x + 8, z: P.southBeach.z }, { x: P.southBeach.x - 8, z: P.southBeach.z + 6 }], text: 'Deal with the two rivals at South Beach (2)' },
      gotoStage('downtown', 'Finish the drop at Downtown'),
    ],
  },
  {
    id: 7, title: 'Shakedown', giver: 'Rico Salas',
    brief: 'Three armed collectors are muscling in on Rico\'s Warehouse turf. Clear them out.',
    reward: 2500,
    stages: [{
      type: 'kill', count: 3,
      spawn: [
        { x: P.warehouse.x + 10, z: P.warehouse.z }, { x: P.warehouse.x - 10, z: P.warehouse.z + 8 },
        { x: P.warehouse.x, z: P.warehouse.z - 12 },
      ],
      text: 'Clear the Warehouse (3 armed)',
    }],
  },
  {
    id: 8, title: 'Boat Job', giver: 'Marina Mike',
    brief: 'A crate needs to reach the far end of the bay. Take the boat at the Marina Dock and run it north.',
    reward: 3000,
    stages: [
      { type: 'enterVehicle', x: P.marinaDock.x, z: P.marinaDock.z, radius: 16, kind: 'boat', text: 'Board the boat at the Marina Dock (E)' },
      { type: 'goto', x: 540, z: -380, radius: 14, text: 'Sail to the north bay drop' },
    ],
  },
  {
    id: 9, title: 'The Getaway', giver: 'Rico Salas',
    brief: 'Pick up the VIP at the Airport, get him to the Safehouse, and lose the heat. The cops will be all over you — stay out of sight for 30 seconds after the drop.',
    reward: 4000,
    stages: [
      gotoStage('airport', 'Pick up the VIP at the Airport'),
      { type: 'goto', x: P.safehouse.x, z: P.safehouse.z, radius: 10, text: 'Drive the VIP to the Safehouse', wantedOnArrive: 2 },
      { type: 'evade', seconds: 30, text: 'Lose the heat — stay unseen for 30s' },
    ],
  },
  {
    id: 10, title: 'Impound Job', giver: 'Rico Salas',
    brief: 'Rico\'s getaway car sits in the Police Impound. Two officers guard it. Take the car, bring it to Rico\'s Bar. Expect 3 stars.',
    reward: 5000,
    stages: [
      {
        type: 'kill', count: 2,
        spawn: [
          { x: P.impound.x + 8, z: P.impound.z, kind: 'police' },
          { x: P.impound.x - 8, z: P.impound.z + 6, kind: 'police' },
        ],
        text: 'Deal with the impound guards (2)',
      },
      { type: 'enterVehicle', x: P.impound.x, z: P.impound.z, radius: 14, kind: 'sedan', text: 'Take the impound sedan (E)' },
      gotoStage('ricosBar', 'Bring the car to Rico\'s Bar'),
    ],
  },
  {
    id: 11, title: 'The Vault', giver: 'Rico Salas',
    brief: 'Vice Bank, midday. Stand at the vault door and hold it open for 8 seconds, then run for the West Docks. No shooting unless you have to.',
    reward: 10000,
    stages: [
      { type: 'hold', x: P.bank.x, z: P.bank.z, radius: 8, seconds: 8, text: 'Hold the vault door open (8s)' },
      gotoStage('westDocks', 'Escape to the West Docks'),
    ],
  },
  {
    id: 12, title: 'The Last Score', giver: 'Rico Salas',
    brief: 'The yacht at the Marina holds Rico\'s final payment — four guards, one crate. Take it, bring it to Rico, and the $50,000 debt is gone.',
    reward: 25000,
    stages: [
      {
        type: 'kill', count: 4,
        spawn: [
          { x: P.yacht.x - 14, z: P.yacht.z + 6 }, { x: P.yacht.x - 14, z: P.yacht.z - 6 },
          { x: P.yacht.x - 24, z: P.yacht.z }, { x: P.yacht.x - 8, z: P.yacht.z + 14 },
        ],
        text: 'Clear the yacht guards (4)',
      },
      { type: 'hold', x: P.yacht.x - 10, z: P.yacht.z, radius: 8, seconds: 5, text: 'Grab the crate (5s)' },
      gotoStage('ricosBar', 'Bring the crate to Rico\'s Bar'),
    ],
  },
];

export function createMissions(scene, world, ctx) {
  // Beacon: a glowing cylinder + ring marking the current objective.
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xf472b6, transparent: true, opacity: 0.55 });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 30, 16, 1, true), beaconMat);
  beacon.visible = false;
  scene.add(beacon);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xf472b6, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(6, 8, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.1;
  ring.visible = false;
  scene.add(ring);

  // v5 item 7 — ground circles: a flat disc + outer ring lying ON the road
  // surface so the player can see exactly where to stand. Two of them:
  //   startCircle (gold)  — the NEXT mission's start point while no mission
  //     is active; standing inside auto-starts that mission (Ayub: "Saya
  //     sudah berada di titik misi, tapi tidak ada misi yang keluar" — the
  //     old flow only started missions from the UI, never by proximity).
  //   targetCircle (green) — the ACTIVE stage's destination (goto / hold /
  //     enterVehicle / race checkpoint / kill target); entering it is what
  //     completes a goto stage, so the trigger boundary is drawn, not
  //     guessed. Both are pure additions: the pink beacon beam + ring, the
  //     spinning gold diamond and the "!" sprite above are untouched.
  // Unit geometry (radius 1), scaled per circle so the drawn radius always
  // equals the trigger radius. depthWrite off + y just above the road so
  // the disc never z-fights the asphalt or the pink ring (y 0.1).
  function makeGroundCircle(color) {
    const group = new THREE.Group();
    group.visible = false;
    const discMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.12;
    group.add(disc);
    const ringMat2 = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
    const edge = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 48), ringMat2);
    edge.rotation.x = -Math.PI / 2;
    edge.position.y = 0.14;
    group.add(edge);
    group.renderOrder = 1;
    scene.add(group);
    return { group, discMat, ringMat: ringMat2 };
  }
  const startCircle = makeGroundCircle(0xffd400); // gold = "start here"
  const targetCircle = makeGroundCircle(0x22ff88); // green = "go here / done here"
  let circleTime = 0;
  let startCircleState = null; // {x, z, radius, missionId} | null
  let targetCircleState = null; // {x, z, radius} | null
  function showCircle(c, x, z, radius) {
    c.group.position.set(x, 0, z);
    c.group.scale.set(radius, 1, radius);
    c.group.visible = true;
  }
  function pulseCircles(dt) {
    circleTime += dt;
    const pulse = 0.5 + 0.5 * Math.sin(circleTime * 3);
    if (startCircle.group.visible) {
      startCircle.discMat.opacity = 0.16 + 0.12 * pulse;
      startCircle.ringMat.opacity = 0.65 + 0.35 * pulse;
    }
    if (targetCircle.group.visible) {
      targetCircle.discMat.opacity = 0.16 + 0.12 * pulse;
      targetCircle.ringMat.opacity = 0.65 + 0.35 * pulse;
    }
  }

  // Mission icon (Builder Markers+Trees): the pink beam + ring alone did
  // not read as a mission icon, so the active target also gets a big
  // floating gold diamond that slowly spins and bobs, plus a "!" sprite
  // that always faces the camera and draws through buildings
  // (depthTest:false) so the player can spot the target from anywhere in
  // the city. Purely visual: no collision, no mission logic.
  const markerGroup = new THREE.Group();
  markerGroup.visible = false;
  scene.add(markerGroup);
  const markerDiamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(2.8),
    new THREE.MeshBasicMaterial({ color: 0xffd400 }),
  );
  markerGroup.add(markerDiamond);
  let markerSprite = null;
  try {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2);
    g.fillStyle = '#f472b6'; g.fill();
    g.lineWidth = 6; g.strokeStyle = '#ffffff'; g.stroke();
    g.fillStyle = '#ffffff';
    g.font = 'bold 88px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('!', 64, 68);
    const tex = new THREE.CanvasTexture(c);
    markerSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    // Small badge floating ABOVE the diamond (not on top of it): the first
    // version used scale 7 at the same centre and swallowed the diamond.
    markerSprite.scale.set(4.5, 4.5, 1);
    markerSprite.position.y = 5.5;
    markerGroup.add(markerSprite);
  } catch { /* diamond alone still marks the target */ }
  let markerTime = 0;
  let markerTarget = null; // {x, z} or null
  function animateMarker(dt) {
    if (!markerGroup.visible || !markerTarget) return;
    markerTime += dt;
    markerGroup.position.set(markerTarget.x, 10 + Math.sin(markerTime * 2) * 0.9, markerTarget.z);
    markerDiamond.rotation.y += dt * 1.5;
    markerDiamond.position.y = 0;
    if (markerSprite) markerSprite.position.y = 5.5;
  }

  let missionIndex = 0; // index into MISSION_DEFS
  let stageIndex = 0;
  let status = 'idle'; // idle | active | done | failed | complete (all 12 done)
  let stageState = {};
  let completed = [];
  let debtPaid = false;
  // v5 item 7 — auto-start re-arm: after a mission completes or fails, its
  // start circle stays disarmed for THAT mission until the player is seen
  // outside it (radius + 5 m). Without this, failing a kill/race stage
  // while standing on its own start point would instantly re-start it in
  // a loop. A different mission id re-arms immediately (completing mission
  // N must never block mission N+1's circle), and a fresh load starts
  // armed so standing at the start point is exactly what starts it.
  let disarmedMissionId = null;

  // Side-job state (one at a time).
  let sideJob = null; // {kind, stage, timer, from, to, checkpoints, cpIndex, pay}

  function currentDef() { return MISSION_DEFS[missionIndex]; }
  function currentStage() {
    const def = currentDef();
    return def ? def.stages[stageIndex] : null;
  }

  function placeBeacon(x, z) {
    beacon.position.set(x, 15, z);
    beacon.visible = true;
    ring.position.set(x, 0.1, z);
    ring.visible = true;
    markerTarget = { x, z };
    markerGroup.position.set(x, 10, z);
    markerGroup.visible = true;
  }
  function hideBeacon() {
    beacon.visible = false;
    ring.visible = false;
    markerTarget = null;
    markerGroup.visible = false;
  }

  // Snap a target onto open ground: Builder B's city has buildings in block
  // interiors, so a raw place coordinate can sit inside a footprint the
  // player can never reach. findOpenGround (B's API, scaffold fallback is
  // identity) moves it to the nearest walkable spot.
  function snap(x, z, maxR = 40) {
    try {
      const g = ctx.world && ctx.world.findOpenGround ? ctx.world.findOpenGround(x, z, maxR) : null;
      if (g && typeof g.x === 'number') return { x: g.x, z: g.z };
    } catch { /* keep the raw point */ }
    return { x, z };
  }

  function startStage() {
    stageState = {};
    const stage = currentStage();
    if (!stage) return;
    if (stage.type === 'kill') {
      stageState.spawned = stage.spawn.map((s) => {
        const p = snap(s.x, s.z);
        if (s.kind === 'police') return ctx.combat.spawnPolice(p.x, p.z, { mission: true });
        return ctx.combat.spawnEnemy(p.x, p.z, { kind: 'guard', mission: true });
      });
      stageState.killed = 0;
    } else if (stage.type === 'enterVehicle') {
      // Make sure a vehicle of the right kind waits at the spot. The car is
      // parked on the nearest road (not inside a block) and the stage target
      // IS the car, so the player walks straight onto it (E enters within 6 m).
      const spot = snap(stage.x, stage.z);
      let carSpot = spot;
      // Cars park on the nearest road; boats stay in the water.
      if (stage.kind !== 'boat') {
        try {
          const rg = ctx.world && ctx.world.roadGraph;
          if (rg && rg.nearestOnRoad) {
            const onRoad = rg.nearestOnRoad(spot.x, spot.z);
            if (onRoad && typeof onRoad.x === 'number') carSpot = { x: onRoad.x, z: onRoad.z };
          }
        } catch { /* keep the snapped spot */ }
      }
      stageState.tx = carSpot.x;
      stageState.tz = carSpot.z;
      const near = ctx.vehicles.nearestVehicle(carSpot.x, carSpot.z, 25);
      // Only a PARKED car counts: nearestVehicle also returns traffic cars,
      // and a traffic car drives off while the player walks to it — with
      // 22 cars on the road that stopped being a rare fluke. A moving car
      // of the right kind nearby means a fresh mission car is spawned.
      if (!near || near.kind !== stage.kind || !near.parked) {
        const v = ctx.vehicles.addVehicle(stage.kind, 0xf59e0b, carSpot.x, carSpot.z, 0, { parked: true, missionCar: true });
        stageState.missionVehicle = v;
      } else {
        stageState.missionVehicle = near;
      }
    } else if (stage.type === 'race') {
      stageState.cpIndex = 0;
      stageState.timeLeft = stage.timeLimit;
      // Race checkpoints are for cars: snap them onto the nearest ROAD, not
      // just open ground — (0,300) sits on the Polsek Beach plot, and open
      // ground next to it wedges the car against the station wall.
      stageState.checkpoints = stage.checkpoints.map((cp) => {
        try {
          const rg = ctx.world && ctx.world.roadGraph;
          if (rg && rg.nearestOnRoad) {
            const p = rg.nearestOnRoad(cp.x, cp.z);
            if (p && typeof p.x === 'number') return { x: p.x, z: p.z };
          }
        } catch { /* fall through to the ground snap */ }
        return snap(cp.x, cp.z);
      });
    } else if (stage.type === 'hold') {
      stageState.progress = 0;
      const spot = snap(stage.x, stage.z);
      stageState.tx = spot.x;
      stageState.tz = spot.z;
    } else if (stage.type === 'goto') {
      const spot = snap(stage.x, stage.z);
      stageState.tx = spot.x;
      stageState.tz = spot.z;
    } else if (stage.type === 'evade') {
      stageState.timeLeft = stage.seconds;
    }
    const target = stageTarget();
    if (target) placeBeacon(target.x, target.z);
    else hideBeacon(); // e.g. evade stages have no location — clear the old marker
    ctx.onObjective(stage.text);
  }

  function stageTarget() {
    const stage = currentStage();
    if (!stage) return null;
    if (stage.type === 'race') {
      const cp = (stageState.checkpoints || stage.checkpoints)[stageState.cpIndex || 0];
      return cp ? { x: cp.x, z: cp.z } : null;
    }
    if (stage.type === 'kill') {
      const alive = (stageState.spawned || []).find((e) => !e.dead);
      return alive ? { x: alive.mesh.position.x, z: alive.mesh.position.z } : { x: stage.spawn[0].x, z: stage.spawn[0].z };
    }
    if (stage.type === 'evade') {
      // No location: the objective is to stay alive/unseen for N seconds.
      return null;
    }
    if (stageState.tx !== undefined) return { x: stageState.tx, z: stageState.tz };
    return { x: stage.x, z: stage.z };
  }

  function startMission(n) {
    const idx = Math.max(0, Math.min(MISSION_DEFS.length - 1, n - 1));
    missionIndex = idx;
    stageIndex = 0;
    status = 'active';
    const def = currentDef();
    ctx.onMessage(`Mission ${def.id}: ${def.title} — ${def.giver}`);
    ctx.onObjective(def.stages[0].text);
    startStage();
    return def;
  }

  function failMission(reason) {
    if (status !== 'active') return;
    status = 'failed';
    disarmedMissionId = currentDef() ? currentDef().id : null; // v5 item 7: no instant re-start loop
    hideBeacon();
    ctx.onMessage(`Mission failed: ${reason}`);
    ctx.audio.fail();
    ctx.onObjective('');
  }

  function completeMission() {
    const def = currentDef();
    status = 'done';
    disarmedMissionId = def.id; // v5 item 7: re-arms on exit, or at once for the next mission id
    completed.push(def.id);
    ctx.addMoney(def.reward);
    ctx.audio.cash();
    hideBeacon();
    ctx.onMessage(`Mission complete: ${def.title} — +$${def.reward.toLocaleString()}`);
    // v6.5 fix: M9 ends by losing the heat — if any wanted level survived
    // the evade (e.g. a fresh crime in the last seconds, before the v6.3
    // escape timer could clear it), clear it here through the same
    // setter the escape path uses, so the mission cannot end with stars
    // still on. In the normal flow wanted is already 0 by now (the
    // escape clears it after ~6 s unseen and main.js toasts
    // "You escaped!"), so this only fires for the re-crime edge case.
    if (def.id === 9 && ctx.combat && ctx.combat.wanted > 0) ctx.combat.setWanted(0);
    ctx.onObjective('');
    ctx.onMissionComplete(def);
    if (def.id === 12) {
      debtPaid = true;
      ctx.onMessage('DEBT PAID — Vera is free. Vice Harbor is hers now.');
    }
    // Auto-advance: next mission becomes available (not auto-started).
    if (missionIndex < MISSION_DEFS.length - 1) {
      missionIndex += 1;
      stageIndex = 0;
    } else {
      status = 'complete';
    }
  }

  function advanceStage() {
    const stage = currentStage();
    ctx.audio.chime();
    stageIndex += 1;
    const def = currentDef();
    if (stageIndex >= def.stages.length) {
      completeMission();
    } else {
      startStage();
    }
  }

  function distTo(x, z) {
    const p = ctx.player.group.position;
    return Math.hypot(p.x - x, p.z - z);
  }

  // v5 item 7 — where the NEXT mission starts, and how big its circle is.
  // Mirrors what startStage() will use for stage 0, so the drawn circle
  // sits on the exact spot the mission begins: goto/hold/enterVehicle use
  // their own x,z; kill uses its first spawn; race uses its first
  // checkpoint snapped onto the road (like startStage does). The trigger
  // radius is at least 12 m — debug.teleport snaps to open ground within
  // 10 m, so a smaller circle could strand the player just outside it
  // after a teleport — and the drawn radius always equals the trigger.
  function startPointFor(def) {
    const s0 = def.stages[0];
    if (!s0) return null;
    let raw = null;
    if (s0.type === 'race') {
      const cp = s0.checkpoints[0];
      if (!cp) return null;
      try {
        const rg = ctx.world && ctx.world.roadGraph;
        if (rg && rg.nearestOnRoad) {
          const p = rg.nearestOnRoad(cp.x, cp.z);
          if (p && typeof p.x === 'number') raw = { x: p.x, z: p.z };
        }
      } catch { /* fall through to the ground snap */ }
      if (!raw) raw = { x: cp.x, z: cp.z };
      const p = snap(raw.x, raw.z);
      return { x: p.x, z: p.z, radius: 12 };
    }
    if (s0.type === 'kill') raw = s0.spawn[0];
    else raw = { x: s0.x, z: s0.z };
    if (!raw || typeof raw.x !== 'number') return null;
    const p = snap(raw.x, raw.z);
    let radius = 12;
    if (s0.type === 'goto' || s0.type === 'hold') radius = Math.max(s0.radius || 10, 12);
    else if (s0.type === 'enterVehicle') radius = Math.max(s0.radius || 14, 12);
    return { x: p.x, z: p.z, radius };
  }

  // v5 item 7 — the gold start circle + proximity auto-start. Runs every
  // frame while no mission is active (idle / done / failed). The next
  // mission is currentDef(): missionIndex already points at it after a
  // completion, and stays on the failed mission after a fail. Suppressed
  // while a side job runs (the beacon belongs to the side job then, and
  // starting a main mission under it would fight over the same marker).
  // Auto-start fires exactly once: startMission flips status to 'active',
  // so this branch stops running until the mission ends.
  function updateStartCircle() {
    const avail = (status !== 'active' && status !== 'complete') ? currentDef() : null;
    if (!avail || sideJob) {
      startCircle.group.visible = false;
      startCircleState = null;
      return;
    }
    const sp = startPointFor(avail);
    if (!sp) {
      startCircle.group.visible = false;
      startCircleState = null;
      return;
    }
    showCircle(startCircle, sp.x, sp.z, sp.radius);
    startCircleState = { x: sp.x, z: sp.z, radius: sp.radius, missionId: avail.id };
    const d = distTo(sp.x, sp.z);
    if (disarmedMissionId !== null && disarmedMissionId !== avail.id) disarmedMissionId = null;
    if (disarmedMissionId === avail.id) {
      if (d > sp.radius + 5) disarmedMissionId = null;
      return;
    }
    if (d < sp.radius) startMission(avail.id);
  }

  // v5 item 7 — the green destination circle for the active stage. Drawn
  // radius always equals the stage's own completion radius, so "inside
  // the circle" and "stage completes" are the same boundary. Follows the
  // live stageTarget (kill targets move, race checkpoints advance).
  // Evade stages have no location: no circle, like the beacon.
  function updateTargetCircle() {
    if (status !== 'active') {
      targetCircle.group.visible = false;
      targetCircleState = null;
      return;
    }
    const stage = currentStage();
    const t = stage ? stageTarget() : null;
    if (!stage || !t) {
      targetCircle.group.visible = false;
      targetCircleState = null;
      return;
    }
    let radius = 10;
    if (stage.type === 'goto' || stage.type === 'hold' || stage.type === 'enterVehicle') radius = stage.radius || 10;
    else if (stage.type === 'race' || stage.type === 'kill') radius = 12;
    showCircle(targetCircle, t.x, t.z, radius);
    targetCircleState = { x: t.x, z: t.z, radius };
  }

  function updateMission(dt) {
    if (status !== 'active') return;
    const stage = currentStage();
    if (!stage) return;
    const p = ctx.player.group.position;
    if (stage.type === 'goto') {
      if (distTo(stageState.tx ?? stage.x, stageState.tz ?? stage.z) < stage.radius) {
        if (stage.wantedOnArrive) ctx.combat.setWanted(stage.wantedOnArrive);
        advanceStage();
      }
    } else if (stage.type === 'kill') {
      const killed = (stageState.spawned || []).filter((e) => e.dead).length;
      stageState.killed = killed;
      ctx.onObjective(`${stage.text.split(' (')[0]} (${killed}/${stage.count})`);
      if (killed >= stage.count) advanceStage();
    } else if (stage.type === 'hold') {
      if (distTo(stageState.tx ?? stage.x, stageState.tz ?? stage.z) < stage.radius) {
        stageState.progress += dt;
        ctx.onObjective(`${stage.text} — ${Math.ceil(stage.seconds - stageState.progress)}s`);
        if (stageState.progress >= stage.seconds) advanceStage();
      } else {
        stageState.progress = Math.max(0, stageState.progress - dt);
      }
    } else if (stage.type === 'enterVehicle') {
      if (ctx.isDriving()) advanceStage();
    } else if (stage.type === 'race') {
      stageState.timeLeft -= dt;
      const cp = (stageState.checkpoints || stage.checkpoints)[stageState.cpIndex];
      if (cp && distTo(cp.x, cp.z) < 12) {
        stageState.cpIndex += 1;
        ctx.audio.chime();
        if (stageState.cpIndex >= (stageState.checkpoints || stage.checkpoints).length) {
          advanceStage();
          return;
        }
        const next = (stageState.checkpoints || stage.checkpoints)[stageState.cpIndex];
        placeBeacon(next.x, next.z);
      }
      ctx.onObjective(`Race: checkpoint ${stageState.cpIndex + 1}/${(stageState.checkpoints || stage.checkpoints).length} — ${Math.ceil(stageState.timeLeft)}s left`);
      if (stageState.timeLeft <= 0) failMission('Out of time');
    } else if (stage.type === 'evade') {
      // v6.5 fix: the countdown runs ONLY while no police unit can see
      // the player. combat.policeCanSee is the v6.3 LOS-aware flag — the
      // same accessor the escape timer uses, so no LOS logic is
      // duplicated here. Standing in the open while SPOTTED freezes the
      // timer: "stay unseen 30s" can no longer be completed by tanking
      // gunfire. Once the v6.3 escape clears wanted (6 s unseen at 2
      // stars) policeCanSee stays false and the timer runs out.
      if (!ctx.combat.policeCanSee) stageState.timeLeft -= dt;
      ctx.onObjective(`Lose the heat — ${Math.ceil(stageState.timeLeft)}s`);
      if (stageState.timeLeft <= 0) advanceStage();
    }
    // Beacon follows moving targets (kill stages).
    if (stage.type === 'kill') {
      const t = stageTarget();
      if (t) placeBeacon(t.x, t.z);
    }
  }

  // ---- Side jobs ----
  function startSideJob(kind) {
    if (sideJob) {
      ctx.onMessage('Finish the current job first.');
      return null;
    }
    const p = ctx.player.group.position;
    if (kind === 'taxi') {
      sideJob = { kind, stage: 'pickup', from: { x: -500, z: 200 }, to: { x: 300, z: -300 }, pay: 350 };
      placeBeacon(sideJob.from.x, sideJob.from.z);
      ctx.onObjective('Taxi: pick up the fare at West Docks');
    } else if (kind === 'package') {
      sideJob = { kind, stage: 'deliver', from: { x: -300, z: -300 }, to: { x: 100, z: 400 }, timeLeft: 120, pay: 450 };
      placeBeacon(sideJob.to.x, sideJob.to.z);
      ctx.onObjective('Package: deliver to South Beach in 120s');
    } else if (kind === 'race') {
      const snapRoad = (x, z) => {
        try {
          const rg = ctx.world && ctx.world.roadGraph;
          if (rg && rg.nearestOnRoad) {
            const p = rg.nearestOnRoad(x, z);
            if (p && typeof p.x === 'number') return { x: p.x, z: p.z };
          }
        } catch { /* fall through */ }
        return { x, z };
      };
      sideJob = {
        kind, stage: 'race', cpIndex: 0, timeLeft: 90, pay: 800,
        checkpoints: [{ x: 200, z: 150 }, { x: -200, z: -150 }, { x: 0, z: 0 }].map((cp) => snapRoad(cp.x, cp.z)),
      };
      placeBeacon(sideJob.checkpoints[0].x, sideJob.checkpoints[0].z);
      ctx.onObjective('Street race: 3 checkpoints in 90s');
    }
    ctx.onMessage(`Side job started: ${kind}`);
    return sideJob;
  }

  function updateSideJob(dt) {
    if (!sideJob) return;
    const p = ctx.player.group.position;
    if (sideJob.kind === 'taxi') {
      const target = sideJob.stage === 'pickup' ? sideJob.from : sideJob.to;
      if (Math.hypot(p.x - target.x, p.z - target.z) < 10) {
        if (sideJob.stage === 'pickup') {
          sideJob.stage = 'dropoff';
          placeBeacon(sideJob.to.x, sideJob.to.z);
          ctx.onObjective('Taxi: drop the fare at Downtown');
        } else {
          ctx.addMoney(sideJob.pay);
          ctx.audio.cash();
          ctx.onMessage(`Taxi done — +$${sideJob.pay}`);
          sideJob = null;
          if (status !== 'active') { hideBeacon(); ctx.onObjective(''); }
        }
      }
    } else if (sideJob.kind === 'package') {
      sideJob.timeLeft -= dt;
      ctx.onObjective(`Package: South Beach — ${Math.ceil(sideJob.timeLeft)}s left`);
      if (Math.hypot(p.x - sideJob.to.x, p.z - sideJob.to.z) < 10) {
        ctx.addMoney(sideJob.pay);
        ctx.audio.cash();
        ctx.onMessage(`Package delivered — +$${sideJob.pay}`);
        sideJob = null;
        if (status !== 'active') { hideBeacon(); ctx.onObjective(''); }
      } else if (sideJob.timeLeft <= 0) {
        ctx.onMessage('Package job failed — too slow.');
        sideJob = null;
        if (status !== 'active') { hideBeacon(); ctx.onObjective(''); }
      }
    } else if (sideJob.kind === 'race') {
      sideJob.timeLeft -= dt;
      const cp = sideJob.checkpoints[sideJob.cpIndex];
      if (cp && Math.hypot(p.x - cp.x, p.z - cp.z) < 12) {
        sideJob.cpIndex += 1;
        ctx.audio.chime();
        if (sideJob.cpIndex >= sideJob.checkpoints.length) {
          ctx.addMoney(sideJob.pay);
          ctx.audio.cash();
          ctx.onMessage(`Race won — +$${sideJob.pay}`);
          sideJob = null;
          if (status !== 'active') { hideBeacon(); ctx.onObjective(''); }
          return;
        }
        placeBeacon(sideJob.checkpoints[sideJob.cpIndex].x, sideJob.checkpoints[sideJob.cpIndex].z);
      }
      ctx.onObjective(`Street race: checkpoint ${sideJob.cpIndex + 1}/3 — ${Math.ceil(sideJob.timeLeft)}s`);
      if (sideJob.timeLeft <= 0) {
        ctx.onMessage('Race failed — out of time.');
        sideJob = null;
        if (status !== 'active') { hideBeacon(); ctx.onObjective(''); }
      }
    }
  }

  return {
    get status() { return status; },
    get missionIndex() { return missionIndex; },
    get stageIndex() { return stageIndex; },
    get completed() { return [...completed]; },
    get debtPaid() { return debtPaid; },
    get sideJob() { return sideJob; },
    currentDef,
    currentStage,
    stageTarget,
    // Mission-icon state for the harness / HUD checks: null when no
    // mission target is active (mission done, evade stage, idle).
    missionMarker() {
      return markerGroup.visible && markerTarget
        ? { x: markerTarget.x, z: markerTarget.z, visible: true }
        : null;
    },
    // Live positions of the peds the current kill stage needs dead
    // (thugs AND police guards — mission 10's guards are police peds).
    stageSpawned() {
      return (stageState.spawned || []).map((e) => ({
        x: e.mesh.position.x, z: e.mesh.position.z, dead: e.dead, kind: e.kind, hp: e.hp,
      }));
    },
    // v5 item 7 — live ground-circle state for the harness / HUD checks:
    // the gold start circle (next mission, while none is active) and the
    // green destination circle (active stage target). Null when hidden.
    missionCircles() {
      return {
        start: startCircleState ? { ...startCircleState, visible: startCircle.group.visible } : null,
        target: targetCircleState ? { ...targetCircleState, visible: targetCircle.group.visible } : null,
      };
    },
    startMission,
    failMission,
    startSideJob,
    listMissions() {
      return MISSION_DEFS.map((d) => ({
        id: d.id, title: d.title, giver: d.giver, reward: d.reward,
        done: completed.includes(d.id),
        current: status === 'active' && currentDef() && currentDef().id === d.id,
      }));
    },
    setState(saved) {
      if (!saved) return;
      missionIndex = Math.max(0, Math.min(MISSION_DEFS.length - 1, saved.missionIndex || 0));
      completed = saved.completed || [];
      debtPaid = !!saved.debtPaid;
      status = 'idle';
      stageIndex = 0;
      disarmedMissionId = null; // v5 item 7: a fresh load starts armed
    },
    getState() {
      return { missionIndex, completed, debtPaid };
    },
    update(dt) {
      animateMarker(dt);
      pulseCircles(dt); // v5 item 7: gold/green ground circles breathe
      updateStartCircle(); // v5 item 7: gold start circle + proximity auto-start
      updateTargetCircle(); // v5 item 7: green destination circle
      updateMission(dt);
      updateSideJob(dt);
    },
  };
}
