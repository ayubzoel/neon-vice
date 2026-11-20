// Neon Vice — Builder C: boot, fixed-timestep loop, wiring.
// FIXED TIMESTEP (Neon Bay v7 lesson): the scaffold clamped dt to 0.05,
// which collapsed game time at low FPS. Here an accumulator runs the whole
// simulation at a fixed 1/60 s step, max 8 substeps per frame, real dt
// clamped to 0.12 s. Game time = steps * 1/60, so the clock, weather and
// missions advance at a measured, reportable ratio to real time.

import { CONFIG } from './config.js';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createInput, getBindings } from './input.js';
import { createAudio } from './audio.js';
import { createWeather } from './weather.js';
import { createVehicles } from './vehicles.js';
import { createAmbient } from './ambient.js';
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

// Cheap software-renderer probe (before the real renderer exists): a
// throwaway context reveals SwiftShader/llvmpipe, where antialias + a
// device-pixel-ratio > 1 are pure fill-rate cost. On software rendering we
// create the renderer without antialias and default to low quality.
let softwareGL = false;
try {
  const probe = document.createElement('canvas').getContext('webgl');
  const ext = probe && probe.getExtension('WEBGL_debug_renderer_info');
  const rendererName = ext ? probe.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
  softwareGL = /swiftshader|llvmpipe|software|basic render/i.test(String(rendererName));
  if (probe) probe.getExtension('WEBGL_lose_context')?.loseContext();
} catch { /* keep defaults */ }

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !softwareGL });
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
    isInWater: typeof raw.isInWater === 'function'
      ? (x, z) => raw.isInWater(x, z)
      : (x, z) => x > CONFIG.water.x0 - 2,
    roadGraph: raw.roadGraph || null,
    destinations: raw.destinations || null,
    groundHeightAt: typeof raw.groundHeightAt === 'function' ? (x, z) => raw.groundHeightAt(x, z) : () => 0,
    findOpenGround: typeof raw.findOpenGround === 'function'
      // B's findOpenGround returns null when nothing is open within maxR;
      // callers expect a point, so fall back to the raw coordinates.
      ? (x, z, r) => raw.findOpenGround(x, z, r) || { x, z } : (x, z) => ({ x, z }),
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
const ambient = createAmbient(scene, world, vehicles, { isDriven: (v) => v === driving });
const combat = createCombat(scene, world, player, audio);

const settings = { lang: 'en', volume: 0.7, musicVolume: 0.8, sfxVolume: 0.9, muted: false, quality: softwareGL ? 'low' : 'high' };
const ui = createUI(settings);
const mapSys = createMap(world);

// Jackets Vera owns (hex colours). Teal is the starting jacket; buying one
// at Vice Threads adds it here, and Backpack equips owned ones for free.
// Persisted in the save (save.js) so the collection survives reload.
let ownedJackets = [CONFIG.colors.heroBody];

let money = CONFIG.money.start;
let state = 'title'; // 'title' | 'playing'
let paused = false; // an overlay (map/shop/phone/settings) is open
let overlay = null; // 'map' | 'shop' | 'phone' | 'settings' | null — which overlay paused the game
let driving = null; // vehicle Vera is in, or null
let mouseDown = false;
let gameTime = 0; // seconds of game time (fixed steps only)
let wallStart = 0; // performance.now() of the first frame (unclamped wall clock)
let frames = 0;
let fpsFrames = 0;
let fpsWallStart = 0;
let fpsShown = 0;

// GPS arrow: a small slim cone floating just above Vera, pointing at the
// current target. The old one (r=0.5, h=1.4, 4 segments) was as big as
// Vera and read as a pink diamond/kite — its square cross-section looked
// like a diamond from the chase camera and its direction was unreadable.
// Slim + round (12 segments) + half the size reads as an arrowhead.
const gpsArrow = new THREE.Mesh(
  new THREE.ConeGeometry(0.22, 0.9, 12),
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
  getOwnedJackets: () => ownedJackets.slice(),
});
// shops ctx
const shops = createShops(scene, {
  player, combat, audio, world,
  getMoney: () => money,
  spendMoney: (n) => { money -= n; ui.setMoney(money); },
});

// ---- Camera ----
// Camera yaw: follows the player's heading, EXCEPT while the touch stick
// is steering — then it stays frozen. The camera sits behind the player's
// heading, so if it swung with every stick turn, "screen-right" would
// rotate under the player and the stick would spin them in circles
// instead of moving them right (joystick test, 2026-11-20).
let camYaw = CONFIG.spawn.heading || 0;
function placeCamera() {
  const target = driving ? driving.mesh.position : player.group.position;
  const stick = !driving && input.read().stick;
  if (!stick || !stick.active) camYaw = driving ? driving.heading : player.heading;
  const heading = driving ? driving.heading : camYaw;
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
  if (Array.isArray(data.ownedJackets) && data.ownedJackets.length) {
    ownedJackets = data.ownedJackets.filter((c) => typeof c === 'number');
    if (!ownedJackets.includes(player.jacketColor)) ownedJackets.push(player.jacketColor);
  } else if (data.jacketColor) {
    ownedJackets = [data.jacketColor];
  }
  if (data.missions) missions.setState(data.missions);
  if (typeof data.hour === 'number') weather.setHour(data.hour);
  if (data.lang) { settings.lang = data.lang; ui.setLang(data.lang); }
  if (typeof data.volume === 'number') { settings.volume = data.volume; audio.setVolume(data.volume); }
  if (typeof data.musicVolume === 'number') { settings.musicVolume = data.musicVolume; audio.setMusicVolume(data.musicVolume); }
  if (typeof data.sfxVolume === 'number') { settings.sfxVolume = data.sfxVolume; audio.setSfxVolume(data.sfxVolume); }
  if (typeof data.muted === 'boolean') { settings.muted = data.muted; audio.setMuted(data.muted); }
  if (data.quality) settings.quality = data.quality;
  applyQuality();
  syncSettingsInputs();
  ui.setMoney(money);
}

// Keep the Settings panel controls in sync with the live settings object
// (used after loading a save, and every time the panel opens).
function syncSettingsInputs() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('volSlider', settings.volume);
  set('musicSlider', settings.musicVolume);
  set('sfxSlider', settings.sfxVolume);
  const mute = document.getElementById('muteChk');
  if (mute) mute.checked = !!settings.muted;
  const q = document.getElementById('qualitySel');
  if (q) q.value = settings.quality;
  const l = document.getElementById('langSel');
  if (l) l.value = settings.lang;
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
  // HUD only exists while playing (BUG polish 8): it sat behind the title.
  // The keyboard hint is keyboard-only: on a touch device it must stay
  // hidden (class AND the body.touch-device CSS rule), or the WASD bar
  // shows on phones — the old code un-hid it unconditionally, and the
  // width-only media query was the only thing hiding it (a wide touch
  // viewport showed it). The HUD state line gets touch wording too.
  const isTouch = document.body.classList.contains('touch-device');
  for (const id of ['hud', 'minimap']) document.getElementById(id)?.classList.remove('hidden');
  // Desktop quick buttons (MAP / PACK / SET, top-right under the minimap).
  // On touch devices the CSS hides them — the #touch buttons serve instead.
  document.getElementById('quickBtns')?.classList.remove('hidden');
  if (!isTouch) document.getElementById('hudHint')?.classList.remove('hidden');
  hudState.textContent = isTouch
    ? 'Playing — left stick to move · buttons to act'
    : 'Playing — WASD move · E interact · M map · B backpack · Esc settings';
  audio.unlock();
  ui.setMoney(money);
  ui.toast(fromSave ? 'Save loaded. Welcome back, Vera.' : 'Vera owes Rico $50,000. Mission 1 is waiting — open your phone (B).', 5000);
}

function applyQuality() {
  // Low on a software renderer also renders at 0.75x backing resolution
  // (upscaled by CSS): SwiftShader is fill-rate bound, so ~44% fewer
  // fragments is the cheapest real FPS win. Real GPUs keep full res.
  const ratio = settings.quality === 'low'
    ? (softwareGL ? 0.75 : 1)
    : Math.min(window.devicePixelRatio || 1, 2);
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
  const v = vehicles.nearestVehicle(p.x, p.z, 6);
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
    // Exit: place Vera beside the vehicle on open ground. A boat sits in
    // deep water, where Vera cannot stand — so for boats search far enough
    // to reach the shore (BUG-1 soft-lock: the old 4 m search fell back to
    // the water position and Vera froze). Swimming (player.js) is the
    // second safety net if she ever ends up in the water anyway.
    const v = driving;
    driving = null;
    const spot = v.kind === 'boat'
      ? world.findOpenGround(v.mesh.position.x, v.mesh.position.z, 160)
      : world.findOpenGround(v.mesh.position.x + 3, v.mesh.position.z, 4);
    player.group.position.set(spot.x, 0, spot.z);
    player.group.visible = true;
    if (v.kind === 'boat') ui.toast(world.isInWater && world.isInWater(spot.x, spot.z) ? 'Swim to shore — hold W' : 'You wade ashore.');
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
  overlay = 'shop';
  const panel = document.getElementById('shopPanel');
  document.getElementById('shopTitle').textContent = shop.name;
  const list = document.getElementById('shopItems');
  list.innerHTML = '';
  for (const item of shop.items) {
    const row = document.createElement('div');
    row.className = 'shopRow';
    const owned = item.id === 'smg' && combat.weapons.smg.owned;
    const needsSmg = item.id === 'smgAmmo' && !combat.weapons.smg.owned;
    row.innerHTML = `<span><b>${item.name}</b><br><small>${item.desc}${needsSmg ? ' · requires SMG' : ''}</small></span><span>$${item.price}${owned ? ' · OWNED' : ''}</span>`;
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = owned ? 'Owned' : 'Buy';
    btn.disabled = owned;
    btn.addEventListener('click', () => {
      const res = shops.buy(shop.id, item.id);
      ui.toast(res.message);
      // A jacket bought here joins the Backpack collection (equip free there).
      if (res.ok && item.color !== undefined && !ownedJackets.includes(item.color)) {
        ownedJackets.push(item.color);
      }
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
  if (overlay === 'shop') overlay = null;
}

// ---- Backpack / Phone (one combined panel, two tabs) ----
// B (and the PACK touch button) opens it on the Backpack tab; the Phone tab
// holds exactly the old Phone contents (side jobs, mission list, restart),
// so nothing the harness or the player relied on goes away. Overlay name
// stays 'phone' so the pause handling below is unchanged.
const JACKET_HEX = (c) => `#${c.toString(16).padStart(6, '0')}`;
let packTab = 'backpack'; // 'backpack' | 'phone'

function renderBackpackTab() {
  const list = document.getElementById('backpackItems');
  if (!list) return;
  list.innerHTML = '';
  // Holster state.
  const hol = document.createElement('p');
  hol.textContent = combat.holstered
    ? 'Weapon holstered — Vera walks unarmed.'
    : `Weapon out: ${combat.weapons[combat.current].name}`;
  list.appendChild(hol);
  const holBtn = document.createElement('button');
  holBtn.className = 'btn small';
  holBtn.textContent = combat.holstered ? ui.t('draw') : ui.t('holster');
  holBtn.addEventListener('click', () => { combat.toggleHolster(); renderBackpackTab(); });
  list.appendChild(holBtn);
  // Weapons.
  const wh = document.createElement('h3');
  wh.textContent = ui.t('weapons');
  list.appendChild(wh);
  for (const kind of ['pistol', 'smg']) {
    const w = combat.weapons[kind];
    const row = document.createElement('div');
    row.className = 'shopRow';
    row.innerHTML = w.owned
      ? `<span><b>${w.name}</b>${combat.current === kind ? ' · ★' : ''}<br><small>Mag ${w.mag}/${w.magSize} · Reserve ${w.reserve}/${w.reserveMax}</small></span>`
      : `<span><b>${w.name}</b><br><small>${ui.t('notOwned')} — buy at Ammo-Nation</small></span>`;
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = combat.current === kind ? ui.t('equipped') : ui.t('equip');
    btn.disabled = !w.owned || combat.current === kind;
    btn.addEventListener('click', () => { combat.switchWeapon(kind); renderBackpackTab(); });
    row.appendChild(btn);
    list.appendChild(row);
  }
  // Jackets (catalogue = Vice Threads items in shops.js, single source).
  const jh = document.createElement('h3');
  jh.textContent = ui.t('jackets');
  list.appendChild(jh);
  const cloth = SHOPS.find((s) => s.id === 'cloth');
  for (const item of cloth ? cloth.items : []) {
    const owned = ownedJackets.includes(item.color);
    const worn = player.jacketColor === item.color;
    const row = document.createElement('div');
    row.className = 'shopRow';
    row.innerHTML = `<span><span class="swatch" style="background:${JACKET_HEX(item.color)}"></span><b>${item.name}</b>${worn ? ` · ${ui.t('worn')}` : ''}<br><small>${owned ? ui.t('owned') : `$${item.price} · ${ui.t('notOwned')}`}</small></span>`;
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = worn ? ui.t('worn') : owned ? ui.t('equip') : ui.t('buyEquip');
    btn.disabled = worn;
    btn.addEventListener('click', () => {
      if (!owned) {
        if (money < item.price) { ui.toast('Not enough cash.'); return; }
        money -= item.price;
        ui.setMoney(money);
        ownedJackets.push(item.color);
      }
      player.setJacket(item.color);
      renderBackpackTab();
    });
    row.appendChild(btn);
    list.appendChild(row);
  }
}

function renderPhoneTab() {
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
}

function showPackTab(tab) {
  packTab = tab;
  document.getElementById('tabBackpack')?.classList.toggle('active', tab === 'backpack');
  document.getElementById('tabPhone')?.classList.toggle('active', tab === 'phone');
  document.getElementById('backpackItems')?.classList.toggle('hidden', tab !== 'backpack');
  document.getElementById('phoneJobs')?.classList.toggle('hidden', tab !== 'phone');
  document.getElementById('phoneTitle').textContent = tab === 'backpack' ? `Backpack — Vera` : `Phone — Vera`;
  if (tab === 'backpack') renderBackpackTab();
  else renderPhoneTab();
}

function openPack(tab = 'backpack') {
  paused = true;
  overlay = 'phone';
  document.getElementById('phonePanel').classList.remove('hidden');
  showPackTab(tab);
}
function closePack() {
  document.getElementById('phonePanel').classList.add('hidden');
  paused = false;
  if (overlay === 'phone') overlay = null;
}
// Old names kept as thin aliases (step() + any debug caller).
function openPhone() { openPack('phone'); }
function closePhone() { closePack(); }

function openMap() {
  paused = true;
  overlay = 'map';
  mapSys.open();
  document.getElementById('mapOverlay').classList.remove('hidden');
  resizeMapCanvas();
}
function closeMap() {
  mapSys.close();
  document.getElementById('mapOverlay').classList.add('hidden');
  paused = false;
  if (overlay === 'map') overlay = null;
}
// ---- Settings (in-game pause panel) ----
// Opens over the game and pauses it (overlay 'settings'); from the title
// screen it opens without pausing anything. Every open re-syncs the
// controls with the live settings, so a loaded save is shown correctly.
function openSettings() {
  syncSettingsInputs();
  buildControlsList();
  if (state === 'playing') {
    paused = true;
    overlay = 'settings';
  }
  document.getElementById('settingsPanel').classList.remove('hidden');
}
function closeSettings() {
  document.getElementById('settingsPanel').classList.add('hidden');
  paused = false;
  if (overlay === 'settings') overlay = null;
}
function buildControlsList() {
  const el = document.getElementById('controlsList');
  if (!el || el.dataset.built) return;
  el.dataset.built = '1';
  el.innerHTML = getBindings()
    .map((b) => `<div class="ctlRow"><span>${b.label}</span><b>${b.keys}</b></div>`)
    .join('');
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
  // Consume edge-triggered presses FIRST, before the paused/title check
  // (BUG-2/3): the old code returned early while paused, so a key pressed
  // while an overlay was open sat in the queue and fired the frame after
  // the overlay closed — M reopened the map by itself. While paused, the
  // overlay's own toggle key closes it and everything else is discarded.
  const pressed = input.consumePressed();
  if (paused || state !== 'playing') {
    // Esc / P closes whichever overlay is open (no soft-lock: every panel
    // has a close path). Title-screen settings close the same way.
    if (pressed.has('pause')) {
      if (overlay === 'map') closeMap();
      else if (overlay === 'phone') closePhone();
      else if (overlay === 'shop') closeShop();
      else if (overlay === 'settings') closeSettings();
      else if (state !== 'playing') closeSettings();
    } else if (paused && overlay === 'map' && pressed.has('map')) closeMap();
    else if (paused && overlay === 'phone' && (pressed.has('phone') || pressed.has('backpack'))) closePhone();
    else if (paused && overlay === 'shop' && pressed.has('interact')) closeShop();
    return;
  }
  // Game time only advances while actually simulating (Builder UI fix: it
  // used to tick above the pause check, so the clock kept running behind
  // the map/phone/shop/settings panels — a pause that doesn't pause).
  gameTime += dt;
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
  if (pressed.has('backpack')) { openPack('backpack'); return; }
  if (pressed.has('phone')) { openPack('phone'); return; }
  if (pressed.has('pause')) { openSettings(); return; }

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
  ambient.update(dt);

  // Combat. No shooting while swimming (BUG-1 swim rules).
  if ((frameInput.fire || mouseDown) && !driving && !player.swimming) combat.shoot();
  combat.update(dt, gameTime, !!driving);

  // Missions + weather.
  missions.update(dt);
  weather.update(dt, player.group.position.x, player.group.position.z);

  // Death.
  if (player.hp <= 0) dieAndRespawn();
}

// ---- HUD ----
let hudTimer = 0;
let minimapTimer = 0;
let lowFpsStreak = 0;
let autoDegraded = false;
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
  // GPS (BUG-GPS): name, distance and the 3D arrow must all point at the
  // SAME target. GPS wins when set; otherwise the mission target with the
  // mission stage name. The old code measured the mission target but
  // labelled it with the GPS destination name.
  const gps = mapSys.gpsTarget;
  const missionTarget = missions.stageTarget();
  const target = gps || missionTarget;
  if (target) {
    const d = Math.hypot(p.x - target.x, p.z - target.z);
    ui.setGps(d, gps ? gps.name : (missions.currentStage()?.text || 'Target'));
    gpsArrow.visible = true;
    gpsArrow.position.set(p.x, 2.7, p.z);
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
  if (player.swimming) {
    hint.textContent = 'Swimming — steer toward the shore';
  } else if (!driving) {
    const near = nearestInteractable();
    if (near?.kind === 'vehicle') hint.textContent = ui.t('enterCar');
    else if (near?.kind === 'shop') hint.textContent = `${near.shop.name} — ${ui.t('enterCar').replace('enter', 'open')}`;
    else hint.textContent = 'WASD move · Shift run · E interact · M map · B backpack · H holster';
  } else {
    hint.textContent = ui.t('exitCar');
  }
  // Minimap (throttled: redrawn every ~0.36 s, not every HUD tick).
  minimapTimer += dt;
  if (minimapTimer >= 0.36) {
    minimapTimer = 0;
    ui.drawMinimap(
      document.getElementById('minimap'),
      p, player.heading,
      missions.stageTarget(),
      Object.values(CONFIG.places),
      mapSys.gpsTarget,
      world.roadGraph ? world.roadGraph.segments : null,
    );
  }
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
    // Auto-degrade once: sustained < 18 FPS on high quality drops to low
    // (pixel ratio 1, no antialias effect at runtime — the probe already
    // disabled it at creation on software GL). Cheap, no visual redesign.
    if (!autoDegraded && settings.quality !== 'low' && fpsShown > 0 && fpsShown < 18) {
      lowFpsStreak += 1;
      if (lowFpsStreak >= 4) {
        autoDegraded = true;
        settings.quality = 'low';
        const sel = document.getElementById('qualitySel');
        if (sel) sel.value = 'low';
        applyQuality();
        ui.toast('Graphics auto-set to Low for smooth play');
      }
    } else if (fpsShown >= 18) {
      lowFpsStreak = 0;
    }
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
        speed: driving ? Math.abs(driving.speed) : player.speed,
        mission: missions.status, missionId: missions.currentDef()?.id ?? null,
        driving: !!driving, hour: weather.hour, raining: weather.raining,
        quality: settings.quality, softwareGL, swimming: player.swimming,
        ambient: ambient.stats(),
      }),
      game: { player, vehicles, ambient, combat, missions, shops, weather, save, map: mapSys, ui, audio, input, world },
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
        clearPolice: () => combat.clearPolice(),
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
document.getElementById('btnSettings').addEventListener('click', openSettings);
document.getElementById('btnCloseSettings').addEventListener('click', closeSettings);
document.getElementById('btnSaveNow').addEventListener('click', () => {
  if (save.save()) ui.toast(ui.t('saved'));
  else ui.toast('Save failed — storage unavailable.');
});
document.getElementById('btnCloseShop').addEventListener('click', closeShop);
document.getElementById('btnClosePhone').addEventListener('click', closePhone);
document.getElementById('tabBackpack').addEventListener('click', () => showPackTab('backpack'));
document.getElementById('tabPhone').addEventListener('click', () => showPackTab('phone'));
document.getElementById('btnCloseMap').addEventListener('click', closeMap);
// Tap the minimap to open the full map (touch + desktop).
document.getElementById('minimap').addEventListener('click', () => {
  if (state === 'playing' && !paused) openMap();
});
// Desktop quick buttons (hidden on touch devices — the touch buttons in
// #touch serve the same actions there). Guarded: no-ops on the title screen.
document.getElementById('btnQuickMap').addEventListener('click', () => {
  if (state === 'playing' && !paused) openMap();
});
document.getElementById('btnQuickPack').addEventListener('click', () => {
  if (state === 'playing' && !paused) openPack('backpack');
});
document.getElementById('btnQuickSet').addEventListener('click', openSettings);
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
document.getElementById('musicSlider').addEventListener('input', (e) => {
  settings.musicVolume = Number(e.target.value);
  audio.setMusicVolume(settings.musicVolume);
});
document.getElementById('sfxSlider').addEventListener('input', (e) => {
  settings.sfxVolume = Number(e.target.value);
  audio.setSfxVolume(settings.sfxVolume);
});
document.getElementById('muteChk').addEventListener('change', (e) => {
  settings.muted = e.target.checked;
  audio.setMuted(settings.muted);
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
syncSettingsInputs();
requestAnimationFrame(frame);
