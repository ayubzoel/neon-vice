// Neon Vice — v5 item 4: police chase + shoot while the player DRIVES.
// Usage: node tests/v5-police-driving.js
// Repro + verification: enter a car, drive a city loop on the arterial
// streets (x=60 / x=300 / z=±120 — the proven v4-final pattern: setCar
// onto a road, W + corner steering, speed capped at 12 m/s), setWanted(3),
// then sample every 5 s of GAME time for 30 s: per-car distances, foot
// distances, HP. PASS criteria (task): within 15 s of game time after
// wanted 3 while driving, >= 2 police cars within 25 m and closing /
// holding; within 30 s at least 1 visible shot (HP drop).
// 0 console errors, 0 external requests.
const { chromium } = require('/home/hatch/workspace/custom-skills/playwright_skill/node_modules/playwright-core/index.mjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const PORT = 8123;
const URL = `http://localhost:${PORT}/`;
const OUT = '/tmp/neon-vice-v5/item4';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function log(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function waitForServer(port, timeoutMs = 15000) {
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

// Arterial street loop, clockwise: x=60 NS, z=120 EW, x=300 NS, z=-120 EW.
const LOOP = [
  { x: 60, z: 120 }, { x: 300, z: 120 }, { x: 300, z: -120 }, { x: 60, z: -120 },
];
const DRIVE_CAP = 12; // m/s — city driving, corners at v4-proven speed

async function main() {
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: __dirname + '/..', stdio: 'ignore' });
  const samples = [];
  try {
    await waitForServer(PORT);
    const browser = await chromium.launch({
      executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
      args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
    });
    const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
    const page = await ctx.newPage();
    const errors = [];
    const requests = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
    page.on('request', (r) => { if (!r.url().startsWith(URL)) requests.push(r.url()); });
    await page.goto(URL, { waitUntil: 'load', timeout: 15000 });
    await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
    try { await page.click('#btnNew', { timeout: 10000 }); } catch { await page.evaluate(() => document.querySelector('#btnNew').click()); }
    await sleep(500);
    await page.evaluate(() => window.NEON_VICE.debug.setStepBudget(24));

    const stats = () => page.evaluate(() => window.NEON_VICE.stats());
    const policeInfo = () => page.evaluate(() => window.NEON_VICE.debug.police());
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
    const carDists = () => page.evaluate(() => {
      const g = window.NEON_VICE.game;
      const px = g.player.group.position.x;
      const pz = g.player.group.position.z;
      const cars = g.combat.policeCars.filter((c) => !c.dead)
        .map((c) => +Math.hypot(c.mesh.position.x - px, c.mesh.position.z - pz).toFixed(1));
      const foot = g.combat.police.filter((p) => !p.dead && !p.mission)
        .map((p) => +Math.hypot(p.mesh.position.x - px, p.mesh.position.z - pz).toFixed(1));
      return { cars: cars.sort((a, b) => a - b), foot: foot.sort((a, b) => a - b) };
    });
    const capSpeed = () => page.evaluate((cc) => {
      const g = window.NEON_VICE.game;
      const p = g.player.group.position;
      let best = null; let bestD = Infinity;
      for (const v of g.vehicles.list) {
        const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
        if (d < bestD) { bestD = d; best = v; }
      }
      if (best && best.speed > cc) best.speed = cc;
    }, DRIVE_CAP);

    // ---- Enter the nearest parked car (v4 pattern) and put it on the
    // x=60 road heading north, speed 0.
    const car = await page.evaluate(() => {
      const g = window.NEON_VICE.game;
      const p = g.player.group.position;
      let best = null; let bestD = Infinity;
      for (const v of g.vehicles.list) {
        if (!v.parked || v.kind === 'boat') continue;
        const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
        if (d < bestD) { bestD = d; best = v; }
      }
      return best ? [best.mesh.position.x, best.mesh.position.z] : null;
    });
    await page.evaluate(([x, z]) => window.NEON_VICE.debug.teleport(x + 3, z), car);
    await sleep(400);
    let entered = false;
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press('KeyE');
      await sleep(600);
      if ((await stats()).driving) { entered = true; break; }
    }
    log('player enters a car', entered, '');
    if (!entered) throw new Error('could not enter a car');
    await page.evaluate(() => window.NEON_VICE.debug.teleport(60, -90));
    await page.evaluate(() => {
      const g = window.NEON_VICE.game;
      const p = g.player.group.position;
      let best = null; let bestD = Infinity;
      for (const v of g.vehicles.list) {
        const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
        if (d < bestD) { bestD = d; best = v; }
      }
      if (best) { best.heading = 0; best.mesh.rotation.y = 0; best.speed = 0; }
    });
    await sleep(300);
    const startCar = await carPos();
    log('car placed on x=60 road heading north', Math.abs(startCar.x - 60) < 3 && Math.abs(startCar.heading) < 0.1,
      `(${startCar.x.toFixed(0)},${startCar.z.toFixed(0)}) h=${startCar.heading.toFixed(2)} ${startCar.kind}`);

    // ---- Drive the loop: W held; steer toward the next waypoint (v4
    // corner method: hold the turn key while heading error > 0.5 rad,
    // release inside it); cap speed. Runs as the sampling loop below.
    await page.keyboard.down('KeyW');
    let wpIdx = 0;
    let steerKey = null;
    const driveTick = async () => {
      const c = await carPos();
      if (!c) return;
      const wp = LOOP[wpIdx];
      if (Math.hypot(wp.x - c.x, wp.z - c.z) < 12) { wpIdx = (wpIdx + 1) % LOOP.length; return; }
      const want = Math.atan2(wp.x - c.x, wp.z - c.z);
      let diff = want - c.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const hw = ((c.heading % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
      const wantHw = ((want % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
      const err = Math.abs(((wantHw - hw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      const key = err > 0.5 ? (diff > 0 ? 'KeyA' : 'KeyD') : null;
      if (key !== steerKey) {
        if (steerKey) await page.keyboard.up(steerKey);
        if (key) await page.keyboard.down(key);
        steerKey = key;
      }
      await capSpeed();
    };

    // Warm up: drive ~5 s of game time so the car is moving.
    const tStart = (await stats()).gameTime;
    while ((await stats()).gameTime - tStart < 5) { await driveTick(); await sleep(250); }
    let s = await stats();
    const warmCar = await carPos();
    log('car moving before wanted', s.speed > 5, `speed=${s.speed} m/s at (${warmCar.x.toFixed(0)},${warmCar.z.toFixed(0)})`);

    // ---- Wanted 3 while driving; sample every 5 s of game time, 30 s.
    await page.evaluate(() => { window.NEON_VICE.debug.setHp(100); window.NEON_VICE.debug.setWanted(3); });
    const t0 = (await stats()).gameTime;
    let lastSample = -5;
    let shotsSeen = false;
    let hpMin = 100;
    let hpEnd = 100;
    const tWall0 = Date.now();
    while ((await stats()).gameTime - t0 < 30 && Date.now() - tWall0 < 300000) {
      const gt = (await stats()).gameTime - t0;
      if (gt - lastSample >= 5) {
        lastSample = Math.floor(gt / 5) * 5;
        const info = await policeInfo();
        const d = await carDists();
        const st = await stats();
        hpMin = Math.min(hpMin, st.hp);
        hpEnd = st.hp;
        if (st.hp < 100) shotsSeen = true;
        if (st.hp < 40) await page.evaluate(() => window.NEON_VICE.debug.setHp(100));
        const row = {
          t: +gt.toFixed(1), wanted: st.wanted, driving: st.driving,
          speed: +st.speed.toFixed(1), hp: st.hp, foot: info.foot, cars: info.cars,
          carDists: d.cars, footDists: d.foot,
        };
        samples.push(row);
        console.log(`t=${row.t}s wanted=${row.wanted} speed=${row.speed} hp=${row.hp} ` +
          `cars=${row.cars} [${row.carDists.join(',')}] foot=${row.foot} [${row.footDists.join(',')}]`);
      }
      await driveTick();
      await sleep(250);
    }
    await page.keyboard.up('KeyW');
    if (steerKey) await page.keyboard.up(steerKey);

    // ---- Criteria ----
    const early = samples.filter((r) => r.t >= 10 && r.t <= 15);
    const closeAt15 = Math.max(0, ...early.map((r) => r.carDists.filter((x) => x <= 25).length));
    log('>= 2 police cars within 25 m by 15 s while driving', closeAt15 >= 2,
      `cars within 25 m at 10-15 s: ${closeAt15}`);
    const s5 = samples.find((r) => r.t >= 5);
    const s15 = samples.find((r) => r.t >= 15);
    let closing = false;
    if (s5 && s15 && s5.carDists.length && s15.carDists.length) {
      closing = Math.min(...s15.carDists) <= Math.min(...s5.carDists) + 2 ||
        Math.min(...s15.carDists) <= 25;
    }
    log('police cars close / hold distance (chasing)', closing,
      s5 && s15 ? `nearest car ${Math.min(...s5.carDists)}m @5s -> ${Math.min(...s15.carDists)}m @15s` : 'no samples');
    log('police shoot while player drives (HP drops)', shotsSeen,
      `hp 100 -> min ${hpMin} -> end ${hpEnd}`);
    log('0 console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    log('0 external requests', requests.length === 0, requests.slice(0, 3).join(' | '));

    await page.screenshot({ path: `${OUT}/v5-police-driving.jpg`, type: 'jpeg', quality: 70 }).catch(() => {});
    await browser.close();
  } finally {
    server.kill();
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/samples.json`, JSON.stringify(samples, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
