// Neon Vice — v5 item 1d fix harness (Playwright, SwiftShader).
// Usage: node tests/v5-flyover-turn-fix.js
// Verifies the flyoverHeightAt entry-aware fix in world.js: cars turning
// at the intersection under either flyover (60,0) / (300,0) must stay at
// y=0 on the road instead of being hauled onto the ramp top edge and
// wedged against the height-gated deck-edge barrier (old trap: left turn
// ended (296.1, 6.0, 10.2) / (55.9, 6.0, 10.3), speed -> 0, no escape).
// Turns use the NORMAL method (start turning AT the intersection, speed
// capped ~7 m/s), like the independent tester probe t2b — NOT the old v5
// harness method of holding the turn key from 25 m out, which completes
// the arc ~20 m early and drives off-road regardless of the flyover.
// Regressions: deck-edge barriers still solid (gas pol on deck), ramp
// climb still works (straight NS over the deck), straight EW under both
// decks stays at y=0.
// Writes screenshots + results.json to /tmp/neon-vice-v5/item1d-fix/.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8126;
const URL = `http://localhost:${PORT}/?autostart=new`;
const OUT = '/tmp/neon-vice-v5/item1d-fix';
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
    const external = [];
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', (r) => { if (!r.url().startsWith(`http://localhost:${PORT}`)) external.push(r.url()); });
    await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
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

    const entered = await enterNearestCar();
    check('enter vehicle (E)', entered, '');

    // Generic NORMAL turn: drive along z=0, start turning only at the
    // intersection (trigger), speed capped at 7 m/s, release the turn key
    // once the heading is on target. Success: on the destination road
    // (|x-fx| < 5.5, i.e. inside the 12 m road), past |z| > 25, y ~ 0.
    // yMax is tracked from the moment turning starts until success.
    // Post-turn the harness STEERS to the target heading (tap A/D): the
    // first version released the key with up to 0.35 rad residual error
    // and no correction, so the car drifted ~0.24 m per metre south and
    // left the road before reaching z=25 — a harness artifact, not the
    // flyover (yMax was 0.00 in every run: no car was ever lifted).
    const wrapPi = (a) => ((a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    async function steerTo(targetHeading) {
      const c = await carPos();
      if (!c) return;
      const err = wrapPi(targetHeading - c.heading);
      if (err > 0.08) { await page.keyboard.down('KeyA'); await page.keyboard.up('KeyD'); }
      else if (err < -0.08) { await page.keyboard.down('KeyD'); await page.keyboard.up('KeyA'); }
      else { await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); }
    }
    async function turnTest(fx, opts) {
      const { startX, startHeading, key, targetHeading, targetIsNorth, label } = opts;
      await setCar(startX, 0, startHeading, 5);
      await page.keyboard.down('KeyW');
      let turning = false; let released = false;
      let yMax = 0; let yMaxAt = null;
      const trace = [];
      let end = null; let ok = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 60000) {
        const c = await carPos();
        if (!c) break;
        end = c;
        if (turning) {
          yMax = Math.max(yMax, c.y);
          if (c.y === yMax) yMaxAt = { x: +c.x.toFixed(1), z: +c.z.toFixed(1) };
          trace.push({ x: +c.x.toFixed(1), y: +c.y.toFixed(1), z: +c.z.toFixed(1) });
        }
        if (!turning && ((startHeading < 0 && c.x <= fx + 2) || (startHeading > 0 && c.x >= fx - 2))) {
          await page.keyboard.down(key); turning = true;
        }
        const err = wrapPi(targetHeading - c.heading);
        if (turning && !released && Math.abs(err) < 0.15) {
          await page.keyboard.up(key); released = true;
        } else if (released) {
          await steerTo(targetHeading);
        }
        const pastTarget = targetIsNorth ? c.z < -25 : c.z > 25;
        if (released && Math.abs(err) < 0.15 && pastTarget && Math.abs(c.x - fx) < 5.5 && Math.abs(c.y) < 0.6) { ok = true; break; }
        await capSpeed(7);
        await sleep(250);
      }
      await page.keyboard.up('KeyW'); await page.keyboard.up(key);
      await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD');
      end = await carPos();
      return { ok, end, yMax, yMaxAt, trace };
    }

    for (const fx of [60, 300]) {
      // (a) Left turn, westbound -> southbound (the reported trap).
      const left = await turnTest(fx, { startX: fx + 25, startHeading: -Math.PI / 2, key: 'KeyA', targetHeading: 0, targetIsNorth: false, label: `left x=${fx}` });
      if (fx === 300) {
        await page.evaluate(() => window.NEON_VICE.debug.setCameraOrbit(0.6, 0.9));
        await sleep(800);
        await page.screenshot({ path: `${OUT}/fix-left-turn-300.png` });
      }
      check(`belok KIRI bawah flyover x=${fx} (westbound->selatan): sampai jalan tujuan, y=0`,
        left.ok && left.yMax < 0.9,
        `end=${fmt(left.end)} yMax=${left.yMax.toFixed(2)}${left.yMaxAt ? ` at (${left.yMaxAt.x},${left.yMaxAt.z})` : ''}`);
      // (b) Right turn, eastbound -> southbound (must stay on asphalt).
      const right = await turnTest(fx, { startX: fx - 25, startHeading: Math.PI / 2, key: 'KeyD', targetHeading: 0, targetIsNorth: false, label: `right x=${fx}` });
      if (fx === 60) {
        await page.evaluate(() => window.NEON_VICE.debug.setCameraOrbit(0.6, 0.9));
        await sleep(800);
        await page.screenshot({ path: `${OUT}/fix-right-turn-60.png` });
      }
      check(`belok KANAN bawah flyover x=${fx} (eastbound->selatan): tetap di jalan, y=0`,
        right.ok && right.yMax < 0.9,
        `end=${fmt(right.end)} yMax=${right.yMax.toFixed(2)}${right.yMaxAt ? ` at (${right.yMaxAt.x},${right.yMaxAt.z})` : ''}`);
      // Extra: the two northbound turns under the same flyover.
      const rightN = await turnTest(fx, { startX: fx + 25, startHeading: -Math.PI / 2, key: 'KeyD', targetHeading: Math.PI, targetIsNorth: true, label: `right-north x=${fx}` });
      check(`belok KANAN bawah flyover x=${fx} (westbound->utara): tetap di jalan, y=0`,
        rightN.ok && rightN.yMax < 0.9,
        `end=${fmt(rightN.end)} yMax=${rightN.yMax.toFixed(2)}`);
      const leftN = await turnTest(fx, { startX: fx - 25, startHeading: Math.PI / 2, key: 'KeyA', targetHeading: Math.PI, targetIsNorth: true, label: `left-north x=${fx}` });
      check(`belok KIRI bawah flyover x=${fx} (eastbound->utara): tetap di jalan, y=0`,
        leftN.ok && leftN.yMax < 0.9,
        `end=${fmt(leftN.end)} yMax=${leftN.yMax.toFixed(2)}`);
    }

    // Regression: straight south over the deck (ramp climb still works).
    async function straightSouth(fx) {
      await setCar(fx, -90, 0, 0);
      await page.keyboard.down('KeyW');
      let yMax = 0; let end = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 90000) {
        const c = await carPos();
        if (!c) break;
        end = c; yMax = Math.max(yMax, c.y);
        if (c.z > 90) break;
        await sleep(300);
      }
      await page.keyboard.up('KeyW');
      return { end, yMax };
    }
    for (const fx of [60, 300]) {
      const s = await straightSouth(fx);
      check(`lurus selatan x=${fx} (naik ramp + deck + turun): sampai z>90`,
        s.end && s.end.z > 90 && Math.abs(s.end.y) < 0.6 && s.yMax > 5.5 && s.yMax < 6.5,
        `end=${fmt(s.end)} yMax=${s.yMax.toFixed(2)}`);
    }

    // Regression: straight east along z=0 under both decks at y=0.
    // Lane-keeping steer to heading PI/2 (first version drifted to
    // z=7.7 off the road edge) and a 180 s budget: SwiftShader runs
    // game time slower than real time, so 480 m needs the headroom.
    {
      await setCar(-90, 0, Math.PI / 2, 0);
      await page.keyboard.down('KeyW');
      let yMax = 0; let end = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 180000) {
        const c = await carPos();
        if (!c) break;
        end = c; yMax = Math.max(yMax, c.y);
        if (c.x > 390) break;
        await steerTo(Math.PI / 2);
        await capSpeed(12);
        await sleep(300);
      }
      await page.keyboard.up('KeyW');
      await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD');
      check('lurus timur z=0 (bawah kedua deck): sampai x>390, y=0',
        end && end.x > 390 && yMax < 0.6,
        `end=${fmt(end)} yMax=${yMax.toFixed(2)}`);
    }

    // Regression: deck-edge barriers still solid (gas pol on deck x=60).
    async function placeCarOnDeck(fx) {
      await page.evaluate((fx2) => {
        const g = window.NEON_VICE.game;
        const p = g.player.group.position;
        let best = null; let bestD = Infinity;
        for (const v of g.vehicles.list) {
          const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
          if (d < bestD) { bestD = d; best = v; }
        }
        if (best) {
          best.mesh.position.set(fx2, 6, 0);
          best.heading = 0; best.mesh.rotation.y = 0; best.speed = 0;
          g.player.group.position.set(fx2, 6, 0);
        }
      }, fx);
      await sleep(800);
      return carPos();
    }
    async function barrierPush(fx, heading) {
      await placeCarOnDeck(fx);
      const start = await carPos();
      await page.evaluate((h) => {
        const g = window.NEON_VICE.game;
        const p = g.player.group.position;
        let best = null; let bestD = Infinity;
        for (const v of g.vehicles.list) {
          const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
          if (d < bestD) { bestD = d; best = v; }
        }
        if (best) { best.heading = h; best.mesh.rotation.y = h; best.speed = 0; }
      }, heading);
      await sleep(300);
      await page.keyboard.down('KeyW');
      let minY = 99; let end = null;
      const t1 = Date.now();
      while (Date.now() - t1 < 15000) {
        const cc = await carPos();
        if (!cc) break;
        minY = Math.min(minY, cc.y); end = cc;
        await sleep(300);
      }
      await page.keyboard.up('KeyW');
      return { start, end, minY };
    }
    const pushE = await barrierPush(60, Math.PI / 2);
    check('pembatas deck x=60 timur: gas pol, tidak keluar deck',
      pushE.start && pushE.start.y > 5.5 && pushE.end && pushE.end.x < 64 && pushE.end.x > 61.5 && pushE.minY > 5.5,
      `start=${fmt(pushE.start)} end=${fmt(pushE.end)} minY=${pushE.minY.toFixed(1)}`);
    const pushW = await barrierPush(60, -Math.PI / 2);
    check('pembatas deck x=60 barat: gas pol, tidak keluar deck',
      pushW.start && pushW.start.y > 5.5 && pushW.end && pushW.end.x > 56 && pushW.end.x < 58.5 && pushW.minY > 5.5,
      `start=${fmt(pushW.start)} end=${fmt(pushW.end)} minY=${pushW.minY.toFixed(1)}`);
    await page.evaluate(() => window.NEON_VICE.debug.setCameraOrbit(0, 1.0));
    await sleep(800);
    await page.screenshot({ path: `${OUT}/fix-deck-barrier-60.png` });

    check('0 console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    check('0 request eksternal', external.length === 0, external.slice(0, 3).join(' | '));
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, errors, external }, null, 2));
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\nV5 flyover-turn-fix: ${results.length - failed}/${results.length} passed`);
    await browser.close();
    process.exit(failed ? 1 : 0);
  } finally {
    server.kill();
  }
}
main().catch((e) => { console.error(e); process.exit(2); });
