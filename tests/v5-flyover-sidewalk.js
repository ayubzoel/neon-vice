// Neon Vice — v5 items 1-2 harness (Playwright, SwiftShader).
// Usage: node tests/v5-flyover-sidewalk.js
// Item 1 (flyover): sign removed, deck markings, solid deck-edge
// barriers (car + on-foot push tests), left/right turns under both
// flyovers. Item 2 (sidewalk): in-page audit of the built sidewalk mesh
// (no triangle inside any road band; pads only where both arms exist)
// + before/after screenshots of 3 intersections + 3 road ends.
// Writes screenshots + results.json to /tmp/neon-vice-v5/item12/.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const PORT = 8121;
const URL = `http://localhost:${PORT}/?autostart=new`;
const OUT = '/tmp/neon-vice-v5/item12';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const { chromium } = await import('/home/hatch/workspace/custom-skills/playwright_skill/node_modules/playwright-core/index.mjs');
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], {
    cwd: '/home/hatch/workspace/makefun/neon-vice-entry', stdio: 'ignore',
  });
  await waitForServer(PORT);
  const browser = await chromium.launch({
    executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const results = [];
  const log = (name, ok, note) => { results.push({ name, ok, note: note || '' }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ' — ' + note : ''}`); };

  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errors = [];
    const requests = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
    page.on('request', (r) => { if (!r.url().startsWith(`http://localhost:${PORT}`)) requests.push(r.url()); });
    let loaded = false;
    for (let i = 0; i < 6 && !loaded; i += 1) {
      try { await page.goto(URL, { waitUntil: 'load', timeout: 15000 }); loaded = true; }
      catch (e) { await sleep(2000); }
    }
    if (!loaded) throw new Error('server unreachable after retries');
    await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
    await page.evaluate(() => window.NEON_VICE.debug.setStepBudget(24));
    await sleep(5000);

    const stats = () => page.evaluate(() => window.NEON_VICE.stats());
    const hero = () => page.evaluate(() => window.NEON_VICE.hero());
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
    // Teleport the driven car (debug.teleport moves it when driving) and
    // set its heading/speed directly.
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
    // Overhead-style shot: teleport player, steep pitch, screenshot.
    async function shot(name, x, z, yaw, pitch = 1.0) {
      await page.evaluate(([xx, zz]) => window.NEON_VICE.debug.teleport(xx, zz), [x, z]);
      await sleep(400);
      await page.evaluate(([y, p]) => window.NEON_VICE.debug.setCameraOrbit(y, p), [yaw, pitch]);
      await sleep(900);
      await page.screenshot({ path: `${OUT}/${name}.png` });
    }

    // ---------- FPS (warmed up) ----------
    const fpsSamples = [];
    for (let i = 0; i < 5; i += 1) { await sleep(1000); fpsSamples.push((await stats()).fps); }
    const fpsMed = fpsSamples.slice().sort((a, b) => a - b)[2];
    log('fps sample (SwiftShader, median of 5)', fpsMed >= 1, `samples=${fpsSamples.join(',')}`);

    // ---------- 1a: approach shot — the sign must be gone ----------
    await shot('v5-approach-flyover60', 60, -78, 0, 0.35);
    log('1a sign gone (visual: approach shot, verify by eye)', true, 'see v5-approach-flyover60.png; code: makeFlyoverSignTexture removed');

    // ---------- Enter a car, drive onto deck x=60 ----------
    const entered = await enterNearestCar();
    log('enter vehicle (E)', entered, '');
    let onDeck = false;
    if (entered) {
      await setCar(60, -90, 0, 0);
      await page.keyboard.down('KeyW');
      const t0 = Date.now();
      let maxY = -99; let minY = 99;
      while (Date.now() - t0 < 90000) {
        const c = await carPos();
        if (!c) break;
        maxY = Math.max(maxY, c.y); minY = Math.min(minY, c.y);
        if (c.z > -5 && c.y > 5.5) { onDeck = true; break; }
        await sleep(400);
      }
      await page.keyboard.up('KeyW');
      // Stop dead on the deck (direct speed=0: S-braking lets the car
      // roll off the deck's north end before the marking screenshots).
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
      await sleep(500);
      const c = await carPos();
      log('drive onto deck x=60 (naik, y≈6, berhenti di deck)',
        onDeck && maxY >= 5.5 && minY > -0.5 && c && Math.abs(c.y - 6) < 0.6 && Math.abs(c.z) < 10 && (await stats()).driving,
        `maxY=${maxY.toFixed(1)} minY=${minY.toFixed(1)} end=(${c ? c.x.toFixed(1) : '?'},${c ? c.y.toFixed(1) : '?'},${c ? c.z.toFixed(1) : '?'})`);
      // Deck markings: steep-down shot from the car + forward shot.
      await page.evaluate(() => window.NEON_VICE.debug.setCameraOrbit(0, 1.0));
      await sleep(900);
      await page.screenshot({ path: `${OUT}/v5-deck-markings-overhead.png` });
      await page.evaluate(() => window.NEON_VICE.debug.setCameraOrbit(0, 0.45));
      await sleep(900);
      await page.screenshot({ path: `${OUT}/v5-deck-markings-front.png` });
      log('1b deck markings (visual: overhead + front shots)', true, 'see v5-deck-markings-*.png');

      // ---------- 1c: barrier push, car, east then west ----------
      // Place the car exactly on the deck centre first (direct pose set:
      // debug.teleport resets y=0, which would drop it under the deck).
      // groundHeightAt keeps y=6 while currentY > 3.
      async function placeCarOnDeck() {
        await page.evaluate(() => {
          const g = window.NEON_VICE.game;
          const p = g.player.group.position;
          let best = null; let bestD = Infinity;
          for (const v of g.vehicles.list) {
            const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
            if (d < bestD) { bestD = d; best = v; }
          }
          if (best) {
            best.mesh.position.set(60, 6, 0);
            best.heading = 0; best.mesh.rotation.y = 0; best.speed = 0;
            g.player.group.position.set(60, 6, 0);
          }
        });
        await sleep(800);
        return carPos();
      }
      async function barrierPushCar(heading, label) {
        const placed = await placeCarOnDeck();
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
        let minY = 99; let maxY = -99; let end = null;
        const t1 = Date.now();
        while (Date.now() - t1 < 15000) {
          const cc = await carPos();
          if (!cc) break;
          minY = Math.min(minY, cc.y); maxY = Math.max(maxY, cc.y);
          end = cc;
          await sleep(300);
        }
        await page.keyboard.up('KeyW');
        return { start, end, minY, maxY };
      }
      const pushE = await barrierPushCar(Math.PI / 2, 'east');
      log('1c barrier car east: gas pol ke tepi, tidak keluar deck',
        pushE.start && pushE.start.y > 5.5 && pushE.end && pushE.end.x < 64 && pushE.end.x > 61.5 && pushE.minY > 5.5,
        `start=(${pushE.start.x.toFixed(1)},${pushE.start.y.toFixed(1)},${pushE.start.z.toFixed(1)}) end=(${pushE.end.x.toFixed(1)},${pushE.end.y.toFixed(1)},${pushE.end.z.toFixed(1)}) yRange=[${pushE.minY.toFixed(1)},${pushE.maxY.toFixed(1)}]`);
      const pushW = await barrierPushCar(-Math.PI / 2, 'west');
      log('1c barrier car west: gas pol ke tepi, tidak keluar deck',
        pushW.start && pushW.start.y > 5.5 && pushW.end && pushW.end.x > 56 && pushW.end.x < 58.5 && pushW.minY > 5.5,
        `start=(${pushW.start.x.toFixed(1)},${pushW.start.y.toFixed(1)},${pushW.start.z.toFixed(1)}) end=(${pushW.end.x.toFixed(1)},${pushW.end.y.toFixed(1)},${pushW.end.z.toFixed(1)}) yRange=[${pushW.minY.toFixed(1)},${pushW.maxY.toFixed(1)}]`);

      // ---------- 1c: barrier on foot ----------
      // Place the player directly on the deck (groundY=6 keeps her up
      // there: teleport resets y=0, which would drop her under the deck).
      // Walk-up from the ramp base was already demonstrated in the
      // previous run (y 0.6 -> 5.6 on the ramp, 6.0 on the deck). On-foot
      // movement is camera-relative, so the camera orbit yaw must match
      // the walking direction (east = yaw PI/2) or W walks her north.
      await page.keyboard.press('KeyE'); // exit vehicle on the deck
      await sleep(800);
      const onFoot = !(await stats()).driving;
      let footOk = false; let footNote = '';
      if (onFoot) {
        await page.evaluate(() => {
          const pl = window.NEON_VICE.game.player;
          pl.groundY = 6;
          pl.group.position.set(60, 6, 0);
          pl.heading = Math.PI / 2;
        });
        await page.evaluate(() => window.NEON_VICE.debug.setCameraOrbit(Math.PI / 2, 0.5));
        await sleep(800);
        const p0 = await page.evaluate(() => {
          const p = window.NEON_VICE.game.player.group.position;
          return { x: p.x, y: p.y, z: p.z };
        });
        if (p0.y > 5.5) {
          await page.keyboard.down('KeyW');
          await sleep(12000);
          await page.keyboard.up('KeyW');
          const p1 = await page.evaluate(() => {
            const p = window.NEON_VICE.game.player.group.position;
            return { x: p.x, y: p.y, z: p.z };
          });
          footOk = p1.x < 64.5 && p1.x > 61 && p1.y > 5.5;
          footNote = `deck start=(${p0.x.toFixed(1)},${p0.y.toFixed(1)},${p0.z.toFixed(1)}) push end=(${p1.x.toFixed(1)},${p1.y.toFixed(1)},${p1.z.toFixed(1)})`;
        } else {
          footNote = `gagal menempatkan pemain di deck, y=${p0.y.toFixed(1)} at (${p0.x.toFixed(1)},${p0.z.toFixed(1)})`;
        }
      } else { footNote = 'exit vehicle gagal'; }
      log('1c barrier on-foot: jalan ke tepi deck, tidak jatuh', footOk, footNote);

      // ---------- 1d: turns under both flyovers ----------
      // Re-enter a car first: after the on-foot test the player is not
      // driving, and debug.teleport only moves the car while driving.
      const reEntered = await enterNearestCar();
      log('re-enter vehicle before turn tests', reEntered, '');
      async function turnUnder(fx, startX, startHeading, key, label) {
        await setCar(startX, 0, startHeading, 8);
        await page.keyboard.down('KeyW');
        await page.keyboard.down(key);
        let turned = false; let yOk = true; let keyHeld = true;
        const trace = [];
        const t3 = Date.now();
        while (Date.now() - t3 < 60000) {
          const c = await carPos();
          if (!c) break;
          if (Math.abs(c.y) > 0.6) yOk = false;
          trace.push({ x: +c.x.toFixed(1), z: +c.z.toFixed(1) });
          const hw = ((c.heading % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
          if (keyHeld && Math.abs(hw) < 0.6) { await page.keyboard.up(key); keyHeld = false; }
          else if (!keyHeld && Math.abs(hw) > 0.6) { await page.keyboard.down(key); keyHeld = true; }
          if (!keyHeld && Math.abs(hw) < 0.6 && c.z > 15) { turned = true; break; }
          await capSpeed(10);
          await sleep(250);
        }
        await page.keyboard.up('KeyW'); await page.keyboard.up(key);
        const end = await carPos();
        // Min distance from the swept path to any flyover pillar.
        let minPillar = Infinity;
        for (const p of trace) {
          for (const [px, pz] of [[-3.5, -9], [3.5, -9], [-3.5, 9], [3.5, 9]]) {
            minPillar = Math.min(minPillar, Math.hypot(p.x - (fx + px), p.z - pz));
          }
        }
        return { turned, yOk, end, minPillar, traceLen: trace.length };
      }
      for (const [fx, label] of [[60, 'x=60'], [300, 'x=300']]) {
        if (!reEntered) { log(`1d turn under ${label}: skipped (no car)`, false, 're-enter failed'); continue; }
        const left = await turnUnder(fx, fx + 25, -Math.PI / 2, 'KeyA', label);
        log(`1d turn under ${label}: belok kiri penuh (westbound)`,
          left.turned && left.yOk && (await stats()).driving,
          `end=(${left.end ? left.end.x.toFixed(0) : '?'},${left.end ? left.end.z.toFixed(0) : '?'}) minPillar=${left.minPillar.toFixed(1)}m trace=${left.traceLen}`);
        const right = await turnUnder(fx, fx - 25, Math.PI / 2, 'KeyD', label);
        log(`1d turn under ${label}: belok kanan penuh (eastbound)`,
          right.turned && right.yOk && (await stats()).driving,
          `end=(${right.end ? right.end.x.toFixed(0) : '?'},${right.end ? right.end.z.toFixed(0) : '?'}) minPillar=${right.minPillar.toFixed(1)}m trace=${right.traceLen}`);
      }
    }

    // ---------- 2: sidewalk geometry audit (built mesh, in-page) ----------
    // Every triangle centroid of the merged sidewalk mesh must lie in a
    // legal sidewalk zone: alongside a segment (lateral offset in
    // [w/2, w/2+3], longitudinally within the TRIMMED interval) or
    // inside a corner pad that exists only where both arms exist.
    // In v4 this audit fails everywhere: strips ran full length through
    // the crossing road band.
    const audit = await page.evaluate(() => {
      const W = window.NEON_VICE_WORLD;
      const rg = W.roadGraph;
      const colW = new Map(); const rowW = new Map();
      for (const s of rg.segments) {
        if (s.kind === 'vertical') colW.set(s.ax, s.width);
        else rowW.set(s.az, s.width);
      }
      // Find the merged sidewalk mesh: every vertex at y ≈ 0.08.
      let walks = null;
      W.scene.traverse((m) => {
        if (walks || !m.geometry || !m.geometry.attributes || !m.geometry.attributes.position) return;
        const pos = m.geometry.attributes.position;
        let ok = pos.count > 100;
        for (let i = 0; i < pos.count && ok; i += 1) {
          if (Math.abs(pos.getY(i) - 0.08) > 0.01) ok = false;
        }
        if (ok) walks = m;
      });
      if (!walks) return { error: 'walks mesh not found' };
      const pos = walks.geometry.attributes.position;
      const idx = walks.geometry.index;
      const triCount = (idx ? idx.count : pos.count) / 3;
      function inZone(x, z) {
        for (const s of rg.segments) {
          const alongX = s.kind === 'horizontal';
          const dx = s.bx - s.ax; const dz = s.bz - s.az;
          const len = Math.hypot(dx, dz);
          const ux = dx / len; const uz = dz / len;
          const rx = x - s.ax; const rz = z - s.az;
          const t = rx * ux + rz * uz;
          const lat = Math.abs(-rz * ux + rx * uz);
          if (lat < s.width / 2 - 0.01 || lat > s.width / 2 + 3.01) continue;
          const nA = rg.nodes[s.a]; const nB = rg.nodes[s.b];
          const trimA = alongX ? colW.get(nA.x) / 2 : rowW.get(nA.z) / 2;
          const trimB = alongX ? colW.get(nB.x) / 2 : rowW.get(nB.z) / 2;
          if (t >= trimA - 0.01 && t <= len - trimB + 0.01) return true;
        }
        for (const n of rg.nodes) {
          const vW = colW.get(n.x); const hW = rowW.get(n.z);
          for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
              const hasH = rg.nodes.some((q) => q.row === n.row && q.col === n.col + sx);
              const hasV = rg.nodes.some((q) => q.col === n.col && q.row === n.row + sz);
              if (!hasH || !hasV) continue;
              const cx = n.x + sx * (vW / 2 + 1.5);
              const cz = n.z + sz * (hW / 2 + 1.5);
              if (Math.abs(x - cx) <= 1.51 && Math.abs(z - cz) <= 1.51) return true;
            }
          }
        }
        return false;
      }
      let bad = 0; const badEx = [];
      for (let t = 0; t < triCount; t += 1) {
        let cx = 0; let cz = 0;
        for (let k = 0; k < 3; k += 1) {
          const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
          cx += pos.getX(vi) / 3; cz += pos.getZ(vi) / 3;
        }
        if (!inZone(cx, cz)) {
          bad += 1;
          if (badEx.length < 5) badEx.push([+cx.toFixed(1), +cz.toFixed(1)]);
        }
      }
      return { triCount, bad, badEx };
    });
    log('2 sidewalk audit: 0 mesh triangles outside legal sidewalk zones',
      !audit.error && audit.bad === 0,
      audit.error || `triangles=${audit.triCount} violations=${audit.bad} ex=${JSON.stringify(audit.badEx)}`);

    // ---------- 2: sidewalk screenshots (same spots as before-shots) ----------
    await shot('v5-intersection-60-0', 60, 0, 0.6);
    await shot('v5-intersection-neg180-120', -180, 120, 0.6);
    await shot('v5-intersection-300-neg240', 300, -240, 0.6);
    await shot('v5-roadend-neg540-neg360', -540, -360, 0.8);
    await shot('v5-roadend-400-360', 400, 360, 2.4);
    await shot('v5-roadend-neg540-0', -540, 0, 0.8);
    log('2 sidewalk screenshots (visual)', true, 'see v5-intersection-*.png + v5-roadend-*.png');

    log('0 console/page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
    log('0 external requests', requests.length === 0, requests.slice(0, 5).join(' | '));
    fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors, requests }, null, 2));
    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} PASS`);
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
