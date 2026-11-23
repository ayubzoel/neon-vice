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
    backpack: 'Backpack', weapons: 'Weapons', jackets: 'Jackets',
    owned: 'Owned', worn: 'Worn', equip: 'Equip', equipped: 'Equipped',
    holster: 'Holster', draw: 'Draw', music: 'Music volume', sfx: 'SFX volume',
    mute: 'Mute all sound', controls: 'Controls', saveNow: 'Save now',
    saved: 'Game saved.', buyEquip: 'Buy & equip', notOwned: 'Not owned',
    playGame: 'Start Game', noSave: 'No save yet — start a New Game first.',
    overwriteSave: 'A save already exists. Starting a New Game will overwrite it.',
    startNewAnyway: 'Yes, start new game', cancel: 'Cancel',
    gameplay: 'Gameplay', audio: 'Audio', saveData: 'Save Data',
    cameraSensitivity: 'Camera sensitivity', cameraFollow: 'Camera follows movement',
    loadSave: 'Load save', resetSave: 'Delete progress',
    resetConfirm: 'Delete all progress? This cannot be undone.',
    confirmDelete: 'Yes, delete', loadedSave: 'Save loaded.',
    noSaveToLoad: 'No save to load.', progressDeleted: 'Progress deleted.',
    escaping: 'ESCAPING...', escaped: 'You escaped!', spotted: 'SPOTTED!',
    packages: 'Packages',
    fullscreen: 'Fullscreen',
    fullscreenUnsupported: 'Fullscreen is not supported in this browser',
    fullscreenFailed: 'Could not enter fullscreen.',
    exitFullscreen: 'Exit fullscreen',
  },
  id: {
    money: 'Uang', wanted: 'Buronan', hp: 'Darah', ammo: 'Peluru', objective: 'Misi',
    newGame: 'Permainan Baru', continue: 'Lanjutkan', settings: 'Pengaturan', volume: 'Volume',
    quality: 'Kualitas grafis', language: 'Bahasa', close: 'Tutup',
    phone: 'HP', jobs: 'Kerja Sampingan', taxi: 'Kerja taksi', package: 'Antar paket',
    race: 'Balapan jalanan', startMission: 'Misi', back: 'Kembali',
    paused: 'Jeda', debt: 'Utang ke Rico', night: 'Malam', day: 'Siang',
    rain: 'Hujan', enterCar: 'Tekan E untuk masuk', exitCar: 'Tekan E untuk keluar',
    backpack: 'Ransel', weapons: 'Senjata', jackets: 'Jaket',
    owned: 'Dimiliki', worn: 'Dipakai', equip: 'Pakai', equipped: 'Dipakai',
    holster: 'Simpan', draw: 'Keluarkan', music: 'Volume musik', sfx: 'Volume efek',
    mute: 'Bisukan semua suara', controls: 'Kontrol', saveNow: 'Simpan sekarang',
    saved: 'Game tersimpan.', buyEquip: 'Beli & pakai', notOwned: 'Belum dimiliki',
    playGame: 'Mulai Permainan', noSave: 'Belum ada save — mulai Permainan Baru dulu.',
    overwriteSave: 'Save sudah ada. Permainan Baru akan menimpa save lama.',
    startNewAnyway: 'Ya, mulai permainan baru', cancel: 'Batal',
    gameplay: 'Gameplay', audio: 'Audio', saveData: 'Data Save',
    cameraSensitivity: 'Sensitivitas kamera', cameraFollow: 'Kamera mengikuti gerakan',
    loadSave: 'Muat save', resetSave: 'Hapus progres',
    resetConfirm: 'Hapus semua progres? Tidak bisa dibatalkan.',
    confirmDelete: 'Ya, hapus', loadedSave: 'Save dimuat.',
    noSaveToLoad: 'Tidak ada save untuk dimuat.', progressDeleted: 'Progres dihapus.',
    escaping: 'KABUR...', escaped: 'Berhasil kabur!', spotted: 'TERLIHAT!',
    packages: 'Paket',
    fullscreen: 'Layar Penuh',
    fullscreenUnsupported: 'Layar penuh tidak didukung di browser ini',
    fullscreenFailed: 'Tidak bisa masuk layar penuh.',
    exitFullscreen: 'Keluar layar penuh',
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
    // Dynamic HUD lines are not data-i18n: re-render the package
    // counter in the new language (v6.5 item 2).
    if (lastPackages) setPackages(lastPackages.n, lastPackages.total);
  }

  function setMoney(n) {
    const el = $('hudMoney');
    if (el) el.textContent = `$${Math.floor(n).toLocaleString()}`;
    const debtEl = $('hudDebt');
    if (debtEl) debtEl.textContent = `${t('debt')}: $${CONFIG.money.debt.toLocaleString()}`;
  }
  function setWanted(n, esc) {
    const el = $('hudWanted');
    if (el) el.textContent = '★'.repeat(n) + '☆'.repeat(CONFIG.wanted.max - n);
    el.style.color = n > 0 ? '#ef4444' : '#94a3b8';
    // v6.3: while the escape timer runs the stars blink (~2 Hz) so the
    // player can see at a glance that the heat is fading.
    if (el) el.style.opacity = esc && esc.escaping ? (Math.floor(Date.now() / 250) % 2 === 0 ? '1' : '0.3') : '1';
  }
  // v6.3 escape meter: label + progress bar, shown only while escaping.
  // v6.3 tune: when the police can see the player again, the same HUD
  // slot shows a red SPOTTED!/TERLIHAT! label (bar hidden) so the player
  // can tell at a glance whether their cover is working. Hidden at
  // wanted 0 (neither escaping nor spotted).
  function setEscape(esc) {
    const el = $('hudEscape');
    if (!el) return;
    if (!esc || (!esc.escaping && !esc.spotted)) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const label = $('hudEscapeLabel');
    const track = $('hudEscapeTrack');
    const bar = $('hudEscapeBar');
    if (esc.spotted) {
      if (label) { label.textContent = t('spotted'); label.style.color = '#ef4444'; }
      if (track) track.style.display = 'none';
      return;
    }
    if (label) { label.textContent = `${t('escaping')} ${Math.round(esc.progress * 100)}%`; label.style.color = ''; }
    if (track) track.style.display = '';
    if (bar) bar.style.width = `${Math.round(esc.progress * 100)}%`;
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
  // v6.5 item 2: hidden-package counter, "Packages 3/20" / "Paket 3/20".
  // The last count is remembered so a language switch re-renders it.
  let lastPackages = null;
  function setPackages(n, total) {
    lastPackages = { n, total };
    const el = $('hudPackages');
    if (el) el.textContent = `${t('packages')} ${n}/${total}`;
  }
  function setClock(text, raining) {
    const el = $('hudClock');
    if (el) el.textContent = `${text}${raining ? ' · ' + t('rain') : ''}`;
  }
  function setAmbient(nPeds, nCars) {
    const el = $('hudAmbient');
    if (el) el.textContent = `NPC ${nPeds} · Cars ${nCars}`;
  }
  function setGps(dist, name) {
    const el = $('hudGps');
    if (el) el.textContent = name ? `GPS ${name} · ${Math.round(dist)}m` : '';
  }
  // ---- Top banner (Builder A v4) -----------------------------------------
  // ALL tutorial/help text lives here now: the persistent controls hint
  // AND the transient toast messages share one small strip at the TOP
  // edge of the screen (below the HUD), so nothing ever covers the
  // centre of the view while playing. The old centre/bottom elements
  // (#hudMsg toast at top-centre, #hudHint bottom bar, #touchHint pill)
  // are retired: hudMsg is gone from the HTML, hudHint/touchHint stay in
  // the DOM hidden only because input.js still observes #hudHint to drive
  // the touch CAR button label.
  let bannerHint = '';
  let toastActive = false;
  let bannerDismissed = false;

  function renderBanner() {
    const banner = $('topBanner');
    const text = $('bannerText');
    if (!banner || !text) return;
    if (bannerDismissed) {
      banner.classList.add('hidden');
      $('bannerShow')?.classList.remove('hidden');
      return;
    }
    $('bannerShow')?.classList.add('hidden');
    banner.classList.remove('hidden');
    text.textContent = bannerHint;
  }

  function setBannerHint(text) {
    bannerHint = text || '';
    // A toast message owns the banner while it is showing; the hint
    // returns when the toast expires (see toast()).
    if (!toastActive) renderBanner();
  }
  function dismissBanner() {
    bannerDismissed = true;
    renderBanner();
  }
  function showBanner() {
    bannerDismissed = false;
    renderBanner();
  }
  function toggleBanner() {
    if (bannerDismissed) showBanner();
    else dismissBanner();
  }

  function toast(msg, ms = 3500) {
    // A message temporarily takes over the banner, then the hint returns.
    // If the player dismissed the banner, the message still shows (a
    // mission message must not be lost) and the banner hides again after.
    const banner = $('topBanner');
    const text = $('bannerText');
    if (!banner || !text) return;
    banner.classList.remove('hidden');
    $('bannerShow')?.classList.add('hidden');
    text.textContent = msg;
    toastActive = true;
    if (msgTimer) clearTimeout(msgTimer);
    msgTimer = setTimeout(() => {
      toastActive = false;
      renderBanner();
    }, ms);
  }

  // Minimap: 2D top-down, player centred, roads + water + bounds + places +
  // objective beacon. segments: roadGraph.segments [{ax,az,bx,bz}] or null.
  function drawMinimap(canvas, playerPos, heading, beaconPos, places, gpsTarget, segments, flyovers) {
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
    // Flyover decks (v6): amber strip along the NS road at each flyover
    // (ramps + deck), so the elevated lanes read on the minimap too.
    if (flyovers && flyovers.length) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 3;
      for (const f of flyovers) {
        const [x1, y1] = toMini(f.x, f.z - 60);
        const [x2, y2] = toMini(f.x, f.z + 60);
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
      // Mission icon on the minimap: a gold diamond with "!" — distinct
      // from the cyan place dots and the pink GPS dot/line.
      const [mx, my] = toMini(beaconPos.x, beaconPos.z);
      ctx.save();
      ctx.translate(mx, my);
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(8, 0); ctx.lineTo(0, 9); ctx.lineTo(-8, 0);
      ctx.closePath();
      ctx.fillStyle = '#ffd400';
      ctx.fill();
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#111111';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', 0, 0.5);
      ctx.restore();
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
    setMoney, setWanted, setEscape, setHp, setAmmo, setObjective, setPackages, setClock, setAmbient, setGps, toast,
    setBannerHint, dismissBanner, showBanner, toggleBanner,
    get bannerDismissed() { return bannerDismissed; },
    drawMinimap,
    showPanel(id) { $(id)?.classList.remove('hidden'); },
    hidePanel(id) { $(id)?.classList.add('hidden'); },
    isPanelOpen(id) { return !$(id)?.classList.contains('hidden'); },
  };
}
