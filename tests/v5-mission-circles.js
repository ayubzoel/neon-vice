// Neon Vice — Tester v5 item 7: mission ground circles + proximity auto-start.
// Usage: node tests/v5-mission-circles.js
// Spawns its own dev server (node serve.ts --port 8125), drives the game in
// headless Chromium (SwiftShader), and proves, without pressing any button:
//   (a) teleporting into mission 1's gold start circle auto-starts it;
//   (b) reaching mission 1's green destination circle completes the stage;
//   (c) the same for mission 2 (Taxi Shift), incl. no auto-start of the
//       NEXT mission while standing at the previous mission's end;
//   (d) screenshots of the start + destination circles from the player's view.
// The diamond/"!" marker must still be present on the active target.
// Writes screenshots + a JSON summary to /tmp/neon-vice-v5/item7/.
// ESM playwright-core is loaded with a dynamic import (this file is CJS:
// the repo has no "type": "module", so a static import would not parse).
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8125;
const URL = `http://localhost:${PORT}/`;
const OUT = '/tmp/neon-vice-v5/item7';
const REPO = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  const { chromium } = await import('/home/hatch/workspace/custom-skills/playwright_skill/node_modules/playwright-core/index.mjs');
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: REPO, stdio: 'ignore' });
  let browser = null;
  try {
    await waitForServer(PORT);
    browser = await chromium.launch({
      executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
      args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errors = [];
    const extReqs = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
    page.on('request', (r) => { if (!r.url().startsWith(URL)) extReqs.push(r.url()); });

    await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 60000 });
    // v5 loading screen (another builder's item): Start Game -> New Game,
    // with an overwrite confirm only when a save already exists.
    await page.click('#btnPlay');
    await sleep(500);
    await page.click('#btnNew');
    await sleep(800);
    const confirmVisible = await page.evaluate(() => {
      const b = document.getElementById('btnConfirmNew');
      return !!b && b.offsetParent !== null;
    });
    if (confirmVisible) { await page.click('#btnConfirmNew'); await sleep(800); }
    await sleep(600);

    const snap = () => page.evaluate(() => {
      const g = window.NEON_VICE.game;
      const s = window.NEON_VICE.stats();
      const p = g.player.group.position;
      return {
        status: g.missions.status, missionId: g.missions.currentDef() ? g.missions.currentDef().id : null,
        stageIndex: g.missions.stageIndex, completed: g.missions.completed,
        circles: g.missions.missionCircles(), marker: g.missions.missionMarker(),
        target: g.missions.stageTarget(), fps: s.fps,
        hero: { x: +p.x.toFixed(1), z: +p.z.toFixed(1) },
      };
    });
    const face = (px, pz, tx, tz, pitch) => page.evaluate(([a, b, c, d, e]) => {
      window.NEON_VICE.debug.setCameraOrbit(Math.atan2(c - a, d - b), e);
    }, [px, pz, tx, tz, pitch]);
    const teleport = (x, z) => page.evaluate(([a, b]) => window.NEON_VICE.debug.teleport(a, b), [x, z]);
    const dist = (a, b, c, d) => Math.hypot(a - c, b - d);
    // Stand `d` metres from (cx,cz) (offset +z), facing the circle, for a screenshot.
    async function shotFrom(name, cx, cz, d, pitch) {
      const px = cx; const pz = cz + d;
      await teleport(px, pz);
      await sleep(600);
      const here = await snap();
      await face(here.hero.x, here.hero.z, cx, cz, pitch || 0.38);
      await sleep(1200);
      await page.screenshot({ path: path.join(OUT, name) });
      return here;
    }

    // ---- (0) BEFORE: fresh New Game, no mission active, M1 start circle up.
    const before1 = await snap();
    check('before-m1: status idle, missionId 1', before1.status === 'idle' && before1.missionId === 1,
      `status=${before1.status} missionId=${before1.missionId} stage=${before1.stageIndex}`);
    check('before-m1: gold start circle visible for M1',
      !!before1.circles.start && before1.circles.start.visible && before1.circles.start.missionId === 1,
      JSON.stringify(before1.circles.start));
    check('before-m1: start circle near Ricos Bar (150,100)',
      !!before1.circles.start && dist(before1.circles.start.x, before1.circles.start.z, 150, 100) < 45,
      before1.circles.start ? `at (${before1.circles.start.x.toFixed(1)}, ${before1.circles.start.z.toFixed(1)}) r=${before1.circles.start.radius}` : 'no circle');
    check('before-m1: no green target circle while idle', !before1.circles.target,
      JSON.stringify(before1.circles.target));

    // ---- (a1) Screenshot the M1 start circle from the player's view.
    // 25 m away: teleport snaps to open ground within 10 m, so the player
    // can never land inside the 12 m trigger by accident here.
    const s1 = before1.circles.start;
    const shot1 = await shotFrom('01-start-circle-m1.png', s1.x, s1.z, 25, 0.38);
    check('shot-m1-start: still idle at 25 m (no premature auto-start)',
      shot1.status === 'idle' && shot1.missionId === 1,
      `status=${shot1.status} hero=(${shot1.hero.x}, ${shot1.hero.z}) distToCircle=${dist(shot1.hero.x, shot1.hero.z, s1.x, s1.z).toFixed(1)}m`);

    // ---- (a2) Teleport INTO the M1 start circle, press nothing.
    await teleport(s1.x, s1.z);
    await sleep(2500);
    const afterStart1 = await snap();
    check('autostart-m1: mission 1 active without any button press',
      afterStart1.status === 'active' && afterStart1.missionId === 1,
      `BEFORE status=${before1.status} stage=${before1.stageIndex} -> AFTER status=${afterStart1.status} missionId=${afterStart1.missionId} stage=${afterStart1.stageIndex} completed=${JSON.stringify(afterStart1.completed)}`);
    check('autostart-m1: start circle hidden once active, target circle shown',
      !afterStart1.circles.start && !!afterStart1.circles.target && afterStart1.circles.target.visible,
      JSON.stringify(afterStart1.circles));
    check('autostart-m1: diamond/! marker still on the active target',
      !!afterStart1.marker && !!afterStart1.target
        && dist(afterStart1.marker.x, afterStart1.marker.z, afterStart1.target.x, afterStart1.target.z) < 3,
      `marker=${JSON.stringify(afterStart1.marker)} target=${JSON.stringify(afterStart1.target)}`);

    // Stage 0 (pickup at Rico's) completes by standing at its target; if
    // the teleport snap left the player just outside its 10 m radius,
    // drive the stage machine by teleporting onto the live target until
    // the North Market leg (stage 1) is active.
    let cur = afterStart1;
    for (let i = 0; i < 4 && cur.status === 'active' && cur.stageIndex === 0; i += 1) {
      const t = cur.target;
      if (!t) break;
      await teleport(t.x, t.z);
      await sleep(2000);
      cur = await snap();
    }
    check('m1-stage1: North Market leg active (stageIndex 1)',
      cur.status === 'active' && cur.missionId === 1 && cur.stageIndex === 1,
      `status=${cur.status} stage=${cur.stageIndex} target=${JSON.stringify(cur.target)}`);
    check('m1-stage1: green target circle at North Market (-300,-300), r=10',
      !!cur.circles.target && dist(cur.circles.target.x, cur.circles.target.z, -300, -300) < 45
        && cur.circles.target.radius === 10,
      JSON.stringify(cur.circles.target));

    // ---- (b1) Screenshot the M1 destination circle from the player's view.
    const t1 = cur.circles.target;
    await shotFrom('02-target-circle-m1.png', t1.x, t1.z, 25, 0.38);

    // ---- (b2) Enter the destination circle -> stage completes -> mission 1 done.
    await teleport(t1.x, t1.z);
    await sleep(2500);
    const afterEnd1 = await snap();
    check('complete-m1: entering destination circle completes mission 1',
      afterEnd1.status === 'done' && afterEnd1.completed.includes(1) && afterEnd1.missionId === 2,
      `BEFORE status=${cur.status} stage=${cur.stageIndex} -> AFTER status=${afterEnd1.status} completed=${JSON.stringify(afterEnd1.completed)} missionId=${afterEnd1.missionId}`);
    check('complete-m1: M2 start circle now shown (West Docks)',
      !!afterEnd1.circles.start && afterEnd1.circles.start.missionId === 2
        && dist(afterEnd1.circles.start.x, afterEnd1.circles.start.z, -500, 200) < 45,
      JSON.stringify(afterEnd1.circles.start));

    // ---- (c1) No chain auto-start: standing at M1's end must NOT start M2.
    await sleep(2000);
    const idle2 = await snap();
    check('no-chain: M2 does not auto-start from North Market',
      idle2.status === 'done' && idle2.missionId === 2 && idle2.completed.length === 1,
      `status=${idle2.status} missionId=${idle2.missionId} completed=${JSON.stringify(idle2.completed)}`);

    // ---- (c2) M2 start circle screenshot + auto-start + complete, same flow.
    const s2 = idle2.circles.start;
    await shotFrom('03-start-circle-m2.png', s2.x, s2.z, 25, 0.38);
    await teleport(s2.x, s2.z);
    await sleep(2500);
    const afterStart2 = await snap();
    check('autostart-m2: mission 2 active without any button press',
      afterStart2.status === 'active' && afterStart2.missionId === 2,
      `BEFORE status=${idle2.status} -> AFTER status=${afterStart2.status} missionId=${afterStart2.missionId} stage=${afterStart2.stageIndex}`);
    let cur2 = afterStart2;
    for (let i = 0; i < 4 && cur2.status === 'active' && cur2.stageIndex === 0; i += 1) {
      const t = cur2.target;
      if (!t) break;
      await teleport(t.x, t.z);
      await sleep(2000);
      cur2 = await snap();
    }
    check('m2-stage1: Downtown drop leg active (stageIndex 1)',
      cur2.status === 'active' && cur2.missionId === 2 && cur2.stageIndex === 1,
      `status=${cur2.status} stage=${cur2.stageIndex} target=${JSON.stringify(cur2.target)}`);
    const t2 = cur2.circles.target;
    if (t2) await shotFrom('04-target-circle-m2.png', t2.x, t2.z, 25, 0.38);
    check('m2-stage1: green target circle at Downtown (300,-300), r=10',
      !!t2 && dist(t2.x, t2.z, 300, -300) < 45 && t2.radius === 10,
      JSON.stringify(t2));
    await teleport(t2.x, t2.z);
    await sleep(2500);
    const afterEnd2 = await snap();
    check('complete-m2: entering destination circle completes mission 2',
      afterEnd2.status === 'done' && afterEnd2.completed.includes(2) && afterEnd2.missionId === 3,
      `status=${afterEnd2.status} completed=${JSON.stringify(afterEnd2.completed)} missionId=${afterEnd2.missionId}`);

    // ---- (c3) Still no re-trigger after M2: one active mission max, no loop.
    await sleep(2000);
    const final = await snap();
    check('no-retrigger: still done/idle after M2, M3 circle up at Uptown',
      final.status === 'done' && final.missionId === 3 && final.completed.length === 2
        && !!final.circles.start && final.circles.start.missionId === 3,
      `status=${final.status} missionId=${final.missionId} completed=${JSON.stringify(final.completed)} start=${JSON.stringify(final.circles.start)}`);

    check('errors: 0 console/page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
    check('network: 0 external requests', extReqs.length === 0, extReqs.slice(0, 5).join(' | '));

    const passed = results.filter((r) => r.ok).length;
    const summary = { passed, failed: results.length - passed, checks: results, errors, extReqs };
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(`\n${passed}/${results.length} checks passed. Screenshots + summary in ${OUT}`);
    if (passed !== results.length) process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill();
  }
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
