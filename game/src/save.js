// Neon Vice — Builder C: save / load (localStorage, one slot).
// Stores position, money, weapons, jacket, mission progress, game hour and
// settings. The start screen shows Continue when a save exists; missions
// autosave on completion.

const KEY = 'neonvice-save-v1';

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
          missions: ctx.missions.getState(),
          hour: ctx.weather.hour,
          lang: ctx.settings.lang,
          volume: ctx.settings.volume,
          quality: ctx.settings.quality,
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
