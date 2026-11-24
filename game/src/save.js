// Neon Vice — progress + preferences kept in localStorage, one slot.
//
// The game save and the preferences live under separate keys on purpose:
// changing volume or quality on the title screen must survive a reload
// even before any game has been saved, and wiping progress must not
// wipe the player's preferences with it.

const SAVE_KEY = "neonvice-save-v1";
const PREFS_KEY = "neonvice-settings-v1";
const SAVE_VERSION = 1;

const DEFAULT_SETTINGS = {
  lang: "en",
  volume: 0.7,
  musicVolume: 0.8,
  sfxVolume: 0.9,
  muted: false,
  quality: "high",
  camSensitivity: 1,
  camFollow: true,
};

// Run fn; anything thrown (private mode, quota, corrupt JSON) yields fallback.
function attempt(fn, fallback) {
  try {
    return fn();
  } catch (caught) {
    return fallback;
  }
}

function readJson(key) {
  const raw = attempt(() => window.localStorage.getItem(key), null);
  return raw ? attempt(() => JSON.parse(raw), null) : null;
}

function writeJson(key, value) {
  return attempt(
    () => window.localStorage.setItem(key, JSON.stringify(value)) === undefined,
    false,
  );
}

function dropKey(key) {
  attempt(() => window.localStorage.removeItem(key));
}

function hasKey(key) {
  return attempt(() => window.localStorage.getItem(key) !== null, false);
}

// Pin a number into [lo, hi]; a missing or non-numeric input falls back.
function pinch(value, lo, hi, fallback) {
  const n = Number(value) || fallback;
  return n < lo ? lo : n > hi ? hi : n;
}

const FIXUPS = [
  ["volume", (v) => pinch(v, 0, 1, 0.7)],
  ["musicVolume", (v) => pinch(v, 0, 1, 0.8)],
  ["sfxVolume", (v) => pinch(v, 0, 1, 0.9)],
  ["muted", (v) => !!v],
  ["quality", (v) => (v === "low" ? "low" : "high")],
  ["camSensitivity", (v) => pinch(v, 0.5, 2, 1)],
  ["camFollow", (v) => v !== false],
  ["lang", (v) => (v === "id" ? "id" : "en")],
];

function loadSettings(overrides = {}) {
  const merged = Object.assign({}, DEFAULT_SETTINGS, overrides);
  const stored = readJson(PREFS_KEY);
  if (stored && typeof stored === "object") {
    for (const k in DEFAULT_SETTINGS) {
      if (stored[k] !== undefined) merged[k] = stored[k];
    }
  }
  // A hand-edited value must never break boot: normalise every field.
  return FIXUPS.reduce((acc, [key, fix]) => {
    acc[key] = fix(acc[key]);
    return acc;
  }, merged);
}

function persistSettings(settings) {
  const picked = Object.fromEntries(
    Object.keys(DEFAULT_SETTINGS).map((k) => [k, settings[k]]),
  );
  return writeJson(PREFS_KEY, picked);
}

function clearSettings() {
  dropKey(PREFS_KEY);
}

function snapshot(ctx) {
  const { group, heading, hp, jacketColor } = ctx.player;
  const { x, z } = group.position;
  const { smg, pistol } = ctx.combat.weapons;
  const { current } = ctx.combat;
  const money = ctx.getMoney();
  const missions = ctx.missions.getState();
  const pkgs = ctx.packages && ctx.packages.getState();
  const { hour } = ctx.weather;
  const s = ctx.settings;
  const jacketsFn = ctx.getOwnedJackets;
  const owned =
    typeof jacketsFn === "function" ? jacketsFn() : [jacketColor];
  return {
    version: SAVE_VERSION,
    savedAt: +new Date(),
    x,
    z,
    heading,
    money,
    hp,
    weapons: { // pistol + smg magazines, reserves, ownership
      smgOwned: smg.owned,
      pistolMag: pistol.mag,
      pistolReserve: pistol.reserve,
      smgMag: smg.mag,
      smgReserve: smg.reserve,
      current,
    },
    jacketColor,
    // Jackets from Vice Threads: owning one means free equip in Backpack.
    ownedJackets: owned,
    missions,
    packages: pkgs,
    hour,
    lang: s.lang,
    volume: s.volume,
    musicVolume: s.musicVolume,
    sfxVolume: s.sfxVolume,
    muted: !!s.muted,
    quality: s.quality,
    camSensitivity: s.camSensitivity,
    camFollow: s.camFollow !== false,
  };
}

function createSave(ctx) {
  return {
    exists: () => hasKey(SAVE_KEY),
    save: () => writeJson(SAVE_KEY, snapshot(ctx)),
    load: () => readJson(SAVE_KEY),
    clear: () => dropKey(SAVE_KEY),
  };
}

export { DEFAULT_SETTINGS, loadSettings, persistSettings, clearSettings, createSave };
