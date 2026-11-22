// Neon Vice — Builder C: save / load (localStorage, one slot).
// Stores position, money, weapons, jacket, mission progress, game hour and
// settings. The start screen shows Continue when a save exists; missions
// autosave on completion.
//
// v5: settings live in their OWN key (neonvice-settings-v1), separate from
// the game save, so a volume/quality change on the title screen survives a
// reload even when no game save exists yet (and survives wiping progress).

const KEY = 'neonvice-save-v1';
const SETTINGS_KEY = 'neonvice-settings-v1';

export const DEFAULT_SETTINGS = {
  lang: 'en', volume: 0.7, musicVolume: 0.8, sfxVolume: 0.9, muted: false,
  quality: 'high', camSensitivity: 1, camFollow: true,
};

export function loadSettings(overrides = {}) {
  const out = { ...DEFAULT_SETTINGS, ...overrides };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return out;
    const data = JSON.parse(raw);
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (data[k] !== undefined) out[k] = data[k];
    }
    // Clamp / sanitize (a hand-edited value must never break boot).
    out.volume = Math.max(0, Math.min(1, Number(out.volume) || 0.7));
    out.musicVolume = Math.max(0, Math.min(1, Number(out.musicVolume) || 0.8));
    out.sfxVolume = Math.max(0, Math.min(1, Number(out.sfxVolume) || 0.9));
    out.muted = !!out.muted;
    out.quality = out.quality === 'low' ? 'low' : 'high';
    out.camSensitivity = Math.max(0.5, Math.min(2, Number(out.camSensitivity) || 1));
    out.camFollow = out.camFollow !== false;
    out.lang = out.lang === 'id' ? 'id' : 'en';
  } catch { /* corrupted settings: fall back to defaults */ }
  return out;
}

export function persistSettings(settings) {
  try {
    const data = {};
    for (const k of Object.keys(DEFAULT_SETTINGS)) data[k] = settings[k];
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearSettings() {
  try { window.localStorage.removeItem(SETTINGS_KEY); } catch { /* ignore */ }
}

export function createSave(ctx) {
  return {
    exists() {
      try {
        return !!window.localStorage.getItem(KEY);
      } catch {
        return false;
      }
    },
    save() {
      try {
        const data = {
          version: 1,
          savedAt: Date.now(),
          x: ctx.player.group.position.x,
          z: ctx.player.group.position.z,
          heading: ctx.player.heading,
          money: ctx.getMoney(),
          hp: ctx.player.hp,
          weapons: {
            smgOwned: ctx.combat.weapons.smg.owned,
            pistolMag: ctx.combat.weapons.pistol.mag,
            pistolReserve: ctx.combat.weapons.pistol.reserve,
            smgMag: ctx.combat.weapons.smg.mag,
            smgReserve: ctx.combat.weapons.smg.reserve,
            current: ctx.combat.current,
          },
          jacketColor: ctx.player.jacketColor,
          // Jackets bought at Vice Threads (owned = equip free in Backpack).
          // Seeded from the current jacket when the getter is absent.
          ownedJackets: ctx.getOwnedJackets
            ? ctx.getOwnedJackets()
            : [ctx.player.jacketColor],
          missions: ctx.missions.getState(),
          hour: ctx.weather.hour,
          lang: ctx.settings.lang,
          volume: ctx.settings.volume,
          musicVolume: ctx.settings.musicVolume,
          sfxVolume: ctx.settings.sfxVolume,
          muted: !!ctx.settings.muted,
          quality: ctx.settings.quality,
          camSensitivity: ctx.settings.camSensitivity,
          camFollow: ctx.settings.camFollow !== false,
        };
        window.localStorage.setItem(KEY, JSON.stringify(data));
        return true;
      } catch {
        return false;
      }
    },
    load() {
      try {
        const raw = window.localStorage.getItem(KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    clear() {
      try {
        window.localStorage.removeItem(KEY);
      } catch { /* ignore */ }
    },
  };
}
