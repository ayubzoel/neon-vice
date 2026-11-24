// Neon Vice — HUD + UI.
//
// Money, wanted stars, HP, ammo, mission objective, minimap, message
// toast, shop / phone / settings panels. Language: EN default + ID
// dictionary for HUD and menus, toggled in Settings and persisted in the
// save. All DOM ids live in index.html; this module only reads/writes
// them.

import { CONFIG as UI_CFG } from './config.js';

const EN_ROWS = [
  ["money", "Cash"],
  ["wanted", "Wanted"],
  ["hp", "Health"],
  ["ammo", "Ammo"],
  ["objective", "Objective"],
  ["newGame", "New Game"],
  ["continue", "Continue"],
  ["settings", "Settings"],
  ["volume", "Volume"],
  ["quality", "Graphics quality"],
  ["language", "Language"],
  ["close", "Close"],
  ["phone", "Phone"],
  ["jobs", "Side Jobs"],
  ["taxi", "Taxi job"],
  ["package", "Package delivery"],
  ["race", "Street race"],
  ["startMission", "Missions"],
  ["back", "Back"],
  ["paused", "Paused"],
  ["debt", "Debt to Rico"],
  ["night", "Night"],
  ["day", "Day"],
  ["rain", "Rain"],
  ["enterCar", "Press E to enter"],
  ["exitCar", "Press E to exit"],
  ["backpack", "Backpack"],
  ["weapons", "Weapons"],
  ["jackets", "Jackets"],
  ["owned", "Owned"],
  ["worn", "Worn"],
  ["equip", "Equip"],
  ["equipped", "Equipped"],
  ["holster", "Holster"],
  ["draw", "Draw"],
  ["music", "Music volume"],
  ["sfx", "SFX volume"],
  ["mute", "Mute all sound"],
  ["controls", "Controls"],
  ["saveNow", "Save now"],
  ["saved", "Game saved."],
  ["buyEquip", "Buy & equip"],
  ["notOwned", "Not owned"],
  ["playGame", "Start Game"],
  ["noSave", "No save yet — start a New Game first."],
  ["overwriteSave", "A save already exists. Starting a New Game will overwrite it."],
  ["startNewAnyway", "Yes, start new game"],
  ["cancel", "Cancel"],
  ["gameplay", "Gameplay"],
  ["audio", "Audio"],
  ["saveData", "Save Data"],
  ["cameraSensitivity", "Camera sensitivity"],
  ["cameraFollow", "Camera follows movement"],
  ["loadSave", "Load save"],
  ["resetSave", "Delete progress"],
  ["resetConfirm", "Delete all progress? This cannot be undone."],
  ["confirmDelete", "Yes, delete"],
  ["loadedSave", "Save loaded."],
  ["noSaveToLoad", "No save to load."],
  ["progressDeleted", "Progress deleted."],
  ["escaping", "ESCAPING..."],
  ["escaped", "You escaped!"],
  ["spotted", "SPOTTED!"],
  ["packages", "Packages"],
  ["fullscreen", "Fullscreen"],
  ["fullscreenUnsupported", "Fullscreen is not supported in this browser"],
  ["fullscreenFailed", "Could not enter fullscreen."],
  ["exitFullscreen", "Exit fullscreen"],
];

const ID_ROWS = [
  ["money", "Uang"],
  ["wanted", "Buronan"],
  ["hp", "Darah"],
  ["ammo", "Peluru"],
  ["objective", "Misi"],
  ["newGame", "Permainan Baru"],
  ["continue", "Lanjutkan"],
  ["settings", "Pengaturan"],
  ["volume", "Volume"],
  ["quality", "Kualitas grafis"],
  ["language", "Bahasa"],
  ["close", "Tutup"],
  ["phone", "HP"],
  ["jobs", "Kerja Sampingan"],
  ["taxi", "Kerja taksi"],
  ["package", "Antar paket"],
  ["race", "Balapan jalanan"],
  ["startMission", "Misi"],
  ["back", "Kembali"],
  ["paused", "Jeda"],
  ["debt", "Utang ke Rico"],
  ["night", "Malam"],
  ["day", "Siang"],
  ["rain", "Hujan"],
  ["enterCar", "Tekan E untuk masuk"],
  ["exitCar", "Tekan E untuk keluar"],
  ["backpack", "Ransel"],
  ["weapons", "Senjata"],
  ["jackets", "Jaket"],
  ["owned", "Dimiliki"],
  ["worn", "Dipakai"],
  ["equip", "Pakai"],
  ["equipped", "Dipakai"],
  ["holster", "Simpan"],
  ["draw", "Keluarkan"],
  ["music", "Volume musik"],
  ["sfx", "Volume efek"],
  ["mute", "Bisukan semua suara"],
  ["controls", "Kontrol"],
  ["saveNow", "Simpan sekarang"],
  ["saved", "Game tersimpan."],
  ["buyEquip", "Beli & pakai"],
  ["notOwned", "Belum dimiliki"],
  ["playGame", "Mulai Permainan"],
  ["noSave", "Belum ada save — mulai Permainan Baru dulu."],
  ["overwriteSave", "Save sudah ada. Permainan Baru akan menimpa save lama."],
  ["startNewAnyway", "Ya, mulai permainan baru"],
  ["cancel", "Batal"],
  ["gameplay", "Gameplay"],
  ["audio", "Audio"],
  ["saveData", "Data Save"],
  ["cameraSensitivity", "Sensitivitas kamera"],
  ["cameraFollow", "Kamera mengikuti gerakan"],
  ["loadSave", "Muat save"],
  ["resetSave", "Hapus progres"],
  ["resetConfirm", "Hapus semua progres? Tidak bisa dibatalkan."],
  ["confirmDelete", "Ya, hapus"],
  ["loadedSave", "Save dimuat."],
  ["noSaveToLoad", "Tidak ada save untuk dimuat."],
  ["progressDeleted", "Progres dihapus."],
  ["escaping", "KABUR..."],
  ["escaped", "Berhasil kabur!"],
  ["spotted", "TERLIHAT!"],
  ["packages", "Paket"],
  ["fullscreen", "Layar Penuh"],
  ["fullscreenUnsupported", "Layar penuh tidak didukung di browser ini"],
  ["fullscreenFailed", "Tidak bisa masuk layar penuh."],
  ["exitFullscreen", "Keluar layar penuh"],
];

export const I18N = { // EN + ID strings
  en: Object.fromEntries(EN_ROWS),
  id: Object.fromEntries(ID_ROWS),
};

export function createUI(settings) { // HUD + panels
  const get = (id) => document.getElementById(id);
  let lang = settings.lang || "en";
  let msgTimer = null; // toast timer

  function t(key) { // translate
    const dict = I18N[lang] || I18N.en;
    return dict[key] || I18N.en[key] || key;
  }
  function setLang(l) { // switch language
    lang = l === "id" ? "id" : "en";
    settings.lang = lang; // persist
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n); // apply the translation
    });
    // Dynamic HUD lines skip data-i18n: re-render the package
    // counter in the new language.
    if (lastPackages) {
      setPackages(lastPackages.n, lastPackages.total);
    }
  }

  function setText(id, text) {
    const el = get(id);
    if (el) {
      el.textContent = text;
    }
  }

  function setMoney(n) { // cash + debt
    setText("hudMoney", `$${Math.floor(n).toLocaleString()}`);
    setText("hudDebt", `${t("debt")}: $${UI_CFG.money.debt.toLocaleString()}`);
  }
  function setWanted(n, esc) { // wanted stars
    const el = get("hudWanted");
    if (el) el.textContent = "★".repeat(n) + "☆".repeat(UI_CFG.wanted.max - n);
    el.style.color = n > 0 ? "#ef4444" : "#94a3b8";
    // While the escape timer runs the stars blink (~2 Hz) so the
    // so the player sees at a glance that the heat is fading.
    if (el) el.style.opacity = esc && esc.escaping ? (Math.floor(Date.now() / 250) % 2 === 0 ? "1" : "0.3") : "1";
  }
  // Escape meter: label + progress bar, shown only while escaping.
  // When the police can see the player again, the same HUD slot shows
  // a red SPOTTED!/TERLIHAT! label (bar hidden) so the player can tell
  // at a glance whether their cover is working. Hidden at wanted 0
  // (neither escaping nor spotted).
  function setEscape(esc) { // escape meter
    const el = get("hudEscape");
    if (!el) { // no escape HUD
      return;
    }
    if (!esc || (!esc.escaping && !esc.spotted)) {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    const label = get("hudEscapeLabel");
    const track = get("hudEscapeTrack");
    const bar = get("hudEscapeBar");
    if (esc.spotted) { // police see you
      if (label) { // spotted label
        label.textContent = t("spotted");
        label.style.color = "#ef4444";
      }
      if (track) track.style.display = "none";
      return;
    }
    if (label) { // escape label
      label.textContent = `${t("escaping")} ${Math.round(esc.progress * 100)}%`;
      label.style.color = "";
    }
    if (track) track.style.display = "";
    if (bar) {
      bar.style.width = `${Math.round(esc.progress * 100)}%`;
    }
  }
  function setHp(hp, max) { // health bar
    const bar = get("hudHpBar");
    if (bar) {
      bar.style.width = `${Math.max(0, (hp / max) * 100)}%`;
    }
    setText("hudHpText", `${Math.ceil(hp)}`);
  }
  function setAmmo(text) { // ammo line
    setText("hudAmmo", text);
  }
  function setObjective(text) { // mission objective
    setText("hudObjective", text || "");
  }
  // Hidden-package counter, "Packages 3/20" / "Paket 3/20". The last
  // count is remembered so a language switch re-renders it.
  let lastPackages = null; // last package count
  function setPackages(n, total) { // package counter
    lastPackages = { n, total }; // remember for language switches
    setText("hudPackages", `${t("packages")} ${n}/${total}`);
  }
  function setClock(text, raining) { // clock + rain
    setText("hudClock", `${text}${raining ? " · " + t("rain") : ""}`);
  }
  function setAmbient(nPeds, nCars) { // NPC/car counts
    setText("hudAmbient", `NPC ${nPeds} · Cars ${nCars}`);
  }
  function setGps(dist, name) { // GPS line
    setText("hudGps", name ? `GPS ${name} · ${Math.round(dist)}m` : "");
  }

  // ---- Top banner -------------------------------------------------------
  // All tutorial/help text lives here: the persistent controls hint
  // and the transient toast messages share one small strip at the TOP
  // edge of the screen (below the HUD), so it never covers the
  // centre of the view while playing. The old centre/bottom bits
  // (#hudMsg toast top-centre, #hudHint bottom bar, #touchHint pill)
  // are retired: hudMsg is gone from the HTML, hudHint/touchHint stay
  // in the DOM hidden only because input.js still observes #hudHint to
  // drive the touch CAR button label.
  let bannerHint = "";
  let toastActive = false; // a toast owns the banner
  let bannerDismissed = false; // user hid the banner

  function renderBanner() { // show hint or hide
    const banner = get("topBanner");
    const text = get("bannerText");
    if (!banner || !text) {
      return;
    }
    const showBtn = get("bannerShow");
    if (bannerDismissed) { // hidden by the user
      banner.classList.add("hidden");
      if (showBtn) showBtn.classList.remove("hidden");
      return;
    }
    if (showBtn) showBtn.classList.add("hidden");
    banner.classList.remove("hidden");
    text.textContent = bannerHint; // show the hint
  }

  function setBannerHint(text) { // set the hint
    bannerHint = text || "";
    // A toast owns the banner while it shows; the hint
    // returns once the toast expires (see toast()).
    if (!toastActive) {
      renderBanner(); // show the hint
    }
  }
  function dismissBanner() { // hide the banner
    bannerDismissed = true; // hide it
    renderBanner(); // apply
  }
  function showBanner() { // show the banner again
    bannerDismissed = false; // show it again
    renderBanner(); // apply
  }
  function toggleBanner() { // hide or show
    if (bannerDismissed) { // hidden?
      showBanner();
    } else {
      dismissBanner();
    }
  }

  function toast(msg, ms = 3500) { // transient message
    // A message briefly takes over the banner, then the hint returns.
    // If the player hid the banner, the message still shows (a
    // mission message must not be lost), and the banner hides again after.
    const banner = get("topBanner");
    const text = get("bannerText");
    if (!banner || !text) {
      return;
    }
    banner.classList.remove("hidden");
    const showBtn = get("bannerShow");
    if (showBtn) showBtn.classList.add("hidden");
    text.textContent = msg; // show the message
    // Mirror the last toast into #hudMsg so the message stays readable
    // after the banner reverts to its hint — the ★1 escape toast ("You
    // escaped!" / "Berhasil kabur!") was otherwise unreadable once it
    // expired.
    const hm = get("hudMsg");
    if (hm) {
      hm.textContent = msg;
    }
    toastActive = true; // toast owns the banner
    if (msgTimer) {
      clearTimeout(msgTimer);
    }
    msgTimer = setTimeout(() => { // toast expires
      toastActive = false; // hint returns
      renderBanner(); // back to the hint
    }, ms);
  }

  // Minimap: 2D top-down, player centred, roads + water + bounds +
  // places + objective beacon. segments: roadGraph.segments
  // [{ax,az,bx,bz}] or null.
  function drawMinimap(canvas, playerPos, heading, beaconPos, places, gpsTarget, segments, flyovers) { // draw the minimap
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d"); // 2d context
    const S = canvas.width; // square size
    const range = 260; // metres across the minimap
    const scale = S / range; // px per metre
    const offScreen = (a, b) => (a < -10 && b < -10) || (a > S + 10 && b > S + 10);
    const toMini = (x, z) => [ // world -> minimap
      S / 2 + (x - playerPos.x) * scale, // east
      S / 2 + (z - playerPos.z) * scale, // south
    ];
    const line = (x1, y1, x2, y2) => {
      ctx.beginPath(); // fresh path
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke(); // draw the line
    };
    const dot = (x, y, r, color) => {
      ctx.fillStyle = color; // dot colour
      ctx.beginPath(); // dot path
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill(); // fill the dot
    };
    ctx.fillStyle = "rgba(11,16,38,0.85)";
    ctx.fillRect(0, 0, S, S); // dark background
    ctx.strokeStyle = "#3b4a63";
    ctx.lineWidth = 1; // thin border
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1); // frame
    // Water strip (east).
    ctx.fillStyle = "#0e3a5c";
    const [wx] = toMini(UI_CFG.water.x0, 0);
    ctx.fillRect(wx, 0, (UI_CFG.water.x1 - UI_CFG.water.x0) * scale, S);
    // Roads — the minimap used to show only dots, nearly useless.
    ctx.strokeStyle = "#5b6b85";
    ctx.lineWidth = 2; // road width
    if (segments && segments.length) { // roads available
      for (const seg of segments) {
        const [x1, y1] = toMini(seg.ax, seg.az);
        const [x2, y2] = toMini(seg.bx, seg.bz);
        if (offScreen(x1, x2) || offScreen(y1, y2)) continue; // skip
        line(x1, y1, x2, y2);
      }
    } else {
      // Fallback grid when the road graph is missing.
      ctx.lineWidth = 1; // thin grid
      for (let gx = -600; gx <= 600; gx += 120) { // vertical lines
        const [x1, y1] = toMini(gx, -450); // grid top
        const [x2, y2] = toMini(gx, 450); // grid bottom
        line(x1, y1, x2, y2);
      }
      for (let gz = -450; gz <= 450; gz += 120) { // horizontal lines
        const [x1, y1] = toMini(-600, gz); // grid left
        const [x2, y2] = toMini(600, gz); // grid right
        line(x1, y1, x2, y2);
      }
    }
    // Flyover decks: amber strip along the NS road at each flyover
    // (ramps + deck) so the elevated lanes read on the minimap too.
    if (flyovers && flyovers.length) { // elevated lanes
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 3; // thick amber strip
      for (const f of flyovers) { // each flyover
        const [x1, y1] = toMini(f.x, f.z - 60); // deck start
        const [x2, y2] = toMini(f.x, f.z + 60); // deck end
        line(x1, y1, x2, y2);
      }
    }
    // World bounds (pink).
    const [bx0, by0] = toMini(-UI_CFG.world.width / 2, -UI_CFG.world.depth / 2);
    const [bx1, by1] = toMini(UI_CFG.world.width / 2, UI_CFG.world.depth / 2);
    ctx.strokeStyle = "#f472b6";
    ctx.lineWidth = 1; // thin bounds
    ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0); // bounds box
    for (const p of places) { // place dots
      const [mx, my] = toMini(p.x, p.z); // place dot
      if (mx < -4 || my < -4 || mx > S + 4 || my > S + 4) continue; // off the map
      dot(mx, my, 3, "#22d3ee");
    }
    if (gpsTarget) { // GPS line + dot
      const [mx, my] = toMini(gpsTarget.x, gpsTarget.z); // gps point
      ctx.strokeStyle = "#f472b6";
      ctx.lineWidth = 2; // gps line
      line(S / 2, S / 2, mx, my);
      dot(mx, my, 5, "#f472b6");
    }
    if (beaconPos) { // mission beacon
      // Mission icon: a gold diamond with "!" — distinct
      // from cyan place dots and the pink GPS dot/line.
      const [mx, my] = toMini(beaconPos.x, beaconPos.z); // beacon point
      ctx.save(); // beacon transform
      ctx.translate(mx, my); // centre on the beacon
      ctx.beginPath(); // diamond path
      ctx.moveTo(0, -9);
      ctx.lineTo(8, 0);
      ctx.lineTo(0, 9);
      ctx.lineTo(-8, 0);
      ctx.closePath(); // diamond
      ctx.fillStyle = "#ffd400";
      ctx.fill(); // fill the diamond
      ctx.strokeStyle = "#f472b6";
      ctx.lineWidth = 2; // diamond outline
      ctx.stroke(); // diamond outline
      ctx.fillStyle = "#111111";
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.textAlign = "center"; // centred "!"
      ctx.textBaseline = "middle";
      ctx.fillText("!", 0, 0.5);
      ctx.restore(); // beacon done
    }
    // Player arrow, screen-up = heading.
    ctx.save(); // arrow transform
    ctx.translate(S / 2, S / 2); // centre
    ctx.rotate(heading + Math.PI);
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath(); // arrow path
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 6);
    ctx.lineTo(-6, 6);
    ctx.closePath(); // triangle
    ctx.fill(); // fill the arrow
    ctx.restore(); // arrow done
  }

  return {
    t, setLang, get lang() { return lang; }, // translate + language
    setMoney, setWanted, setEscape, setHp, setAmmo, setObjective, setPackages, setClock, setAmbient, setGps, toast, // HUD setters + toast
    setBannerHint, dismissBanner, showBanner, toggleBanner, // banner controls
    get bannerDismissed() { return bannerDismissed; }, // banner hidden?
    drawMinimap, // minimap
    showPanel(id) { get(id)?.classList.remove("hidden"); },
    hidePanel(id) { get(id)?.classList.add("hidden"); },
    isPanelOpen(id) { return !get(id)?.classList.contains("hidden"); },
  };
}
