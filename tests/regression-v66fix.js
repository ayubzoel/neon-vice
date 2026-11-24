// Neon Vice — regression test for the v6.6-fix round (round 1) plus the
// round-2 wide-left fix. Written from scratch for this resubmit round.
// Covers, in order:
//   (0) static wide-left diagonal clearance per flyover (round-2 guard)
//   (1) side-job beacon returns to the main mission target (M1 152.3,120
//       -> package side job 100,360 -> beacon back to 152.3,120)
//   (2) tight left turn under both flyovers, slow (cap 6) and fast (cap 12)
//   (3) escape toast text in EN ("You escaped!") and ID ("Berhasil kabur!")
//       as read from #hudMsg after the banner has reverted
//   (4) south corridor of park B (garden B): pedestrian walks through,
//       car stays blocked outside (and can still reverse out)
//   (5) wide left turn under both flyovers (round-2 fix, garden C moved)
//   (6) right turn under both flyovers (guard for the median-hedge work)
//   (7) traffic keeps flowing (no stuck cars)
//   (8) 0 console/page errors, 0 external requests
// Run: node tests/regression-v66fix.js   (from the repo root)
// Exit code 0 = all checks passed, 1 = at least one failed, 2 = crash.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from '/home/hatch/workspace/custom-skills/playwright_skill/node_modules/playwright-core/index.mjs';

const PORT = 8441;
const GAME_DIR = fileURLToPath(new URL('../game', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wrapPi = (a) => ((a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function waitForServer(timeoutMs = 20000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/' }, (res) => { res.resume(); resolve(true); });
      req.on('error', () => {
        if (Date.now() - t0 > timeoutMs) reject(new Error('game server did not start'));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

async function main() {
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: GAME_DIR, stdio: 'pipe' });
  await waitForServer();
  const browser = await chromium.launch({
    executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith(`http://localhost:${PORT}`)) external.push(r.url()); });
  const close = async (code) => {
    try { await browser.close(); } catch { /* already closed */ }
    try { server.kill(); } catch { /* already dead */ }
    process.exit(code);
  };
  try {
    await page.goto(`http://localhost:${PORT}/?autostart=new`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 30000 });
    await page.evaluate(() => window.NEON_VICE.debug.setStepBudget(24));
    await sleep(3000);

    const stats = () => page.evaluate(() => window.NEON_VICE.stats());
    const gameTime = async () => (await stats()).gameTime;
    const waitGame = async (secs) => {
      const t0 = await gameTime();
      while ((await gameTime()) - t0 < secs) await sleep(300);
    };
    const marker = () => page.evaluate(() => window.NEON_VICE.game.missions.missionMarker());
    const hudMsg = () => page.evaluate(() => {
      const el = document.getElementById('hudMsg');
      return el ? el.textContent.trim() : null;
    });
    const near = (a, b, tol) => a && b && Math.hypot(a.x - b.x, a.z - b.z) < tol;
    const drivenId = () => page.evaluate(() => {
      const g = window.NEON_VICE.game;
      const p = g.player.group.position;
      let best = null, bd = Infinity;
      for (const v of g.vehicles.list) {
        const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
        if (d < bd) { bd = d; best = v; }
      }
      return best && bd < 1.5 ? best.id : null;
    });
    const carById = (id) => page.evaluate((i) => {
      const g = window.NEON_VICE.game;
      const v = g.vehicles.list.find((vv) => vv.id === i);
      return v ? { x: +v.mesh.position.x.toFixed(1), z: +v.mesh.position.z.toFixed(1), heading: +v.heading.toFixed(2), speed: +v.speed.toFixed(1) } : null;
    }, id);
    const releaseKeys = async () => {
      for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) await page.keyboard.up(k);
    };
    async function placeCar(x, z, heading, tolerance = 5) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!(await stats()).driving) {
          const entered = await enterNearestCar();
          if (!entered) return { ok: false, why: 'cannot enter a car' };
        }
        const id = await drivenId();
        if (id === null) return { ok: false, why: 'no driven car id' };
        await page.evaluate(([xx, zz]) => window.NEON_VICE.debug.teleport(xx, zz), [x, z]);
        await page.evaluate(([hh]) => {
          const g = window.NEON_VICE.game;
          const p = g.player.group.position;
          let best = null, bd = Infinity;
          for (const v of g.vehicles.list) {
            const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
            if (d < bd) { bd = d; best = v; }
          }
          if (best) { best.heading = hh; best.mesh.rotation.y = hh; best.speed = 0; }
        }, [heading]);
        await sleep(600);
        const c = await carById(id);
        if (c && (await stats()).driving && Math.hypot(c.x - x, c.z - z) < tolerance) return { ok: true, id };
      }
      return { ok: false, why: 'placement did not verify after 3 attempts' };
    }
    async function enterNearestCar() {
      const cars = await page.evaluate(() => {
        const g = window.NEON_VICE.game;
        const p = g.player.group.position;
        return g.vehicles.list
          .filter((v) => !v.traffic && v.kind !== 'boat')
          .map((v) => ({ x: v.mesh.position.x, z: v.mesh.position.z, d: Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z) }))
          .sort((a, b) => a.d - b.d).slice(0, 3);
      });
      for (const car of cars) {
        await page.evaluate(([x, z]) => window.NEON_VICE.debug.teleport(x + 3, z), [car.x, car.z]);
        await sleep(600);
        for (let i = 0; i < 4; i++) {
          await page.keyboard.press('KeyE');
          await sleep(700);
          if ((await stats()).driving) return true;
        }
      }
      return false;
    }
    async function driveWaypoints(id, wps, cap, timeoutWall = 90000) {
      let end = null;
      const t0 = Date.now();
      await page.keyboard.down('KeyW');
      try {
        for (const [tx, tz] of wps) {
          while (Date.now() - t0 < timeoutWall) {
            const c = await carById(id);
            if (!c) return null;
            end = c;
            if (Math.hypot(tx - c.x, tz - c.z) < 8) break;
            const desired = Math.atan2(tx - c.x, tz - c.z);
            const diff = wrapPi(desired - c.heading);
            if (diff > 0.12) { await page.keyboard.down('KeyA'); await page.keyboard.up('KeyD'); }
            else if (diff < -0.12) { await page.keyboard.down('KeyD'); await page.keyboard.up('KeyA'); }
            else { await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); }
            await page.evaluate((cc) => {
              const g = window.NEON_VICE.game;
              const p = g.player.group.position;
              let best = null, bd = Infinity;
              for (const v of g.vehicles.list) {
                const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
                if (d < bd) { bd = d; best = v; }
              }
              if (best && best.speed > cc) best.speed = cc;
            }, cap);
            await sleep(200);
          }
        }
      } finally { await releaseKeys(); }
      return end;
    }
    async function reverseMeters(id, secs) {
      const c0 = await carById(id);
      const t0 = await gameTime();
      await page.keyboard.down('KeyS');
      while ((await gameTime()) - t0 < secs) await sleep(250);
      await page.keyboard.up('KeyS');
      const c1 = await carById(id);
      return c0 && c1 ? +Math.hypot(c1.x - c0.x, c1.z - c0.z).toFixed(1) : null;
    }
    async function walkTo(tx, tz, timeoutWall = 90000, radius = 2) {
      const t0 = Date.now();
      let checkT = Date.now(), checkD = Infinity, side = 0;
      while (Date.now() - t0 < timeoutWall) {
        const p = await page.evaluate(() => {
          const pp = window.NEON_VICE.game.player.group.position;
          return { x: pp.x, z: pp.z, h: window.NEON_VICE.game.player.heading };
        });
        const dist = Math.hypot(tx - p.x, tz - p.z);
        if (dist < radius) { await releaseKeys(); return { ok: true, end: p }; }
        if (Date.now() - checkT > 2500) {
          if (dist > checkD - 1) {
            await page.keyboard.up('KeyW');
            await page.keyboard.down('KeyS'); await sleep(400); await page.keyboard.up('KeyS');
            side += 1;
            const dir = side % 2 === 1 ? 'KeyA' : 'KeyD';
            await page.keyboard.down(dir); await page.keyboard.down('KeyW'); await sleep(1200);
            await page.keyboard.up(dir); await page.keyboard.up('KeyW');
          }
          checkD = dist; checkT = Date.now();
        }
        const desired = Math.atan2(tx - p.x, tz - p.z);
        const diff = wrapPi(desired - p.h);
        await page.keyboard.down('KeyW');
        if (diff > 0.15) { await page.keyboard.down('KeyA'); await page.keyboard.up('KeyD'); }
        else if (diff < -0.15) { await page.keyboard.down('KeyD'); await page.keyboard.up('KeyA'); }
        else { await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); }
        await sleep(120);
      }
      await releaseKeys();
      const p = await page.evaluate(() => {
        const pp = window.NEON_VICE.game.player.group.position;
        return { x: +pp.x.toFixed(1), z: +pp.z.toFixed(1) };
      });
      return { ok: false, end: p };
    }

    // ---- (0) static wide-left clearance (round-2 guard) ----
    {
      const wlc = await page.evaluate(() => window.NEON_VICE_WORLD.wideLeftClearance);
      const fx300 = wlc ? wlc.find((e) => e.fx === 300) : null;
      const fx60 = wlc ? wlc.find((e) => e.fx === 60) : null;
      check('(0) clearance diagonal belok kiri lebar fx=300 > 2 m',
        !!fx300 && fx300.clearanceM !== null && fx300.clearanceM > 2,
        `wideLeftClearance=${JSON.stringify(wlc)}`);
      check('(0) tidak ada taman di koridor belok kiri lebar fx=60',
        !!fx60 && fx60.clearanceM === null, `fx60=${JSON.stringify(fx60)}`);
    }

    // ---- (1) side-job beacon returns to the main mission target ----
    {
      await page.evaluate(() => window.NEON_VICE.debug.exitVehicle());
      await sleep(400);
      await page.evaluate(() => window.NEON_VICE.debug.startMission(1));
      await sleep(1200);
      const m1t = await page.evaluate(() => window.NEON_VICE.game.missions.stageTarget());
      const m1ok = m1t && Math.hypot(m1t.x - 152.3, m1t.z - 120) < 2;
      const markM1 = await marker();
      check('(1) beacon misi utama aktif di target M1 (152.3,120)',
        m1ok && near(markM1, m1t, 2), `target=${JSON.stringify(m1t)} marker=${JSON.stringify(markM1)}`);
      const sj = await page.evaluate(() => window.NEON_VICE.game.missions.startSideJob('package'));
      await sleep(800);
      const sjTo = sj ? sj.to : null;
      const sjOk = sjTo && Math.hypot(sjTo.x - 100, sjTo.z - 360) < 5;
      const markSj = await marker();
      check('(1) beacon pindah ke target side job package (100,360)',
        sjOk && near(markSj, sjTo, 2), `sideJob.to=${JSON.stringify(sjTo)} marker=${JSON.stringify(markSj)}`);
      if (sjTo) {
        await page.evaluate(([x, z]) => window.NEON_VICE.debug.teleport(x, z), [sjTo.x, sjTo.z]);
        let cleared = false;
        const t0 = Date.now();
        while (Date.now() - t0 < 30000) {
          const after = await page.evaluate(() => window.NEON_VICE.game.missions.sideJob);
          if (after === null) { cleared = true; break; }
          await sleep(500);
        }
        const markAfter = await marker();
        const m1tAfter = await page.evaluate(() => window.NEON_VICE.game.missions.stageTarget());
        const backToMain = near(markAfter, m1tAfter, 2);
        const stuckOnSj = near(markAfter, sjTo, 2);
        check('(1) beacon kembali ke target misi utama setelah side job selesai',
          cleared && backToMain && !stuckOnSj,
          `sideJob cleared=${cleared} marker=${JSON.stringify(markAfter)} target M1=${JSON.stringify(m1tAfter)} stuckOnSideJob=${stuckOnSj}`);
      } else {
        check('(1) beacon kembali ke target misi utama setelah side job selesai', false, 'side job did not start');
      }
    }

    // ---- (2) tight left turn, slow + fast, both flyovers ----
    for (const fx of [60, 300]) {
      for (const [label, cap] of [['pelan', 6], ['cepat', 12]]) {
        const p = await placeCar(fx - 40, 0, Math.PI / 2);
        if (!p.ok) { check(`(2) belok kiri rapat fx=${fx} ${label}`, false, 'setup: ' + p.why); continue; }
        const e = await driveWaypoints(p.id, [[fx, 0], [fx - 4.5, -40]], cap);
        const ok = e && Math.hypot(e.x - (fx - 4.5), e.z + 40) < 12;
        const rev = !ok && e ? await reverseMeters(p.id, 5) : null;
        check(`(2) belok kiri rapat fx=${fx} ${label} (cap ${cap}) selesai on-road`,
          ok, `end=${e ? `(${e.x},${e.z})` : 'null'} target=(${fx - 4.5},-40) mundur=${rev} m`);
      }
    }

    // ---- (5) wide left turn, both flyovers (round-2 fix) ----
    for (const fx of [60, 300]) {
      const p = await placeCar(fx - 30, 0, Math.PI / 2);
      if (!p.ok) { check(`(5) belok kiri lebar fx=${fx}`, false, 'setup: ' + p.why); continue; }
      const e = await driveWaypoints(p.id, [[fx - 4.5, -30]], 12);
      const ok = e && Math.hypot(e.x - (fx - 4.5), e.z + 30) < 12;
      const rev = !ok && e ? await reverseMeters(p.id, 5) : null;
      check(`(5) belok kiri lebar fx=${fx} selesai on-road`,
        ok, `end=${e ? `(${e.x},${e.z})` : 'null'} target=(${fx - 4.5},-30) mundur=${rev} m`);
    }

    // ---- (6) right turn, both flyovers ----
    for (const fx of [60, 300]) {
      const p = await placeCar(fx - 4.5, 40, 0);
      if (!p.ok) { check(`(6) belok kanan fx=${fx}`, false, 'setup: ' + p.why); continue; }
      const e = await driveWaypoints(p.id, [[fx + 4.5, 0], [fx + 4.5, 40]], 12);
      const ok = e && Math.hypot(e.x - (fx + 4.5), e.z - 40) < 12;
      const rev = !ok && e ? await reverseMeters(p.id, 5) : null;
      check(`(6) belok kanan fx=${fx} selesai on-road`,
        ok, `end=${e ? `(${e.x},${e.z})` : 'null'} target=(${fx + 4.5},40) mundur=${rev} m`);
    }

    // ---- (3) escape toast EN + ID, read from #hudMsg ----
    // Method (learned from the first run of this file, 18/21): a
    // ring-search for a LOS-blocked hide spot near the player is
    // unreliable — in open ground every candidate stays visible, and a
    // spot 15-20 m from the police is re-acquired within a second, so
    // the escape timer never runs. Worse, #hudMsg mirrors the LAST
    // toast, so reading it late can return a stale toast from an
    // earlier escape (or a package pickup that overwrote it). This
    // version therefore (a) blanks #hudMsg first, (b) waits out the
    // 10-game-second fresh-heat window after setWanted (combat.js
    // maintainForce keeps spawning reinforcements near the player
    // during it, but stops once every unit is beyond the 70 m sight
    // range), then (c) teleports 300+ m away, where police cars
    // despawn (>250 m) and foot police cannot close in before the
    // 5-game-second ★1 timer runs out — re-teleporting to the next
    // far corner if the chase ever re-acquires — and (d) reads #hudMsg
    // in the same poll that first sees wanted hit 0, so the toast it
    // captures is the escape toast itself, not a later overwrite.
    const FAR_SPOTS = [[-480, 380], [400, -300], [-480, -300], [400, 300]];
    async function runEscape(lang, expected) {
      await page.evaluate((l) => window.NEON_VICE.game.ui.setLang(l), lang);
      await page.evaluate(() => {
        const hm = document.getElementById('hudMsg');
        if (hm) hm.textContent = '';
      });
      await page.evaluate(() => window.NEON_VICE.debug.exitVehicle());
      await page.evaluate(() => {
        window.NEON_VICE.debug.setWanted(0);
        window.NEON_VICE.debug.clearPolice();
        window.NEON_VICE.debug.setHp(100);
      });
      await sleep(1000);
      await page.evaluate(() => window.NEON_VICE.debug.setWanted(1));
      const tCrime = await gameTime();
      const tSeen = Date.now();
      let seen = false;
      let clearedEarly = false;
      while (Date.now() - tSeen < 90000) {
        const s = await stats();
        if (s.wanted === 0) { clearedEarly = true; break; }
        if (s.policeCanSee && s.wanted === 1) { seen = true; break; }
        await sleep(500);
      }
      if (!seen) return { ok: false, detail: clearedEarly ? 'wanted bersih sebelum polisi melihat' : 'polisi tidak pernah melihat dalam 90 dtk' };
      // Wait out the fresh-heat window (11 game-seconds after the
      // crime) so no reinforcements spawn next to the player after the
      // far teleport. Top up hp while the police close in.
      while ((await gameTime()) - tCrime < 11) {
        const s = await stats();
        if (s.wanted === 0) return { ok: false, detail: 'wanted bersih saat menunggu akhir fresh-heat' };
        if (s.hp < 50) await page.evaluate(() => window.NEON_VICE.debug.setHp(100));
        await sleep(400);
      }
      let spotIdx = 0;
      const jump = async () => {
        const [fx, fz] = FAR_SPOTS[spotIdx % FAR_SPOTS.length];
        spotIdx += 1;
        await page.evaluate(([x, z]) => window.NEON_VICE.debug.teleport(x, z), [fx, fz]);
        await sleep(600);
        return { x: fx, z: fz };
      };
      let jumpedTo = await jump();
      let cleared = false;
      let toastAtClear = null;
      let maxProg = 0;
      const tClear = Date.now();
      while (Date.now() - tClear < 150000) {
        const s = await stats();
        maxProg = Math.max(maxProg, s.escapeProgress || 0);
        if (s.wanted === 0) {
          cleared = true;
          toastAtClear = await hudMsg();
          break;
        }
        if (s.hp <= 0) break;
        if (s.hp < 50) await page.evaluate(() => window.NEON_VICE.debug.setHp(100));
        if (s.policeCanSee) jumpedTo = await jump();
        await sleep(400);
      }
      return {
        ok: cleared && toastAtClear === expected,
        detail: `jumpedTo=${JSON.stringify(jumpedTo)} cleared=${cleared} maxProg=${maxProg} hudMsg saat bersih=${JSON.stringify(toastAtClear)} expected=${JSON.stringify(expected)}`,
      };
    }
    {
      const en = await runEscape('en', 'You escaped!');
      check('(3) toast escape EN terbaca di #hudMsg: "You escaped!"', en.ok, en.detail);
      const id = await runEscape('id', 'Berhasil kabur!');
      check('(3) toast escape ID terbaca di #hudMsg: "Berhasil kabur!"', id.ok, id.detail);
      await page.evaluate(() => window.NEON_VICE.game.ui.setLang('en'));
    }

    // ---- (4) south corridor of park B (garden B) ----
    {
      const band = await page.evaluate(() => {
        const W = window.NEON_VICE_WORLD;
        const free = [];
        for (let z = 83.0; z <= 86.0; z += 0.05) {
          if (!W.collides(78, z, 0.6)) free.push(+z.toFixed(2));
        }
        return free;
      });
      const bandW = band.length ? +(Math.max(...band) - Math.min(...band)).toFixed(2) : 0;
      check('(4) koridor selatan taman B: ada jalur pejalan kaki (r=0.6)',
        band.length >= 10, `lebar bebas ~${bandW} m (z ${band.length ? band[0] + '..' + band[band.length - 1] : 'none'})`);
      await page.evaluate(() => window.NEON_VICE.debug.exitVehicle());
      await sleep(400);
      await page.evaluate(() => window.NEON_VICE.debug.teleport(70, 84.5));
      await sleep(500);
      let pedOk = true;
      let pedEnd = null;
      for (const [wx, wz] of [[78, 84.5], [78, 78]]) {
        const r = await walkTo(wx, wz, 60000, 2);
        pedEnd = r.end;
        if (!r.ok) { pedOk = false; break; }
      }
      check('(4) pejalan kaki lewat koridor selatan + masuk taman B lewat celah',
        pedOk, `end=${JSON.stringify(pedEnd)} target=(78,78)`);
      const entered = await enterNearestCar();
      if (!entered) {
        check('(4) mobil terblokir di luar taman B (tidak masuk, bisa mundur)', false, 'setup: cannot enter a car');
      } else {
        // (78,95) itself sits inside a building: debug.teleport snaps
        // via findOpenGround to ~(73.8,99.2), 6 m off — the same start
        // the parent probe uses — so the placement tolerance here is
        // 12 m, not the usual 5 m. The car then drives north to the
        // garden's south hedge and must stop outside it.
        const p = await placeCar(78, 95, Math.PI, 12);
        if (!p.ok) {
          check('(4) mobil terblokir di luar taman B (tidak masuk, bisa mundur)', false, 'setup: ' + p.why);
        } else {
          let everIn = false;
          let stopped = false;
          await page.keyboard.down('KeyW');
          const t0 = Date.now();
          let last = await carById(p.id);
          let lastT = await gameTime();
          try {
            while (Date.now() - t0 < 45000) {
              const c = await carById(p.id);
              if (!c) break;
              if (c.x >= 72 && c.x <= 84 && c.z >= 72 && c.z <= 83.6) everIn = true;
              if (Math.hypot(c.x - last.x, c.z - last.z) > 0.5) { last = c; lastT = await gameTime(); }
              else if ((await gameTime()) - lastT > 4) { stopped = true; break; }
              await page.evaluate(() => {
                const g = window.NEON_VICE.game;
                const pp = g.player.group.position;
                let best = null, bd = Infinity;
                for (const v of g.vehicles.list) {
                  const d = Math.hypot(v.mesh.position.x - pp.x, v.mesh.position.z - pp.z);
                  if (d < bd) { bd = d; best = v; }
                }
                if (best && best.speed > 8) best.speed = 8;
              });
              await sleep(250);
            }
          } finally { await releaseKeys(); }
          const end = await carById(p.id);
          const rev = await reverseMeters(p.id, 5);
          check('(4) mobil terblokir di luar taman B (tidak masuk, bisa mundur)',
            !everIn && stopped && rev !== null && rev > 0.5,
            `everIn=${everIn} stopped=${stopped} end=${JSON.stringify(end)} mundur=${rev} m`);
        }
      }
    }

    // ---- (7) traffic keeps flowing ----
    {
      const snap = () => page.evaluate(() => window.NEON_VICE.game.vehicles.list
        .filter((v) => v.traffic)
        .map((v) => ({ x: +v.mesh.position.x.toFixed(1), z: +v.mesh.position.z.toFixed(1) })));
      const before = await snap();
      await waitGame(30);
      const after = await snap();
      let moved = 0;
      let stuck = 0;
      for (let i = 0; i < Math.min(before.length, after.length); i++) {
        const d = Math.hypot(after[i].x - before[i].x, after[i].z - before[i].z);
        moved += d;
        if (d < 1) stuck += 1;
      }
      check('(7) traffic mengalir (tidak ada mobil nyangkut)',
        before.length > 0 && moved > 30 && stuck <= 2,
        `traffic=${before.length} totalGerak=${moved.toFixed(1)} m / 30 dtk game, nyangkut(<1 m)=${stuck}`);
    }

    // ---- (8) errors / external requests ----
    check('(8) 0 console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    check('(8) 0 request eksternal', external.length === 0, external.slice(0, 3).join(' | '));

    const failed = results.filter((r) => !r.ok).length;
    console.log(`\nregression-v66fix: ${results.length - failed}/${results.length} passed`);
    await close(failed ? 1 : 0);
  } catch (e) {
    console.error(e);
    await close(2);
  }
}
main();
