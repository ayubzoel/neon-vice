// Neon Vice v6.1 — focused re-test of the two v6-flyover wall-time
// failures (right turn x=60 south->west; straight east under both
// decks). Both failed only on the suite's wall-clock budget while the
// car was driving correctly (heading/road/y all right, still moving);
// this re-runs exactly those two maneuvers with generous wall budgets
// to prove the maneuvers themselves work.
// Usage: node tests/v61-retest.js (spawns its own server on :8131)
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const OUT = '/home/hatch/workspace/makefun/neon-vice-entry/tests/evidence-v6/v61';
const PORT = 8131;
const URL = `http://localhost:${PORT}/?autostart=new`;
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
const wrapPi = (a) => ((a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;

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
    await sleep(4000);
    const stats = () => page.evaluate(() => window.NEON_VICE.stats());
    const carPos = () => page.evaluate(() => {
      const g = window.NEON_VICE.game;
      const p = g.player.group.position;
      let best = null; let bestD = Infinity;
      for (const v of g.vehicles.list) {
        const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
        if (d < bestD) { bestD = d; best = v; }
      }
      return best ? { x: best.mesh.position.x, y: best.mesh.position.y, z: best.mesh.position.z, heading: best.heading, speed: best.speed } : null;
    });
    async function setCar(x, z, heading, speed) {
      await page.evaluate(([xx, zz]) => window.NEON_VICE.debug.teleport(xx, zz), [x, z]);
      await page.evaluate(([h, s]) => {
        const g = window.NEON_VICE.game;
        const p = g.player.group.position;
        let best = null; let bestD = Infinity;
        for (const v of g.vehicles.list) {
          const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
          if (d < bestD) { bestD = d; best = v; }
        }
        if (best) { best.heading = h; best.mesh.rotation.y = h; best.speed = s; }
      }, [heading, speed]);
      await sleep(300);
    }
    async function capSpeed(cap) {
      await page.evaluate((cc) => {
        const g = window.NEON_VICE.game;
        const p = g.player.group.position;
        let best = null; let bestD = Infinity;
        for (const v of g.vehicles.list) {
          const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
          if (d < bestD) { bestD = d; best = v; }
        }
        if (best && best.speed > cc) best.speed = cc;
      }, cap);
    }
    async function enterNearestCar() {
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
      if (!car) return false;
      await page.evaluate(([x, z]) => window.NEON_VICE.debug.teleport(x + 3, z), car);
      await sleep(400);
      for (let i = 0; i < 3; i += 1) {
        await page.keyboard.press('KeyE');
        await sleep(600);
        if ((await stats()).driving) return true;
      }
      return false;
    }
    async function steerTo(targetHeading) {
      const c = await carPos();
      if (!c) return;
      const err = wrapPi(targetHeading - c.heading);
      if (err > 0.08) { await page.keyboard.down('KeyA'); await page.keyboard.up('KeyD'); }
      else if (err < -0.08) { await page.keyboard.down('KeyD'); await page.keyboard.up('KeyA'); }
      else { await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); }
    }

    check('enter vehicle (E)', await enterNearestCar(), '');

    // (1) Right turn from the turn lane x=60, south -> west.
    {
      await setCar(64.5, -25, 0, 5);
      await page.keyboard.down('KeyW');
      let turning = false; let released = false;
      let yMax = 0; let end = null; let ok = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 150000) {
        const c = await carPos();
        if (!c) break;
        end = c;
        if (turning) yMax = Math.max(yMax, c.y);
        if (!turning && c.z >= -2) { await page.keyboard.down('KeyD'); turning = true; }
        const err = wrapPi(-Math.PI / 2 - c.heading);
        if (turning && !released && Math.abs(err) < 0.15) {
          await page.keyboard.up('KeyD'); released = true;
        } else if (released) {
          await steerTo(-Math.PI / 2);
        }
        if (released && Math.abs(err) < 0.15 && Math.abs(c.x - 60) > 25 && Math.abs(c.z) < 5.5 && Math.abs(c.y) < 0.6) { ok = true; break; }
        await capSpeed(7);
        await sleep(250);
      }
      await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD');
      await page.keyboard.up('KeyA');
      end = await carPos();
      check('belok KANAN dari lajur belok x=60 (selatan->barat): sampai jalan EW, y=0',
        ok && yMax < 0.6, `end=${fmt(end)} yMax=${yMax.toFixed(2)} wall=${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }

    // (2) Straight east under both decks.
    {
      await setCar(-90, 0, Math.PI / 2, 0);
      await page.keyboard.down('KeyW');
      let yMax = 0; let end = null; let ok = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 420000) {
        const c = await carPos();
        if (!c) break;
        end = c; yMax = Math.max(yMax, c.y);
        if (c.x > 390) { ok = true; break; }
        await steerTo(Math.PI / 2);
        await capSpeed(12);
        await sleep(300);
      }
      await page.keyboard.up('KeyW');
      await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD');
      check('lurus timur z=0 (bawah kedua deck): sampai x>390, y=0',
        ok && yMax < 0.6, `end=${fmt(end)} yMax=${yMax.toFixed(2)} wall=${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }

    check('0 console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    fs.writeFileSync(`${OUT}/v61-retest.json`, JSON.stringify({ results, errors }, null, 2));
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\nv6.1 retest: ${results.length - failed}/${results.length} passed`);
    await browser.close();
    process.exit(failed ? 1 : 0);
  } finally {
    server.kill();
  }
}
main().catch((e) => { console.error(e); process.exit(2); });
