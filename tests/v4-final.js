// Neon Vice — Tester Akhir v4 final harness (Playwright, SwiftShader).
// Usage: node tests/v4-final.js
// Covers v4 revisions not in tests/aim-v4.js: car pedals (touch GAS/REM,
// stick steers only; keyboard W/S), flyovers (drive over both, ground-level
// left/right turns under the deck), free 360 orbit camera (drag, pitch
// clamp, camera-relative movement, other controls unaffected), day cycle
// (Pagi/Siang/Sore/Malam phases + HUD clock), wanted 1-5, and regressions
// (New Game, save/load, map/backpack/settings, enter/exit vehicle).
// Writes phase screenshots to /tmp for visual inspection.
const { chromium } = require('/home/hatch/workspace/custom-skills/playwright_skill/node_modules/playwright');
const { spawn } = require('child_process');
const http = require('http');

const PORT = 8917;
const URL = `http://localhost:${PORT}/`;
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
  let loaded = false;
  for (let i = 0; i < 6 && !loaded; i += 1) {
    try { await page.goto(URL, { waitUntil: 'load', timeout: 15000 }); loaded = true; }
    catch (e) { await sleep(2000); }
  }
  if (!loaded) throw new Error('server unreachable after retries');
  await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
  return { page, ctx, errors, requests };
}

async function startGame(page) { await page.click('#btnNew'); await sleep(500); }
async function stats(page) { return page.evaluate(() => window.NEON_VICE.stats()); }
async function hero(page) { return page.evaluate(() => window.NEON_VICE.hero()); }

// Teleport next to the nearest parked car and press E until driving.
async function enterNearestCar(page) {
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
    if ((await stats(page)).driving) return true;
  }
  return false;
}

// Set the driven car's pose + speed directly (test hook via vehicles.list).
async function setCar(page, x, z, heading, speed) {
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

// Cap the driven car's speed (a player braking for a corner).
async function capSpeed(page, cap) {
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

async function carPos(page) {
  return page.evaluate(() => {
    const g = window.NEON_VICE.game;
    const p = g.player.group.position;
    let best = null; let bestD = Infinity;
    for (const v of g.vehicles.list) {
      const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best ? { x: best.mesh.position.x, y: best.mesh.position.y, z: best.mesh.position.z, heading: best.heading, speed: best.speed } : null;
  });
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
  const log = (name, ok, note) => { results.push({ name, ok, note: note || '' }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ' — ' + note : ''}`); };

  try {
    // ---------- Desktop 1280x800 ----------
    const d = await newPage(browser, { width: 1280, height: 800 }, false);
    const page = d.page;
    await startGame(page);
    await page.evaluate(() => window.NEON_VICE.debug.setStepBudget(24));
    await sleep(1500);

    // Counts: exactly 60 peds + 28 traffic (Builder C v4 spec).
    const cnt = await page.evaluate(() => ({
      peds: window.NEON_VICE.debug.checkPedestrians(),
      traffic: window.NEON_VICE.debug.checkTraffic(),
      missions: window.NEON_VICE.debug.listMissions().length,
    }));
    log('counts: 60 peds, 28 traffic, 12 missions',
      cnt.peds.count === 60 && cnt.traffic.traffic === 28 && cnt.missions === 12,
      `peds=${cnt.peds.count} traffic=${cnt.traffic.traffic} missions=${cnt.missions}`);

    // Day cycle: 4 phases, distinct clock + phase name, HUD clock readable.
    const phases = [];
    for (const [h, name] of [[8, 'pagi'], [13, 'siang'], [17, 'sore'], [22, 'malam']]) {
      await page.evaluate((hh) => window.NEON_VICE.debug.setHour(hh), h);
      await sleep(900);
      const s = await stats(page);
      const clock = await page.evaluate(() => document.getElementById('hudClock').textContent);
      phases.push({ h, phase: s.phase, clock });
      await page.screenshot({ path: `/tmp/v4-phase-${name}.png` });
    }
    const phaseNames = phases.map((p) => p.phase).join('/');
    log('day cycle: Pagi/Siang/Sore/Malam distinct + clock ticks',
      phases[0].phase === 'Pagi' && phases[1].phase === 'Siang' && phases[2].phase === 'Sore' && phases[3].phase === 'Malam'
      && phases.every((p) => p.clock.includes(String(p.h).padStart(2, '0'))),
      `${phaseNames} clocks=${phases.map((p) => p.clock).join(' | ')}`);

    // Wanted 1-5: stars set, police present at each level.
    const wantedSeen = [];
    for (let n = 1; n <= 5; n += 1) {
      await page.evaluate((nn) => window.NEON_VICE.debug.setWanted(nn), n);
      let got = false;
      for (let i = 0; i < 20; i += 1) {
        await sleep(1000);
        const s = await stats(page);
        if (s.wanted === n && s.police + s.policeCars > 0) { got = true; break; }
      }
      const s = await stats(page);
      wantedSeen.push(`${n}:${got ? `ok(police=${s.police},cars=${s.policeCars})` : `FAIL(wanted=${s.wanted},police=${s.police})`}`);
    }
    log('wanted 1-5: stars + police at each level',
      wantedSeen.every((w) => w.includes('ok')), wantedSeen.join(' '));
    await page.evaluate(() => { window.NEON_VICE.debug.setWanted(0); window.NEON_VICE.debug.clearPolice(); });
    await sleep(500);

    // Car pedals (keyboard): W gas, S brake then reverse, A/D steer.
    const entered = await enterNearestCar(page);
    log('regression: enter vehicle (E)', entered, '');
    if (entered) {
      await page.keyboard.down('KeyW');
      await sleep(4000);
      await page.keyboard.up('KeyW');
      let s = await stats(page);
      const gasSpeed = s.speedSigned;
      await page.keyboard.down('KeyS');
      await sleep(3000);
      await page.keyboard.up('KeyS');
      s = await stats(page);
      const afterBrake = s.speedSigned;
      await page.keyboard.down('KeyS');
      await sleep(4000);
      await page.keyboard.up('KeyS');
      s = await stats(page);
      const reverseSpeed = s.speedSigned;
      log('pedals keyboard: W gas, S brakes to 0, S reverses',
        gasSpeed > 5 && Math.abs(afterBrake) < 3 && reverseSpeed < -1,
        `gas=${gasSpeed} afterBrake=${afterBrake} reverse=${reverseSpeed}`);
      // Steering while moving: hold W + A, heading must change.
      const h0 = (await carPos(page)).heading;
      await page.keyboard.down('KeyW'); await page.keyboard.down('KeyA');
      await sleep(2500);
      await page.keyboard.up('KeyW'); await page.keyboard.up('KeyA');
      const h1 = (await carPos(page)).heading;
      let dh = h1 - h0;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      log('pedals keyboard: A steers while moving', Math.abs(dh) > 0.3, `dHeading=${dh.toFixed(2)} rad`);

      // Flyover 1 (x=60): teleport car south of it, head straight toward +z
      // (heading 0 = +z: the flyover sits at z=0, the car starts at z=-90).
      await setCar(page, 60, -90, 0, 0);
      const trace = [];
      await page.keyboard.down('KeyW');
      const t0 = Date.now();
      let crossed = false; let maxY = 0; let minY = 99;
      while (Date.now() - t0 < 90000) {
        const c = await carPos(page);
        if (!c) break;
        maxY = Math.max(maxY, c.y); minY = Math.min(minY, c.y);
        if (trace.length === 0 || Math.abs(c.z - trace[trace.length - 1].z) > 5) trace.push({ z: +c.z.toFixed(0), y: +c.y.toFixed(1) });
        if (c.z > 80) { crossed = true; break; }
        await sleep(400);
      }
      await page.keyboard.up('KeyW');
      const end = await carPos(page);
      log('flyover x=60: drive up, over deck, down safely',
        crossed && maxY >= 5.5 && end && Math.abs(end.y) < 0.6 && minY > -0.5 && (await stats(page)).driving,
        `maxY=${maxY.toFixed(1)} minY=${minY.toFixed(1)} endY=${end ? end.y.toFixed(1) : '?'} endZ=${end ? end.z.toFixed(0) : '?'} trace=${JSON.stringify(trace)}`);

      // Flyover 2 (x=300): same run (teleport to z=-90, drive to z>80).
      await setCar(page, 300, -90, 0, 0);
      await page.keyboard.down('KeyW');
      const t1 = Date.now();
      let crossed2 = false; let maxY2 = 0; let minY2 = 99;
      while (Date.now() - t1 < 90000) {
        const c = await carPos(page);
        if (!c) break;
        maxY2 = Math.max(maxY2, c.y); minY2 = Math.min(minY2, c.y);
        if (c.z > 80) { crossed2 = true; break; }
        await sleep(400);
      }
      await page.keyboard.up('KeyW');
      const end2 = await carPos(page);
      log('flyover x=300: drive up, over deck, down safely',
        crossed2 && maxY2 >= 5.5 && end2 && Math.abs(end2.y) < 0.6 && minY2 > -0.5 && (await stats(page)).driving,
        `maxY=${maxY2.toFixed(1)} minY=${minY2.toFixed(1)} endY=${end2 ? end2.y.toFixed(1) : '?'} endZ=${end2 ? end2.z.toFixed(0) : '?'}`);

      // Ground-level left turn under flyover x=60: westbound at the corner
      // at 8 m/s, turn + W with speed capped at 10 (a player braking for
      // the corner). The turn key is released once the heading is reached
      // — holding it forever just drives in circles. At 34 m/s flat-out
      // the car swings wide onto the ramp instead (probe 1: y=5.2); at
      // cornering speed it stays on the ground road (ramp corridor is
      // only |x-60| <= 5).
      await setCar(page, 85, 0, -Math.PI / 2, 8);
      await page.keyboard.down('KeyW');
      await page.keyboard.down('KeyA');
      let turnedL = false; let yOkL = true; let aHeld = true;
      const t2 = Date.now();
      while (Date.now() - t2 < 60000) {
        const c = await carPos(page);
        if (!c) break;
        if (Math.abs(c.y) > 0.6) yOkL = false;
        const hw = ((c.heading % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
        if (aHeld && Math.abs(hw) < 0.6) { await page.keyboard.up('KeyA'); aHeld = false; }
        else if (!aHeld && Math.abs(hw) > 0.6) { await page.keyboard.down('KeyA'); aHeld = true; }
        if (!aHeld && Math.abs(hw) < 0.6 && c.z > 15) { turnedL = true; break; }
        await capSpeed(page, 10);
        await sleep(250);
      }
      await page.keyboard.up('KeyW'); await page.keyboard.up('KeyA');
      const endL = await carPos(page);
      log('flyover ground: westbound left turn under deck stays at y=0',
        turnedL && yOkL && (await stats(page)).driving,
        `end=(${endL ? endL.x.toFixed(0) : '?'},${endL ? endL.z.toFixed(0) : '?'}) y=${endL ? endL.y.toFixed(1) : '?'} heading=${endL ? endL.heading.toFixed(2) : '?'}`);

      // Ground-level right turn under flyover x=60: eastbound at the
      // corner at 8 m/s, same method.
      await setCar(page, 35, 0, Math.PI / 2, 8);
      await page.keyboard.down('KeyW');
      await page.keyboard.down('KeyD');
      let turnedR = false; let yOkR = true; let dHeld = true;
      const t3 = Date.now();
      while (Date.now() - t3 < 60000) {
        const c = await carPos(page);
        if (!c) break;
        if (Math.abs(c.y) > 0.6) yOkR = false;
        const hw = ((c.heading % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
        if (dHeld && Math.abs(hw) < 0.6) { await page.keyboard.up('KeyD'); dHeld = false; }
        else if (!dHeld && Math.abs(hw) > 0.6) { await page.keyboard.down('KeyD'); dHeld = true; }
        if (!dHeld && Math.abs(hw) < 0.6 && c.z > 15) { turnedR = true; break; }
        await capSpeed(page, 10);
        await sleep(250);
      }
      await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD');
      const endR = await carPos(page);
      log('flyover ground: eastbound right turn under deck stays at y=0',
        turnedR && yOkR && (await stats(page)).driving,
        `end=(${endR ? endR.x.toFixed(0) : '?'},${endR ? endR.z.toFixed(0) : '?'}) y=${endR ? endR.y.toFixed(1) : '?'} heading=${endR ? endR.heading.toFixed(2) : '?'}`);

      // Exit vehicle (E) after the flyover runs.
      await page.keyboard.press('KeyE');
      await sleep(600);
      log('regression: exit vehicle (E)', !(await stats(page)).driving, '');
    }

    // Orbit camera (on foot): real mouse drag moves the target yaw; pitch
    // clamps to [0.12, 1.0] after hard vertical drags.
    const orb0 = await page.evaluate(() => window.NEON_VICE.debug.getCameraOrbit());
    await page.mouse.move(640, 400);
    await page.mouse.down();
    for (let i = 0; i < 10; i += 1) { await page.mouse.move(640 + i * 30, 400); await sleep(60); }
    await page.mouse.up();
    await sleep(800);
    const orb1 = await page.evaluate(() => window.NEON_VICE.debug.getCameraOrbit());
    let dyaw = orb1.yawTarget - orb0.yawTarget;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    log('orbit: horizontal drag moves camera yaw', Math.abs(dyaw) > 0.3, `dyaw=${dyaw.toFixed(2)} (was ${orb0.yawTarget.toFixed(2)} -> ${orb1.yawTarget.toFixed(2)})`);
    await page.mouse.move(640, 400);
    await page.mouse.down();
    for (let i = 0; i < 10; i += 1) { await page.mouse.move(640, 400 - i * 40); await sleep(60); }
    await page.mouse.up();
    await sleep(500);
    await page.mouse.move(640, 400);
    await page.mouse.down();
    for (let i = 0; i < 10; i += 1) { await page.mouse.move(640, 400 + i * 40); await sleep(60); }
    await page.mouse.up();
    await sleep(800);
    const orb2 = await page.evaluate(() => window.NEON_VICE.debug.getCameraOrbit());
    log('orbit: pitch stays clamped [0.12, 1.0] after hard vertical drags',
      orb2.pitch >= 0.12 && orb2.pitch <= 1.0 && orb2.pitchTarget >= 0.12 && orb2.pitchTarget <= 1.0,
      `pitch=${orb2.pitch.toFixed(2)} target=${orb2.pitchTarget.toFixed(2)}`);

    // Camera-relative movement: orbit 180 deg (camera on the other side),
    // then W must move Vera AWAY from the camera (opposite world dir).
    const hBefore = await hero(page);
    await page.evaluate(() => {
      const g = window.NEON_VICE.game;
      window.NEON_VICE.debug.setCameraOrbit(g.player.heading + Math.PI, 0.33);
    });
    await sleep(1200);
    const cam = await stats(page);
    await page.keyboard.down('KeyW');
    await sleep(5000);
    await page.keyboard.up('KeyW');
    const hAfter = await hero(page);
    const dx = hAfter.x - hBefore.x; const dz = hAfter.z - hBefore.z;
    const moved = Math.hypot(dx, dz);
    // Camera sits behind the player at camYaw: away-from-camera dir is
    // (sin camYaw, cos camYaw). After a 180 orbit from heading~0 that is -z.
    const awayX = Math.sin(cam.camYaw); const awayZ = Math.cos(cam.camYaw);
    const dot = moved > 0 ? (dx * awayX + dz * awayZ) / moved : 0;
    log('orbit: W moves away from camera after 180 deg orbit',
      moved > 3 && dot > 0.7, `moved=${moved.toFixed(1)}m dot=${dot.toFixed(2)} camYaw=${cam.camYaw.toFixed(2)}`);

    // Other controls still work after orbiting: map, backpack, settings.
    await page.keyboard.press('KeyM'); await sleep(500);
    const mapOpen = await page.evaluate(() => !document.getElementById('mapOverlay').classList.contains('hidden'));
    await page.keyboard.press('KeyM'); await sleep(400);
    await page.keyboard.press('KeyB'); await sleep(500);
    const packOpen = await page.evaluate(() => !document.getElementById('phonePanel').classList.contains('hidden'));
    await page.keyboard.press('KeyB'); await sleep(400);
    await page.keyboard.press('Escape'); await sleep(500);
    const setOpen = await page.evaluate(() => !document.getElementById('settingsPanel').classList.contains('hidden'));
    await page.keyboard.press('Escape'); await sleep(400);
    log('regression: map/backpack/settings open after orbit',
      mapOpen && packOpen && setOpen, `map=${mapOpen} pack=${packOpen} settings=${setOpen}`);

    // Save/load: set money, save, reload, Continue restores.
    await page.evaluate(() => { window.NEON_VICE.debug.setMoney(7777); window.NEON_VICE.game.save.save(); });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('neonvice-save-v1') || 'null'));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
    const contVisible = await page.evaluate(() => !document.getElementById('btnContinue').classList.contains('hidden'));
    if (contVisible) { await page.click('#btnContinue'); await sleep(600); }
    const sAfter = await stats(page);
    log('regression: save/load restores money',
      !!saved && saved.money === 7777 && contVisible && sAfter.money === 7777,
      `saved=${saved ? saved.money : 'none'} after=$${sAfter.money}`);

    // New Game from title: fresh state, mission 1 waiting.
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
    await page.click('#btnNew');
    await sleep(800);
    const sNew = await stats(page);
    log('regression: New Game starts playing, mission 1',
      (await page.evaluate(() => window.NEON_VICE.state())) === 'playing' && sNew.missionId === 1 && sNew.hp === 100,
      `state=playing missionId=${sNew.missionId} hp=${sNew.hp} money=$${sNew.money}`);
    log('desktop: no console errors / no external requests',
      d.errors.length === 0 && d.requests.length === 0,
      `errors=${d.errors.slice(0, 2).join(' | ')} ext=${d.requests.slice(0, 2).join(' | ')}`);
    await page.close();
    await d.ctx.close();

    // ---------- Phone 390x844 (touch) ----------
    const m = await newPage(browser, { width: 390, height: 844 }, true);
    const mp = m.page;
    await startGame(mp);
    await mp.evaluate(() => window.NEON_VICE.debug.setStepBudget(24));
    await sleep(1500);
    const mEntered = await enterNearestCar(mp);
    log('mobile: enter vehicle', mEntered, '');
    if (mEntered) {
      // Stick up alone must NOT move the car (steers only).
      await mp.evaluate(() => window.NEON_VICE.game.input.setStick(0, 1));
      await sleep(3000);
      await mp.evaluate(() => window.NEON_VICE.game.input.clearStick());
      let ms = await stats(mp);
      const stickUpSpeed = ms.speedSigned;
      // Stick left/right steers: hold GAS + stick right, heading changes.
      const mh0 = (await carPos(mp)).heading;
      await mp.evaluate(() => {
        const el = document.getElementById('btnGas');
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
        window.NEON_VICE.game.input.setStick(1, 0);
      });
      await sleep(4000);
      const mh1 = (await carPos(mp)).heading;
      ms = await stats(mp);
      const gasSpeed = ms.speedSigned;
      await mp.evaluate(() => {
        window.NEON_VICE.game.input.clearStick();
        const el = document.getElementById('btnGas');
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
      });
      let mdh = mh1 - mh0;
      while (mdh > Math.PI) mdh -= Math.PI * 2;
      while (mdh < -Math.PI) mdh += Math.PI * 2;
      log('mobile pedals: stick-up gives no gas, GAS accelerates, stick steers',
        Math.abs(stickUpSpeed) < 1 && gasSpeed > 5 && Math.abs(mdh) > 0.3,
        `stickUpSpeed=${stickUpSpeed} gasSpeed=${gasSpeed} dHeading=${mdh.toFixed(2)}`);
      // REM: brake to a full stop and hold at 0 (never reverses).
      await mp.evaluate(() => {
        const el = document.getElementById('btnBrake');
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
      });
      await sleep(3000);
      ms = await stats(mp);
      const remSpeed = ms.speedSigned;
      await sleep(2000);
      ms = await stats(mp);
      const remHold = ms.speedSigned;
      await mp.evaluate(() => {
        const el = document.getElementById('btnBrake');
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
      });
      log('mobile pedals: REM brakes to 0 and holds (no reverse)',
        Math.abs(remSpeed) < 0.5 && Math.abs(remHold) < 0.5 && remHold >= -0.01,
        `remSpeed=${remSpeed} remHold=${remHold}`);
      // Exit via debug hook (same path as E/EXIT).
      const exited = await mp.evaluate(() => window.NEON_VICE.debug.exitVehicle());
      log('mobile: exit vehicle', exited, '');
    }
    // Swipe orbit on touch: synthetic pointer events on the canvas.
    const morb0 = await mp.evaluate(() => window.NEON_VICE.debug.getCameraOrbit());
    await mp.evaluate(() => {
      const c = document.getElementById('game');
      const opts = (x, y) => ({ bubbles: true, pointerType: 'touch', clientX: x, clientY: y, button: 0 });
      c.dispatchEvent(new PointerEvent('pointerdown', opts(195, 422)));
      for (let i = 1; i <= 10; i += 1) c.dispatchEvent(new PointerEvent('pointermove', opts(195 + i * 20, 422)));
      c.dispatchEvent(new PointerEvent('pointerup', opts(395, 422)));
    });
    await sleep(800);
    const morb1 = await mp.evaluate(() => window.NEON_VICE.debug.getCameraOrbit());
    let mdyaw = morb1.yawTarget - morb0.yawTarget;
    while (mdyaw > Math.PI) mdyaw -= Math.PI * 2;
    while (mdyaw < -Math.PI) mdyaw += Math.PI * 2;
    log('mobile orbit: swipe moves camera yaw', Math.abs(mdyaw) > 0.3, `dyaw=${mdyaw.toFixed(2)}`);
    // Hard vertical swipe: pitch clamps.
    await mp.evaluate(() => {
      const c = document.getElementById('game');
      const opts = (x, y) => ({ bubbles: true, pointerType: 'touch', clientX: x, clientY: y, button: 0 });
      c.dispatchEvent(new PointerEvent('pointerdown', opts(195, 422)));
      for (let i = 1; i <= 10; i += 1) c.dispatchEvent(new PointerEvent('pointermove', opts(195, 422 - i * 30)));
      c.dispatchEvent(new PointerEvent('pointerup', opts(195, 122)));
      c.dispatchEvent(new PointerEvent('pointerdown', opts(195, 422)));
      for (let i = 1; i <= 10; i += 1) c.dispatchEvent(new PointerEvent('pointermove', opts(195, 422 + i * 30)));
      c.dispatchEvent(new PointerEvent('pointerup', opts(195, 722)));
    });
    await sleep(800);
    const morb2 = await mp.evaluate(() => window.NEON_VICE.debug.getCameraOrbit());
    log('mobile orbit: pitch stays clamped [0.12, 1.0]',
      morb2.pitch >= 0.12 && morb2.pitch <= 1.0,
      `pitch=${morb2.pitch.toFixed(2)} target=${morb2.pitchTarget.toFixed(2)}`);
    // Buttons still work after swipe: map opens (M key path), stick moves Vera.
    await mp.keyboard.press('KeyM'); await sleep(500);
    const mMap = await mp.evaluate(() => !document.getElementById('mapOverlay').classList.contains('hidden'));
    await mp.keyboard.press('KeyM'); await sleep(300);
    const mBefore = await hero(mp);
    await mp.evaluate(() => window.NEON_VICE.game.input.setStick(0, 1));
    await sleep(4000);
    await mp.evaluate(() => window.NEON_VICE.game.input.clearStick());
    const mAfter = await hero(mp);
    const mMoved = Math.hypot(mAfter.x - mBefore.x, mAfter.z - mBefore.z);
    log('mobile: map opens + stick moves Vera after swipe', mMap && mMoved > 2, `map=${mMap} moved=${mMoved.toFixed(1)}m`);
    log('mobile: no console errors / no external requests',
      m.errors.length === 0 && m.requests.length === 0,
      `errors=${m.errors.slice(0, 2).join(' | ')} ext=${m.requests.slice(0, 2).join(' | ')}`);
    await mp.close();
    await m.ctx.close();
  } finally {
    await browser.close();
    server.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED: ' + failed.map((r) => r.name).join(' | ')); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exit(1); });
