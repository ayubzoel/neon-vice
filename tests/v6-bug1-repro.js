// Neon Vice — v6 BUG 1 repro v2: ukur dalam GAME-TIME (emulator SwiftShader
// jalan ~0.15-0.25x real time; ukur jarak/kecepatan per detik game-time).
// Keyboard S dari diam + dari maju; REM touch (390x844); mobil + motor;
// + cek bug lama: mobil diam + belok ditahan = tidak berputar.
// Usage: node tests/v6-bug1-repro.js — writes /tmp/neon-vice-v6/bug1-repro/results.json
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const PORT = 8127;
const URL = `http://localhost:${PORT}/?autostart=new`;
const OUT = '/home/hatch/workspace/makefun/neon-vice-entry/tests/evidence-v6/bug1-repro';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
function waitForServer(port, timeoutMs = 20000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { res.resume(); resolve(true); });
      req.on('error', () => {
        if (Date.now() - t0 > timeoutMs) reject(new Error('server did not start'));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}
const fmt = (c) => (c ? `(${c.x.toFixed(1)},${c.y.toFixed(1)},${c.z.toFixed(1)}) h=${c.heading.toFixed(2)} v=${c.speed.toFixed(1)}` : '?');

async function main() {
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: process.cwd(), stdio: 'pipe' });
  try {
    await waitForServer(PORT);
    const { chromium } = await import('/home/hatch/workspace/custom-skills/playwright_skill/node_modules/playwright-core/index.mjs');
    const browser = await chromium.launch({
      executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
      args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
    });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 30000 });
    await page.evaluate(() => window.NEON_VICE.debug.setStepBudget(24));
    await sleep(3000);
    const stats = () => page.evaluate(() => window.NEON_VICE.stats());
    const carPos = () => page.evaluate(() => {
      const g = window.NEON_VICE.game;
      const p = g.player.group.position;
      let best = null; let bestD = Infinity;
      for (const v of g.vehicles.list) {
        const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
        if (d < bestD) { bestD = d; best = v; }
      }
      return best ? { x: best.mesh.position.x, y: best.mesh.position.y, z: best.mesh.position.z, heading: best.heading, speed: best.speed, kind: best.kind } : null;
    });
    const gameTime = async () => (await stats()).gameTime;
    async function enterVehicleAt(x, z) {
      await page.evaluate(([xx, zz]) => window.NEON_VICE.debug.teleport(xx, zz), [x, z]);
      await sleep(400);
      for (let i = 0; i < 3; i += 1) {
        await page.keyboard.press('KeyE');
        await sleep(600);
        if ((await stats()).driving) return true;
      }
      return false;
    }
    // Hold a key until `gameSec` seconds of GAME time pass. Returns samples.
    async function holdKeyGame(key, gameSec) {
      const before = await carPos();
      const t0g = await gameTime();
      await page.keyboard.down(key);
      const samples = [];
      const wall0 = Date.now();
      while (true) {
        await sleep(400);
        const c = await carPos();
        const g = await gameTime();
        samples.push({ gt: +(g - t0g).toFixed(2), speed: c ? +c.speed.toFixed(2) : null, x: c ? +c.x.toFixed(1) : null, z: c ? +c.z.toFixed(1) : null });
        if (g - t0g >= gameSec || Date.now() - wall0 > 120000) break;
      }
      await page.keyboard.up(key);
      const after = await carPos();
      const g1 = await gameTime();
      return { before, after, samples, gameElapsed: +(g1 - t0g).toFixed(2), wallMs: Date.now() - wall0 };
    }
    const alongHeading = (a, b) => {
      const dx = b.x - a.x; const dz = b.z - a.z;
      return dx * Math.sin(a.heading) + dz * Math.cos(a.heading);
    };

    // Rasio game-time (info).
    const gA = await gameTime(); await sleep(5000); const gB = await gameTime();
    console.log(`INFO game-time ratio ~${((gB - gA) / 5).toFixed(2)}x real time`);

    // --- 1. Mobil sedan: S dari diam, 4 detik game-time ---
    let ok = await enterVehicleAt(15, 8);
    check('masuk mobil sedan plaza', ok, '');
    let r = await holdKeyGame('KeyS', 4);
    const d1 = alongHeading(r.before, r.after);
    // Kecepatan minimum selama penahanan (bukan akhir): mobil bisa
    // menabrak bangunan di ujung lintasan dan memantul ke +.
    const minS1 = Math.min(...r.samples.map((s) => (s.speed === null ? 0 : s.speed)));
    check('BUG1 mobil: S dari diam 4 dtk game-time -> mundur',
      minS1 < -5 && d1 < -10,
      `before=${fmt(r.before)} after=${fmt(r.after)} jarak=${d1.toFixed(1)} m (game ${r.gameElapsed}s / wall ${(r.wallMs / 1000).toFixed(0)}s) minSpeed=${minS1} samples=${JSON.stringify(r.samples.map((s) => s.speed))}`);

    // --- 2. Mobil: W maju 3 dtk game, lalu S 4 dtk game (rem lalu mundur) ---
    // Metrik: kecepatan akhir < -5 DAN jarak mundur dihitung SEJAK mobil
    // berhenti (titik balik), bukan dari posisi awal — pengereman dari
    // 30 m/s menempuh jarak maju yang besar sebelum mobil berbalik.
    const fwd = await holdKeyGame('KeyW', 3);
    const fwdSpeed = fwd.after ? fwd.after.speed : 0;
    r = await holdKeyGame('KeyS', 4);
    const crossIdx = r.samples.findIndex((s) => s.speed !== null && s.speed <= 0);
    const crossPos = crossIdx >= 0 ? r.samples[crossIdx] : r.before;
    const d2 = alongHeading({ x: crossPos.x, z: crossPos.z, heading: r.before.heading }, r.after);
    check('BUG1 mobil: S dari maju -> rem lalu mundur',
      r.after && r.after.speed < -5 && d2 < -10,
      `maju=${fwdSpeed.toFixed(1)} titikBerhenti=(${crossPos.x},${crossPos.z}) after=${fmt(r.after)} jarakMundurSejakBerhenti=${d2.toFixed(1)} m`);

    // --- 3. Mobil: W maju normal ---
    r = await holdKeyGame('KeyW', 3);
    check('mobil: W maju normal (speed > 15 setelah 3 dtk game)',
      r.after && r.after.speed > 15,
      `after=${fmt(r.after)} samples=${JSON.stringify(r.samples.map((s) => s.speed))}`);

    // --- 4. Bug lama: mobil DIAM + tahan A (belok) 2 dtk game -> heading tetap ---
    await page.evaluate(() => {
      const g = window.NEON_VICE.game;
      const p = g.player.group.position;
      let best = null; let bestD = Infinity;
      for (const v of g.vehicles.list) {
        const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
        if (d < bestD) { bestD = d; best = v; }
      }
      if (best) best.speed = 0;
    });
    await sleep(300);
    const h0 = (await carPos()).heading;
    const st = await holdKeyGame('KeyA', 2);
    const h1 = (await carPos()).heading;
    const dh = Math.abs(((h1 - h0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    check('BUG LAMA: mobil diam + tahan belok -> TIDAK berputar di tempat',
      dh < 0.05,
      `heading ${h0.toFixed(3)} -> ${h1.toFixed(3)} (d=${dh.toFixed(3)} rad) speed akhir=${st.after.speed.toFixed(2)}`);

    // --- 5. Motor: S dari diam 4 dtk game ---
    // Pindah dulu ke jalan z=0 yang lurus menghadap timur (-100, 0):
    // mundur ke barat sepanjang jalan, tanpa bangunan di jalurnya.
    await page.evaluate(() => window.NEON_VICE.debug.exitVehicle());
    await sleep(500);
    ok = await enterVehicleAt(9, -12);
    check('masuk motor', ok, '');
    const bike = await carPos();
    check('kendaraan yang dimasuki adalah motor', bike && bike.kind === 'bike', `kind=${bike && bike.kind}`);
    await page.evaluate(() => {
      const g = window.NEON_VICE.game;
      const p = g.player.group.position;
      let best = null; let bestD = Infinity;
      for (const v of g.vehicles.list) {
        const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
        if (d < bestD) { bestD = d; best = v; }
      }
      if (best) {
        best.mesh.position.set(-100, 0, 0);
        best.heading = Math.PI / 2; best.mesh.rotation.y = Math.PI / 2; best.speed = 0;
        g.player.group.position.set(-100, 0, 0);
      }
    });
    await sleep(500);
    r = await holdKeyGame('KeyS', 4);
    const d3 = alongHeading(r.before, r.after);
    const minS3 = Math.min(...r.samples.map((s) => (s.speed === null ? 0 : s.speed)));
    check('BUG1 motor: S dari diam 4 dtk game-time -> mundur',
      minS3 < -5 && d3 < -10,
      `before=${fmt(r.before)} after=${fmt(r.after)} jarak=${d3.toFixed(1)} m minSpeed=${minS3} samples=${JSON.stringify(r.samples.map((s) => s.speed))}`);

    // --- 6. Touch REM (390x844) ---
    await page.close(); // bebaskan CPU SwiftShader untuk halaman touch
    const touchCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true, isMobile: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    const tp = await touchCtx.newPage();
    tp.on('pageerror', (e) => errors.push('TOUCH PAGEERROR: ' + e.message));
    tp.on('console', (m) => { if (m.type() === 'error') errors.push('TOUCH: ' + m.text()); });
    await tp.goto(URL, { waitUntil: 'load', timeout: 60000 });
    await tp.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 30000 });
    await tp.evaluate(() => window.NEON_VICE.debug.setStepBudget(24));
    await sleep(3000);
    const tStats = () => tp.evaluate(() => window.NEON_VICE.stats());
    const tCarPos = () => tp.evaluate(() => {
      const g = window.NEON_VICE.game;
      const p = g.player.group.position;
      let best = null; let bestD = Infinity;
      for (const v of g.vehicles.list) {
        const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
        if (d < bestD) { bestD = d; best = v; }
      }
      return best ? { x: best.mesh.position.x, y: best.mesh.position.y, z: best.mesh.position.z, heading: best.heading, speed: best.speed, kind: best.kind } : null;
    });
    const tGameTime = async () => (await tStats()).gameTime;
    await tp.evaluate(() => window.NEON_VICE.debug.teleport(15, 8));
    await sleep(400);
    let enteredTouch = false;
    for (let i = 0; i < 3; i += 1) {
      await tp.evaluate(() => { document.getElementById('btnCar').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
      await sleep(600);
      if ((await tStats()).driving) { enteredTouch = true; break; }
    }
    check('touch: masuk mobil via tombol CAR', enteredTouch, '');
    const remVisible = await tp.evaluate(() => {
      const el = document.getElementById('btnBrake');
      return !!el && getComputedStyle(el).display !== 'none' && document.body.classList.contains('driving');
    });
    const before = await tCarPos();
    const tg0 = await tGameTime();
    await tp.evaluate(() => {
      document.getElementById('btnBrake').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 99, pointerType: 'touch' }));
    });
    const tSamples = [];
    const tw0 = Date.now();
    while (true) {
      await sleep(400);
      const c = await tCarPos();
      const g = await tGameTime();
      tSamples.push({ gt: +(g - tg0).toFixed(2), speed: c ? +c.speed.toFixed(2) : null });
      if (g - tg0 >= 4 || Date.now() - tw0 > 120000) break;
    }
    await tp.evaluate(() => {
      document.getElementById('btnBrake').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 99, pointerType: 'touch' }));
    });
    const after = await tCarPos();
    const d4 = before && after ? alongHeading(before, after) : 0;
    // Metrik: kecepatan mundur MINIMUM selama penahanan + jarak, bukan
    // kecepatan akhir — mobil bisa menabrak bangunan di ujung lintasan
    // 49 m dan memantul ke + (bounce) tepat sebelum jendela berakhir.
    const minSpeed = Math.min(...tSamples.map((s) => (s.speed === null ? 0 : s.speed)));
    check('BUG1 touch: tahan REM dari diam 4 dtk game-time -> mundur',
      minSpeed < -5 && d4 < -10,
      `btnREM visible=${remVisible} before=${fmt(before)} after=${fmt(after)} jarak=${d4.toFixed(1)} m minSpeed=${minSpeed} samples=${JSON.stringify(tSamples.map((s) => s.speed))}`);

    check('0 console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 2));
    const failed = results.filter((x) => !x.ok).length;
    console.log(`\nV6 bug1-repro: ${results.length - failed}/${results.length} passed`);
    await browser.close();
    process.exit(failed ? 1 : 0);
  } finally {
    server.kill();
  }
}
main().catch((e) => { console.error(e); process.exit(2); });
