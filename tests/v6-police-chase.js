// Neon Vice — v6 police dynamic chase across the flyover (focused probe).
// The static deck test showed police reach a parked player on the deck
// (minDist 15.8 m) but never cross z=0 — they hold at ~16 m and a parked
// player gives them no reason to cross. This probe drives the player
// SOUTH over the deck while wanted=3 and checks the police follow
// ACROSS the flyover (their z flips from < -5 to > +5 near x=60).
// Usage: node tests/v6-police-chase.js
// Writes results.json to tests/evidence-v6/police-chase/.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8129;
const URL = `http://localhost:${PORT}/?autostart=new`;
const OUT = '/home/hatch/workspace/makefun/neon-vice-entry/tests/evidence-v6/police-chase';
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
    const gameTime = async () => (await stats()).gameTime;
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

    const entered = await enterNearestCar();
    check('enter vehicle (E)', entered, '');
    // Drive south from (60,-90) over the deck, capped at 12 m/s so the
    // 3-star police cars (24 m/s) can close in and follow across.
    await page.evaluate(() => {
      const g = window.NEON_VICE.game;
      const p = g.player.group.position;
      let best = null; let bestD = Infinity;
      for (const v of g.vehicles.list) {
        const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
        if (d < bestD) { bestD = d; best = v; }
      }
      if (best) {
        best.mesh.position.set(60, 0, -90);
        best.heading = 0; best.mesh.rotation.y = 0; best.speed = 0;
        g.player.group.position.set(60, 0, -90);
      }
    });
    await sleep(500);
    await page.evaluate(() => window.NEON_VICE.debug.setWanted(3));
    await sleep(1000);
    await page.keyboard.down('KeyW');
    const tracks = new Map(); // idx -> [{x,z,dist}]
    let minDist = Infinity;
    let playerCrossed = false;
    let playerYMax = 0;
    const t0 = await gameTime();
    while ((await gameTime()) - t0 < 60) {
      const c = await carPos();
      if (c) {
        playerYMax = Math.max(playerYMax, c.y);
        if (c.z > 120) break;
        if (c.z > 90) playerCrossed = true;
      }
      const ps = await page.evaluate(() => {
        const g = window.NEON_VICE.game;
        const p = g.player.group.position;
        return g.combat.policeCars.filter((cc) => !cc.dead).map((cc) => ({
          x: +cc.mesh.position.x.toFixed(1), z: +cc.mesh.position.z.toFixed(1),
          speed: +cc.speed.toFixed(1),
          dist: +Math.hypot(cc.mesh.position.x - p.x, cc.mesh.position.z - p.z).toFixed(1),
        }));
      });
      ps.forEach((cc, i) => {
        if (!tracks.has(i)) tracks.set(i, []);
        tracks.get(i).push(cc);
        minDist = Math.min(minDist, cc.dist);
      });
      // Keep the player on the road south, capped at 12 m/s.
      await steerTo(0);
      await page.evaluate(() => {
        const g = window.NEON_VICE.game;
        const p = g.player.group.position;
        let best = null; let bestD = Infinity;
        for (const v of g.vehicles.list) {
          const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
          if (d < bestD) { bestD = d; best = v; }
        }
        if (best && best.speed > 12) best.speed = 12;
      });
      await sleep(1200);
    }
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD');
    const end = await carPos();
    let crossed = 0; let crossedDetail = '';
    let stuckCars = 0;
    for (const [i, tr] of tracks) {
      const zs = tr.map((c) => c.z);
      const nearFly = tr.some((c) => Math.abs(c.x - 60) < 25);
      if (nearFly && Math.min(...zs) < -5 && Math.max(...zs) > 5) {
        crossed += 1;
        crossedDetail += ` #${i} z ${Math.min(...zs).toFixed(0)}->${Math.max(...zs).toFixed(0)};`;
      }
      const moved = Math.hypot(tr[tr.length - 1].x - tr[0].x, tr[tr.length - 1].z - tr[0].z);
      if (tr.length > 5 && moved < 5) stuckCars += 1;
    }
    check('polisi kejar: pemain menyeberang flyover ke selatan (z>90, naik deck)',
      playerCrossed && playerYMax > 5.5, `end=${fmt(end)} yMax=${playerYMax.toFixed(2)}`);
    check('polisi kejar: mendekati pemain (< 30 m) selama pengejaran',
      minDist < 30, `minDist=${minDist.toFixed(1)} m cars=${tracks.size}`);
    check('polisi kejar: ada yang melintasi flyover mengikuti pemain',
      crossed >= 1, `crossed=${crossed}${crossedDetail}`);
    check('polisi kejar: tidak ada mobil polisi yang diam membeku',
      stuckCars === 0, `stuck=${stuckCars}`);
    check('0 console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, errors }, null, 2));
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\nV6 police-chase: ${results.length - failed}/${results.length} passed`);
    await browser.close();
    process.exit(failed ? 1 : 0);
  } finally {
    server.kill();
  }
}
main().catch((e) => { console.error(e); process.exit(2); });
