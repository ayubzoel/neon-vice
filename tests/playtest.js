// Neon Vice — Builder C playtest harness (Playwright, SwiftShader).
// Usage: node tests/playtest.js [scenario]
// Scenarios: smoke | missions | sidejobs | combat | shops | save | joystick | weather | full
const { chromium } = require('/home/hatch/workspace/custom-skills/playwright_skill/node_modules/playwright');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

const PORT = 8913;
const URL = `http://localhost:${PORT}/`;
const OUT = '/home/hatch/workspace/makefun/neon-vice-entry/screenshots';
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
  const ctx = await browser.newContext({
    // Small viewport: SwiftShader is software rendering, so a small canvas
    // keeps the game-time ratio usable for real-time playtests.
    viewport: viewport || { width: 640, height: 400 },
    hasTouch: !!touch,
    isMobile: !!touch,
  });
  const page = await ctx.newPage();
  const errors = [];
  const requests = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('request', (r) => { if (!r.url().startsWith(URL)) requests.push(r.url()); });
  // The dev server restarts occasionally; retry the load a few times.
  let loaded = false;
  for (let i = 0; i < 6 && !loaded; i += 1) {
    try {
      await page.goto(URL, { waitUntil: 'load', timeout: 15000 });
      loaded = true;
    } catch (e) {
      await sleep(2000);
    }
  }
  if (!loaded) throw new Error('server unreachable after retries');
  await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
  return { page, ctx, errors, requests };
}

async function startGame(page) {
  await page.click('#btnNew');
  await sleep(500);
}

async function stats(page) { return page.evaluate(() => window.NEON_VICE.stats()); }
async function dbg(page, expr) { return page.evaluate(expr); }
async function hero(page) { return page.evaluate(() => window.NEON_VICE.hero()); }

async function waitFor(page, fn, timeout = 30000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn)) return true;
    await sleep(300);
  }
  console.log('  TIMEOUT waiting for: ' + label);
  return false;
}

// Drive on foot toward a target using keyboard heading control.
// Simple controller: compute desired heading, turn with A/D, hold W.
async function walkTo(page, x, z, timeout = 60000) {
  const t0 = Date.now();
  let lastDist = Infinity;
  let stuck = 0;
  while (Date.now() - t0 < timeout) {
    const h = await hero(page);
    const dx = x - h.x, dz = z - h.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 9) { await page.keyboard.up('KeyW'); await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); return true; }
    if (Math.abs(dist - lastDist) < 0.2) stuck += 1; else stuck = 0;
    lastDist = dist;
    if (stuck > 40) { // turn around a bit / back up
      await page.keyboard.down('KeyS'); await sleep(400); await page.keyboard.up('KeyS'); stuck = 0;
    }
    const desired = Math.atan2(dx, dz);
    let diff = desired - h.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    await page.keyboard.down('KeyW');
    if (diff > 0.15) { await page.keyboard.down('KeyA'); await page.keyboard.up('KeyD'); }
    else if (diff < -0.15) { await page.keyboard.down('KeyD'); await page.keyboard.up('KeyA'); }
    else { await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); }
    await sleep(120);
  }
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD');
  return false;
}

// Drive the current vehicle toward a target (W + A/D steering).
async function driveTo(page, x, z, timeout = 90000) {
  const t0 = Date.now();
  let lastDist = Infinity;
  let stuck = 0;
  while (Date.now() - t0 < timeout) {
    const s = await stats(page);
    if (!s.driving) return false;
    const h = await hero(page);
    const dx = x - h.x, dz = z - h.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 12) { await page.keyboard.up('KeyW'); await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); return true; }
    if (Math.abs(dist - lastDist) < 0.2) stuck += 1; else stuck = 0;
    lastDist = dist;
    if (stuck > 60) { await page.keyboard.down('KeyS'); await sleep(800); await page.keyboard.up('KeyS'); stuck = 0; }
    const desired = Math.atan2(dx, dz);
    let diff = desired - h.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    await page.keyboard.down('KeyW');
    // Steering: heading decreases (D) turns right; if target is to the right (diff<0) press D.
    if (diff > 0.12) { await page.keyboard.down('KeyA'); await page.keyboard.up('KeyD'); }
    else if (diff < -0.12) { await page.keyboard.down('KeyD'); await page.keyboard.up('KeyA'); }
    else { await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); }
    await sleep(120);
  }
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD');
  return false;
}

// Teleport to 35 m from a target, then walk the last leg. The commute is
// not what a mission test measures; the trigger/completion logic is.
async function walkToNear(page, x, z, timeout = 60000) {
  const h = await hero(page);
  const dx = x - h.x, dz = z - h.z;
  const d = Math.hypot(dx, dz);
  if (d > 45) {
    const nx = x - (dx / d) * 35;
    const nz = z - (dz / d) * 35;
    await dbg(page, `window.NEON_VICE.debug.teleport(${nx.toFixed(1)}, ${nz.toFixed(1)})`);
    await sleep(300);
  }
  return walkTo(page, x, z, timeout);
}

// Wait until the current mission stage advances / mission ends.
async function waitForAdvance(page, timeout = 60000) {
  const before = await page.evaluate(() => {
    const g = window.NEON_VICE.game;
    return JSON.stringify({ m: g.missions.status, id: g.missions.currentDef() && g.missions.currentDef().id, s: g.missions.stageIndex, o: document.getElementById('hudObjective').textContent });
  });
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const now = await page.evaluate(() => {
      const g = window.NEON_VICE.game;
      return JSON.stringify({ m: g.missions.status, id: g.missions.currentDef() && g.missions.currentDef().id, s: g.missions.stageIndex, o: document.getElementById('hudObjective').textContent });
    });
    if (now !== before) return true;
    await sleep(400);
  }
  return false;
}

async function pressKey(page, code, ms = 80) {
  await page.keyboard.press(code);
  await sleep(ms);
}

async function main() {
  const scenario = process.argv[2] || 'smoke';
  // Own dev server as a child of this process (exec-started servers die
  // with their shell session, so the harness brings its own).
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], {
    cwd: '/home/hatch/workspace/makefun/neon-vice-entry',
    stdio: 'ignore',
  });
  await waitForServer(PORT);
  const browser = await chromium.launch({
    executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const results = [];
  const log = (name, ok, note) => { results.push({ name, ok, note: note || '' }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ' — ' + note : ''}`); };

  try {
    if (scenario === 'smoke' || scenario === 'full') {
      const { page, errors, requests } = await newPage(browser);
      await startGame(page);
      await sleep(3000);
      const s = await stats(page);
      log('boot: ready + playing', s.fps > 0, `fps=${s.fps} hour=${s.hour.toFixed(2)} money=$${s.money}`);
      // Walk forward 10s real; at SwiftShader ratio ~0.3 that is ~3s game.
      const h0 = await hero(page);
      await page.keyboard.down('KeyW');
      await sleep(10000);
      await page.keyboard.up('KeyW');
      const h1 = await hero(page);
      const moved = Math.hypot(h1.x - h0.x, h1.z - h0.z);
      log('walk forward moves', moved > 8, `moved ${moved.toFixed(1)}m in 10s real`);
      // Time ratio measured against WALL CLOCK (not the clamped accumulator).
      const g0 = await stats(page).then((x) => x.gameTime);
      const w0 = Date.now();
      await sleep(10000);
      const g1 = await stats(page).then((x) => x.gameTime);
      const ratio = (g1 - g0) / ((Date.now() - w0) / 1000);
      log('game-time ratio (wall clock)', ratio > 0.2, `ratio=${ratio.toFixed(2)} fps=${(await stats(page)).fps}`);
      log('console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
      log('external requests', requests.length === 0, requests.slice(0, 3).join(' | '));
      await page.close();
    }

    if (scenario === 'shots' || scenario === 'full') {
      // The 4 dossier screenshots at 1280x800, JPEG (gate: max 4, ≤256 KiB each).
      const { page, errors } = await newPage(browser, { width: 1280, height: 800 });
      await sleep(1500);
      await page.screenshot({ path: OUT + '/1-start.jpg', type: 'jpeg', quality: 75 });
      await startGame(page);
      await page.keyboard.down('KeyW');
      await sleep(4000);
      await page.keyboard.up('KeyW');
      await page.screenshot({ path: OUT + '/2-play.jpg', type: 'jpeg', quality: 75 });
      await page.evaluate(() => {
        window.NEON_VICE.debug.setWanted(2);
        const g = window.NEON_VICE.game;
        const p = g.player.group.position;
        g.combat.spawnPolice(p.x + 12, p.z + 8);
        g.combat.spawnPolice(p.x - 10, p.z + 14);
      });
      await sleep(1500);
      await page.screenshot({ path: OUT + '/3-chase.jpg', type: 'jpeg', quality: 75 });
      await page.keyboard.press('KeyM');
      await sleep(800);
      await page.screenshot({ path: OUT + '/4-map.jpg', type: 'jpeg', quality: 75 });
      const sizes = fs.readdirSync(OUT).filter((f) => /\.jpe?g$/i.test(f)).map((f) => `${f}:${(fs.statSync(OUT + '/' + f).size / 1024).toFixed(0)}KiB`);
      log('screenshots 4x JPEG ≤256KiB', sizes.length === 4 && sizes.every((s) => parseInt(s.split(':')[1], 10) <= 256), sizes.join(' '));
      log('shots console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
      await page.close();
    }

    if (scenario === 'missions' || scenario === 'full') {
      const { page, errors } = await newPage(browser);
      await startGame(page);
      await page.evaluate(() => window.NEON_VICE.debug.setMoney(50000));
      const P = { ricosBar: [150, 100], northMarket: [-300, -300], westDocks: [-500, 200], downtown: [300, -300], uptown: [-400, -350], southBeach: [100, 400], airport: [-100, -400], warehouse: [-450, -100], eastMarina: [500, 150], safehouse: [-400, -330], impound: [350, 250], bank: [300, -280], yacht: [520, 0] };
      const missionTargets = {
        1: [[150, 100], [-300, -300]],
        2: [[-500, 200], [300, -300]],
        3: [[-400, -350], [100, 400], [-100, -400]],
        4: null, // vehicle: enter + drive
        5: [[0, 0], [300, -300], [-300, -300], [0, 300]],
        6: null, // combat
        7: null, // combat
        8: null, // boat
        9: [[-100, -400], [-400, -330]],
        10: null, // combat + vehicle
        11: [[300, -280], [-500, 200]],
        12: null, // combat + hold
      };
      for (let n = 1; n <= 12; n += 1) {
        const before = await stats(page);
        await page.evaluate((n) => window.NEON_VICE.debug.startMission(n), n);
        await sleep(400);
        let ok = false;
        let note = '';
        try {
          if (n === 4 || n === 10) {
            // enter vehicle: walk to the mission car, press E, drive to target
            const spot = n === 4 ? P.warehouse : P.impound;
            await walkToNear(page, spot[0] + 4, spot[1] + 4);
            await pressKey(page, 'KeyE');
            await sleep(500);
            const s1 = await stats(page);
            if (s1.driving) {
              const tgt = n === 4 ? P.eastMarina : P.ricosBar;
              ok = await driveTo(page, tgt[0], tgt[1], 150000);
              note = ok ? 'drove to destination' : 'drive failed';
              if (ok) { await pressKey(page, 'KeyE'); await sleep(300); }
            } else { note = 'could not enter vehicle'; }
          } else if (n === 5) {
            // race in the plaza car, teleporting near each checkpoint
            await walkToNear(page, 12, 12);
            await pressKey(page, 'KeyE');
            await sleep(400);
            const s1 = await stats(page);
            if (!s1.driving) { note = 'could not enter car for race'; }
            else {
              ok = true;
              for (const cp of missionTargets[5]) {
                await dbg(page, `window.NEON_VICE.debug.teleport(${(cp[0] - 30).toFixed(1)}, ${(cp[1] - 30).toFixed(1)})`);
                await sleep(300);
                const r = await driveTo(page, cp[0], cp[1], 60000);
                if (!r) { note = `checkpoint ${cp} missed`; ok = false; break; }
              }
              if (ok) ok = await waitFor(page, () => window.NEON_VICE.stats().missionId !== 5 || window.NEON_VICE.stats().mission === 'done', 8000, 'race complete');
              note = note || 'checkpoints done';
            }
          } else if (n === 6 || n === 7 || n === 12) {
            // combat: unholster, kite to enemies, aim via debug heading, shoot.
            const spot = n === 6 ? P.southBeach : n === 7 ? P.warehouse : P.yacht;
            await walkToNear(page, spot[0] + 20, spot[1] + 20);
            await pressKey(page, 'KeyH');
            await sleep(200);
            const t0 = Date.now();
            let done = false;
            while (Date.now() - t0 < 120000) {
              const st = await stats(page);
              if (st.missionId !== n || st.mission === 'done') { done = true; break; }
              // Kite: if HP is low, back off 40 m from the nearest enemy.
              if (st.hp < 40) {
                await page.evaluate(() => {
                  const g = window.NEON_VICE.game;
                  const p = g.player.group.position;
                  const list = [...g.combat.enemies, ...g.combat.police].filter((e) => !e.dead);
                  if (!list.length) return;
                  const e = list[0];
                  const dx = p.x - e.mesh.position.x, dz = p.z - e.mesh.position.z;
                  const d = Math.hypot(dx, dz) || 1;
                  window.NEON_VICE.debug.teleport(p.x + (dx / d) * 40, p.z + (dz / d) * 40);
                  window.NEON_VICE.debug.setHp(100);
                });
                await sleep(300);
                continue;
              }
              const aimed = await page.evaluate(() => {
                const g = window.NEON_VICE.game;
                const p = g.player.group.position;
                const list = [...g.combat.enemies, ...g.combat.police].filter((e) => !e.dead);
                if (!list.length) return false;
                list.sort((a, b) => {
                  const da = Math.hypot(a.mesh.position.x - p.x, a.mesh.position.z - p.z);
                  const db = Math.hypot(b.mesh.position.x - p.x, b.mesh.position.z - p.z);
                  return da - db;
                });
                const e = list[0];
                g.player.heading = Math.atan2(e.mesh.position.x - p.x, e.mesh.position.z - p.z);
                return true;
              });
              if (aimed) {
                await page.mouse.click(320, 200);
                await sleep(250);
              } else {
                // No enemies left — walk to the next stage target.
                const tgt = await page.evaluate(() => {
                  const t = window.NEON_VICE.game.missions.stageTarget();
                  return t ? [t.x, t.z] : null;
                });
                if (tgt) {
                  await walkToNear(page, tgt[0], tgt[1], 30000);
                  await waitForAdvance(page, 40000);
                } else await sleep(500);
              }
            }
            ok = done;
            note = done ? 'combat stages cleared' : 'timed out in combat';
            if (n === 12 && done) {
              const w1 = await walkToNear(page, P.yacht[0] - 10, P.yacht[1], 30000);
              await waitForAdvance(page, 40000);
              const w2 = await walkToNear(page, P.ricosBar[0], P.ricosBar[1], 60000);
              ok = w1 && w2 && await waitFor(page, () => window.NEON_VICE.stats().mission === 'done' || window.NEON_VICE.stats().debtPaid !== undefined && window.NEON_VICE.game.missions.debtPaid, 10000, 'debt paid');
              note = `hold ${w1}, deliver ${w2}`;
            }
          } else if (n === 8) {
            await walkToNear(page, P.eastMarina[0] + 4, P.eastMarina[1] + 4);
            await pressKey(page, 'KeyE');
            await sleep(500);
            const s1 = await stats(page);
            if (s1.driving) {
              ok = await driveTo(page, 540, -380, 180000);
              note = ok ? 'sailed to north bay' : 'boat drive failed';
            } else note = 'could not board boat';
          } else {
            for (const tgt of missionTargets[n]) {
              const r = await walkToNear(page, tgt[0], tgt[1], 60000);
              if (!r) { note = `target ${tgt} not reached`; break; }
              // Hold/evade stages need game time inside the radius.
              await waitForAdvance(page, n === 9 ? 150000 : 45000);
            }
            // Mission 9 evade: wait for the full evade to finish.
            if (n === 9) { await waitFor(page, () => window.NEON_VICE.stats().mission === 'done' || window.NEON_VICE.stats().missionId !== 9, 120000, 'evade done'); }
            ok = await waitFor(page, () => window.NEON_VICE.stats().mission === 'done' || window.NEON_VICE.stats().missionId !== n, 8000, 'mission ' + n + ' complete');
            note = note || 'targets reached';
          }
          if (!ok) {
            const st = await stats(page);
            const obj = await page.evaluate(() => document.getElementById('hudObjective').textContent);
            note += ` | state=${st.mission} missionId=${st.missionId} obj="${obj}"`;
          }
        } catch (e) {
          note = 'EXCEPTION: ' + e.message;
        }
        const after = await stats(page);
        log(`mission ${n} completes`, ok, `${note} | money $${before.money} → $${after.money}`);
      }
      log('mission console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
      await page.close();
    }

    if (scenario === 'sidejobs' || scenario === 'full') {
      const { page, errors } = await newPage(browser);
      await startGame(page);
      // Taxi: start job, walk to pickup then dropoff.
      await page.evaluate(() => window.NEON_VICE.debug.startSideJob('taxi'));
      let ok = await walkToNear(page, -500, 200, 60000);
      ok = ok && await walkToNear(page, 300, -300, 60000);
      log('side job taxi', ok, '');
      await page.evaluate(() => window.NEON_VICE.debug.startSideJob('package'));
      ok = await walkToNear(page, 100, 400, 60000);
      log('side job package', ok, '');
      await page.evaluate(() => window.NEON_VICE.debug.startSideJob('race'));
      // race in the plaza car
      await walkToNear(page, 12, 12);
      await pressKey(page, 'KeyE');
      await sleep(400);
      ok = true;
      for (const cp of [[200, 150], [-200, -150], [0, 0]]) {
        await dbg(page, `window.NEON_VICE.debug.teleport(${(cp[0] - 30).toFixed(1)}, ${(cp[1] - 30).toFixed(1)})`);
        await sleep(300);
        ok = ok && await driveTo(page, cp[0], cp[1], 60000);
      }
      log('side job street race (car)', ok, '');
      log('sidejob console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
      await page.close();
    }

    if (scenario === 'combat' || scenario === 'full') {
      const { page, errors } = await newPage(browser);
      await startGame(page);
      await page.evaluate(() => window.NEON_VICE.debug.setMoney(5000));
      // Holster toggle + screenshots of both states.
      await pressKey(page, 'KeyH');
      await sleep(300);
      const armed = await page.evaluate(() => !window.NEON_VICE.game.combat.holstered);
      await pressKey(page, 'KeyH');
      await sleep(300);
      const holstered = await page.evaluate(() => window.NEON_VICE.game.combat.holstered);
      log('combat holster toggle', armed && holstered, `armed=${armed} holstered=${holstered}`);
      // Shoot: spawn enemy in front, aim, fire until dead.
      await page.evaluate(() => {
        const g = window.NEON_VICE.game;
        const p = g.player.group.position;
        g.combat.spawnEnemy(p.x + Math.sin(g.player.heading) * 15, p.z + Math.cos(g.player.heading) * 15);
      });
      await pressKey(page, 'KeyH');
      for (let i = 0; i < 20; i += 1) {
        await page.mouse.click(320, 200);
        await sleep(250);
        const dead = await page.evaluate(() => window.NEON_VICE.game.combat.enemies.every((e) => e.dead));
        if (dead) break;
      }
      const dead = await page.evaluate(() => window.NEON_VICE.game.combat.enemies.every((e) => e.dead));
      const wanted = await stats(page).then((s) => s.wanted);
      log('combat shoot kills enemy', dead, `wanted=${wanted}`);
      // Wanted decay: wait for stars to drop (25s per star, max 3 -> up to 75s).
      const decayed = await waitFor(page, () => window.NEON_VICE.stats().wanted === 0, 90000, 'wanted decay');
      log('wanted decays to 0', decayed, '');
      log('combat console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
      await page.close();
    }

    if (scenario === 'shops' || scenario === 'full') {
      const { page, errors } = await newPage(browser);
      await startGame(page);
      await page.evaluate(() => window.NEON_VICE.debug.setMoney(5000));
      // Gun shop at (-200,-200).
      await walkToNear(page, -200, -188, 60000);
      await pressKey(page, 'KeyE');
      await sleep(500);
      const shopOpen = await page.evaluate(() => !document.getElementById('shopPanel').classList.contains('hidden'));
      let bought = false;
      if (shopOpen) {
        const btns = await page.$$('#shopItems .btn');
        if (btns.length) { await btns[0].click(); await sleep(400); }
        bought = await page.evaluate(() => window.NEON_VICE.game.combat.weapons.smg.owned);
        const m = await stats(page);
        log('shop buy SMG', bought, `money now $${m.money}`);
        await page.click('#btnCloseShop');
        await sleep(300);
      } else log('shop opens', false, 'panel did not open');
      // Clothing shop at (200,-100): buy pink jacket.
      await walkToNear(page, 200, -88, 60000);
      await pressKey(page, 'KeyE');
      await sleep(500);
      const clothOpen = await page.evaluate(() => !document.getElementById('shopPanel').classList.contains('hidden'));
      if (clothOpen) {
        const btns = await page.$$('#shopItems .btn');
        if (btns.length > 1) { await btns[1].click(); await sleep(400); }
        const color = await page.evaluate(() => window.NEON_VICE.game.player.jacketColor);
        log('shop buy jacket', color === 0xec4899, `color=0x${color.toString(16)}`);
        await page.click('#btnCloseShop');
      } else log('clothing shop opens', false, 'panel did not open');
      log('shop console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
      await page.close();
    }

    if (scenario === 'save' || scenario === 'full') {
      const { page, errors } = await newPage(browser);
      await startGame(page);
      await page.evaluate(() => window.NEON_VICE.debug.setMoney(7777));
      await walkTo(page, 100, 100, 30000);
      await page.evaluate(() => window.NEON_VICE.game.save.save());
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('neonvice-save-v1') || 'null'));
      log('save writes localStorage', !!saved && saved.money === 7777, saved ? `money=${saved.money} x=${saved.x}` : 'no save');
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
      const contVisible = await page.evaluate(() => !document.getElementById('btnContinue').classList.contains('hidden'));
      await page.click('#btnContinue');
      await sleep(600);
      const s = await stats(page);
      const h = await hero(page);
      log('save/load Continue restores', contVisible && s.money === 7777 && Math.hypot(h.x - 100, h.z - 100) < 15, `money=$${s.money} pos=(${h.x.toFixed(0)},${h.z.toFixed(0)})`);
      log('save console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
      await page.close();
    }

    if (scenario === 'joystick' || scenario === 'full') {
      // Touch joystick direction test on mobile viewport.
      const { page, errors } = await newPage(browser, { width: 390, height: 844 }, true);
      await startGame(page);
      await sleep(500);
      const touchOn = await page.evaluate(() => document.getElementById('touch').classList.contains('on'));
      log('touch layer shows on mobile', touchOn, '');
      // Camera-relative check: record camera forward, push stick right, verify
      // Vera moves toward screen-right (camera right vector).
      const before = await page.evaluate(() => {
        const g = window.NEON_VICE.game;
        return { x: g.player.group.position.x, z: g.player.group.position.z, heading: g.player.heading };
      });
      await page.evaluate(() => window.NEON_VICE.game.input.setStick(1, 0)); // full right
      await sleep(6000);
      await page.evaluate(() => window.NEON_VICE.game.input.clearStick());
      const after = await page.evaluate(() => {
        const g = window.NEON_VICE.game;
        return { x: g.player.group.position.x, z: g.player.group.position.z };
      });
      const dx = after.x - before.x, dz = after.z - before.z;
      // Screen-right at heading ~0 (camera behind, looking +Z): world -X.
      const movedRight = -dx; // + means moved toward screen-right (-X)
      const movedMag = Math.hypot(dx, dz);
      log('joystick right = screen-right', movedMag > 2 && movedRight > movedMag * 0.7, `delta=(${dx.toFixed(1)}, ${dz.toFixed(1)}) mag=${movedMag.toFixed(1)}`);
      // Stick up = away from camera (forward on screen, +Z at heading 0).
      const b2 = await hero(page);
      await page.evaluate(() => window.NEON_VICE.game.input.setStick(0, 1));
      await sleep(6000);
      await page.evaluate(() => window.NEON_VICE.game.input.clearStick());
      const a2 = await hero(page);
      const dz2 = a2.z - b2.z;
      log('joystick up = forward on screen', dz2 > 2, `dz=${dz2.toFixed(1)}`);
      // Map on mobile.
      await page.keyboard.press('KeyM');
      await sleep(500);
      const mapOpen = await page.evaluate(() => !document.getElementById('mapOverlay').classList.contains('hidden'));
      log('map opens on mobile', mapOpen, '');
      log('joystick console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
      await page.close();
    }

    if (scenario === 'weather' || scenario === 'full') {
      const { page, errors } = await newPage(browser);
      await startGame(page);
      await page.evaluate(() => window.NEON_VICE.debug.setHour(12));
      await sleep(1500);
      const dayBg = await page.evaluate(() => window.NEON_VICE.game.weather.clockText());
      const dayShot = await page.screenshot({ path: '/tmp/neonvice-day.png' });
      await page.evaluate(() => window.NEON_VICE.debug.setRain(true));
      await sleep(2000);
      const raining = await page.evaluate(() => window.NEON_VICE.game.weather.raining);
      log('weather day + rain toggle', dayBg === '12:00' && raining, `clock=${dayBg} raining=${raining}`);
      await page.evaluate(() => window.NEON_VICE.debug.setHour(21));
      await sleep(1000);
      const nightBg = await page.evaluate(() => window.NEON_VICE.game.weather.isNight());
      log('weather night', nightBg, '');
      log('weather console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
      await page.close();
    }
  } catch (e) {
    console.log('HARNESS ERROR: ' + e.message);
  } finally {
    await browser.close();
    server.kill();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n== ${results.length - failed}/${results.length} passed ==`);
  process.exit(failed ? 1 : 0);
}

main();
