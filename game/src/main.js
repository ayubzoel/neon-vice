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
import { createPackages } from './packages.js'; // v6.5 item 2: hidden money packages
import { createShops, SHOPS } from './shops.js';
import { createSave, loadSettings, persistSettings } from './save.js';
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
  const has = (key) => typeof raw[key] === 'function';
  const pass = (key) => (...args) => raw[key](...args);
  return {
    raw,
    spawn: (raw.spawn && typeof raw.spawn.x === 'number') ? raw.spawn : CONFIG.spawn,
    clamp(x, z) {
      if (raw.clamp) return raw.clamp(x, z);
      return { x: Math.max(-halfW, Math.min(halfW, x)), z: Math.max(-halfD, Math.min(halfD, z)) };
    },
    // v5: forward y so the flyover deck barriers (raw.collides 4th arg)
    // block an elevated caller but never ground traffic under the deck.
    collides: has('collides') ? (x, z, r, y = 0) => raw.collides(x, z, r, y) : null,
    isInWater: has('isInWater')
      ? (x, z) => raw.isInWater(x, z)
      : (x, z) => x > CONFIG.water.x0 - 2,
    // v6.6 item 5: beach sand (x 420..470) — the sand-speed cap in
    // vehicles.js driveVehicle and the police cap in combat.js read
    // this. Forwarded like isInWater; the fallback matches the
    // sand strip (SAND_X0 420 .. WATER_X0 470).
    isOnSand: has('isOnSand')
      ? (x, z) => raw.isOnSand(x, z)
      : (x, z) => x >= 420 && x < CONFIG.water.x0,
    roadGraph: raw.roadGraph || null,
    flyovers: raw.flyovers || [],
    flyoverGardens: raw.flyoverGardens || [],
    medianGardens: raw.medianGardens || [],
    medianObjects: raw.medianObjects || [],
    // v6: lane-shifted steering target at flyover intersections
    // (world.js laneTarget). Forwarded so the traffic drivers
    // (vehicles.js / ambient.js) and the debug hook can use it.
    laneTarget: has('laneTarget') ? pass('laneTarget') : null,
    // v6.2: flyover recovery helpers (world.js flyoverExit /
    // unstuckTarget). Same forwarding as laneTarget.
    flyoverExit: has('flyoverExit') ? pass('flyoverExit') : null,
    unstuckTarget: has('unstuckTarget') ? pass('unstuckTarget') : null,
    // v6.2: nearest node ahead, for the missed-turn recovery.
    aheadNode: has('aheadNode') ? pass('aheadNode') : null,
    // v6.5 item 5: tallest building roof under a point — the police
    // helicopter's roof avoidance (combat.js updateHeli).
    tallestAt: has('tallestAt') ? pass('tallestAt') : () => 0,
    destinations: raw.destinations || null,
    groundHeightAt: has('groundHeightAt') ? (x, z, y = 0) => raw.groundHeightAt(x, z, y) : () => 0,
    findOpenGround: has('findOpenGround')
      // B's findOpenGround returns null when nothing is open within maxR;
      // callers expect a point, so fall back to the raw coordinates.
      ? (x, z, r) => raw.findOpenGround(x, z, r) || { x, z } : (x, z) => ({ x, z }),
    nearestSidewalk: has('nearestSidewalk') ? pass('nearestSidewalk') : () => [],
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
weather.registerWorld(world.raw); // v4: phase-driven windows, lamps, moon/stars
const vehicles = createVehicles(scene, world);
const ambient = createAmbient(scene, world, vehicles, { isDriven: (v) => v === driving });
const combat = createCombat(scene, world, player, audio);

const settings = loadSettings({ quality: softwareGL ? 'low' : 'high' });
function saveSettings() { persistSettings(settings); }
audio.setVolume(settings.volume);
audio.setMusicVolume(settings.musicVolume);
audio.setSfxVolume(settings.sfxVolume);
audio.setMuted(settings.muted);
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
let lastRamCrimeAt = 0; // wall-clock ms of the last ramming crime (3 s cooldown)
let mouseDown = false;
let aimHeldMouse = false; // Builder A v4: right mouse held
let aimHeldTouch = false; // Builder A v4: AIM touch button held
let aimShown = false; // crosshair currently visible
const _aimVec = new THREE.Vector3(); // lock-marker projection scratch

// Builder A v4: recompute the aim state (held + on foot + playing) and
// push it into combat; the crosshair follows the same flag.
function applyAim() {
  const want = (aimHeldMouse || aimHeldTouch) && state === 'playing' && !paused && !driving;
  combat.setAiming(want);
  if (want === aimShown) return;
  aimShown = want;
  document.getElementById('crosshair')?.classList.toggle('show', want);
  document.getElementById('btnAim')?.classList.toggle('aiming', want);
  // Drop the bracket synchronously on release: at SwiftShader frame
  // rates the per-frame overlay update can lag ~0.5 s behind the input,
  // and a stale red bracket on a released lock reads as a bug.
  if (!want) document.getElementById('lockMarker')?.classList.remove('show');
}

// Builder A v4: position the red lock bracket over the locked target (or
// hide it). Runs every frame after the camera is placed, so the marker
// tracks a moving target instead of lagging on the 0.12 s HUD tick.
function updateAimOverlay() {
  const marker = document.getElementById('lockMarker');
  const label = document.getElementById('lockLabel');
  if (!marker) return;
  const info = combat.aimInfo();
  const hide = () => marker.classList.remove('show');
  if (!info.locked) { hide(); return; }
  _aimVec.set(info.locked.x, info.locked.y, info.locked.z).project(camera);
  if (_aimVec.z > 1) { hide(); return; }
  const screenX = (_aimVec.x * 0.5 + 0.5) * window.innerWidth;
  const screenY = (-_aimVec.y * 0.5 + 0.5) * window.innerHeight;
  marker.style.left = `${screenX}px`;
  marker.style.top = `${screenY}px`;
  if (label) {
    const hp = Math.max(0, Math.ceil(info.locked.hp));
    label.textContent = `${info.locked.label} · ${info.locked.dist}m · HP ${hp}`;
  }
  marker.classList.add('show');
}

// Builder A v4: touch wording for the banner hint (mirrors the translate()
// in input.js, which feeds the now-hidden #touchHint pill).
function translateHint(text) {
  if (!document.body.classList.contains('touch-device')) return text;
  const swaps = [
    ['Press E to ', 'Tap CAR to '],
    ['Tekan E untuk ', 'Ketuk CAR untuk '],
    [
      'WASD move · Shift run · E interact · M map · B backpack · H holster · Hold right-click to aim',
      'Left stick to move · CAR to enter · Hold AIM to lock a target',
    ],
    ['Swimming — steer toward the shore', 'Swimming — stick toward the shore'],
  ];
  let out = text;
  for (const [from, to] of swaps) out = out.replace(from, to);
  return out;
}
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
const saveCtx = {
  player, combat, missions, weather, settings,
  getMoney: () => money,
  getOwnedJackets: () => ownedJackets.slice(),
};
const save = createSave(saveCtx);
// shops ctx
const shops = createShops(scene, {
  player, combat, audio, world,
  getMoney: () => money,
  spendMoney: (n) => { money -= n; ui.setMoney(money); },
});
// v6.5 item 2 — hidden money packages (created after save so a pickup can
// autosave; saveCtx.packages is read at save() time, like missions).
const packages = createPackages(scene, world, {
  player, world, ui, audio,
  addMoney: (n) => { money += n; ui.setMoney(money); },
  onMessage: (m) => ui.toast(m, 4200),
  onCollect: () => { save.save(); },
});
saveCtx.packages = packages;

// ---- Camera (Builder B v4 rev 7: free orbit) ----
// The camera orbits Vera 360°: a drag on empty screen (touch swipe or
// mouse drag, input.js) moves a TARGET yaw/pitch, and the live yaw/pitch
// damp toward it (lerp, ~8/s) so the motion is smooth, never a jump.
// Pitch is the elevation angle above the look point, clamped to
// [0.12, 1.0] rad — the camera can look down from high above but never
// flips over or goes underground. When the player is idle the camera
// stays where the player left it; once they move (and 2.5 s after the
// last drag) the target yaw eases back behind their heading, so the
// camera still follows without ever snapping. While the touch stick is
// steering on foot the camera stays frozen — otherwise "screen-right"
// would rotate under the player (joystick test, 2026-11-20). Movement
// stays camera-relative (player.js / driveVehicle read the camera basis),
// so stick-up / W after a 180° orbit still walk away from the camera.
// Clipping: if the computed camera spot is inside a building footprint,
// pull the camera closer (down to 3.5 m) until it is clear.
let camYaw = CONFIG.spawn.heading || 0;
let camYawTarget = camYaw;
let camPitch = 0.33; // default elevation: (4.5 - 1.6) / 9 m
let camPitchTarget = 0.33;
let camHoldUntil = 0; // performance.now() ms: follow paused until then
const CAM_PITCH_MIN = 0.12;
const CAM_PITCH_MAX = 1.0;
function angleDelta(from, to) {
  const TAU = Math.PI * 2;
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}
function placeCamera(dtReal = 0.016) {
  const dt = Math.max(0.001, Math.min(0.1, dtReal));
  // Consume the orbit drag (empty-screen swipe / mouse drag).
  const drag = input.consumeCamDrag ? input.consumeCamDrag() : { dx: 0, dy: 0 };
  if (drag.dx !== 0 || drag.dy !== 0) {
    const sens = settings.camSensitivity ?? 1; // v5: camera sensitivity setting
    camYawTarget += drag.dx * 0.005 * sens; // ~1250 px per full turn at 1.0×
    camPitchTarget = Math.max(CAM_PITCH_MIN, Math.min(CAM_PITCH_MAX, camPitchTarget - drag.dy * 0.004 * sens));
    camHoldUntil = performance.now() + 2500;
  } else if (performance.now() > camHoldUntil && settings.camFollow !== false) {
    // Ease the target back behind the heading — only while moving, and
    // never while the stick is steering on foot (frozen camera, see above).
    const stick = !driving && input.read().stick;
    const moving = driving ? Math.abs(driving.speed) > 0.5 : Math.abs(player.speed) > 0.5;
    if ((!stick || !stick.active) && moving) {
      const base = driving ? driving.heading : player.heading;
      camYawTarget += angleDelta(camYawTarget, base) * Math.min(1, 1.6 * dt);
    }
  }
  const k = 1 - Math.exp(-8 * dt); // damping: smooth, no jumps
  camYaw += angleDelta(camYaw, camYawTarget) * k;
  camPitch += (camPitchTarget - camPitch) * k;
  const anchor = driving ? driving.mesh.position : player.group.position;
  const anchorY = anchor.y || 0;
  const fullDist = driving ? CONFIG.camera.distance + 3 : CONFIG.camera.distance;
  // Camera spot for a given distance, then pull in if it is inside a
  // building footprint (2D colliders; conservative at high pitch).
  const spotAt = (d) => ({
    x: anchor.x - Math.sin(camYaw) * Math.cos(camPitch) * d,
    y: anchorY + CONFIG.camera.lookHeight + Math.sin(camPitch) * d,
    z: anchor.z - Math.cos(camYaw) * Math.cos(camPitch) * d,
  });
  let dist = fullDist;
  if (world.collides) {
    while (dist > 3.5 && world.collides(spotAt(dist).x, spotAt(dist).z, 0.5)) dist -= 0.5;
  }
  const pos = spotAt(dist);
  camera.position.set(pos.x, Math.max(1.2, pos.y), pos.z);
  camera.lookAt(anchor.x, anchorY + CONFIG.camera.lookHeight, anchor.z);
}

function cameraBasis() {
  // Forward = where the camera looks, on the ground plane; right = screen-right.
  const p = player.group.position;
  const fx = p.x - camera.position.x;
  const fz = p.z - camera.position.z;
  const len = Math.hypot(fx, fz) || 1;
  return { fx: fx / len, fz: fz / len, rx: -fz / len, rz: fx / len };
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
  if (data.packages) packages.setState(data.packages); // v6.5 item 2
  if (typeof data.hour === 'number') weather.setHour(data.hour);
  if (data.lang) { settings.lang = data.lang; ui.setLang(data.lang); }
  if (typeof data.volume === 'number') { settings.volume = data.volume; audio.setVolume(data.volume); }
  if (typeof data.musicVolume === 'number') { settings.musicVolume = data.musicVolume; audio.setMusicVolume(data.musicVolume); }
  if (typeof data.sfxVolume === 'number') { settings.sfxVolume = data.sfxVolume; audio.setSfxVolume(data.sfxVolume); }
  if (typeof data.muted === 'boolean') { settings.muted = data.muted; audio.setMuted(data.muted); }
  if (data.quality) {
    settings.quality = data.quality;
    autoDegraded = false; // a loaded choice renders as chosen until FPS says otherwise
    lowFpsStreak = 0;
  }
  if (typeof data.camSensitivity === 'number') settings.camSensitivity = Math.max(0.5, Math.min(2, data.camSensitivity));
  if (typeof data.camFollow === 'boolean') settings.camFollow = data.camFollow;
  saveSettings(); // a loaded save refreshes the persisted settings too
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
  const sens = document.getElementById('sensSlider');
  if (sens) sens.value = settings.camSensitivity ?? 1;
  const sensVal = document.getElementById('sensVal');
  if (sensVal) sensVal.textContent = `${Number(settings.camSensitivity ?? 1).toFixed(1)}×`;
  const fol = document.getElementById('followChk');
  if (fol) fol.checked = settings.camFollow !== false;
  syncFullscreenUI();
}

// ---- v6.5 item 6: fullscreen mode (session-only toggle, default OFF) ----
// Fullscreen is NOT persisted in settings: the API needs a user gesture,
// so a stored "on" could never be applied on load anyway. The checkbox
// always reflects the LIVE state (synced on every fullscreenchange, which
// also covers leaving via Esc). Unsupported browsers get a disabled
// checkbox + a short explanation instead of an error.
function isFullscreenSupported() {
  return typeof document !== 'undefined'
    && !!document.fullscreenEnabled
    && typeof document.documentElement.requestFullscreen === 'function';
}
function syncFullscreenUI() {
  const chk = document.getElementById('fullscreenChk');
  const note = document.getElementById('fullscreenNote');
  const titleBtn = document.getElementById('btnFullscreenTitle');
  const supported = isFullscreenSupported();
  const active = !!document.fullscreenElement;
  if (chk) {
    chk.checked = active;
    chk.disabled = !supported;
  }
  if (note) note.hidden = supported;
  if (titleBtn) {
    titleBtn.hidden = !supported;
    titleBtn.textContent = active ? ui.t('exitFullscreen') : ui.t('fullscreen');
  }
}
async function setFullscreen(on) {
  if (on) {
    if (!isFullscreenSupported()) { syncFullscreenUI(); return false; }
    try {
      await document.documentElement.requestFullscreen();
      return true;
    } catch {
      // Rejected (e.g. no user gesture, browser policy) — revert the UI,
      // never throw.
      ui.toast(ui.t('fullscreenFailed'));
      syncFullscreenUI();
      return false;
    }
  }
  if (document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch { /* already out */ }
  }
  syncFullscreenUI();
  return true;
}
document.addEventListener('fullscreenchange', syncFullscreenUI);

// ---- v5 loading screen flow ----
// #startScreen has three views; exactly ONE is visible at a time:
// #startMain (Start Game + Settings only), #startPlay (New / Continue /
// Back), #startConfirm (overwrite-save confirmation for New Game).
function showStartView(view) {
  for (const [id, name] of [['startMain', 'main'], ['startPlay', 'play'], ['startConfirm', 'confirm']]) {
    document.getElementById(id)?.classList.toggle('hidden', name !== view);
  }
  if (view === 'play') refreshContinueState();
}
function refreshContinueState() {
  const has = save.exists();
  const btn = document.getElementById('btnContinue');
  if (btn) btn.disabled = !has;
  const note = document.getElementById('continueNote');
  if (note) {
    note.hidden = has;
    if (!has) note.textContent = ui.t('noSave');
  }
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
    packages.setState(null); // v6.5 item 2: New Game re-hides all packages
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
  hudState.textContent = 'Playing';
  // Builder A v4: the top banner carries the controls hint from here on.
  ui.showBanner();
  audio.unlock();
  ui.setMoney(money);
  ui.toast(fromSave ? 'Save loaded. Welcome back, Vera.' : 'Vera owes Rico $50,000. Mission 1 is waiting — open your phone (B).', 5000);
}

function applyQuality() {
  // Low on a software renderer also renders at 0.75x backing resolution
  // (upscaled by CSS): SwiftShader is fill-rate bound, so ~44% fewer
  // fragments is the cheapest real FPS win. Real GPUs keep full res.
  // v5: the RENDER quality is the user's choice unless auto-degrade kicked
  // in (autoDegraded) — settings.quality itself is never rewritten by the
  // degrader, so a later saveSettings() cannot silently store 'low' over
  // the player's chosen High.
  const effQuality = autoDegraded ? 'low' : settings.quality;
  const ratio = effQuality === 'low'
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
  const nearCar = vehicles.nearestVehicle(p.x, p.z, 6);
  if (nearCar) return { kind: 'vehicle', vehicle: nearCar };
  // Boats sit in the water just past the shore: allow boarding from the dock.
  const boat = vehicles.list.find(
    (x) => x.kind === 'boat' && Math.hypot(x.mesh.position.x - p.x, x.mesh.position.z - p.z) < 12,
  );
  if (boat) return { kind: 'vehicle', vehicle: boat };
  const shop = shops.nearestShop(p.x, p.z, 12);
  if (shop) return { kind: 'shop', shop };
  return null;
}

function doInteract() {
  if (driving) {
    // Exit: place Vera on the nearest SAFE sidewalk — not on the asphalt,
    // not inside a building, not inside another vehicle. The old code put
    // her at car.x + 3, which landed on the road itself when the car was
    // parked/driven on a street, or deep inside a block when the car had
    // cut a corner. Candidates are the sidewalk centrelines flanking the
    // nearest road (world.nearestSidewalk), nearest first, each rejected
    // when it collides, is water, or sits within another vehicle's
    // footprint; the ring around the car is the last resort.
    const v = driving;
    driving = null;
    const spot = findExitSpot(v);
    player.group.position.set(spot.x, 0, spot.z);
    player.heading = Math.atan2(spot.x - v.mesh.position.x, spot.z - v.mesh.position.z);
    player.group.rotation.y = player.heading;
    player.group.visible = true;
    if (v.kind === 'boat') {
      const ashore = world.isInWater && world.isInWater(spot.x, spot.z);
      ui.toast(ashore ? 'Swim to shore — hold W' : 'You wade ashore.');
    }
    return;
  }
  const near = nearestInteractable();
  if (!near) return;
  if (near.kind === 'vehicle') {
    driving = near.vehicle;
    driving.parked = false;
    player.group.visible = false;
    audio.unlock();
    // Car theft (Builder B v3, Neon Bay rule): +1 star when a cop is close
    // enough to see it, otherwise a 40% chance somebody saw. Mission cars
    // are yours already — taking one is not a crime.
    if (!driving.missionCar) {
      const seen = combat.policeNear(CONFIG.wanted.sightRange || 70) || Math.random() < 0.4;
      if (seen) {
        combat.commitCrime(1);
        ui.toast('Someone saw you steal that car!');
      }
    }
  } else if (near.kind === 'shop') {
    openShop(near.shop);
  }
}

// Nearest safe exit spot for a vehicle: sidewalk first, open ground as a
// fallback. A boat sits in deep water, where Vera cannot stand — so for
// boats search far enough to reach the shore (BUG-1 soft-lock: the old 4 m
// search fell back to the water position and Vera froze). Swimming
// (player.js) is the second safety net if she ever ends up in the water
// anyway.
function findExitSpot(v) {
  const vx = v.mesh.position.x;
  const vz = v.mesh.position.z;
  if (v.kind === 'boat') {
    return world.findOpenGround(vx, vz, 160);
  }
  const clear = (x, z) => {
    if (world.collides && world.collides(x, z, 0.8)) return false;
    if (world.isInWater && world.isInWater(x, z)) return false;
    return !vehicles.list.some(
      (o) => o !== v && Math.hypot(o.mesh.position.x - x, o.mesh.position.z - z) < 3,
    );
  };
  const cands = [];
  // Sidewalk centrelines by the nearest road, nearest first; also the same
  // sidewalks 8 m up/down the street, in case the nearest point is blocked
  // by another car or a pole.
  try {
    const near = world.roadGraph && world.roadGraph.nearestOnRoad
      ? world.roadGraph.nearestOnRoad(vx, vz) : null;
    const walks = world.nearestSidewalk ? world.nearestSidewalk(vx, vz) : [];
    cands.push(...walks);
    if (near) {
      const s = world.roadGraph.segments[near.segment];
      const alongX = s.kind === 'horizontal';
      const off = s.width / 2 + 1.5;
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const len = Math.hypot(dx, dz) || 1;
      for (const shift of [-8, 8]) {
        for (const side of [1, -1]) {
          const bx = near.x + (dx / len) * shift + (alongX ? 0 : side * off);
          const bz = near.z + (dz / len) * shift + (alongX ? side * off : 0);
          cands.push({ x: bx, z: bz, dist: Math.hypot(bx - vx, bz - vz) });
        }
      }
    }
  } catch { /* fall through to the ring */ }
  cands.sort((a, b) => a.dist - b.dist);
  const firstClear = cands.find((c) => clear(c.x, c.z));
  if (firstClear) return { x: firstClear.x, z: firstClear.z };
  // Last resort: the ring around the car, then any open ground nearby.
  for (let r = 3; r <= 9; r += 3) {
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2;
      const x = vx + Math.cos(a) * r;
      const z = vz + Math.sin(a) * r;
      if (clear(x, z)) return { x, z };
    }
  }
  return world.findOpenGround(vx + 3, vz, 4);
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
// v6.3: tapping a pin on the full map sets the GPS. pointerdown (not
// click) so touch on phones registers without delay; the handler only
// acts while the map is open, and an empty-space tap does nothing (the
// GPS is never cleared by accident). Mission diamond first, then
// destination dots — see mapSys.hitTest for the radii. This REPLACES the
// old `click` handler (removed in v6.3): it only knew destinations, and
// its 60 px "fat-finger" fallback hijacked taps on the mission diamond
// (e.g. a tap dead-centre on Rico's Bar set GPS to RS Pantai instead),
// so a tap on the mission pin could never win.
document.getElementById('mapCanvas')?.addEventListener('pointerdown', (e) => {
  if (!mapSys.isOpen) return;
  const hit = mapSys.hitTest(e.currentTarget, e.clientX, e.clientY);
  if (!hit) return;
  if (hit.type === 'mission') {
    const stage = missions.currentStage();
    const label = stage?.text || 'Mission Target';
    mapSys.setGpsTarget(hit.x, hit.z, label);
    ui.toast(`GPS set: ${label}`);
  } else {
    mapSys.setGps(hit.name);
    ui.toast(`GPS set: ${hit.name}`);
  }
});
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
    .join('')
    // Builder A v4: aim is wired in main.js, not in input.js (Builder B),
    // so its row is appended here instead of in getBindings().
    + '<div class="ctlRow"><span>Aim at NPC / police (hold)</span><b>Right mouse / AIM</b></div>'
    + '<div class="ctlRow"><span>Show / hide help banner</span><b>T</b></div>';
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
    } else if (paused && overlay === 'map') {
      if (pressed.has('map')) closeMap();
      else {
        // v6.3: number keys pick a destination while the map is open
        // (1/2 reuse the weapon actions — the game is paused, so no
        // weapon switch can fire; 3-9 are the dest3-9 actions).
        let idx = -1;
        if (pressed.has('weapon1')) idx = 0;
        else if (pressed.has('weapon2')) idx = 1;
        else for (let n = 3; n <= 9; n++) {
          if (pressed.has(`dest${n}`)) { idx = n - 1; break; }
        }
        if (idx >= 0) {
          const d = mapSys.setGpsByIndex(idx);
          if (d) ui.toast(`GPS set: ${d.name}`);
        }
      }
    }
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
  // F is the dedicated exit key (E stays the general interact key): it
  // only ever exits a vehicle, so it can never open a shop by mistake.
  if (pressed.has('exitVehicle') && driving) doInteract();
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
  vehicles.update(dt, driving);
  ambient.update(dt);

  // Builder B v4 rev 6: traffic cars ride the flyover profile too (their
  // steering loops in vehicles.js / ambient.js are 2D, so the height is
  // applied here, after they move). A car whose route crosses a flyover
  // NS drives up and over it; EW traffic passes underneath at y=0.
  // (ambient.js itself is Builder C's — untouched; this is the only place
  // traffic height is set.) Police cars (combat.js, Builder A) keep y=0
  // and may clip a ramp visually while chasing — known limitation.
  if (world.groundHeightAt) {
    for (const v of vehicles.list) {
      if (!v.traffic || v.kind === 'boat') continue;
      const gy = world.groundHeightAt(v.mesh.position.x, v.mesh.position.z, v.mesh.position.y);
      v.mesh.position.y += (gy - v.mesh.position.y) * Math.min(1, 10 * dt);
    }
  }

  // Driving crimes (Builder B v3, Neon Bay rule: crimes the police see
  // raise wanted): hitting a pedestrian or ramming another car while
  // driving at speed is +1 star. A hit ped is knocked down and respawns
  // on a far sidewalk (ambient.knockDown); a rammed car just costs heat.
  if (driving && Math.abs(driving.speed) > 3) {
    const cx = driving.mesh.position.x;
    const cz = driving.mesh.position.z;
    // Height guard (v4 flyover): a car on the deck (y≈6) is not hitting
    // the pedestrians / cars on the ground road underneath it.
    const onDeck = Math.abs(driving.mesh.position.y) > 2.5;
    for (const p of ambient.pedestrians) {
      if (onDeck) break;
      if (p.lastHit && Date.now() - p.lastHit < 3000) continue;
      if (Math.hypot(p.x - cx, p.z - cz) < 2.2) {
        combat.commitCrime(1);
        ambient.knockDown(p);
        ui.toast('You hit a pedestrian!');
      }
    }
    if (!onDeck && Date.now() - lastRamCrimeAt > 3000) {
      for (const o of vehicles.list) {
        if (o === driving || o.kind === 'boat') continue;
        if (Math.abs(driving.mesh.position.y - o.mesh.position.y) > 2.5) continue;
        if (Math.hypot(o.mesh.position.x - cx, o.mesh.position.z - cz) < 3.5) {
          combat.commitCrime(1);
          lastRamCrimeAt = Date.now();
          ui.toast('You rammed another car!');
          break;
        }
      }
    }
  }

  // Combat. No shooting while swimming (BUG-1 swim rules). Mouse
  // hold-to-fire is suppressed while a camera drag is in progress (rev 7),
  // so orbiting with the mouse never fires the weapon.
  // Builder A v4: aim state is re-evaluated every step (pause / driving /
  // title changes must drop the lock even without a pointer event).
  applyAim();
  if ((frameInput.fire || (mouseDown && !input.isCamDragging())) && !driving && !player.swimming) combat.shoot();
  combat.update(dt, gameTime, !!driving);
  // v6.3: an escape that just completed toasts once (combat owns the
  // timer; main owns the UI). Police dispersal is the wanted===0 branch.
  if (combat.takeEscapeEvent()) ui.toast(ui.t('escaped'), 4200);

  // Missions + weather.
  missions.update(dt);
  packages.update(dt); // v6.5 item 2: walk-over pickup check + bob
  weather.update(dt, player.group.position.x, player.group.position.z);

  // Death.
  if (player.hp <= 0) dieAndRespawn();
}

// ---- HUD ----
let hudTimer = 0;
let lowFpsStreak = 0;
let autoDegraded = false;
function updateHud(dt) {
  hudTimer += dt;
  if (hudTimer < 0.12) return;
  hudTimer = 0;
  // Builder B v4 rev 3: show the GAS / REM pedals only while driving.
  document.body.classList.toggle('driving', !!driving);
  const p = player.group.position;
  document.getElementById('hudPos').textContent = `x ${p.x.toFixed(0)} · z ${p.z.toFixed(0)} · ${player.speed.toFixed(1)} m/s`;
  document.getElementById('hudFps').textContent = `${fpsShown} FPS · ${weather.clockText()}`;
  ui.setMoney(money);
  const esc = combat.escapeInfo();
  ui.setWanted(combat.wanted, esc);
  ui.setEscape(esc);
  ui.setHp(player.hp, player.maxHp);
  ui.setAmmo(driving ? '—' : `${combat.weapons[combat.current].name} ${combat.ammoText()}${combat.isReloading() ? ' …' : ''}`);
  ui.setClock(weather.clockText(), weather.raining);
  ui.setAmbient(ambient.stats().pedestrians, ambient.stats().trafficTotal);
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
  // Interaction hint (Builder A v4): the text still goes into the hidden
  // #hudHint (input.js observes it to drive the touch CAR button), but
  // what the player SEES is the top banner — nothing at the bottom or
  // centre of the screen anymore.
  const hint = document.getElementById('hudHint');
  let hintText;
  if (player.swimming) {
    hintText = 'Swimming — steer toward the shore';
  } else if (!driving) {
    const near = nearestInteractable();
    if (near?.kind === 'vehicle') hintText = ui.t('enterCar');
    else if (near?.kind === 'shop') hintText = `${near.shop.name} — ${ui.t('enterCar').replace('enter', 'open')}`;
    else hintText = 'WASD move · Shift run · E interact · M map · B backpack · H holster · Hold right-click to aim';
  } else {
    hintText = ui.t('exitCar');
  }
  hint.textContent = hintText;
  // v5: the tutorial banner is an in-game strip — it must not leak onto
  // the loading screen (which shows only Start Game + Settings).
  if (state === 'playing') ui.setBannerHint(translateHint(hintText));
  // Map overlay redraw (pass the live mission target for its map icon, plus
  // the ambient pedestrians + traffic so the map shows the living city).
  // (The minimap no longer lives here — see frame(), v5 item 3.)
  if (mapSys.isOpen) {
    mapSys.draw(document.getElementById('mapCanvas'), p, player.heading, missions.stageTarget(), {
      pedestrians: ambient.pedestrians,
      traffic: vehicles.list.filter((v) => v.traffic),
    });
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
  placeCamera(dtReal);
  updateAimOverlay();
  renderer.render(scene, camera);
  updateHud(dtReal);
  // Minimap realtime (v5 item 3): redrawn EVERY rendered frame with the
  // live player position — never throttled. The old code redrew it at most
  // every 0.36 s of accumulated dt inside updateHud, and dt is clamped to
  // 0.12 s/frame, so at ~2 FPS (SwiftShader) the minimap only refreshed
  // every ~1.5-1.8 s of wall clock while the car kept moving: the arrow,
  // roads and GPS route visibly lagged behind the player. The draw is
  // cheap (150x150 canvas, ~123 road segments), so per-frame is affordable.
  // (The full-screen map stays in updateHud: it pauses the game while open,
  // so the player cannot move under it.)
  ui.drawMinimap(
    document.getElementById('minimap'),
    player.group.position, player.heading,
    missions.stageTarget(),
    Object.values(CONFIG.places),
    mapSys.gpsTarget,
    world.roadGraph ? world.roadGraph.segments : null,
    world.flyovers,
  );

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
        // Render only: settings.quality (the player's choice, and what
        // gets persisted) stays 'high'. The old code wrote 'low' into
        // settings here, so the next saveSettings() overwrote High in
        // localStorage and the choice never survived a reload.
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
        police: combat.police.filter((p) => !p.dead).length,
        policeCars: combat.policeCars.filter((c) => !c.dead).length,
        policeCanSee: combat.policeCanSee,
        // v6.3 escape state (debug API): escaping, 0..1 progress, seconds
        // needed at this wanted level, nearest living police unit (m/null).
        ...(() => {
          const e = combat.escapeInfo();
          return {
            escaping: e.escaping,
            escapeProgress: +e.progress.toFixed(3),
            escapeNeeded: e.needed,
            nearestPoliceDist: e.nearestPoliceDist,
            nearestPoliceLos: e.nearestPoliceLos,
          };
        })(),
        speed: driving ? Math.abs(driving.speed) : player.speed,
        mission: missions.status, missionId: missions.currentDef()?.id ?? null,
        driving: !!driving, hour: weather.hour, phase: weather.phaseName(), raining: weather.raining,
        quality: settings.quality, renderQuality: autoDegraded ? 'low' : settings.quality, softwareGL, swimming: player.swimming,
        settings: { ...settings }, saveExists: save.exists(),
        ambient: ambient.stats(),
        drawCalls: renderer.info.render.calls,
        packages: { collected: packages.collectedCount, total: packages.total }, // v6.5 item 2
        camYaw: +camYaw.toFixed(3), camPitch: +camPitch.toFixed(3),
        speedSigned: driving ? +driving.speed.toFixed(2) : +player.speed.toFixed(2),
        flyovers: world.flyovers,
      }),
      game: { player, vehicles, ambient, combat, missions, packages, shops, weather, save, map: mapSys, ui, audio, input, world },
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
        police: () => combat.policeInfo(),
        // Test hooks (Builder A v4): aim-lock verification.
        // spawnThug(dist): a thug straight ahead of Vera at `dist` metres.
        spawnThug: (dist = 15) => {
          const p = player.group.position;
          return combat.spawnEnemy(p.x + Math.sin(player.heading) * dist, p.z + Math.cos(player.heading) * dist);
        },
        // setAiming(b): drive the aim hold programmatically (same path as
        // the right mouse button / AIM touch button, via applyAim).
        setAiming: (b) => { aimHeldMouse = !!b; applyAim(); return combat.aimInfo(); },
        aimInfo: () => combat.aimInfo(),
        setHp: (n) => { player.hp = Math.max(0, Math.min(player.maxHp, n)); },
        startSideJob: (kind) => missions.startSideJob(kind),
        setHour: (h) => weather.setHour(h),
        setRain: (on) => weather.setRain(on),
        // Test hook: exit the current vehicle (same path as E / EXIT).
        exitVehicle: () => { if (driving) doInteract(); return !driving; },
        // Test hooks (Builder A v3): verify the pedestrians really walk
        // the sidewalks and the traffic really stays on the roads.
        // checkPedestrians: ownOffsetErr = worst |distance to the ped's
        // own segment centreline - sidewalk offset| (0 = exactly on the
        // sidewalk centreline); onRoadGlobal counts peds inside any road
        // band by the global isOnRoad check — sidewalk strips cross the
        // cross-street's band at intersections by construction, so a
        // ped turning a corner can read as on-road there.
        checkPedestrians: () => {
          const rg = world.roadGraph;
          const ps = ambient.pedestrians;
          let maxErr = 0;
          let onRoadGlobal = 0;
          let minPair = Infinity;
          for (const p of ps) {
            const s = rg.segments[p.seg];
            // Distance to the ped's OWN segment centreline.
            const dx = s.bx - s.ax;
            const dz = s.bz - s.az;
            const len2 = dx * dx + dz * dz;
            let t = len2 === 0 ? 0 : ((p.x - s.ax) * dx + (p.z - s.az) * dz) / len2;
            t = Math.max(0, Math.min(1, t));
            const cx = s.ax + dx * t;
            const cz = s.az + dz * t;
            const dOwn = Math.hypot(p.x - cx, p.z - cz);
            maxErr = Math.max(maxErr, Math.abs(dOwn - (s.width / 2 + 1.5)));
            if (rg.isOnRoad(p.x, p.z)) onRoadGlobal += 1;
          }
          for (let i = 0; i < ps.length; i += 1) {
            for (let j = i + 1; j < ps.length; j += 1) {
              minPair = Math.min(minPair, Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z));
            }
          }
          return {
            count: ps.length, maxOwnOffsetErr: +maxErr.toFixed(3),
            onRoadGlobal, minPair: +minPair.toFixed(2),
          };
        },
        checkTraffic: () => {
          const rg = world.roadGraph;
          const cars = vehicles.list.filter((v) => v.traffic);
          let onRoad = 0;
          let stopped = 0;
          let minPair = Infinity;
          for (const v of cars) {
            if (rg.isOnRoad(v.mesh.position.x, v.mesh.position.z)) onRoad += 1;
            if (Math.abs(v.speed) < 0.5) stopped += 1;
          }
          for (let i = 0; i < cars.length; i += 1) {
            for (let j = i + 1; j < cars.length; j += 1) {
              minPair = Math.min(minPair, Math.hypot(
                cars[i].mesh.position.x - cars[j].mesh.position.x,
                cars[i].mesh.position.z - cars[j].mesh.position.z,
              ));
            }
          }
          return {
            traffic: cars.length, total: vehicles.list.length, onRoad, stopped,
            minPair: +minPair.toFixed(2),
            lightNS: rg.trafficLight ? rg.trafficLight('NS') : null,
            lightEW: rg.trafficLight ? rg.trafficLight('EW') : null,
          };
        },
        // Test hook only: raise the substep budget so game time runs faster
        // than real time under SwiftShader. Shipped default is 8.
        setStepBudget: (n) => { stepBudget = Math.max(1, Math.min(60, n | 0)); },
        // Test hooks (v5): loading-screen flow + settings, without DOM clicks.
        settings: () => ({ ...settings }),
        saveExists: () => save.exists(),
        // v6.5 item 6: fullscreen state (supported/active) for tests.
        fullscreen: () => ({ supported: isFullscreenSupported(), active: !!document.fullscreenElement }),
        setFullscreen: (on) => setFullscreen(!!on),
        startGame: (fromSave) => startGame(!!fromSave),
        showStartView: (v) => showStartView(v),
        openSettings: () => openSettings(),
        closeSettings: () => closeSettings(),
        // Test hooks (Builder B v4): free camera orbit + flyovers.
        // getCameraOrbit: live + target yaw/pitch (rad) and follow-hold ms.
        // setCameraOrbit(yaw, pitch): jump the orbit (target + live) and
        // hold the follow for 60 s so a test can measure movement
        // relative to the orbited camera without the follow swinging back.
        getCameraOrbit: () => ({
          yaw: +camYaw.toFixed(3), pitch: +camPitch.toFixed(3),
          yawTarget: +camYawTarget.toFixed(3), pitchTarget: +camPitchTarget.toFixed(3),
          holdMs: Math.max(0, camHoldUntil - performance.now()),
        }),
        setCameraOrbit: (yaw, pitch) => {
          camYawTarget = yaw;
          camYaw = yaw;
          if (typeof pitch === 'number') {
            camPitchTarget = Math.max(CAM_PITCH_MIN, Math.min(CAM_PITCH_MAX, pitch));
            camPitch = camPitchTarget;
          }
          camHoldUntil = performance.now() + 60000;
          return true;
        },
        flyoverHeightAt: (x, z, y = 0) => world.groundHeightAt(x, z, y),
        // v6: lane-shifted steering target at a flyover node (probe hook).
        laneTarget: (node, prev, next) => (world.laneTarget ? world.laneTarget(node, prev, next) : node),
        // Peek at the accumulated (not yet consumed) orbit-drag deltas.
        camDragPeek: () => (input.peekCamDrag ? input.peekCamDrag() : { dx: 0, dy: 0 }),
        checkFlyover: () => ({
          flyovers: world.flyovers,
          treesOnFlyover: (world.raw && world.raw.trees ? world.raw.trees : [])
            .filter((t) => world.flyovers.some((f) => Math.abs(t.x - f.x) < 7 && Math.abs(t.z - f.z) < 62)).length,
        }),
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
// Builder A v4: hold right mouse to aim (button 2). The context menu is
// suppressed on the canvas so the hold never pops a menu mid-fight.
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button === 2) { aimHeldMouse = true; applyAim(); }
});
window.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse' && e.button === 2) { aimHeldMouse = false; applyAim(); }
});
window.addEventListener('pointercancel', (e) => {
  if (e.pointerType === 'mouse' && e.button === 2) { aimHeldMouse = false; applyAim(); }
});
window.addEventListener('blur', () => { aimHeldMouse = false; applyAim(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// Builder A v4: touch AIM button — hold to aim, release to drop the lock.
// Bound here (not in input.js, which is Builder B's file) so the stick
// keeps working while AIM is held: separate pointer, separate button.
const btnAim = document.getElementById('btnAim');
if (btnAim) {
  const aimDown = (e) => { e.preventDefault(); aimHeldTouch = true; applyAim(); };
  const aimUp = (e) => { e.preventDefault(); aimHeldTouch = false; applyAim(); };
  btnAim.addEventListener('pointerdown', aimDown);
  btnAim.addEventListener('pointerup', aimUp);
  btnAim.addEventListener('pointercancel', aimUp);
  btnAim.addEventListener('pointerleave', aimUp);
}
// Builder A v4: banner dismiss (X) / re-open (?) / T toggles it.
document.getElementById('bannerClose').addEventListener('click', () => ui.dismissBanner());
document.getElementById('bannerShow').addEventListener('click', () => ui.showBanner());
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyT' && state === 'playing') ui.toggleBanner();
});
window.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse' && e.button === 0) mouseDown = false;
});

document.getElementById('btnPlay').addEventListener('click', () => showStartView('play'));
document.getElementById('btnBackToStart').addEventListener('click', () => showStartView('main'));
document.getElementById('btnNew').addEventListener('click', () => {
  // New Game with an existing save asks first — never silently wipes it.
  if (save.exists()) showStartView('confirm');
  else startGame(false);
});
document.getElementById('btnConfirmNew').addEventListener('click', () => {
  save.clear(); // confirmed New Game wipes the old save: Continue must not resurrect it
  startGame(false);
});
document.getElementById('btnCancelNew').addEventListener('click', () => showStartView('play'));
document.getElementById('btnContinue').addEventListener('click', () => startGame(true));
document.getElementById('btnSettings').addEventListener('click', openSettings);
document.getElementById('btnCloseSettings').addEventListener('click', closeSettings);
document.getElementById('btnSaveNow').addEventListener('click', () => {
  saveSettings(); // settings persist even if the game save cannot be written
  if (save.save()) ui.toast(ui.t('saved'));
  else ui.toast('Save failed — storage unavailable.');
});
document.getElementById('btnLoadSave').addEventListener('click', () => {
  if (!save.exists()) { ui.toast(ui.t('noSaveToLoad')); return; }
  const data = save.load();
  if (!data) { ui.toast(ui.t('noSaveToLoad')); return; }
  if (state === 'playing') { applyLoadedSave(data); ui.toast(ui.t('loadedSave')); }
  else startGame(true);
});
document.getElementById('btnResetSave').addEventListener('click', () => {
  document.getElementById('resetConfirm').classList.remove('hidden');
});
document.getElementById('btnCancelReset').addEventListener('click', () => {
  document.getElementById('resetConfirm').classList.add('hidden');
});
document.getElementById('btnConfirmReset').addEventListener('click', () => {
  save.clear();
  ui.toast(ui.t('progressDeleted'));
  window.location.reload(); // back to the loading screen, with no Continue
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
document.getElementById('volSlider').addEventListener('input', (e) => {
  settings.volume = Number(e.target.value);
  audio.setVolume(settings.volume);
  saveSettings();
});
document.getElementById('musicSlider').addEventListener('input', (e) => {
  settings.musicVolume = Number(e.target.value);
  audio.setMusicVolume(settings.musicVolume);
  saveSettings();
});
document.getElementById('sfxSlider').addEventListener('input', (e) => {
  settings.sfxVolume = Number(e.target.value);
  audio.setSfxVolume(settings.sfxVolume);
  saveSettings();
});
document.getElementById('muteChk').addEventListener('change', (e) => {
  settings.muted = e.target.checked;
  audio.setMuted(settings.muted);
  saveSettings();
});
document.getElementById('qualitySel').addEventListener('change', (e) => {
  settings.quality = e.target.value;
  autoDegraded = false; // explicit choice: render what the player picked
  lowFpsStreak = 0;
  applyQuality();
  saveSettings();
});
document.getElementById('sensSlider').addEventListener('input', (e) => {
  settings.camSensitivity = Number(e.target.value);
  const v = document.getElementById('sensVal');
  if (v) v.textContent = `${settings.camSensitivity.toFixed(1)}×`;
  saveSettings();
});
document.getElementById('followChk').addEventListener('change', (e) => {
  settings.camFollow = e.target.checked;
  saveSettings();
});
document.getElementById('langSel').addEventListener('change', (e) => {
  ui.setLang(e.target.value);
  // setLang rewrites every [data-i18n] label, including the title-screen
  // fullscreen button — re-apply its live Enter/Exit text afterwards.
  syncFullscreenUI();
  saveSettings();
});
// v6.5 item 6: fullscreen toggle (Settings) + title-screen button.
// Both are real user gestures, which the Fullscreen API requires.
document.getElementById('fullscreenChk').addEventListener('change', (e) => {
  setFullscreen(e.target.checked);
});
document.getElementById('btnFullscreenTitle').addEventListener('click', () => {
  setFullscreen(!document.fullscreenElement);
});

// Loading screen starts on its main view (Start Game + Settings only).
showStartView('main');

applyQuality();
placeCamera();
ui.setMoney(money);
ui.setLang(settings.lang);
syncSettingsInputs();
// v5: ?autostart=new|continue boots straight into the game (debug/test
// path — the loading screen stays the default for real players, and the
// NEON_VICE debug API is live either way from the first frame).
const autostart = new URLSearchParams(window.location.search).get('autostart');
if (autostart === 'new') startGame(false);
else if (autostart === 'continue' && save.exists()) startGame(true);
requestAnimationFrame(frame);
