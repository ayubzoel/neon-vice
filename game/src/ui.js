// Neon Vice — Builder C: HUD + UI.
// Money, wanted stars, HP, ammo, mission objective, minimap, message toast,
// shop / phone / settings panels. Language: EN default + ID dictionary for
// HUD and menus, toggled in Settings and persisted in the save.
// All DOM ids live in index.html; this module only reads/writes them.

import { CONFIG } from './config.js';

export const I18N = {
  en: {
    money: 'Cash', wanted: 'Wanted', hp: 'Health', ammo: 'Ammo', objective: 'Objective',
    newGame: 'New Game', continue: 'Continue', settings: 'Settings', volume: 'Volume',
    quality: 'Graphics quality', language: 'Language', close: 'Close',
    phone: 'Phone', jobs: 'Side Jobs', taxi: 'Taxi job', package: 'Package delivery',
    race: 'Street race', startMission: 'Missions', back: 'Back',
    paused: 'Paused', debt: 'Debt to Rico', night: 'Night', day: 'Day',
    rain: 'Rain', enterCar: 'Press E to enter', exitCar: 'Press E to exit',
  },
  id: {
    money: 'Uang', wanted: 'Buronan', hp: 'Darah', ammo: 'Peluru', objective: 'Misi',
    newGame: 'Permainan Baru', continue: 'Lanjutkan', settings: 'Pengaturan', volume: 'Volume',
    quality: 'Kualitas grafis', language: 'Bahasa', close: 'Tutup',
    phone: 'HP', jobs: 'Kerja Sampingan', taxi: 'Kerja taksi', package: 'Antar paket',
    race: 'Balapan jalanan', startMission: 'Misi', back: 'Kembali',
    paused: 'Jeda', debt: 'Utang ke Rico', night: 'Malam', day: 'Siang',
    rain: 'Hujan', enterCar: 'Tekan E untuk masuk', exitCar: 'Tekan E untuk keluar',
  },
};

export function createUI(settings) {
  const $ = (id) => document.getElementById(id);
  let lang = settings.lang || 'en';
  let msgTimer = null;

  function t(key) {
    return (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
  }
  function setLang(l) {
    lang = l === 'id' ? 'id' : 'en';
    settings.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
  }

  function setMoney(n) {
    const el = $('hudMoney');
    if (el) el.textContent = `$${Math.floor(n).toLocaleString()}`;
    const debtEl = $('hudDebt');
    if (debtEl) debtEl.textContent = `${t('debt')}: $${CONFIG.money.debt.toLocaleString()}`;
  }
  function setWanted(n) {
    const el = $('hudWanted');
    if (el) el.textContent = '★'.repeat(n) + '☆'.repeat(CONFIG.wanted.max - n);
    el.style.color = n > 0 ? '#ef4444' : '#94a3b8';
  }
  function setHp(hp, max) {
    const bar = $('hudHpBar');
    if (bar) bar.style.width = `${Math.max(0, (hp / max) * 100)}%`;
    const el = $('hudHpText');
    if (el) el.textContent = `${Math.ceil(hp)}`;
  }
  function setAmmo(text) {
    const el = $('hudAmmo');
    if (el) el.textContent = text;
  }
  function setObjective(text) {
    const el = $('hudObjective');
    if (el) el.textContent = text || '';
  }
  function setClock(text, raining) {
    const el = $('hudClock');
    if (el) el.textContent = `${text}${raining ? ' · ' + t('rain') : ''}`;
  }
  function setGps(dist, name) {
    const el = $('hudGps');
    if (el) el.textContent = name ? `GPS ${name} · ${Math.round(dist)}m` : '';
  }
  function toast(msg, ms = 3500) {
    const el = $('hudMsg');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    if (msgTimer) clearTimeout(msgTimer);
    msgTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  // Minimap: 2D top-down, player centred, roads + water + bounds + places +
  // objective beacon. segments: roadGraph.segments [{ax,az,bx,bz}] or null.
  function drawMinimap(canvas, playerPos, heading, beaconPos, places, gpsTarget, segments) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const S = canvas.width;
    const range = 260; // metres shown across the minimap
    const scale = S / range;
    ctx.fillStyle = 'rgba(11,16,38,0.85)';
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = '#3b4a63';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
    const toMini = (x, z) => [
      S / 2 + (x - playerPos.x) * scale,
      S / 2 + (z - playerPos.z) * scale,
    ];
    // Water strip.
    ctx.fillStyle = '#0e3a5c';
    const [wx] = toMini(CONFIG.water.x0, 0);
    ctx.fillRect(wx, 0, (CONFIG.water.x1 - CONFIG.water.x0) * scale, S);
    // Roads (was: minimap showed only dots — nearly useless).
    ctx.strokeStyle = '#5b6b85';
    ctx.lineWidth = 2;
    if (segments && segments.length) {
      for (const s of segments) {
        const [x1, y1] = toMini(s.ax, s.az);
        const [x2, y2] = toMini(s.bx, s.bz);
        if ((x1 < -10 && x2 < -10) || (x1 > S + 10 && x2 > S + 10)
          || (y1 < -10 && y2 < -10) || (y1 > S + 10 && y2 > S + 10)) continue;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
    } else {
      // Fallback grid when no road graph is available.
      ctx.lineWidth = 1;
      for (let gx = -600; gx <= 600; gx += 120) {
        const [x1, y1] = toMini(gx, -450);
        const [x2, y2] = toMini(gx, 450);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      for (let gz = -450; gz <= 450; gz += 120) {
        const [x1, y1] = toMini(-600, gz);
        const [x2, y2] = toMini(600, gz);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
    }
    // World bounds.
    const [bx0, by0] = toMini(-CONFIG.world.width / 2, -CONFIG.world.depth / 2);
    const [bx1, by1] = toMini(CONFIG.world.width / 2, CONFIG.world.depth / 2);
    ctx.strokeStyle = '#f472b6';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
    for (const p of places) {
      const [mx, my] = toMini(p.x, p.z);
      if (mx < -4 || my < -4 || mx > S + 4 || my > S + 4) continue;
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath(); ctx.arc(mx, my, 3, 0, Math.PI * 2); ctx.fill();
    }
    if (gpsTarget) {
      const [mx, my] = toMini(gpsTarget.x, gpsTarget.z);
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(S / 2, S / 2); ctx.lineTo(mx, my); ctx.stroke();
      ctx.fillStyle = '#f472b6';
      ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI * 2); ctx.fill();
    }
    if (beaconPos) {
      const [mx, my] = toMini(beaconPos.x, beaconPos.z);
      ctx.fillStyle = '#f472b6';
      ctx.beginPath(); ctx.arc(mx, my, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#f472b6';
      ctx.beginPath(); ctx.arc(mx, my, 9, 0, Math.PI * 2); ctx.stroke();
    }
    // Player arrow (screen-up = heading).
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(Math.atan2(Math.sin(heading), Math.cos(heading)) + Math.PI);
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  return {
    t, setLang, get lang() { return lang; },
    setMoney, setWanted, setHp, setAmmo, setObjective, setClock, setGps, toast,
    drawMinimap,
    showPanel(id) { $(id)?.classList.remove('hidden'); },
    hidePanel(id) { $(id)?.classList.add('hidden'); },
    isPanelOpen(id) { return !$(id)?.classList.contains('hidden'); },
  };
}
