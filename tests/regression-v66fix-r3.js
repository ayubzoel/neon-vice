// Neon Vice — regresi v6.6-fix, ronde 3 (tulis ulang segar dari spesifikasi).
//
// Menjaga perbaikan ronde 2 (taman C geser 12 m ke barat) + perbaikan ronde 1:
//   (0) clearance belok kiri lebar di bawah flyover x=300 (diagonal bebas),
//   (1) beacon kembali ke target misi utama setelah side job selesai,
//   (2) belok kiri rapat di bawah kedua flyover (pelan + cepat),
//   (3) toast escape terbaca di #hudMsg (EN + ID),
//   (4) koridor selatan taman B: pejalan kaki bisa masuk, mobil terhalang,
//   (5) belok kiri lebar fx=300, (6) belok kanan kedua flyover,
//   (7) traffic 28 mobil, 0 nyangkut selama 30 dtk game-time,
//   (8) 0 console/page error, 0 request eksternal.
//
// Dijalankan:  node tests/regression-v66fix-r3.js   (dari repo root)
// Keluar 0 bila semua check lolos, 1 bila ada yang gagal.
// Game disajikan lewat server statis lokal (python3 -m http.server) di atas
// folder game/; browser Chromium headless + SwiftShader via playwright-core.
import { chromium } from '/home/hatch/workspace/custom-skills/playwright_skill/node_modules/playwright-core/index.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(HERE, '..', 'game');
const PORT = 8931;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// ---- Registry check: setiap check tercatat + dicetak, ringkasan di akhir. ----
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// ---- Server statis lokal: pakai yang sudah jalan, atau spawn sendiri. ----
let serverProc = null;
async function ensureServer() {
  try {
    const r = await fetch(`${BASE}/index.html`);
    if (r.ok) return;
  } catch { /* belum jalan */ }
  serverProc = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: GAME_DIR, stdio: 'ignore' });
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${BASE}/index.html`);
      if (r.ok) return;
    } catch { /* coba lagi */ }
    if (Date.now() - t0 > 20000) throw new Error('server http lokal tidak kunjung jalan');
    await sleep(250);
  }
}

// ---- State game: posisi + heading mobil yang dikemudikan + kecepatan. ----
async function carState(page) {
  return page.evaluate(() => {
    const V = window.NEON_VICE;
    const s = V.stats();
    const h = V.hero();
    let heading = h.heading;
    let nearestTraffic = Infinity;
    for (const v of V.game.vehicles.list) {
      const d = Math.hypot(v.mesh.position.x - h.x, v.mesh.position.z - h.z);
      if (v.traffic) nearestTraffic = Math.min(nearestTraffic, d);
      else if (!v.parked && d < 1.5) heading = v.heading; // mobil yang dikemudikan
    }
    return {
      x: h.x, z: h.z, heading, speed: Math.abs(s.speedSigned),
      gameTime: s.gameTime, driving: s.driving, wanted: s.wanted, nearestTraffic,
    };
  });
}

// ---- Manajemen tombol keyboard (WASD) lewat Playwright. ----
const downKeys = new Set();
async function setKeys(page, want) {
  for (const k of [...downKeys]) {
    if (!want.has(k)) { await page.keyboard.up(k); downKeys.delete(k); }
  }
  for (const k of [...want]) {
    if (!downKeys.has(k)) { await page.keyboard.down(k); downKeys.add(k); }
  }
}

// ---- Driver waypoint: pure pursuit dengan lookahead DI SEPANJANG segmen.
// Setiap leg adalah SEGMEN dari waypoint sebelumnya ke target — mobil
// membidik titik 4 m di depan sepanjang segmen (bukan waypoint jauhnya),
// jadi ia mengikuti GARIS jalur dan tetap di tengah lajur. Ini penting di
// lajur sempit bawah flyover (clearance 0,55 m/sisi): membidik waypoint
// jauh membiarkan mobil melenceng lateral sampai hidungnya bersinggungan
// dengan pagar taman median (wedge: tidak bisa maju maupun membelok,
// hanya mundur yang membebaskan). Bila mobil jauh dari garis (> 8 m),
// bidik langsung target (mode pemulihan).
// TANPA mundur: bila mobil tidak maju 10 dtk game-time dengan jalanan
// kosong di depan → gagal (macet karena traffic < 12 m diberi tenggang).
async function driveRoute(page, legs) {
  let leg = 0;
  let bestD = Infinity;
  let lastImproveGt = (await carState(page)).gameTime;
  const startGt = lastImproveGt;
  const startPos = await carState(page);
  let segStart = { x: startPos.x, z: startPos.z };
  const path = [];
  const LOOKAHEAD = 4;
  for (;;) {
    const s = await carState(page);
    path.push([+s.x.toFixed(1), +s.z.toFixed(1)]);
    if (leg >= legs.length) {
      await setKeys(page, new Set());
      return { ok: true, path, gt: s.gameTime - startGt };
    }
    const t = legs[leg];
    const d = dist2(s.x, s.z, t.x, t.z);
    if (d < (t.r || 6)) {
      segStart = { x: t.x, z: t.z };
      leg += 1;
      bestD = Infinity;
      continue;
    }
    if (d < bestD - 0.5) { bestD = d; lastImproveGt = s.gameTime; }
    if (s.nearestTraffic < 12) lastImproveGt = s.gameTime; // macet, bukan nyangkut
    if (s.gameTime - lastImproveGt > 10) {
      await setKeys(page, new Set());
      return { ok: false, reason: `nyangkut di leg ${leg} → (${t.x},${t.z}); pos (${s.x.toFixed(1)},${s.z.toFixed(1)})`, path, gt: s.gameTime - startGt };
    }
    if (s.gameTime - startGt > 150) {
      await setKeys(page, new Set());
      return { ok: false, reason: `timeout di leg ${leg} → (${t.x},${t.z})`, path, gt: s.gameTime - startGt };
    }
    // Titik bidik: proyeksi mobil ke segmen + lookahead 4 m ke depan.
    const dx = t.x - segStart.x;
    const dz = t.z - segStart.z;
    const segLen = Math.hypot(dx, dz) || 1;
    const ux = dx / segLen;
    const uz = dz / segLen;
    let rel = (s.x - segStart.x) * ux + (s.z - segStart.z) * uz;
    rel = Math.max(0, Math.min(segLen, rel));
    const cx = segStart.x + ux * rel;
    const cz = segStart.z + uz * rel;
    const lat = dist2(s.x, s.z, cx, cz);
    let aimX;
    let aimZ;
    if (lat > 8) {
      aimX = t.x;
      aimZ = t.z;
    } else {
      const adv = Math.min(rel + LOOKAHEAD, segLen);
      aimX = segStart.x + ux * adv;
      aimZ = segStart.z + uz * adv;
    }
    const desired = Math.atan2(aimX - s.x, aimZ - s.z);
    const err = wrapPi(desired - s.heading);
    const keys = new Set();
    const target = t.speed ?? 10;
    if (s.speed < target - 0.5) keys.add('KeyW');
    else if (s.speed > target + 3) keys.add('KeyS'); // rem
    if (err > 0.06) keys.add('KeyA');
    else if (err < -0.06) keys.add('KeyD');
    await setKeys(page, keys);
    await sleep(60);
  }
}

// ---- Pejalan kaki: jalan mengikuti waypoint lewat orbit kamera.
// W selalu maju searah kamera; yaw kamera dihitung ulang tiap poll.
async function walkRoute(page, legs) {
  let leg = 0;
  let bestD = Infinity;
  let lastImproveGt = (await carState(page)).gameTime;
  const startGt = lastImproveGt;
  const path = [];
  for (;;) {
    const s = await carState(page);
    path.push([+s.x.toFixed(1), +s.z.toFixed(1)]);
    if (leg >= legs.length) {
      await setKeys(page, new Set());
      return { ok: true, path, gt: s.gameTime - startGt };
    }
    const t = legs[leg];
    const d = dist2(s.x, s.z, t.x, t.z);
    if (d < (t.r || 1.5)) { leg += 1; bestD = Infinity; continue; }
    if (d < bestD - 0.3) { bestD = d; lastImproveGt = s.gameTime; }
    if (s.gameTime - lastImproveGt > 5) {
      await setKeys(page, new Set());
      return { ok: false, reason: `pejalan kaki macet di leg ${leg} → (${t.x},${t.z}); pos (${s.x.toFixed(1)},${s.z.toFixed(1)})`, path, gt: s.gameTime - startGt };
    }
    if (s.gameTime - startGt > 60) {
      await setKeys(page, new Set());
      return { ok: false, reason: `timeout jalan kaki di leg ${leg}`, path, gt: s.gameTime - startGt };
    }
    const yaw = Math.atan2(t.x - s.x, t.z - s.z);
    await page.evaluate((y) => window.NEON_VICE.debug.setCameraOrbit(y), yaw);
    await setKeys(page, new Set(['KeyW']));
    await sleep(100);
  }
}

// ---- Setup mobil: teleport (ikut mobil bila mengemudi) + atur heading. ----
async function setupCar(page, x, z, heading) {
  await page.evaluate(([x, z, heading]) => {
    const V = window.NEON_VICE;
    V.debug.teleport(x, z);
    const h = V.hero();
    const car = V.game.vehicles.list.find(
      (v) => !v.traffic && !v.parked && Math.hypot(v.mesh.position.x - h.x, v.mesh.position.z - h.z) < 3,
    );
    if (!car) throw new Error('setupCar: mobil yang dikemudikan tidak ditemukan');
    car.heading = heading;
    car.mesh.rotation.y = heading;
    car.speed = 0;
    V.game.player.heading = heading;
  }, [x, z, heading]);
  await sleep(300);
}

// ---- Masuk mobil parkir terdekat dari spawn (sedan/coupe). ----
async function enterCar(page) {
  const spot = await page.evaluate(() => {
    const V = window.NEON_VICE;
    const cars = V.game.vehicles.list
      .filter((v) => v.parked && !v.traffic && (v.kind === 'sedan' || v.kind === 'coupe'))
      .sort((a, b) => Math.hypot(a.mesh.position.x, a.mesh.position.z) - Math.hypot(b.mesh.position.x, b.mesh.position.z));
    const c = cars[0];
    V.debug.teleport(c.mesh.position.x, c.mesh.position.z);
    return { x: +c.mesh.position.x.toFixed(1), z: +c.mesh.position.z.toFixed(1), kind: c.kind };
  });
  await sleep(400);
  await page.keyboard.press('KeyE');
  await sleep(600);
  const s = await carState(page);
  if (!s.driving) throw new Error(`gagal masuk mobil di (${spot.x},${spot.z})`);
  await page.evaluate(() => {
    window.NEON_VICE.debug.setWanted(0);
    window.NEON_VICE.debug.clearPolice();
  });
  return spot;
}

// ---- Posisi beacon (mesh silinder pink) langsung dari scene. ----
async function beaconPos(page) {
  return page.evaluate(() => {
    let found = null;
    window.NEON_VICE_WORLD.scene.traverse((o) => {
      if (found) return;
      const g = o && o.geometry;
      if (o && o.isMesh && g && g.type === 'CylinderGeometry' && g.parameters
        && g.parameters.radiusTop === 1.2 && g.parameters.height === 30
        && o.material && o.material.color && o.material.color.getHex() === 0xf472b6) found = o;
    });
    return found
      ? { x: +found.position.x.toFixed(2), z: +found.position.z.toFixed(2), visible: found.visible }
      : null;
  });
}

// ---- Satu kali escape: 1 bintang, tunggu lewat jendela respawn 10 dtk,
// bersihkan polisi, lalu tunggu wanted bersih (maks 30 dtk game-time). ----
async function escapeOnce(page) {
  return page.evaluate(async () => {
    const V = window.NEON_VICE;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    V.debug.setWanted(1);
    const t0 = V.stats().gameTime;
    while (V.stats().gameTime - t0 < 11) await sleep(200);
    V.debug.clearPolice();
    const t1 = V.stats().gameTime;
    while (V.stats().wanted > 0 && V.stats().gameTime - t1 < 30) await sleep(200);
    await sleep(400);
    const hm = document.getElementById('hudMsg');
    return { wanted: V.stats().wanted, hudMsg: hm ? hm.textContent : null };
  });
}

async function trafficSnapshot(page) {
  return page.evaluate(() => {
    const V = window.NEON_VICE;
    const cars = V.game.vehicles.list.filter((v) => v.traffic);
    return {
      gameTime: V.stats().gameTime,
      count: cars.length,
      total: V.game.vehicles.list.length,
      cars: cars.map((v, i) => ({ i, x: +v.mesh.position.x.toFixed(2), z: +v.mesh.position.z.toFixed(2) })),
    };
  });
}

let fatal = null;
let browser = null;
let page = null;
try {
  await ensureServer();
  browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  const consoleErrors = [];
  const pageErrors = [];
  const externalReqs = [];
  page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    try {
      if (new URL(u).origin !== new URL(BASE).origin) externalReqs.push(u);
    } catch { externalReqs.push(u); }
  });

  await page.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 60000 });

  // ================= (0) Clearance statis belok kiri lebar =================
  const st = await page.evaluate(() => {
    const W = window.NEON_VICE_WORLD;
    const cl = W.wideLeftClearance || [];
    const c300 = cl.find((c) => c.fx === 300) || {};
    const c60 = cl.find((c) => c.fx === 60) || {};
    const gardenC = (W.flyoverGardens || []).find((g) => g.x0 === 258) || null;
    // Diagonal (270,0)→(295.5,-30) harus bebas untuk mobil r=1,0 (sampel 0,5 m).
    let blocked = 0;
    let samples = 0;
    const ax = 270; const az = 0; const bx = 295.5; const bz = -30;
    const len = Math.hypot(bx - ax, bz - az);
    for (let d = 0; d <= len; d += 0.5) {
      samples += 1;
      const x = ax + ((bx - ax) * d) / len;
      const z = az + ((bz - az) * d) / len;
      if (W.collides(x, z, 1.0)) blocked += 1;
    }
    return { c300: c300.clearanceM ?? null, c60: c60.clearanceM ?? null, gardenC, blocked, samples };
  });
  check('0a clearance belok kiri lebar fx=300 ≥ 3,5 m', typeof st.c300 === 'number' && st.c300 >= 3.5,
    `API wideLeftClearance: ${st.c300} m (fx=60: ${st.c60})`);
  check('0b taman C geser 12 m ke barat (x 258–276, gapC 267, z −30..−12)',
    !!st.gardenC && st.gardenC.x0 === 258 && st.gardenC.x1 === 276 && st.gardenC.gapC === 267
    && st.gardenC.z0 === -30 && st.gardenC.z1 === -12,
    st.gardenC ? `x ${st.gardenC.x0}–${st.gardenC.x1}, gapC ${st.gardenC.gapC}, z ${st.gardenC.z0}..${st.gardenC.z1}` : 'taman C tidak ditemukan');
  check('0c diagonal (270,0)→(295,5,−30) bebas untuk mobil r=1,0', st.blocked === 0,
    `${st.blocked}/${st.samples} sampel bertabrakan`);

  await page.evaluate(() => {
    window.NEON_VICE.debug.setStepBudget(30);
    window.NEON_VICE.debug.startGame(false);
  });
  await sleep(1200);
  const traffic0 = await trafficSnapshot(page);

  // ================= (1) Beacon kembali ke M1 setelah side job =================
  const b = await page.evaluate(async () => {
    const V = window.NEON_VICE;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const findBeacon = () => {
      let found = null;
      window.NEON_VICE_WORLD.scene.traverse((o) => {
        if (found) return;
        const g = o && o.geometry;
        if (o && o.isMesh && g && g.type === 'CylinderGeometry' && g.parameters
          && g.parameters.radiusTop === 1.2 && g.parameters.height === 30
          && o.material && o.material.color && o.material.color.getHex() === 0xf472b6) found = o;
      });
      return found ? { x: +found.position.x.toFixed(2), z: +found.position.z.toFixed(2), visible: found.visible } : null;
    };
    V.debug.startMission(1);
    await sleep(500);
    const t1 = V.game.missions.stageTarget();
    const b1 = findBeacon();
    const sj = V.debug.startSideJob('package');
    await sleep(300);
    const b2 = findBeacon();
    const to = sj && sj.to;
    V.debug.teleport(to.x, to.z);
    let done = false;
    for (let i = 0; i < 50 && !done; i += 1) {
      await sleep(100);
      done = V.game.missions.sideJob === null;
    }
    return { t1, b1, to, b2, done, t2: V.game.missions.stageTarget(), b3: findBeacon() };
  });
  check('1a beacon di target M1 (152.296,120) saat misi aktif',
    b.t1 && Math.abs(b.t1.x - 152.296) < 0.5 && Math.abs(b.t1.z - 120) < 0.5
    && b.b1 && Math.abs(b.b1.x - 152.296) < 1 && Math.abs(b.b1.z - 120) < 1 && b.b1.visible,
    `stageTarget (${b.t1.x.toFixed(2)},${b.t1.z.toFixed(2)}), beacon ${JSON.stringify(b.b1)}`);
  check('1b beacon pindah ke drop package (100,360) saat side job jalan',
    b.to && Math.abs(b.to.x - 100) < 1 && Math.abs(b.to.z - 360) < 1
    && b.b2 && dist2(b.b2.x, b.b2.z, b.to.x, b.to.z) < 1 && b.b2.visible,
    `drop (${b.to.x},${b.to.z}), beacon ${JSON.stringify(b.b2)}`);
  check('1c beacon kembali ke target M1 setelah package selesai',
    b.done && b.t2 && Math.abs(b.t2.x - 152.296) < 0.5 && Math.abs(b.t2.z - 120) < 0.5
    && b.b3 && Math.abs(b.b3.x - 152.296) < 1 && Math.abs(b.b3.z - 120) < 1 && b.b3.visible,
    `sideJob selesai: ${b.done}, beacon ${JSON.stringify(b.b3)}`);

  // ================= (3) Toast escape EN + ID =================
  await page.evaluate(() => {
    window.NEON_VICE.game.ui.setLang('en');
    window.NEON_VICE.debug.teleport(-400, -330);
  });
  await sleep(300);
  const escEn = await escapeOnce(page);
  check('3a toast escape EN: #hudMsg = "You escaped!"', escEn.wanted === 0 && escEn.hudMsg === 'You escaped!',
    `wanted=${escEn.wanted}, hudMsg=${JSON.stringify(escEn.hudMsg)}`);
  await page.evaluate(() => {
    window.NEON_VICE.game.ui.setLang('id');
    window.NEON_VICE.debug.teleport(-400, -330);
  });
  await sleep(300);
  const escId = await escapeOnce(page);
  check('3b toast escape ID: #hudMsg = "Berhasil kabur!"', escId.wanted === 0 && escId.hudMsg === 'Berhasil kabur!',
    `wanted=${escId.wanted}, hudMsg=${JSON.stringify(escId.hudMsg)}`);

  // ================= (4a) Pejalan kaki masuk taman B =================
  // Celah selatan taman B (gapC 78, lebar 4,4 m) punya bollard 0,6 m DI
  // TENGAH — jalan lurus ke (78,78) menabrak bollard. Lewat sub-celah
  // timur (78,3–80,2; tengah 79,25), tempat pejalan kaki (r=0,6) lolos.
  await page.evaluate(() => window.NEON_VICE.debug.teleport(66, 84));
  await sleep(300);
  const walk = await walkRoute(page, [{ x: 79.25, z: 84, r: 0.5 }, { x: 79.25, z: 78, r: 2 }]);
  const walkInside = walk.path.some(([x, z]) => x > 72 && x < 84 && z > 72 && z < 83);
  check('4a pejalan kaki masuk taman B lewat koridor selatan + sub-celah timur',
    walk.ok && walkInside,
    walk.ok ? `tiba di dalam taman (${walk.gt.toFixed(1)} dtk game-time)` : walk.reason);

  // ================= Masuk mobil untuk tes mengemudi =================
  const carSpot = await enterCar(page);
  console.log(`INFO  masuk ${carSpot.kind} parkir di (${carSpot.x},${carSpot.z})`);

  // ================= (2) Belok kiri rapat, kedua flyover, pelan + cepat =================
  for (const [fx, speed, label] of [[60, 6, 'pelan'], [60, 16, 'cepat'], [300, 6, 'pelan'], [300, 16, 'cepat']]) {
    await setupCar(page, fx - 70, 0, Math.PI / 2);
    const r = await driveRoute(page, [
      { x: fx - 30, z: 0, r: 6, speed },
      { x: fx - 8, z: 0, r: 5, speed: 6 },
      { x: fx - 4.5, z: -20, r: 6, speed: 6 },
      { x: fx - 4.5, z: -45, r: 6, speed: 10 },
      { x: fx - 4.5, z: -75, r: 8, speed: 10 },
    ]);
    check(`2 belok kiri rapat fx=${fx} (${label}) lolos maju`, r.ok,
      r.ok ? `sampai (${fx - 4.5},−75) dalam ${r.gt.toFixed(1)} dtk game-time` : r.reason);
  }

  // ================= (5) Belok kiri lebar fx=300 (2x) =================
  for (let run = 1; run <= 2; run += 1) {
    await setupCar(page, 240, 0, Math.PI / 2);
    const r = await driveRoute(page, [
      { x: 270, z: 0, r: 6, speed: 8 },
      { x: 295.5, z: -30, r: 6, speed: 8 },
      { x: 295.5, z: -60, r: 8, speed: 10 },
    ]);
    const nearPoint = r.path.some(([x, z]) => dist2(x, z, 291, -24.4) <= 6);
    const end = r.path.length ? r.path[r.path.length - 1] : [NaN, NaN];
    check(`5 belok kiri lebar fx=300 #${run} (lewat ~(291,−24.4))`, r.ok && nearPoint,
      r.ok ? `ujung (${end[0]},${end[1]}), lewat titik acuan: ${nearPoint}` : r.reason);
  }

  // ================= (6) Belok kanan kedua flyover =================
  for (const fx of [60, 300]) {
    await setupCar(page, fx - 70, 0, Math.PI / 2);
    const r = await driveRoute(page, [
      { x: fx - 30, z: 0, r: 6, speed: 8 },
      { x: fx + 8, z: 0, r: 5, speed: 6 },
      { x: fx + 4.5, z: 25, r: 6, speed: 8 },
      { x: fx + 4.5, z: 55, r: 8, speed: 10 },
    ]);
    check(`6 belok kanan fx=${fx} lolos maju`, r.ok,
      r.ok ? `sampai (${fx + 4.5},55) dalam ${r.gt.toFixed(1)} dtk game-time` : r.reason);
  }

  // ================= (4b) Mobil terhalang pagar selatan taman B =================
  await setupCar(page, 66, 84, Math.PI / 2);
  let maxX = -Infinity;
  let insideGarden = false;
  const holdStart = (await carState(page)).gameTime;
  let s;
  for (;;) { // tahan gas ~7 dtk game-time ke arah timur (ke pagar taman B)
    s = await carState(page);
    maxX = Math.max(maxX, s.x);
    if (s.x > 72 && s.z > 72 && s.z < 83.6) insideGarden = true;
    if (s.gameTime - holdStart > 7) break;
    await setKeys(page, new Set(['KeyW']));
    await sleep(90);
  }
  await setKeys(page, new Set());
  const blockedX = s.x;
  const revStart = (await carState(page)).gameTime;
  const revX0 = (await carState(page)).x;
  let revX1 = revX0;
  for (;;) { // mundur ~4 dtk game-time, harus bebas ke barat
    s = await carState(page);
    revX1 = s.x;
    if (s.gameTime - revStart > 4) break;
    await setKeys(page, new Set(['KeyS']));
    await sleep(90);
  }
  await setKeys(page, new Set());
  check('4b mobil terhalang pagar selatan taman B + bisa mundur bebas',
    maxX < 72 && !insideGarden && (revX0 - revX1) >= 4,
    `maxX=${maxX.toFixed(1)} (batas 72), x saat tertahan=${blockedX.toFixed(1)}, mundur ${(revX0 - revX1).toFixed(1)} m`);

  // ================= (7) Traffic 28 mobil, 0 nyangkut =================
  let traffic1 = await trafficSnapshot(page);
  while (traffic1.gameTime - traffic0.gameTime < 30) { // pastikan jendela ≥ 30 dtk game-time
    await sleep(1000);
    traffic1 = await trafficSnapshot(page);
  }
  const stuck = traffic1.cars.filter((c) => {
    const a = traffic0.cars[c.i];
    return a && dist2(c.x, c.z, a.x, a.z) < 1.0;
  });
  check('7a traffic 28 mobil', traffic0.count === 28 && traffic1.count === 28,
    `t0=${traffic0.count} (total kendaraan ${traffic0.total}), t1=${traffic1.count} (total ${traffic1.total})`);
  check('7b 0 mobil traffic nyangkut selama 30 dtk game-time', stuck.length === 0,
    stuck.length === 0
      ? `jendela ${(traffic1.gameTime - traffic0.gameTime).toFixed(1)} dtk game-time`
      : `nyangkut: ${stuck.map((c) => `#${c.i} (${c.x},${c.z})`).join(', ')}`);

  // ================= (8) 0 error + 0 request eksternal =================
  check('8a 0 console/page error selama seluruh run', consoleErrors.length === 0 && pageErrors.length === 0,
    consoleErrors.length || pageErrors.length
      ? [...consoleErrors.slice(0, 3), ...pageErrors.slice(0, 3)].join(' | ')
      : 'bersih');
  check('8b 0 request eksternal selama seluruh run', externalReqs.length === 0,
    externalReqs.length ? externalReqs.slice(0, 3).join(', ') : 'semua request lokal');

  const ratio = await page.evaluate(() => window.NEON_VICE.stats().ratio);
  console.log(`INFO  rasio game-time/real-time: ${Number(ratio).toFixed(2)}`);
} catch (err) {
  fatal = err;
  console.error('FATAL:', err && err.stack ? err.stack : err);
} finally {
  if (page) { try { await setKeys(page, new Set()); } catch { /* abaikan */ } }
  if (browser) await browser.close().catch(() => {});
  if (serverProc) serverProc.kill();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\nRINGKASAN: ${passed}/${results.length} check lolos${fatal ? ` (FATAL: ${fatal.message})` : ''}`);
process.exit(fatal || passed !== results.length ? 1 : 0);
