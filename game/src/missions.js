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
      checkpoints: [
        { x: 0, z: 0 }, { x: 300, z: -300 }, { x: -300, z: -300 }, { x: 0, z: 300 },
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

  let missionIndex = 0; // index into MISSION_DEFS
  let stageIndex = 0;
  let status = 'idle'; // idle | active | done | failed | complete (all 12 done)
  let stageState = {};
  let completed = [];
  let debtPaid = false;

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
  }
  function hideBeacon() {
    beacon.visible = false;
    ring.visible = false;
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
      if (!near || near.kind !== stage.kind) {
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
    hideBeacon();
    ctx.onMessage(`Mission failed: ${reason}`);
    ctx.audio.fail();
    ctx.onObjective('');
  }

  function completeMission() {
    const def = currentDef();
    status = 'done';
    completed.push(def.id);
    ctx.addMoney(def.reward);
    ctx.audio.cash();
    hideBeacon();
    ctx.onMessage(`Mission complete: ${def.title} — +$${def.reward.toLocaleString()}`);
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
      stageState.timeLeft -= dt;
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
    // Live positions of the peds the current kill stage needs dead
    // (thugs AND police guards — mission 10's guards are police peds).
    stageSpawned() {
      return (stageState.spawned || []).map((e) => ({
        x: e.mesh.position.x, z: e.mesh.position.z, dead: e.dead, kind: e.kind, hp: e.hp,
      }));
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
    },
    getState() {
      return { missionIndex, completed, debtPaid };
    },
    update(dt) {
      updateMission(dt);
      updateSideJob(dt);
    },
  };
}
