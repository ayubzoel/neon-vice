// Neon Vice — Builder Markers+Trees verification (one-off, not the dossier).
// Usage: node tests/verify-markers-trees.js
// Checks: (1) EVERY tree vs EVERY road segment, 0 violations at the 4 m
// clearance; (2) mission marker follows stageTarget, visible in-world +
// on the minimap, moves on stage change; (3) map click sets GPS (desktop
// + touch); (4) touch pill shows touch wording, not WASD; (5) HUD GPS
// shows name + distance; (6) 0 console / page errors, 0 external requests.
const { chromium } = require('/home/hatch/workspace/custom-skills/playwright_skill/node_modules/playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const PORT = 8107;
const URL = `http://localhost:${PORT}/`;
const OUT = '/tmp/neonvice-markers';
fs.mkdirSync(OUT, { recursive: true });
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

async function newPage(browser, viewport, touch) {
  const ctx = await browser.newContext({ viewport, hasTouch: !!touch, isMobile: !!touch });
  const page = await ctx.newPage();
  const errors = [];
  const requests = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('request', (r) => { if (!r.url().startsWith(URL)) requests.push(r.url()); });
  await page.goto(URL, { waitUntil: 'load', timeout: 15000 });
  await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
  return { page, ctx, errors, requests };
}

// Canvas coords of a world point on the open full-screen map, in CSS px.
async function mapCssPoint(page, wx, wz) {
  return page.evaluate(([wx, wz]) => {
    const c = document.getElementById('mapCanvas');
    const rect = c.getBoundingClientRect();
    const W = 1200, D = 900;
    const scale = Math.min(c.width / W, c.height / D) * 0.92;
    const ox = (c.width - W * scale) / 2;
    const oy = (c.height - D * scale) / 2;
    const ax = ox + (wx + W / 2) * scale;
    const ay = oy + (wz + D / 2) * scale;
    return { x: rect.left + ax * (rect.width / c.width), y: rect.top + ay * (rect.height / c.height) };
  }, [wx, wz]);
}

async function main() {
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], {
    cwd: '/home/hatch/workspace/makefun/neon-vice-entry', stdio: 'ignore',
  });
  await waitForServer(PORT);
  const browser = await chromium.launch({
    executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const results = [];
  const log = (name, ok, note) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ' — ' + note : ''}`); };
  try {
    // ---- Desktop ----
    const d = await newPage(browser, { width: 1280, height: 800 }, false);
    const treeCheck = await d.page.evaluate(() => {
      const w = window.NEON_VICE_WORLD;
      const segs = w.roadGraph.segments;
      const clearM = w.roadClearM;
      let minMargin = Infinity;
      const violations = [];
      for (const t of w.trees) {
        let best = Infinity; let bestW = 0;
        for (const s of segs) {
          const dx = s.bx - s.ax, dz = s.bz - s.az;
          const len2 = dx * dx + dz * dz;
          let tt = len2 === 0 ? 0 : ((t.x - s.ax) * dx + (t.z - s.az) * dz) / len2;
          tt = Math.max(0, Math.min(1, tt));
          const dist = Math.hypot(t.x - (s.ax + dx * tt), t.z - (s.az + dz * tt));
          if (dist < best) { best = dist; bestW = s.width; }
        }
        const margin = best - bestW / 2;
        if (margin < minMargin) minMargin = margin;
        if (margin <= clearM) violations.push({ ...t, dist: +best.toFixed(1), margin: +margin.toFixed(1) });
      }
      return { count: w.trees.length, dropped: w.treesDropped, retried: w.treesRetried, clearM, minMargin: +minMargin.toFixed(2), violations };
    });
    log('trees: all checked, 0 on-road', treeCheck.violations.length === 0,
      `${treeCheck.count} trees checked, ${treeCheck.retried} candidates rejected & re-placed, ${treeCheck.dropped} dropped at build, min clearance past road edge ${treeCheck.minMargin}m (need >${treeCheck.clearM}m), violations: ${JSON.stringify(treeCheck.violations.slice(0, 3))}`);

    await d.page.click('#btnNew');
    await sleep(600);
    // Mission 1: marker must exist at stage 1 target and match stageTarget.
    await d.page.evaluate(() => window.NEON_VICE.debug.startMission(1));
    await sleep(800);
    const m1 = await d.page.evaluate(() => {
      const g = window.NEON_VICE.game;
      return {
        marker: g.missions.missionMarker(),
        target: g.missions.stageTarget(),
        stage: g.missions.stageIndex,
        hudGps: document.getElementById('hudGps').textContent,
        objective: document.getElementById('hudObjective').textContent,
      };
    });
    const markerAtTarget = m1.marker && m1.target
      && Math.hypot(m1.marker.x - m1.target.x, m1.marker.z - m1.target.z) < 1;
    log('mission marker at stage-1 target', !!markerAtTarget,
      `marker=${JSON.stringify(m1.marker)} target=${JSON.stringify(m1.target)}`);
    log('HUD GPS shows name + distance', /GPS .+ · \d+m/.test(m1.hudGps), `hudGps="${m1.hudGps}" objective="${m1.objective}"`);
    // Step back ~40 m south of the target, facing it, for a full-marker shot.
    await d.page.evaluate(() => {
      const g = window.NEON_VICE.game;
      const t = g.missions.stageTarget();
      g.player.group.position.set(t.x, 0, t.z + 40);
      g.player.heading = Math.atan2(t.x - t.x, t.z - (t.z + 40));
    });
    await sleep(1200);
    await d.page.screenshot({ path: OUT + '/1-marker-world.jpg', type: 'jpeg', quality: 75 });
    // Minimap close-up: the diamond should be visible in the HUD minimap.
    const mini = await d.page.evaluate(() => {
      const c = document.getElementById('minimap');
      return { w: c.width, h: c.height };
    });
    log('minimap present', mini.w > 0, `${mini.w}x${mini.h}`);

    // Stage change: walk to stage 1 target, marker must move to stage 2.
    const t1 = m1.target;
    await d.page.evaluate(([x, z]) => window.NEON_VICE.debug.teleport(x, z), [t1.x, t1.z]);
    let advanced = false;
    for (let i = 0; i < 20 && !advanced; i += 1) {
      await sleep(500);
      advanced = await d.page.evaluate(() => window.NEON_VICE.game.missions.stageIndex === 1);
    }
    const m2 = await d.page.evaluate(() => ({
      marker: window.NEON_VICE.game.missions.missionMarker(),
      target: window.NEON_VICE.game.missions.stageTarget(),
      stage: window.NEON_VICE.game.missions.stageIndex,
    }));
    const moved = advanced && m2.marker && m2.target
      && Math.hypot(m2.marker.x - m2.target.x, m2.marker.z - m2.target.z) < 1
      && Math.hypot(m2.marker.x - t1.x, m2.marker.z - t1.z) > 10;
    log('marker moves to stage-2 target', !!moved,
      `advanced=${advanced} stage=${m2.stage} marker=${JSON.stringify(m2.marker)} target=${JSON.stringify(m2.target)}`);
    await d.page.screenshot({ path: OUT + '/2-marker-stage2.jpg', type: 'jpeg', quality: 75 });

    // GPS click (desktop): click exactly on Pantai Vice's map dot.
    await d.page.keyboard.press('KeyM');
    await sleep(700);
    const pt = await mapCssPoint(d.page, 445, 100);
    const rectInfo = await d.page.evaluate(() => {
      const c = document.getElementById('mapCanvas');
      const r = c.getBoundingClientRect();
      return { attr: [c.width, c.height], css: [Math.round(r.width), Math.round(r.height)] };
    });
    await d.page.mouse.click(pt.x, pt.y);
    await sleep(400);
    const gps = await d.page.evaluate(() => ({
      target: window.NEON_VICE.game.map.gpsTarget,
      hud: document.getElementById('hudGps').textContent,
    }));
    log('map click sets GPS (desktop)', gps.target && gps.target.name === 'Pantai Vice',
      `canvas attr=${rectInfo.attr} css=${rectInfo.css} clicked=(${pt.x.toFixed(0)},${pt.y.toFixed(0)}) gps=${JSON.stringify(gps.target)} hud="${gps.hud}"`);
    await d.page.screenshot({ path: OUT + '/3-map-gps.jpg', type: 'jpeg', quality: 75 });
    await d.page.keyboard.press('KeyM'); // close map
    await sleep(300);
    log('desktop console errors', d.errors.length === 0, d.errors.slice(0, 3).join(' | '));
    log('desktop external requests', d.requests.length === 0, d.requests.slice(0, 3).join(' | '));
    await d.page.close();

    // ---- Mobile / touch ----
    const m = await newPage(browser, { width: 390, height: 844 }, true);
    await m.page.click('#btnNew');
    await sleep(800);
    const pill = await m.page.evaluate(() => ({
      text: document.getElementById('touchHint').textContent,
      shown: document.getElementById('touchHint').classList.contains('show'),
    }));
    log('touch pill shows touch wording, not WASD', pill.shown && /Left stick/.test(pill.text) && !/WASD/.test(pill.text),
      `pill="${pill.text}" shown=${pill.shown}`);
    await m.page.evaluate(() => window.NEON_VICE.debug.startMission(1));
    await sleep(500);
    await m.page.screenshot({ path: OUT + '/4-mobile-marker.jpg', type: 'jpeg', quality: 75 });
    await m.page.keyboard.press('KeyM');
    await sleep(700);
    const ptM = await mapCssPoint(m.page, 445, 100);
    await m.page.touchscreen.tap(ptM.x, ptM.y);
    await sleep(400);
    const gpsM = await m.page.evaluate(() => window.NEON_VICE.game.map.gpsTarget);
    log('map click sets GPS (mobile tap)', gpsM && gpsM.name === 'Pantai Vice',
      `tapped=(${ptM.x.toFixed(0)},${ptM.y.toFixed(0)}) gps=${JSON.stringify(gpsM)}`);
    await m.page.screenshot({ path: OUT + '/5-mobile-map.jpg', type: 'jpeg', quality: 75 });
    log('mobile console errors', m.errors.length === 0, m.errors.slice(0, 3).join(' | '));
    log('mobile external requests', m.requests.length === 0, m.requests.slice(0, 3).join(' | '));
    await m.page.close();
  } catch (e) {
    console.log('HARNESS ERROR: ' + e.message);
    results.push({ name: 'harness', ok: false });
  } finally {
    await browser.close();
    server.kill();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n== ${results.length - failed}/${results.length} passed ==`);
  process.exit(failed ? 1 : 0);
}
main();
