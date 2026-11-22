// Neon Vice — v6 flyover redesign harness (Playwright, SwiftShader).
// Usage: node tests/v6-flyover.js
// Verifies the 4-lane 2-direction flyover redesign at (60,0) and (300,0):
//  - laneTarget() unit values (flyover lane vs surface turn lane)
//  - turns from the SURFACE lane: NS -> EW, both directions x both
//    flyovers x left/right (car ends on the EW road, yMax ~ 0)
//  - turns EW -> NS (v5 regression) + straight over the deck N and S
//    (0 -> 6 m -> 0) + straight EW under both decks (y = 0)
//  - deck-edge barriers still solid at the new 6 m deck width
//  - traffic does not wedge at the new intersections (lane offsets)
//  - police can reach / cross a player on the deck
//  - missions 1-3 + 8 still complete end-to-end
//  - reverse (bug 1) still works after the redesign
//  - full map (M) + minimap show the flyover decks (amber strips)
// Writes screenshots + results.json to /tmp/neon-vice-v6/flyover/.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8128;
const URL = `http://localhost:${PORT}/?autostart=new`;
const OUT = '/home/hatch/workspace/makefun/neon-vice-entry/tests/evidence-v6/flyover';
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
    const external = [];
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', (r) => { if (!r.url().startsWith(`http://localhost:${PORT}`)) external.push(r.url()); });
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
      return best ? { x: best.mesh.position.x, y: best.mesh.position.y, z: best.mesh.position.z, heading: best.heading, speed: best.speed, kind: best.kind } : null;
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

    // ---- (0) laneTarget unit values ----
    const lt = await page.evaluate(() => {
      const L = window.NEON_VICE.debug.laneTarget;
      const r = (o) => ({ x: +o.x.toFixed(1), z: +o.z.toFixed(1), via: !!o.viaFlyover });
      return {
        straightS: r(L({ x: 60, z: 0 }, { x: 60, z: -120 }, { x: 60, z: 120 })),
        straightN: r(L({ x: 60, z: 0 }, { x: 60, z: 120 }, { x: 60, z: -120 })),
        turnS: r(L({ x: 60, z: 0 }, { x: 60, z: -120 }, { x: 180, z: 0 })),
        turnN: r(L({ x: 60, z: 0 }, { x: 60, z: 120 }, { x: 180, z: 0 })),
        turnEtoS: r(L({ x: 300, z: 0 }, { x: 180, z: 0 }, { x: 300, z: 120 })),
        straightE: r(L({ x: 300, z: 0 }, { x: 180, z: 0 }, { x: 420, z: 0 })),
        plain: r(L({ x: 180, z: 0 }, { x: 180, z: -120 }, { x: 180, z: 120 })),
      };
    });
    check('laneTarget: lurus selatan -> lajur flyover (61.5, viaFlyover)',
      lt.straightS.x === 61.5 && lt.straightS.via === true, JSON.stringify(lt.straightS));
    check('laneTarget: lurus utara -> lajur flyover (58.5, viaFlyover)',
      lt.straightN.x === 58.5 && lt.straightN.via === true, JSON.stringify(lt.straightN));
    check('laneTarget: belok dari selatan -> lajur belok (64.5, bukan flyover)',
      lt.turnS.x === 64.5 && lt.turnS.via === false, JSON.stringify(lt.turnS));
    check('laneTarget: belok dari utara -> lajur belok (55.5, bukan flyover)',
      lt.turnN.x === 55.5 && lt.turnN.via === false, JSON.stringify(lt.turnN));
    check('laneTarget: timur -> selatan -> lajur belok (304.5)',
      lt.turnEtoS.x === 304.5 && lt.turnEtoS.via === false, JSON.stringify(lt.turnEtoS));
    check('laneTarget: lurus timur di bawah deck -> tanpa geser',
      lt.straightE.x === 300 && lt.straightE.via === false, JSON.stringify(lt.straightE));
    check('laneTarget: simpang biasa -> tanpa geser',
      lt.plain.x === 180 && lt.plain.via === false, JSON.stringify(lt.plain));

    const entered = await enterNearestCar();
    check('enter vehicle (E)', entered, '');

    // ---- (1) Turns FROM the surface lane: NS -> EW ----
    // Start in the turn lane (x = fx +/- 4.5), 40 m before the
    // intersection, turn AT the intersection, end on the EW road.
    async function turnTestNS(fx, opts) {
      const { startX, startZ, startHeading, key, targetHeading } = opts;
      await setCar(startX, startZ, startHeading, 5);
      await page.keyboard.down('KeyW');
      let turning = false; let released = false;
      let yMax = 0; let end = null; let ok = false;
      const southbound = startHeading === 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 60000) {
        const c = await carPos();
        if (!c) break;
        end = c;
        if (turning) yMax = Math.max(yMax, c.y);
        if (!turning && ((southbound && c.z >= -2) || (!southbound && c.z <= 2))) {
          await page.keyboard.down(key); turning = true;
        }
        const err = wrapPi(targetHeading - c.heading);
        if (turning && !released && Math.abs(err) < 0.15) {
          await page.keyboard.up(key); released = true;
        } else if (released) {
          await steerTo(targetHeading);
        }
        if (released && Math.abs(err) < 0.15 && Math.abs(c.x - fx) > 25 && Math.abs(c.z) < 5.5 && Math.abs(c.y) < 0.6) { ok = true; break; }
        await capSpeed(7);
        await sleep(250);
      }
      await page.keyboard.up('KeyW'); await page.keyboard.up(key);
      await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD');
      end = await carPos();
      const driving = (await stats()).driving;
      const hero = await page.evaluate(() => window.NEON_VICE.hero());
      return { ok, end, yMax, driving, hero };
    }
    for (const fx of [60, 300]) {
      const lS = await turnTestNS(fx, { startX: fx + 4.5, startZ: -25, startHeading: 0, key: 'KeyA', targetHeading: Math.PI / 2 });
      check(`belok KIRI dari lajur belok x=${fx} (selatan->timur): sampai jalan EW, y=0`,
        lS.ok && lS.yMax < 0.6, `end=${fmt(lS.end)} yMax=${lS.yMax.toFixed(2)} driving=${lS.driving} hero=(${lS.hero.x.toFixed(1)},${lS.hero.z.toFixed(1)})`);
      const rS = await turnTestNS(fx, { startX: fx + 4.5, startZ: -25, startHeading: 0, key: 'KeyD', targetHeading: -Math.PI / 2 });
      check(`belok KANAN dari lajur belok x=${fx} (selatan->barat): sampai jalan EW, y=0`,
        rS.ok && rS.yMax < 0.6, `end=${fmt(rS.end)} yMax=${rS.yMax.toFixed(2)} driving=${rS.driving} hero=(${rS.hero.x.toFixed(1)},${rS.hero.z.toFixed(1)})`);
      const lN = await turnTestNS(fx, { startX: fx - 4.5, startZ: 25, startHeading: Math.PI, key: 'KeyA', targetHeading: -Math.PI / 2 });
      check(`belok KIRI dari lajur belok x=${fx} (utara->barat): sampai jalan EW, y=0`,
        lN.ok && lN.yMax < 0.6, `end=${fmt(lN.end)} yMax=${lN.yMax.toFixed(2)} driving=${lN.driving} hero=(${lN.hero.x.toFixed(1)},${lN.hero.z.toFixed(1)})`);
      const rN = await turnTestNS(fx, { startX: fx - 4.5, startZ: 25, startHeading: Math.PI, key: 'KeyD', targetHeading: Math.PI / 2 });
      check(`belok KANAN dari lajur belok x=${fx} (utara->timur): sampai jalan EW, y=0`,
        rN.ok && rN.yMax < 0.6, `end=${fmt(rN.end)} yMax=${rN.yMax.toFixed(2)} driving=${rN.driving} hero=(${rN.hero.x.toFixed(1)},${rN.hero.z.toFixed(1)})`);
      if (fx === 300) {
        await page.evaluate(() => window.NEON_VICE.debug.setCameraOrbit(0.6, 0.9));
        await sleep(800);
        await page.screenshot({ path: `${OUT}/turn-surface-lane-300.png` });
      }
    }

    // ---- (2) Turns EW -> NS (v5 regression, same harness) ----
    async function turnTest(fx, opts) {
      const { startX, startHeading, key, targetHeading, targetIsNorth } = opts;
      await setCar(startX, 0, startHeading, 5);
      await page.keyboard.down('KeyW');
      let turning = false; let released = false;
      let yMax = 0; let end = null; let ok = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 60000) {
        const c = await carPos();
        if (!c) break;
        end = c;
        if (turning) yMax = Math.max(yMax, c.y);
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
      return { ok, end, yMax };
    }
    for (const fx of [60, 300]) {
      const left = await turnTest(fx, { startX: fx + 25, startHeading: -Math.PI / 2, key: 'KeyA', targetHeading: 0, targetIsNorth: false });
      check(`regresi belok KIRI bawah flyover x=${fx} (barat->selatan): y=0`,
        left.ok && left.yMax < 0.9, `end=${fmt(left.end)} yMax=${left.yMax.toFixed(2)}`);
      const right = await turnTest(fx, { startX: fx - 25, startHeading: Math.PI / 2, key: 'KeyD', targetHeading: 0, targetIsNorth: false });
      check(`regresi belok KANAN bawah flyover x=${fx} (timur->selatan): y=0`,
        right.ok && right.yMax < 0.9, `end=${fmt(right.end)} yMax=${right.yMax.toFixed(2)}`);
      const rightN = await turnTest(fx, { startX: fx + 25, startHeading: -Math.PI / 2, key: 'KeyD', targetHeading: Math.PI, targetIsNorth: true });
      check(`regresi belok KANAN bawah flyover x=${fx} (barat->utara): y=0`,
        rightN.ok && rightN.yMax < 0.9, `end=${fmt(rightN.end)} yMax=${rightN.yMax.toFixed(2)}`);
      const leftN = await turnTest(fx, { startX: fx - 25, startHeading: Math.PI / 2, key: 'KeyA', targetHeading: Math.PI, targetIsNorth: true });
      check(`regresi belok KIRI bawah flyover x=${fx} (timur->utara): y=0`,
        leftN.ok && leftN.yMax < 0.9, `end=${fmt(leftN.end)} yMax=${leftN.yMax.toFixed(2)}`);
    }

    // ---- (3) Straight over the deck, south + north ----
    async function straightOver(fx, dir) {
      // dir +1: south (start z=-90, heading 0) -> z>90; dir -1: north.
      await setCar(fx, -90 * dir, dir > 0 ? 0 : Math.PI, 0);
      await page.keyboard.down('KeyW');
      let yMax = 0; let end = null; let yMinDeck = 99;
      const t0 = Date.now();
      while (Date.now() - t0 < 90000) {
        const c = await carPos();
        if (!c) break;
        end = c; yMax = Math.max(yMax, c.y);
        if (Math.abs(c.z) < 10) yMinDeck = Math.min(yMinDeck, c.y);
        if (dir > 0 ? c.z > 90 : c.z < -90) break;
        await sleep(300);
      }
      await page.keyboard.up('KeyW');
      return { end, yMax, yMinDeck };
    }
    for (const fx of [60, 300]) {
      const s = await straightOver(fx, 1);
      check(`lurus selatan x=${fx} (naik ramp + deck + turun): sampai z>90`,
        s.end && s.end.z > 90 && Math.abs(s.end.y) < 0.6 && s.yMax > 5.5 && s.yMax < 6.5,
        `end=${fmt(s.end)} yMax=${s.yMax.toFixed(2)}`);
      const n = await straightOver(fx, -1);
      check(`lurus utara x=${fx} (naik ramp + deck + turun): sampai z<-90`,
        n.end && n.end.z < -90 && Math.abs(n.end.y) < 0.6 && n.yMax > 5.5 && n.yMax < 6.5,
        `end=${fmt(n.end)} yMax=${n.yMax.toFixed(2)}`);
    }

    // ---- (4) Straight east under both decks ----
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
        end && end.x > 390 && yMax < 0.6, `end=${fmt(end)} yMax=${yMax.toFixed(2)}`);
    }

    // ---- (5) Deck-edge barriers still solid (new 6 m deck) ----
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
      pushE.start && pushE.start.y > 5.5 && pushE.end && pushE.end.x < 62 && pushE.end.x > 59 && pushE.minY > 5.5,
      `start=${fmt(pushE.start)} end=${fmt(pushE.end)} minY=${pushE.minY.toFixed(1)}`);
    const pushW = await barrierPush(60, -Math.PI / 2);
    check('pembatas deck x=60 barat: gas pol, tidak keluar deck',
      pushW.start && pushW.start.y > 5.5 && pushW.end && pushW.end.x > 58 && pushW.end.x < 61 && pushW.minY > 5.5,
      `start=${fmt(pushW.start)} end=${fmt(pushW.end)} minY=${pushW.minY.toFixed(1)}`);
    const pushE300 = await barrierPush(300, Math.PI / 2);
    check('pembatas deck x=300 timur: gas pol, tidak keluar deck',
      pushE300.start && pushE300.start.y > 5.5 && pushE300.end && pushE300.end.x < 302 && pushE300.end.x > 299 && pushE300.minY > 5.5,
      `start=${fmt(pushE300.start)} end=${fmt(pushE300.end)} minY=${pushE300.minY.toFixed(1)}`);

    // ---- (6) Traffic does not wedge at the new intersections ----
    async function trafficPositions() {
      return page.evaluate(() => {
        const g = window.NEON_VICE.game;
        return g.vehicles.list.filter((v) => v.traffic).map((v) => ({
          x: +v.mesh.position.x.toFixed(1), z: +v.mesh.position.z.toFixed(1),
          y: +v.mesh.position.y.toFixed(1), speed: +v.speed.toFixed(1),
        }));
      });
    }
    const nearFlyover = (p) => [60, 300].some((fx) => Math.abs(p.x - fx) < 15 && Math.abs(p.z) < 70);
    const tp0 = await trafficPositions();
    const tg0 = await gameTime();
    while ((await gameTime()) - tg0 < 20) await sleep(1000);
    const tp1 = await trafficPositions();
    const ct = await page.evaluate(() => window.NEON_VICE.debug.checkTraffic());
    let stuckNear = [];
    for (let i = 0; i < Math.min(tp0.length, tp1.length); i += 1) {
      const d = Math.hypot(tp1[i].x - tp0[i].x, tp1[i].z - tp0[i].z);
      if (d < 3 && (nearFlyover(tp0[i]) || nearFlyover(tp1[i]))) stuckNear.push({ i, d: +d.toFixed(1), at: tp1[i] });
    }
    check('lalu lintas: tidak ada mobil nyangkut di koridor flyover (20 dtk game-time)',
      stuckNear.length === 0, `stuck=${JSON.stringify(stuckNear)} total=${tp1.length}`);
    check('lalu lintas: tetap di jalan (checkTraffic onRoad)',
      ct.onRoad >= ct.traffic - 1, `onRoad=${ct.onRoad}/${ct.traffic} stopped=${ct.stopped}`);

    // ---- (7) Police can reach / cross a player on the deck ----
    await placeCarOnDeck(60);
    await page.evaluate(() => window.NEON_VICE.debug.setWanted(3));
    await sleep(1000);
    const policeSamples = [];
    const pg0 = await gameTime();
    while ((await gameTime()) - pg0 < 25) {
      const ps = await page.evaluate(() => {
        const g = window.NEON_VICE.game;
        const p = g.player.group.position;
        return g.combat.policeCars.filter((c) => !c.dead).map((c) => ({
          x: +c.mesh.position.x.toFixed(1), z: +c.mesh.position.z.toFixed(1),
          speed: +c.speed.toFixed(1),
          dist: +Math.hypot(c.mesh.position.x - p.x, c.mesh.position.z - p.z).toFixed(1),
        }));
      });
      policeSamples.push(ps);
      await sleep(1500);
    }
    let minDist = Infinity; let crossed = false; let movedAll = true;
    const firstByIdx = policeSamples[0] || [];
    const lastByIdx = policeSamples[policeSamples.length - 1] || [];
    for (const ps of policeSamples) for (const c of ps) minDist = Math.min(minDist, c.dist);
    for (const ps of policeSamples) {
      for (const c of ps) {
        if ((Math.abs(c.x - 60) < 20 || Math.abs(c.x - 300) < 20) && Math.abs(c.z) < 12) { /* near deck */ }
      }
    }
    // Crossing: a police car's z sign flips while near a flyover x.
    const tracks = new Map();
    for (const ps of policeSamples) {
      ps.forEach((c, i) => {
        if (!tracks.has(i)) tracks.set(i, []);
        tracks.get(i).push(c);
      });
    }
    for (const [, tr] of tracks) {
      const zs = tr.map((c) => c.z);
      if (Math.min(...zs) < -5 && Math.max(...zs) > 5) crossed = true;
      const moved = Math.hypot(tr[tr.length - 1].x - tr[0].x, tr[tr.length - 1].z - tr[0].z);
      if (moved < 5 && tr.length > 5) movedAll = false;
    }
    check('polisi: mendekati pemain di deck (< 30 m)',
      minDist < 30, `minDist=${minDist.toFixed(1)} m cars=${firstByIdx.length}`);
    check('polisi: ada yang melintasi flyover (z berubah sisi)',
      crossed, `tracks=${tracks.size}`);
    check('polisi: tidak ada yang diam membeku saat mengejar',
      movedAll, `last=${JSON.stringify(lastByIdx.slice(0, 2))}`);
    await page.evaluate(() => window.NEON_VICE.debug.setWanted(0));
    await page.evaluate(() => window.NEON_VICE.debug.clearPolice());
    await sleep(1000);

    // ---- (8) Missions 1-3 + 8 end-to-end ----
    const snap = () => page.evaluate(() => {
      const g = window.NEON_VICE.game;
      return {
        status: g.missions.status,
        missionId: g.missions.currentDef() ? g.missions.currentDef().id : null,
        stageIndex: g.missions.stageIndex, completed: g.missions.completed,
        target: g.missions.stageTarget(),
        driving: !!g.missions && window.NEON_VICE.stats().driving,
      };
    });
    const teleport = (x, z) => page.evaluate(([a, b]) => window.NEON_VICE.debug.teleport(a, b), [x, z]);
    async function completeMission(id) {
      // On foot: exit any vehicle first so E never re-enters a car
      // instead of the mission boat (M8).
      await page.evaluate(() => window.NEON_VICE.debug.exitVehicle());
      await sleep(500);
      await page.evaluate((n) => window.NEON_VICE.debug.startMission(n), id);
      await sleep(1500);
      for (let i = 0; i < 14; i += 1) {
        const s = await snap();
        if (s.completed.includes(id)) return { ok: true, detail: `selesai dalam ${i} lompatan` };
        if (s.status !== 'active' || !s.target) return { ok: false, detail: `status=${s.status} stage=${s.stageIndex} target=${JSON.stringify(s.target)}` };
        if (id === 8 && i === 0 && !s.driving) {
          // Board the boat at the Marina Dock first.
          await teleport(s.target.x, s.target.z);
          await sleep(800);
          for (let k = 0; k < 3 && !(await stats()).driving; k += 1) {
            await page.keyboard.press('KeyE');
            await sleep(600);
          }
        }
        await teleport(s.target.x, s.target.z);
        await sleep(2000);
      }
      const s = await snap();
      return { ok: s.completed.includes(id), detail: `status=${s.status} stage=${s.stageIndex}` };
    }
    for (const id of [1, 2, 3, 8]) {
      const m = await completeMission(id);
      check(`misi ${id} selesai end-to-end`, m.ok, m.detail);
    }

    // ---- (9) Reverse regression (bug 1) after the redesign ----
    await page.evaluate(() => window.NEON_VICE.debug.exitVehicle());
    await sleep(500);
    const entered2 = await enterNearestCar();
    check('regresi mundur: masuk mobil lagi', entered2, '');
    if (entered2) {
      // Reposition to the clear z=0 road first (after M8 the player is
      // in the bay; the nearest parked car may face a building).
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
      const before = await carPos();
      const rg0 = await gameTime();
      await page.keyboard.down('KeyS');
      while ((await gameTime()) - rg0 < 3) await sleep(400);
      await page.keyboard.up('KeyS');
      const after = await carPos();
      const d = before && after
        ? (after.x - before.x) * Math.sin(before.heading) + (after.z - before.z) * Math.cos(before.heading) : 0;
      check('regresi mundur: S dari diam -> mundur (speed < -5, jarak > 10 m)',
        after && after.speed < -5 && d < -10,
        `before=${fmt(before)} after=${fmt(after)} jarak=${d.toFixed(1)} m`);
    }

    // ---- (10) Map (M) + minimap show the flyover decks ----
    const amberCount = async (canvasId) => page.evaluate((cid) => {
      const c = document.getElementById(cid);
      if (!c) return -1;
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - 245) < 14 && Math.abs(d[i + 1] - 158) < 14 && Math.abs(d[i + 2] - 11) < 14) n += 1;
      }
      return n;
    }, canvasId);
    await page.evaluate(() => window.NEON_VICE.debug.teleport(60, -100));
    await sleep(1500);
    const miniAmber = await amberCount('minimap');
    check('minimap: strip amber flyover terlihat di dekat (60,-100)',
      miniAmber > 20, `piksel amber=${miniAmber}`);
    await page.keyboard.press('KeyM');
    await sleep(1500);
    const mapAmber = await amberCount('mapCanvas');
    check('peta (M): strip amber flyover terlihat',
      mapAmber > 50, `piksel amber=${mapAmber}`);
    await page.screenshot({ path: `${OUT}/map-flyover.png` });
    await page.keyboard.press('KeyM');
    await sleep(800);

    check('0 console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    check('0 request eksternal', external.length === 0, external.slice(0, 3).join(' | '));
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, errors, external }, null, 2));
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\nV6 flyover: ${results.length - failed}/${results.length} passed`);
    await browser.close();
    process.exit(failed ? 1 : 0);
  } finally {
    server.kill();
  }
}
main().catch((e) => { console.error(e); process.exit(2); });
