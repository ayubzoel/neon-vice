// Neon Vice — Tester v5 item 3: map/minimap realtime navigation lag.
// Usage: node tests/v5-map-realtime.js [label]
//   label: "before" (default) or "after" — names the evidence files.
// Measures, while driving 10 s along the z=0 straight (x -300 -> +400):
//   * per-frame lag = age (ms, wall clock) of the player position the
//     minimap was last drawn with, sampled every rAF;
//   * positional error = metres between the live player position and the
//     position used by the last minimap draw;
//   * draw cadence (intervals between drawMinimap calls).
// PASS when max lag < 100 ms while moving. Writes a JSON log + screenshots
// to /tmp/neon-vice-v5/item3/ and prints a one-line summary.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const LABEL = process.argv[2] || 'before';
const PORT = 8122;
const URL = `http://localhost:${PORT}/`;
const OUTDIR = '/tmp/neon-vice-v5/item3';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUTDIR, { recursive: true });

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
  const errors = [];
  const requests = [];

  try {
    const ctx = await browser.newContext({ viewport: { width: Number(process.env.VW || 960), height: Number(process.env.VH || 600) }, hasTouch: false });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
    page.on('request', (r) => { if (!r.url().startsWith(URL)) requests.push(r.url()); });
    await page.goto(URL, { waitUntil: 'load', timeout: 20000 });
    await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
    await page.click('#btnPlay');
    await sleep(400);
    await page.click('#btnNew');
    await sleep(400);
    // A save may exist (confirm-overwrite step): accept it if shown.
    if (await page.locator('#btnConfirmNew').isVisible().catch(() => false)) {
      await page.click('#btnConfirmNew');
    }
    await sleep(800);

    // --- Instrumentation: wrap ui.drawMinimap, sample live pos every rAF.
    await page.evaluate(() => {
      window.__mapLag = { draws: [], samples: [], running: true };
      const ui = window.NEON_VICE.game.ui;
      const orig = ui.drawMinimap.bind(ui);
      ui.drawMinimap = function (canvas, playerPos, heading, ...rest) {
        window.__mapLag.draws.push({ t: performance.now(), x: playerPos.x, z: playerPos.z });
        return orig(canvas, playerPos, heading, ...rest);
      };
      (function sample() {
        if (!window.__mapLag.running) return;
        const p = window.NEON_VICE.game.player.group.position;
        const s = window.__mapLag.samples;
        s.push({ t: performance.now(), x: p.x, z: p.z });
        if (s.length > 30000) s.splice(0, 5000);
        requestAnimationFrame(sample);
      })();
    });

    // --- GPS: pick the farthest destination from the player as the target.
    const gps = await page.evaluate(() => {
      const g = window.NEON_VICE.game;
      const p = g.player.group.position;
      const ds = g.map.destinations();
      let best = null; let bestD = -1;
      ds.forEach((d, i) => {
        const dd = Math.hypot(d.x - p.x, d.z - p.z);
        if (dd > bestD) { bestD = dd; best = i; }
      });
      const t = g.map.setGpsByIndex(best);
      return { name: t && t.name, dist: Math.round(bestD), count: ds.length };
    });
    console.log(`GPS target: ${gps.name} (${gps.dist} m away, ${gps.count} destinations)`);

    // --- Enter the nearest parked car, then place it on the z=0 straight.
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
    if (!car) throw new Error('no parked car found');
    await page.evaluate(([x, z]) => window.NEON_VICE.debug.teleport(x + 3, z), car);
    await sleep(400);
    let driving = false;
    for (let i = 0; i < 3 && !driving; i += 1) {
      await page.keyboard.press('KeyE');
      await sleep(600);
      driving = (await page.evaluate(() => window.NEON_VICE.stats())).driving;
    }
    if (!driving) throw new Error('could not enter car');
    // Straight run east along z=0: heading atan2(dx=1, dz=0) = PI/2.
    await page.evaluate(() => {
      const g = window.NEON_VICE.game;
      const p = g.player.group.position;
      let best = null; let bestD = Infinity;
      for (const v of g.vehicles.list) {
        const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
        if (d < bestD) { bestD = d; best = v; }
      }
      window.NEON_VICE.debug.teleport(-300, 0);
      if (best) { best.heading = Math.PI / 2; best.mesh.rotation.y = Math.PI / 2; best.speed = 0; }
    });
    await sleep(500);
    const fps0 = (await page.evaluate(() => window.NEON_VICE.stats())).fps;
    console.log(`FPS before drive: ${fps0}`);

    // --- Drive 10 s holding W; screenshot mid-drive (minimap visible).
    // Reset the lag buffers now so teleports/positioning cannot pollute the
    // steady-state numbers: only the 10 s drive is measured.
    await page.evaluate(() => { window.__mapLag.draws = []; window.__mapLag.samples = []; });
    await page.keyboard.down('KeyW');
    await sleep(5000);
    await page.screenshot({ path: path.join(OUTDIR, `driving-minimap-${LABEL}.png`) });
    await sleep(5000);
    await page.keyboard.up('KeyW');
    const st = await page.evaluate(() => window.NEON_VICE.stats());
    console.log(`After drive: fps=${st.fps} speed=${st.speed} driving=${st.driving}`);

    // --- Full-screen map overlay shot (game paused, GPS route visible).
    await page.keyboard.press('KeyM');
    await sleep(700);
    await page.screenshot({ path: path.join(OUTDIR, `fullscreen-map-${LABEL}.png`) });
    await page.keyboard.press('KeyM');
    await sleep(300);

    // --- Collect + analyse.
    const data = await page.evaluate(() => {
      window.__mapLag.running = false;
      return { draws: window.__mapLag.draws, samples: window.__mapLag.samples };
    });
    const { draws, samples } = data;
    // Per-sample lag: age + positional error vs the latest draw at sample time,
    // plus staleness in FRAMES (samples since that draw — 0 means the minimap
    // was redrawn in the very frame being sampled).
    let di = 0;
    const lags = [];
    for (let i = 0; i < samples.length; i += 1) {
      const s = samples[i];
      while (di + 1 < draws.length && draws[di + 1].t <= s.t) di += 1;
      if (!draws.length || draws[di].t > s.t) { lags.push(null); continue; } // before first draw
      const d = draws[di];
      let si = i;
      while (si > 0 && samples[si - 1].t > d.t) si -= 1;
      lags.push({ t: s.t, lagMs: s.t - d.t, lagFrames: i - si, errM: Math.hypot(s.x - d.x, s.z - d.z) });
    }
    // Speed per sample (m/s) from consecutive samples; keep moving samples.
    const moving = [];
    for (let i = 1; i < samples.length; i += 1) {
      const a = samples[i - 1]; const b = samples[i];
      const dt = (b.t - a.t) / 1000;
      if (dt <= 0) continue;
      const v = Math.hypot(b.x - a.x, b.z - a.z) / dt;
      if (v > 2) moving.push(lags[i] || lags[lags.length - 1]);
    }
    const m = moving.filter(Boolean);
    const stats = (arr, key) => {
      if (!arr.length) return null;
      const vs = arr.map((o) => o[key]).sort((x, y) => x - y);
      const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
      return { n: vs.length, mean: +mean.toFixed(1), p50: +vs[Math.floor(vs.length * 0.5)].toFixed(1), p95: +vs[Math.floor(vs.length * 0.95)].toFixed(1), max: +vs[vs.length - 1].toFixed(1) };
    };
    const intervals = [];
    for (let i = 1; i < draws.length; i += 1) intervals.push(draws[i].t - draws[i - 1].t);
    intervals.sort((a, b) => a - b);
    const drawCadence = intervals.length ? {
      n: intervals.length,
      mean: +(intervals.reduce((a, b) => a + b, 0) / intervals.length).toFixed(1),
      p95: +intervals[Math.floor(intervals.length * 0.95)].toFixed(1),
      max: +intervals[intervals.length - 1].toFixed(1),
    } : null;
    const lagStats = stats(m, 'lagMs');
    const frameStats = stats(m, 'lagFrames');
    const errStats = stats(m, 'errM');
    const out = {
      label: LABEL, fpsBefore: fps0, fpsAfter: st.fps,
      samples: samples.length, draws: draws.length,
      drawCadenceMs: drawCadence,
      movingSamples: m.length,
      lagMs: lagStats, lagFrames: frameStats, posErrM: errStats,
      consoleErrors: errors, externalRequests: requests,
    };
    fs.writeFileSync(path.join(OUTDIR, `lag-${LABEL}.json`), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    log('minimap lag < 100 ms while driving', !!(lagStats && lagStats.max < 100),
      lagStats ? `max ${lagStats.max} ms, p95 ${lagStats.p95} ms, mean ${lagStats.mean} ms (n=${lagStats.n}); frames stale max ${frameStats.max}` : 'no moving samples');
    log('minimap never more than 1 frame stale', !!(frameStats && frameStats.max <= 1),
      frameStats ? `max ${frameStats.max} frame(s) stale` : 'no moving samples');
    log('no new console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    log('no external requests', requests.length === 0, requests.slice(0, 3).join(' | '));
    console.log(`Evidence: ${OUTDIR}/lag-${LABEL}.json, driving-minimap-${LABEL}.png, fullscreen-map-${LABEL}.png`);
    const failed = results.filter((r) => !r.ok);
    console.log(failed.length ? `\n${failed.length} FAIL` : '\nALL PASS');
    await browser.close();
    server.kill();
    process.exit(failed.length ? 1 : 0);
  } catch (e) {
    console.error('HARNESS ERROR:', e.message);
    try { await browser.close(); } catch (_) {}
    server.kill();
    process.exit(2);
  }
}
main();
