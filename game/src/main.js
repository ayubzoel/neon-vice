// Neon Vice — Builder C: boot, fixed-timestep loop, wiring.
// FIXED TIMESTEP (Neon Bay v7 lesson): the scaffold clamped dt to 0.05,
// which collapsed game time at low FPS. Here an accumulator runs the whole
// simulation at a fixed 1/60 s step, max 8 substeps per frame, real dt
// clamped to 0.12 s. Game time = steps * 1/60, so the clock, weather and
// missions advance at a measured, reportable ratio to real time.

import { CONFIG } from './config.js';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createWeather } from './weather.js';
import { createVehicles } from './vehicles.js';
import { createCombat } from './combat.js';
import { createMissions, MISSION_DEFS } from './missions.js';
import { createShops, SHOPS } from './shops.js';
import { createSave } from './save.js';
import { createMap } from './map.js';
import { createUI } from './ui.js';

const canvas = document.getElementById('game');
const errorBox = document.getElementById('webglError');
const startPanel = document.getElementById('startScreen');
const hudState = document.getElementById('hudState');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (err) {
  errorBox.hidden = false;
  errorBox.textContent = `Neon Vice needs WebGL to run. (${err.message})`;
  throw err;
}

// ---- World normalization: Builder B's API if present, scaffold fallback ----
// Guaranteed-by-B contract (when B's rewrite lands): world.spawn,
// world.roadGraph {findPath, nearestOnRoad, isOnRoad}, world.groundHeightAt,
// world.findOpenGround, world.collides, world.destinations, world.counts.
// Until then every access below guards and falls back to the scaffold.
function normalizeWorld(raw) {
  const halfW = CONFIG.world.width / 2 - CONFIG.player.radius;
  const halfD = CONFIG.world.depth / 2 - CONFIG.player.radius;
  return {
    raw,
    spawn: (raw.spawn && typeof raw.spawn.x === 'number') ? raw.spawn : CONFIG.spawn,
    clamp(x, z) {
      if (raw.clamp) return raw.clamp(x, z);
      return { x: Math.max(-halfW, Math.min(halfW, x)), z: Math.max(-halfD, Math.min(halfD, z)) };
    },
    collides: typeof raw.collides === 'function' ? (x, z, r) => raw.collides(x, z, r) : null,
    roadGraph: raw.roadGraph || null,
    destinations: raw.destinations || null,
    groundHeightAt: typeof raw.groundHeightAt === 'function' ? (x, z) => raw.groundHeightAt(x, z) : () => 0,
    findOpenGround: typeof raw.findOpenGround === 'function'
      ? (x, z, r) => raw.findOpenGround(x, z, r) : (x, z) => ({ x, z }),
    counts: raw.counts || {},
  };
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  CONFIG.camera.fov,
  window.innerWidth / window.innerHeight,
  CONFIG.camera.near,
  CONFIG.camera.far,
);

const world = normalizeWorld(createWorld(scene));
const player = createPlayer(scene);
const input = createInput();
input.attach();
const audio = createAudio();
const weather = createWeather(scene);
const vehicles = createVehicles(scene, world);
const combat = createCombat(scene, world, player, audio);

const settings = { lang: 'en', volume: 0.7, quality: 'high' };
const ui = createUI(settings);
const mapSys = createMap(world);

let money = CONFIG.money.start;
let state = 'title'; // 'title' | 'playing'
let paused = false; // an overlay (map/shop/phone/settings) is open
let driving = null; // vehicle Vera is in, or null
let mouseDown = false;
let gameTime = 0; // seconds of game time (fixed steps only)
let wallStart = 0; // performance.now() of the first frame (unclamped wall clock)
let frames = 0;
let fpsFrames = 0;
let fpsWallStart = 0;
let fpsShown = 0;

// GPS arrow: a cone floating above Vera, pointing at the current target.
const gpsArrow = new THREE.Mesh(
  new THREE.ConeGeometry(0.5, 1.4, 4),
  new THREE.MeshBasicMaterial({ color: 0xf472b6 }),
);
gpsArrow.rotation.x = Math.PI / 2;
gpsArrow.visible = false;
scene.add(gpsArrow);

const missions = createMissions(scene, world, {
  player,
  vehicles,
  combat,
  audio,
  world,
  isDriving: () => !!driving,
  getMoney: () => money,
  addMoney: (n) => { money += n; ui.setMoney(money); },
  onMessage: (m) => ui.toast(m, 4200),
  onObjective: (t) => ui.setObjective(t),
  onMissionComplete: () => { save.save(); },
});
// Re-create save with the full context now that missions exist.
const save = createSave({
  player, combat, missions, weather, settings,
  getMoney: () => money,
});
// shops ctx
const shops = createShops(scene, {
  player, combat, audio, world,
  getMoney: () => money,
  spendMoney: (n) => { money -= n; ui.setMoney(money); },
});

// ---- Camera ----
function placeCamera() {
  const target = driving ? driving.mesh.position : player.group.position;
  const heading = driving ? driving.heading : player.heading;
  const backX = -Math.sin(heading) * CONFIG.camera.distance;
  const backZ = -Math.cos(heading) * CONFIG.camera.distance;
  const dist = driving ? CONFIG.camera.distance + 3 : CONFIG.camera.distance;
  camera.position.set(
    target.x + backX * (dist / CONFIG.camera.distance),
    CONFIG.camera.height + (driving ? 1.5 : 0),
    target.z + backZ * (dist / CONFIG.camera.distance),
  );
  camera.lookAt(target.x, CONFIG.camera.lookHeight, target.z);
}

function cameraBasis() {
  // Forward = where the camera looks, on the ground plane; right = screen-right.
  const p = player.group.position;
  let fx = p.x - camera.position.x;
  let fz = p.z - camera.position.z;
  const len = Math.hypot(fx, fz) || 1;
  fx /= len;
  fz /= len;
  return { fx, fz, rx: -fz, rz: fx };
}

// ---- Game flow ----
function applyLoadedSave(data) {
  player.group.position.set(data.x, 0, data.z);
  player.heading = data.heading || 0;
  player.group.rotation.y = player.heading;
  player.hp = data.hp ?? 100;
  money = data.money ?? CONFIG.money.start;
  if (data.weapons) {
    if (data.weapons.smgOwned) combat.buyWeapon('smg');
    combat.weapons.pistol.mag = data.weapons.pistolMag ?? 12;
    combat.weapons.pistol.reserve = data.weapons.pistolReserve ?? 60;
    combat.weapons.smg.mag = data.weapons.smgMag ?? 0;
    combat.weapons.smg.reserve = data.weapons.smgReserve ?? 0;
    if (data.weapons.current) combat.switchWeapon(data.weapons.current);
  }
  if (data.jacketColor) player.setJacket(data.jacketColor);
  if (data.missions) missions.setState(data.missions);
  if (typeof data.hour === 'number') weather.setHour(data.hour);
  if (data.lang) { settings.lang = data.lang; ui.setLang(data.lang); }
  if (typeof data.volume === 'number') { settings.volume = data.volume; audio.setVolume(data.volume); }
  if (data.quality) settings.quality = data.quality;
  applyQuality();
  ui.setMoney(money);
}

function startGame(fromSave) {
  if (fromSave) {
    const data = save.load();
    if (data) applyLoadedSave(data);
  } else {
    player.reset();
    player.group.position.set(world.spawn.x, 0, world.spawn.z);
    player.heading = world.spawn.heading || 0;
    money = CONFIG.money.start;
    ui.setMoney(money);
  }
  state = 'playing';
  startPanel.classList.add('hidden');
  hudState.textContent = 'Playing — WASD move · E interact · M map · B phone';
  audio.unlock();
  ui.setMoney(money);
  ui.toast(fromSave ? 'Save loaded. Welcome back, Vera.' : 'Vera owes Rico $50,000. Mission 1 is waiting — open your phone (B).', 5000);
}

function applyQuality() {
  const ratio = settings.quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(ratio);
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function dieAndRespawn() {
  combat.setWanted(0);
  missions.failMission('Vera went down');
  money = Math.max(0, Math.floor(money * 0.9));
  ui.setMoney(money);
  ui.toast('You woke up at the clinic. Hospital bill: 10% of your cash.', 5000);
  if (driving) driving = null;
  player.reset();
  player.group.position.set(world.spawn.x, 0, world.spawn.z);
  player.heading = world.spawn.heading || 0;
  player.group.rotation.y = player.heading;
}

// ---- Interaction (E) ----
function nearestInteractable() {
  const p = player.group.position;
  const v = vehicles.nearestVehicle(p.x, p.z, 4.5);
  if (v) return { kind: 'vehicle', vehicle: v };
  // Boats sit in the water just past the shore: allow boarding from the dock.
  const boat = vehicles.list.find((x) => x.kind === 'boat' && Math.hypot(x.mesh.position.x - p.x, x.mesh.position.z - p.z) < 12);
  if (boat) return { kind: 'vehicle', vehicle: boat };
  const shop = shops.nearestShop(p.x, p.z, 12);
  if (shop) return { kind: 'shop', shop };
  return null;
}

function doInteract() {
  if (driving) {
    // Exit: place Vera beside the car on open ground.
    const v = driving;
    driving = null;
    const spot = world.findOpenGround(v.mesh.position.x + 3, v.mesh.position.z, 4);
    player.group.position.set(spot.x, 0, spot.z);
    player.group.visible = true;
    return;
  }
  const near = nearestInteractable();
  if (!near) return;
  if (near.kind === 'vehicle') {
    driving = near.vehicle;
    driving.parked = false;
    player.group.visible = false;
    audio.unlock();
  } else if (near.kind === 'shop') {
    openShop(near.shop);
  }
}

// ---- Panels ----
function openShop(shop) {
  paused = true;
  const panel = document.getElementById('shopPanel');
  document.getElementById('shopTitle').textContent = shop.name;
  const list = document.getElementById('shopItems');
  list.innerHTML = '';
  for (const item of shop.items) {
    const row = document.createElement('div');
    row.className = 'shopRow';
    const owned = item.id === 'smg' && combat.weapons.smg.owned;
    row.innerHTML = `<span><b>${item.name}</b><br><small>${item.desc}</small></span><span>$${item.price}${owned ? ' · OWNED' : ''}</span>`;
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = owned ? 'Owned' : 'Buy';
    btn.disabled = owned;
    btn.addEventListener('click', () => {
      const res = shops.buy(shop.id, item.id);
      ui.toast(res.message);
      if (res.ok) openShop(shop); // refresh owned state
    });
    row.appendChild(btn);
    list.appendChild(row);
  }
  panel.classList.remove('hidden');
}
function closeShop() {
  document.getElementById('shopPanel').classList.add('hidden');
  paused = false;
}

function openPhone() {
  paused = true;
  const panel = document.getElementById('phonePanel');
  const list = document.getElementById('phoneJobs');
  list.innerHTML = '';
  const mkBtn = (label, fn) => {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = label;
    b.addEventListener('click', () => { fn(); closePhone(); });
    list.appendChild(b);
  };
  mkBtn(`${ui.t('taxi')} — $350`, () => missions.startSideJob('taxi'));
  mkBtn(`${ui.t('package')} — $450`, () => missions.startSideJob('package'));
  mkBtn(`${ui.t('race')} — $800`, () => missions.startSideJob('race'));
  const cur = missions.currentDef();
  if (cur) {
    const m = document.createElement('p');
    m.textContent = `Mission ${cur.id}: ${cur.title} — ${missions.status}`;
    list.appendChild(m);
    mkBtn(`Restart mission ${cur.id}`, () => missions.startMission(cur.id));
  }
  const all = document.createElement('div');
  all.innerHTML = '<b>All missions</b><br>' + missions.listMissions().map((d) => `${d.done ? '✓' : d.current ? '▶' : '·'} ${d.id}. ${d.title} — $${d.reward}`).join('<br>');
  list.appendChild(all);
  panel.classList.remove('hidden');
}
function closePhone() {
  document.getElementById('phonePanel').classList.add('hidden');
  paused = false;
}

function openMap() {
  paused = true;
  mapSys.open();
  document.getElementById('mapOverlay').classList.remove('hidden');
  resizeMapCanvas();
}
function closeMap() {
  mapSys.close();
  document.getElementById('mapOverlay').classList.add('hidden');
  paused = false;
}
function resizeMapCanvas() {
  const c = document.getElementById('mapCanvas');
  c.width = Math.min(window.innerWidth - 24, 900);
  c.height = Math.min(window.innerHeight - 120, 700);
}

// ---- Fixed-timestep simulation ----
const STEP = 1 / 60;
let acc = 0;
let lastNow = performance.now();
let stepBudget = 8; // max substeps per frame (mandated default); the debug
// hook below may raise it for fast playtests — shipped play stays at 8.

function step(dt) {
  gameTime += dt;
  if (paused || state !== 'playing') return;
  const pressed = input.consumePressed();
  const frameInput = input.read();
  frameInput.jump = pressed.has('jump');

  // Actions.
  if (pressed.has('interact')) doInteract();
  if (pressed.has('holster')) {
    combat.toggleHolster();
    ui.toast(combat.holstered ? 'Weapon holstered' : `Weapon out: ${combat.weapons[combat.current].name}`);
  }
  if (pressed.has('weapon1')) combat.switchWeapon('pistol');
  if (pressed.has('weapon2')) combat.switchWeapon('smg');
  if (pressed.has('reload')) combat.reload();
  if (pressed.has('mute')) {
    audio.setMuted(!audio.isMuted());
    ui.toast(audio.isMuted() ? 'Muted' : 'Sound on');
  }
  if (pressed.has('map')) { openMap(); return; }
  if (pressed.has('phone')) { openPhone(); return; }

  // Movement.
  if (driving) {
    vehicles.driveVehicle(driving, frameInput, dt);
    audio.setEngine(Math.abs(driving.speed) / driving.maxSpeed, true);
    player.group.position.copy(driving.mesh.position);
    player.heading = driving.heading;
  } else {
    player.update(dt, frameInput, world, cameraBasis());
    audio.setEngine(0, false);
  }
  vehicles.update(dt);

  // Combat.
  if ((frameInput.fire || mouseDown) && !driving) combat.shoot();
  combat.update(dt, gameTime, !!driving);

  // Missions + weather.
  missions.update(dt);
  weather.update(dt, player.group.position.x, player.group.position.z);

  // Death.
  if (player.hp <= 0) dieAndRespawn();
}

// ---- HUD ----
let hudTimer = 0;
function updateHud(dt) {
  hudTimer += dt;
  if (hudTimer < 0.12) return;
  hudTimer = 0;
  const p = player.group.position;
  document.getElementById('hudPos').textContent = `x ${p.x.toFixed(0)} · z ${p.z.toFixed(0)} · ${player.speed.toFixed(1)} m/s`;
  document.getElementById('hudFps').textContent = `${fpsShown} FPS · ${weather.clockText()}`;
  ui.setMoney(money);
  ui.setWanted(combat.wanted);
  ui.setHp(player.hp, player.maxHp);
  ui.setAmmo(driving ? '—' : `${combat.weapons[combat.current].name} ${combat.ammoText()}${combat.isReloading() ? ' …' : ''}`);
  ui.setClock(weather.clockText(), weather.raining);
  const target = missions.stageTarget() || mapSys.gpsTarget;
  if (target) {
    const d = Math.hypot(p.x - target.x, p.z - target.z);
    ui.setGps(d, mapSys.gpsTarget ? mapSys.gpsTarget.name : (missions.currentStage()?.text || 'Target'));
    gpsArrow.visible = true;
    gpsArrow.position.set(p.x, 3.2, p.z);
    // Cone points +Y by default; order YXZ with X=90° points it along the
    // heading (sin ang, 0, cos ang) toward the target.
    gpsArrow.rotation.order = 'YXZ';
    gpsArrow.rotation.set(Math.PI / 2, Math.atan2(target.x - p.x, target.z - p.z), 0);
  } else {
    ui.setGps(0, null);
    gpsArrow.visible = false;
  }
  // Interaction hint.
  const hint = document.getElementById('hudHint');
  if (!driving) {
    const near = nearestInteractable();
    if (near?.kind === 'vehicle') hint.textContent = ui.t('enterCar');
    else if (near?.kind === 'shop') hint.textContent = `${near.shop.name} — ${ui.t('enterCar').replace('enter', 'open')}`;
    else hint.textContent = 'WASD move · Shift run · E interact · M map · B phone · H holster';
  } else {
    hint.textContent = ui.t('exitCar');
  }
  // Minimap.
  ui.drawMinimap(
    document.getElementById('minimap'),
    p, player.heading,
    missions.stageTarget(),
    Object.values(CONFIG.places),
    mapSys.gpsTarget,
  );
  // Map overlay redraw.
  if (mapSys.isOpen) {
    mapSys.draw(document.getElementById('mapCanvas'), p, player.heading);
  }
}

// ---- Frame loop ----
function frame(now) {
  requestAnimationFrame(frame);
  if (!wallStart) {
    wallStart = now;
    fpsWallStart = now;
  }
  const dtReal = Math.min(Math.max(0, (now - lastNow) / 1000), 0.12);
  lastNow = now;
  acc += dtReal;
  let steps = 0;
  while (acc >= STEP && steps < stepBudget) {
    step(STEP);
    acc -= STEP;
    steps += 1;
  }
  if (steps === stepBudget) acc = 0; // spiral guard: drop backlog, game time lags honestly
  placeCamera();
  renderer.render(scene, camera);
  updateHud(dtReal);

  // FPS from unclamped wall-clock frames, not the clamped dt.
  fpsFrames += 1;
  const wallSec = (now - fpsWallStart) / 1000;
  if (wallSec >= 1) {
    fpsShown = Math.round(fpsFrames / wallSec);
    fpsFrames = 0;
    fpsWallStart = now;
  }

  frames += 1;
  if (frames === 1) {
    window.NEON_VICE = {
      ready: true,
      title: CONFIG.title,
      hero: () => ({ x: player.group.position.x, z: player.group.position.z, heading: player.heading }),
      state: () => state,
      stats: () => ({
        fps: fpsShown, gameTime,
        // Wall-clock elapsed (UNCLAMPED) so the ratio is honest: the dt clamp
        // must never be allowed to flatter the ratio.
        realElapsed: wallStart ? (performance.now() - wallStart) / 1000 : 0,
        ratio: wallStart ? gameTime / ((performance.now() - wallStart) / 1000) : 0,
        money, wanted: combat.wanted, hp: player.hp,
        mission: missions.status, missionId: missions.currentDef()?.id ?? null,
        driving: !!driving, hour: weather.hour, raining: weather.raining,
      }),
      game: { player, vehicles, combat, missions, shops, weather, save, map: mapSys, ui, audio, input },
      debug: {
        startMission: (n) => {
          const def = missions.startMission(n);
          // Teleport near the first stage so the tester can play it at once.
          const target = missions.stageTarget();
          if (target) {
            const spot = world.findOpenGround(target.x, target.z + 15, 20);
            player.group.position.set(spot.x, 0, spot.z);
            player.heading = Math.atan2(target.x - spot.x, target.z - spot.z);
          }
          return def;
        },
        listMissions: () => missions.listMissions(),
        teleport: (x, z) => {
          const spot = world.findOpenGround(x, z, 10);
          player.group.position.set(spot.x, 0, spot.z);
          if (driving) { driving.mesh.position.set(spot.x, 0, spot.z); }
        },
        setMoney: (n) => { money = n; ui.setMoney(money); },
        giveWeapon: (kind) => combat.buyWeapon(kind),
        setWanted: (n) => combat.setWanted(n),
        setHp: (n) => { player.hp = Math.max(0, Math.min(player.maxHp, n)); },
        startSideJob: (kind) => missions.startSideJob(kind),
        setHour: (h) => weather.setHour(h),
        setRain: (on) => weather.setRain(on),
        // Test hook only: raise the substep budget so game time runs faster
        // than real time under SwiftShader. Shipped default is 8.
        setStepBudget: (n) => { stepBudget = Math.max(1, Math.min(60, n | 0)); },
        state: () => ({ money, hp: player.hp, wanted: combat.wanted, mission: missions.status, missionId: missions.currentDef()?.id }),
      },
    };
  }
}

// ---- DOM wiring ----
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (mapSys.isOpen) resizeMapCanvas();
});

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button === 0) mouseDown = true;
});
window.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse' && e.button === 0) mouseDown = false;
});

document.getElementById('btnNew').addEventListener('click', () => startGame(false));
document.getElementById('btnContinue').addEventListener('click', () => startGame(true));
document.getElementById('btnSettings').addEventListener('click', () => {
  paused = state === 'playing';
  document.getElementById('settingsPanel').classList.remove('hidden');
});
document.getElementById('btnCloseSettings').addEventListener('click', () => {
  document.getElementById('settingsPanel').classList.add('hidden');
  paused = false;
});
document.getElementById('btnCloseShop').addEventListener('click', closeShop);
document.getElementById('btnClosePhone').addEventListener('click', closePhone);
document.getElementById('btnCloseMap').addEventListener('click', closeMap);
document.getElementById('mapCanvas').addEventListener('click', (e) => {
  const rect = e.target.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  // Nearest destination in canvas space (recompute the same projection).
  const canvasEl = e.target;
  const W = CONFIG.world.width;
  const D = CONFIG.world.depth;
  const scale = Math.min(canvasEl.width / W, canvasEl.height / D) * 0.92;
  const ox = (canvasEl.width - W * scale) / 2;
  const oy = (canvasEl.height - D * scale) / 2;
  let best = null;
  let bestD = 30;
  for (const d of mapSys.destinations()) {
    const mx = ox + (d.x + W / 2) * scale;
    const my = oy + (d.z + D / 2) * scale;
    const dist = Math.hypot(mx - x, my - y);
    if (dist < bestD) { bestD = dist; best = d; }
  }
  if (best) {
    mapSys.setGps(best.name);
    ui.toast(`GPS set: ${best.name}`);
  }
});
document.getElementById('volSlider').addEventListener('input', (e) => {
  settings.volume = Number(e.target.value);
  audio.setVolume(settings.volume);
});
document.getElementById('qualitySel').addEventListener('change', (e) => {
  settings.quality = e.target.value;
  applyQuality();
});
document.getElementById('langSel').addEventListener('change', (e) => {
  ui.setLang(e.target.value);
});

// Continue button only when a save exists.
if (save.exists()) {
  document.getElementById('btnContinue').classList.remove('hidden');
}

applyQuality();
placeCamera();
ui.setMoney(money);
ui.setLang(settings.lang);
requestAnimationFrame(frame);
