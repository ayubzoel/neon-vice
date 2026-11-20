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
async function walkTo(page, x, z, timeout = 60000, radius = 9) {
  const t0 = Date.now();
  let checkTime = Date.now();
  let checkDist = Infinity;
  while (Date.now() - t0 < timeout) {
    const h = await hero(page);
    const dx = x - h.x, dz = z - h.z;
    const dist = Math.hypot(dx, dz);
    if (dist < radius) { await page.keyboard.up('KeyW'); await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); return true; }
    // Stuck check on a WALL-CLOCK window: at ~3 FPS the same frame is
    // sampled twice, so a per-sample counter fires spuriously.
    if (Date.now() - checkTime > 2000) {
      if (dist > checkDist - 1) {
        await page.keyboard.down('KeyS'); await sleep(400); await page.keyboard.up('KeyS');
      }
      checkDist = dist;
      checkTime = Date.now();
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
// On land the route follows the road graph (straight lines cross buildings);
// on water (opts.direct) it steers straight at the target.
async function driveTo(page, x, z, timeout = 90000, opts = {}) {
  const legs = [];
  if (!opts.direct) {
    const path = await page.evaluate(([tx, tz]) => {
      const g = window.NEON_VICE.game;
      const rg = g.world && g.world.roadGraph;
      if (!rg || !rg.findPath) return null;
      const h = g.player.group.position;
      try {
        return rg.findPath({ x: h.x, z: h.z }, { x: tx, z: tz });
      } catch {
        return null;
      }
    }, [x, z]);
    if (path && path.length > 1) {
      for (const p of path) legs.push([p.x, p.z]);
    }
  }
  legs.push([x, z]);
  const t0 = Date.now();
  for (let i = 0; i < legs.length; i += 1) {
    const [lx, lz] = legs[i];
    // Intermediate nodes are waypoints: pass within 25 m at speed. Only the
    // final target gets the slow approach (accept 8 m, tighter than the
    // 10 m mission radius) — braking at every node made a 4-checkpoint race
    // take ~290 game-seconds, over its 150 s limit.
    const legOk = await driveLeg(page, lx, lz, Math.max(20000, timeout - (Date.now() - t0)), i === legs.length - 1);
    if (!legOk) return false;
    if (Date.now() - t0 > timeout) return false;
  }
  return true;
}

async function driveLeg(page, x, z, timeout = 90000, final = false) {
  const accept = final ? 8 : 25;
  const t0 = Date.now();
  let checkTime = Date.now();
  let checkDist = Infinity;
  while (Date.now() - t0 < timeout) {
    const s = await stats(page);
    if (!s.driving) return false;
    const h = await hero(page);
    const dx = x - h.x, dz = z - h.z;
    const dist = Math.hypot(dx, dz);
    if (dist < accept) { await page.keyboard.up('KeyW'); await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); return true; }
    if (Date.now() - t0 > timeout - 1000) {
      const diag = await page.evaluate(() => {
        const g = window.NEON_VICE.game;
        const p = g.player.group.position;
        return `pos=(${p.x.toFixed(0)},${p.z.toFixed(0)}) heading=${g.player.heading.toFixed(2)}`;
      });
      console.log(`  driveLeg TIMEOUT target=(${x},${z}) final=${final} ${diag}`);
    }
    // Stuck check on a WALL-CLOCK window (see walkTo).
    if (Date.now() - checkTime > 2000) {
      if (dist > checkDist - 2) {
        await page.keyboard.down('KeyS'); await sleep(800); await page.keyboard.up('KeyS');
      }
      checkDist = dist;
      checkTime = Date.now();
    }
    const desired = Math.atan2(dx, dz);
    let diff = desired - h.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    // Approach control (final leg only): a car at 30 m/s jumps 12 m per
    // frame and overshoots a small acceptance radius forever. Brake early,
    // creep under 4 m/s, sample every 60 ms so the crossing is not missed.
    if (!final || dist > 45) {
      await page.keyboard.down('KeyW'); await page.keyboard.up('KeyS');
    } else if (s.speed > 10) {
      await page.keyboard.up('KeyW'); await page.keyboard.down('KeyS');
    } else if (s.speed < 4) {
      await page.keyboard.down('KeyW'); await page.keyboard.up('KeyS');
    } else {
      await page.keyboard.up('KeyW'); await page.keyboard.up('KeyS');
    }
    // Steering: heading decreases (D) turns right; if target is to the right (diff<0) press D.
    if (diff > 0.12) { await page.keyboard.down('KeyA'); await page.keyboard.up('KeyD'); }
    else if (diff < -0.12) { await page.keyboard.down('KeyD'); await page.keyboard.up('KeyA'); }
    else { await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); }
    await sleep(60);
  }
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD');
  return false;
}

// Teleport to 35 m from a target, then walk the last leg. The commute is
// not what a mission test measures; the trigger/completion logic is.
async function walkToNear(page, x, z, timeout = 60000, radius = 9) {
  const h = await hero(page);
  const dx = x - h.x, dz = z - h.z;
  const d = Math.hypot(dx, dz);
  if (d > 45) {
    const nx = x - (dx / d) * 35;
    const nz = z - (dz / d) * 35;
    await dbg(page, `window.NEON_VICE.debug.teleport(${nx.toFixed(1)}, ${nz.toFixed(1)})`);
    await sleep(300);
  }
  return walkTo(page, x, z, timeout, radius);
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
      const fromN = parseInt(process.argv[3] || '1', 10);
      const toN = parseInt(process.argv[4] || '12', 10);
      const { page, errors } = await newPage(browser);
      await startGame(page);
      // Fast-forward hook for playtests only: 24 substeps/frame so game
      // time runs ~1.3x real time under SwiftShader (shipped default is 8).
      await page.evaluate(() => window.NEON_VICE.debug.setStepBudget(24));
      await page.evaluate(() => window.NEON_VICE.debug.setMoney(50000));
      const P = { ricosBar: [150, 100], northMarket: [-300, -300], westDocks: [-500, 200], downtown: [300, -300], uptown: [-400, -350], southBeach: [100, 400], airport: [-100, -400], warehouse: [-450, -100], eastMarina: [440, 150], safehouse: [-400, -330], impound: [350, 250], bank: [300, -280], yacht: [440, 0] };

      // Target-driven runner: follow the game's live stage target until the
      // mission completes or leaves this mission id.
      async function playGoto(n, maxMs) {
        const t0 = Date.now();
        while (Date.now() - t0 < maxMs) {
          const st = await stats(page);
          if (st.missionId !== n || st.mission === 'done') return true;
          const tgt = await page.evaluate(() => {
            const t = window.NEON_VICE.game.missions.stageTarget();
            return t ? [t.x, t.z] : null;
          });
          if (!tgt) { await sleep(500); continue; }
          await walkToNear(page, tgt[0], tgt[1], 45000);
          await waitForAdvance(page, 45000);
        }
        return false;
      }

      for (let n = fromN; n <= toN; n += 1) {
        const before = await stats(page);
        await page.evaluate((n) => window.NEON_VICE.debug.startMission(n), n);
        await sleep(400);
        let ok = false;
        let note = '';
        try {
          if (n === 4 || n === 10) {
            // enter vehicle: exit any car left over from a previous mission,
            // walk to the live stage target, press E, drive on
            if ((await stats(page)).driving) { await pressKey(page, 'KeyE'); await sleep(400); }
            const tgt0 = await page.evaluate(() => {
              const t = window.NEON_VICE.game.missions.stageTarget();
              return t ? [t.x, t.z] : null;
            });
            if (tgt0) await walkToNear(page, tgt0[0], tgt0[1], 45000, 4);
            await pressKey(page, 'KeyE');
            await sleep(500);
            const s1 = await stats(page);
            if (s1.driving) {
              const tgt = await page.evaluate(() => {
                const t = window.NEON_VICE.game.missions.stageTarget();
                return t ? [t.x, t.z] : null;
              });
              if (tgt) {
                ok = await driveTo(page, tgt[0], tgt[1], 120000);
                note = ok ? 'drove to destination' : 'drive failed';
                if (ok) { await pressKey(page, 'KeyE'); await sleep(300); }
              } else { note = 'no drive target'; }
            } else { note = 'could not enter vehicle'; }
          } else if (n === 5) {
            // race in the plaza car: walk to the car itself, not the plaza point
            const carPos = await page.evaluate(() => {
              const g = window.NEON_VICE.game;
              const p = g.player.group.position;
              let best = null;
              let bestD = Infinity;
              for (const v of g.vehicles.list) {
                // Parked cars only: traffic cars drive away while you walk.
                if (!v.parked || v.kind === 'boat') continue;
                const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
                if (d < bestD) { bestD = d; best = v; }
              }
              return best ? [best.mesh.position.x, best.mesh.position.z] : null;
            });
            if (carPos) await walkToNear(page, carPos[0], carPos[1], 45000, 4);
            await pressKey(page, 'KeyE');
            await sleep(400);
            const s1 = await stats(page);
            if (!s1.driving) { note = 'could not enter car for race'; }
            else {
              ok = true;
              // Drive the road-graph route to each live checkpoint (no
              // teleport: teleporting the car into a block strands it).
              for (let i = 0; i < 4; i += 1) {
                const cp = await page.evaluate(() => {
                  const t = window.NEON_VICE.game.missions.stageTarget();
                  return t ? [t.x, t.z] : null;
                });
                if (!cp) break;
                const r = await driveTo(page, cp[0], cp[1], 90000);
                if (!r) { note = `checkpoint ${cp} missed`; ok = false; break; }
              }
              if (ok) ok = await waitFor(page, () => window.NEON_VICE.stats().missionId !== 5 || window.NEON_VICE.stats().mission === 'done', 8000, 'race complete');
              note = note || 'checkpoints done';
            }
          } else if (n === 6 || n === 7 || n === 12) {
            // combat: exit any vehicle left over from a previous mission,
            // clear wanted/police (mission 6 leaves 2 stars + chasers),
            // unholster, kite to enemies, aim via debug heading, shoot.
            if ((await stats(page)).driving) { await pressKey(page, 'KeyE'); await sleep(400); }
            await page.evaluate(() => { window.NEON_VICE.debug.setWanted(0); window.NEON_VICE.debug.clearPolice(); });
            const spot = n === 6 ? P.southBeach : n === 7 ? P.warehouse : P.yacht;
            await walkToNear(page, spot[0] + 20, spot[1] + 20);
            // Un-holster deterministically: the previous mission may already
            // have left the weapon out, and a blind H press would holster it.
            await page.evaluate(() => {
              if (window.NEON_VICE.game.combat.holstered) window.NEON_VICE.game.input.press('holster');
            });
            await sleep(300);
            const t0 = Date.now();
            let done = false;
            let lastLog = 0;
            // Hold the fire button: at ~3 FPS a 50 ms click falls between
            // frames and is never seen by the polled mouseDown flag.
            await page.mouse.down();
            try {
              while (Date.now() - t0 < 150000) {
                const st = await stats(page);
                if (st.missionId !== n || st.mission === 'done' || st.mission === 'failed') { done = st.mission === 'done' || st.missionId !== n; break; }
                if (Date.now() - lastLog > 10000) {
                  lastLog = Date.now();
                  const diag = await page.evaluate(() => {
                    const g = window.NEON_VICE.game;
                    const p = g.player.group.position;
                    const alive = g.combat.enemies.filter((e) => !e.dead).map((e) => `(${e.mesh.position.x.toFixed(0)},${e.mesh.position.z.toFixed(0)}):${e.hp}`);
                    return `hp=${g.player.hp} mag=${g.combat.weapons[g.combat.current].mag} holstered=${g.combat.holstered} wanted=${g.combat.wanted} police=${g.combat.police.filter((e) => !e.dead).length} pos=(${p.x.toFixed(0)},${p.z.toFixed(0)}) alive=[${alive.join(' ')}]`;
                  });
                  console.log(`  combat[${n}] t=${((Date.now() - t0) / 1000).toFixed(0)}s ${diag}`);
                }
                // Stand and fight (the isolated probe kills all thugs in
                // ~9 s this way): teleport-kiting breaks the fight because
                // the thugs then have to be chased back through buildings.
                // Heal in place instead.
                if (st.hp < 50) {
                  await page.evaluate(() => window.NEON_VICE.debug.setHp(100));
                  await sleep(200);
                  continue;
                }
                const aim = await page.evaluate(() => {
                  const g = window.NEON_VICE.game;
                  const p = g.player.group.position;
                  // Mission thugs only — police are a distraction that
                  // respawns while wanted > 0 and would eat all the shots.
                  const list = [...g.combat.enemies].filter((e) => !e.dead);
                  if (!list.length) return { aimed: false };
                  list.sort((a, b) => {
                    const da = Math.hypot(a.mesh.position.x - p.x, a.mesh.position.z - p.z);
                    const db = Math.hypot(b.mesh.position.x - p.x, b.mesh.position.z - p.z);
                    return da - db;
                  });
                  const e = list[0];
                  const dist = Math.hypot(e.mesh.position.x - p.x, e.mesh.position.z - p.z);
                  g.player.heading = Math.atan2(e.mesh.position.x - p.x, e.mesh.position.z - p.z);
                  return { aimed: true, dist, x: e.mesh.position.x, z: e.mesh.position.z };
                });
                if (aim.aimed && aim.dist < 55) {
                  await sleep(400); // firing (mouse held down)
                } else if (aim.aimed) {
                  // Too far to hit: close the distance first.
                  await walkToNear(page, aim.x, aim.z, 30000);
                } else {
                  // No enemies left — follow the live stage target.
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
            } finally {
              await page.mouse.up();
            }
            ok = done;
            note = done ? 'combat stages cleared' : (await stats(page)).mission === 'failed' ? 'mission failed (Vera went down?)' : 'timed out in combat';
            if (n === 12 && done) {
              ok = await playGoto(12, 120000);
              note = 'hold + deliver via goto runner';
            }
          } else if (n === 8) {
            if ((await stats(page)).driving) { await pressKey(page, 'KeyE'); await sleep(400); }
            const tgt0 = await page.evaluate(() => {
              const t = window.NEON_VICE.game.missions.stageTarget();
              return t ? [t.x, t.z] : null;
            });
            if (tgt0) await walkToNear(page, tgt0[0], tgt0[1], 45000, 4);
            await pressKey(page, 'KeyE');
            await sleep(500);
            const s1 = await stats(page);
            if (s1.driving) {
              const tgt = await page.evaluate(() => {
                const t = window.NEON_VICE.game.missions.stageTarget();
                return t ? [t.x, t.z] : null;
              });
              if (tgt) {
                ok = await driveTo(page, tgt[0], tgt[1], 150000, { direct: true });
                note = ok ? 'sailed to north bay' : 'boat drive failed';
              } else note = 'no sail target';
            } else note = 'could not board boat';
          } else {
            ok = await playGoto(n, 240000);
            note = ok ? 'targets reached' : 'goto runner timed out';
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
      await page.evaluate(() => window.NEON_VICE.debug.setStepBudget(24));
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
      await walkToNear(page, 12, 12, 45000, 4);
      await pressKey(page, 'KeyE');
      await sleep(400);
      ok = true;
      for (const cp of [[200, 150], [-200, -150], [0, 0]]) {
        ok = ok && await driveTo(page, cp[0], cp[1], 90000);
      }
      log('side job street race (car)', ok, '');
      log('sidejob console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
      await page.close();
    }

    if (scenario === 'combat' || scenario === 'full') {
      const { page, errors } = await newPage(browser);
      await startGame(page);
      await page.evaluate(() => window.NEON_VICE.debug.setStepBudget(24));
      await page.evaluate(() => window.NEON_VICE.debug.setMoney(5000));
      // Holster toggle + screenshots of both states (to /tmp, not the dossier).
      await pressKey(page, 'KeyH');
      await sleep(300);
      const armed = await page.evaluate(() => !window.NEON_VICE.game.combat.holstered);
      await page.screenshot({ path: '/tmp/neonvice-armed.jpg', type: 'jpeg', quality: 75 });
      await pressKey(page, 'KeyH');
      await sleep(300);
      const holstered = await page.evaluate(() => window.NEON_VICE.game.combat.holstered);
      await page.screenshot({ path: '/tmp/neonvice-holstered.jpg', type: 'jpeg', quality: 75 });
      log('combat holster toggle', armed && holstered, `armed=${armed} holstered=${holstered}`);
      // Shoot: spawn enemy in front, aim, fire until dead.
      await page.evaluate(() => {
        const g = window.NEON_VICE.game;
        const p = g.player.group.position;
        g.combat.spawnEnemy(p.x + Math.sin(g.player.heading) * 15, p.z + Math.cos(g.player.heading) * 15);
      });
      await pressKey(page, 'KeyH');
      // Hold fire: at ~3 FPS a quick click falls between frames.
      await page.mouse.down();
      let dead = false;
      for (let i = 0; i < 40; i += 1) {
        await sleep(500);
        dead = await page.evaluate(() => window.NEON_VICE.game.combat.enemies.every((e) => e.dead));
        if (dead) break;
      }
      await page.mouse.up();
      dead = await page.evaluate(() => window.NEON_VICE.game.combat.enemies.every((e) => e.dead));
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
      await page.evaluate(() => window.NEON_VICE.debug.setStepBudget(24));
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
