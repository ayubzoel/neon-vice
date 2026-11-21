// Neon Vice — Builder B v3 police verification (Playwright, SwiftShader).
// Usage: node tests/police-v3.js
// Per star 1..5: force counts (foot/cars) match the Neon Bay-mapped tier,
// police visibly close distance on the player, police shoot and HP drops.
// Then real crimes (firing the pistol; stealing a car), wanted decay while
// hidden, and a save/load smoke check. 0 console errors, 0 external reqs.
const { chromium } = require('/home/hatch/workspace/custom-skills/playwright_skill/node_modules/playwright');
const { spawn } = require('child_process');
const http = require('http');

const PORT = 8914;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TIERS = { 1: { foot: 2, cars: 0 }, 2: { foot: 2, cars: 1 }, 3: { foot: 3, cars: 2 }, 4: { foot: 3, cars: 3 }, 5: { foot: 4, cars: 4 } };
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

async function main() {
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: __dirname + '/..', stdio: 'ignore' });
  try {
    await waitForServer(PORT);
    const browser = await chromium.launch({
      executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
      args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
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
    await page.click('#btnNew');
    await sleep(500);
    await page.evaluate(() => window.NEON_VICE.debug.setStepBudget(24));

    const policeInfo = () => page.evaluate(() => window.NEON_VICE.debug.police());
    const stats = () => page.evaluate(() => window.NEON_VICE.stats());

    const base = await stats();
    log('game loads, 0 stars at start', base.wanted === 0, `wanted=${base.wanted} drawCalls=${base.drawCalls}`);

    // ---- Per-star checks ----
    for (let n = 1; n <= 5; n += 1) {
      await page.evaluate(([w]) => {
        const d = window.NEON_VICE.debug;
        d.setHp(100);
        d.setWanted(w);
      }, [n]);
      await sleep(3000);
      const info0 = await policeInfo();
      const tier = TIERS[n];
      // Foot police spawn at 35 m; cars at 60-80 m on a road. Give cars
      // time to path in; re-read after a few seconds if short.
      let info = info0;
      for (let tries = 0; tries < 4 && (info.foot < tier.foot || info.cars < tier.cars); tries += 1) {
        await sleep(3000);
        info = await policeInfo();
      }
      log(`star ${n}: force = ${tier.foot} foot + ${tier.cars} cars`,
        info.foot === tier.foot && info.cars === tier.cars,
        `foot=${info.foot} cars=${info.cars} nearestFoot=${info.nearestFoot?.toFixed(0)}m nearestCar=${info.nearestCar?.toFixed(0)}m`);
      // Chase: nearest distance must shrink over ~12 s (player stands
      // still) — or already be at hold/shooting range (<=17 m). Heal
      // through the wait: at 4-5 stars standing still is lethal, and a
      // death mid-measurement (wanted reset, respawn) would skew it.
      const d0 = Math.min(info.nearestFoot ?? 999, info.nearestCar ?? 999);
      for (let i = 0; i < 6; i += 1) {
        await sleep(2000);
        await page.evaluate(() => window.NEON_VICE.debug.setHp(100));
      }
      const info1 = await policeInfo();
      const d1 = Math.min(info1.nearestFoot ?? 999, info1.nearestCar ?? 999);
      log(`star ${n}: police close distance`,
        d1 < d0 || d1 <= 17, `nearest ${d0.toFixed(0)}m -> ${d1.toFixed(0)}m`);
      // Shooting: HP must drop (heal to stay alive for the measurement).
      let hpMin = 100;
      let hpDropped = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 45000) {
        const s = await stats();
        hpMin = Math.min(hpMin, s.hp);
        if (s.hp < 100) { hpDropped = true; break; }
        if (s.hp < 40) await page.evaluate(() => window.NEON_VICE.debug.setHp(100));
        await sleep(1000);
      }
      log(`star ${n}: police shoot, HP drops`, hpDropped, `hpMin=${hpMin}`);
      if (n === 5) {
        const s5 = await stats();
        log('star 5: draw calls bounded', s5.drawCalls < base.drawCalls + 40, `drawCalls ${base.drawCalls} -> ${s5.drawCalls}`);
        await page.screenshot({ path: '/tmp/police-v3-5stars.jpg', type: 'jpeg', quality: 70 });
      }
      await page.evaluate(() => { window.NEON_VICE.debug.setWanted(0); window.NEON_VICE.debug.clearPolice(); });
      await sleep(1000);
    }

    // ---- Real crime 1: firing the pistol raises wanted ----
    await page.evaluate(() => {
      const g = window.NEON_VICE.game;
      window.NEON_VICE.debug.setWanted(0);
      window.NEON_VICE.debug.clearPolice();
      if (g.combat.holstered) g.input.press('holster');
    });
    await sleep(300);
    await page.mouse.down();
    await sleep(1500);
    await page.mouse.up();
    const wAfterShot = (await stats()).wanted;
    log('real crime: firing pistol -> wanted >= 1', wAfterShot >= 1, `wanted=${wAfterShot}`);

    // ---- Real crime 2: stealing a car raises wanted ----
    // Deterministic "seen" path: a cop stands 20 m away, so policeNear()
    // is true and the theft is always +1 (the 40% unseen chance is the
    // fallback, not the test).
    await page.evaluate(() => {
      window.NEON_VICE.debug.setWanted(0);
      window.NEON_VICE.debug.clearPolice();
      const g = window.NEON_VICE.game;
      const p = g.player.group.position;
      g.combat.spawnPolice(p.x + 20, p.z);
    });
    let stolen = false;
    let attempts = 0;
    for (let i = 0; i < 3 && !stolen; i += 1) {
      attempts += 1;
      await page.evaluate(() => {
        const g = window.NEON_VICE.game;
        const p = g.player.group.position;
        const v = g.vehicles.nearestVehicle(p.x, p.z, 600);
        if (v) window.NEON_VICE.debug.teleport(v.mesh.position.x, v.mesh.position.z);
      });
      await sleep(400);
      await page.keyboard.press('KeyE');
      await sleep(600);
      const s = await stats();
      if (s.driving) {
        await page.evaluate(() => window.NEON_VICE.debug.exitVehicle());
        await sleep(300);
      }
      if ((await stats()).wanted >= 1) stolen = true;
    }
    await page.evaluate(() => window.NEON_VICE.debug.clearPolice());
    log('real crime: stealing a car (cop nearby) -> wanted >= 1', stolen, `attempts=${attempts} wanted=${(await stats()).wanted}`);

    // ---- Decay: hide far away, wanted falls to 0 ----
    await page.evaluate(() => {
      window.NEON_VICE.debug.setWanted(1);
      window.NEON_VICE.debug.teleport(-550, -400);
    });
    await sleep(2000);
    const wHide0 = (await stats()).wanted;
    let decayed = false;
    const t1 = Date.now();
    while (Date.now() - t1 < 240000) {
      const s = await stats();
      if (s.wanted === 0) { decayed = true; break; }
      await sleep(2000);
    }
    log('decay: hiding far away drops wanted to 0', decayed, `wanted at hide=${wHide0}, waited=${((Date.now() - t1) / 1000).toFixed(0)}s`);

    // ---- Save/load smoke ----
    await page.evaluate(() => {
      window.NEON_VICE.debug.setMoney(7777);
      window.NEON_VICE.game.save.save();
    });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('neonvice-save-v1') || 'null'));
    log('save writes localStorage', !!saved && saved.money === 7777, saved ? `money=${saved.money}` : 'no save');
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
    await page.click('#btnContinue');
    await sleep(800);
    const s2 = await stats();
    log('save/load Continue restores', s2.money === 7777, `money=$${s2.money} wanted=${s2.wanted}`);

    log('0 console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    log('0 external requests', requests.length === 0, requests.slice(0, 3).join(' | '));

    await browser.close();
  } finally {
    server.kill();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
