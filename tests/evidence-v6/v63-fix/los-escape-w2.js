// FOCUSED re-test: 2-star on-foot LOS escape only (runs 1/2/3/5 all failed
// to complete it — the player kept getting PINNED in a building corner:
// hero frozen for 25 s game-time while cops held at ~15.6 m).
// Fixes vs los-escape.js: (1) steer + cover-search in ONE evaluate;
// (2) cover candidates at 8/14/22 m with a 1 m-step walkability check
// (r=0.6) so the straight path cannot clip a building corner;
// (3) stuck recovery: sidestep along the wall (perpendicular to the
// threat) instead of fleeing straight into the same wall.
// Usage: node tests/evidence-v6/v63-fix/los-escape-w2.js  (server :8111)
const fs = require('fs');
const OUT = '/home/hatch/workspace/makefun/neon-vice-entry/tests/evidence-v6/v63-fix';
const STARS = Number(process.argv[2] || 2); // 2 = the LOS fix case; 1 = regression
const URL = 'http://localhost:8111/?autostart=new';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const { chromium } = await import('/home/hatch/workspace/custom-skills/playwright_skill/node_modules/playwright-core/index.mjs');
  const browser = await chromium.launch({
    executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const errors = [];
  const external = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith('http://localhost:8111')) external.push(r.url()); });
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 60000 });
  await sleep(2000);
  const R = {};
  const stats = async () => page.evaluate(() => {
    const s = window.NEON_VICE.stats();
    return {
      gt: +s.gameTime.toFixed(2), wanted: s.wanted, police: s.police, policeCars: s.policeCars,
      canSee: s.policeCanSee, escaping: s.escaping, progress: s.escapeProgress, needed: s.escapeNeeded,
      nearest: s.nearestPoliceDist, nearestLos: s.nearestPoliceLos, hp: s.hp,
    };
  });
  const hero = async () => page.evaluate(() => window.NEON_VICE.hero());
  const heal = () => page.evaluate(() => window.NEON_VICE.debug.setHp(100));

  // One evaluate: pick a steering target for `mode` and point the camera
  // at it (keyboard W is camera-relative). Modes: cover | flee | slideL |
  // slideR. Cover = a point walkable in a straight line (1 m steps,
  // r=0.6) whose LOS from EVERY living police unit is blocked (4 m
  // steps, mirroring the game). Falls back to flee when no cover exists.
  const stepSteer = (mode) => page.evaluate((m) => {
    const g = window.NEON_VICE.game;
    const p = g.player.group.position;
    const w = g.world;
    const units = [...g.combat.police, ...g.combat.policeCars]
      .filter((u) => !u.dead)
      .map((u) => ({ x: u.mesh.position.x, z: u.mesh.position.z }));
    const blocked = (ax, az, bx, bz, step, r = 0) => {
      const dx = bx - ax, dz = bz - az, dist = Math.hypot(dx, dz);
      const n = Math.max(1, Math.ceil(dist / step));
      for (let i = 1; i < n; i += 1) {
        const t = i / n;
        if (w.collides(ax + dx * t, az + dz * t, r)) return true;
      }
      return false;
    };
    let nx = p.x, nz = p.z - 1, nd = 1e9;
    for (const u of units) {
      const d = Math.hypot(u.x - p.x, u.z - p.z);
      if (d < nd) { nd = d; nx = u.x; nz = u.z; }
    }
    let tx, tz, picked = m;
    if (m === 'flee' || !units.length) {
      tx = p.x + (p.x - nx); tz = p.z + (p.z - nz);
    } else if (m === 'slideL' || m === 'slideR') {
      const s = m === 'slideL' ? 1 : -1;
      const dx = p.x - nx, dz = p.z - nz, d = Math.hypot(dx, dz) || 1;
      tx = p.x + (-dz / d) * s * 15; tz = p.z + (dx / d) * s * 15;
    } else {
      let best = null, bestScore = -1e9;
      for (let k = 0; k < 24; k += 1) {
        const a = (k / 24) * Math.PI * 2;
        for (const r of [8, 14, 22]) {
          const cx = p.x + Math.cos(a) * r;
          const cz = p.z + Math.sin(a) * r;
          if (Math.abs(cx) > 480 || Math.abs(cz) > 420) continue;
          if (w.collides(cx, cz, 0.6)) continue;
          if (blocked(p.x, p.z, cx, cz, 1, 0.6)) continue;
          let minD = 1e9, hidden = true;
          for (const u of units) {
            const d = Math.hypot(cx - u.x, cz - u.z);
            if (d < minD) minD = d;
            if (!blocked(u.x, u.z, cx, cz, 4)) { hidden = false; break; }
          }
          if (!hidden) continue;
          const score = minD - 0.3 * r;
          if (score > bestScore) { bestScore = score; best = { x: cx, z: cz }; }
        }
      }
      if (best) { tx = best.x; tz = best.z; }
      else { tx = p.x + (p.x - nx); tz = p.z + (p.z - nz); picked = 'flee'; }
    }
    const h = Math.atan2(tx - p.x, tz - p.z);
    window.NEON_VICE.debug.setCameraOrbit(h);
    g.player.heading = h;
    g.player.group.rotation.y = h;
    return { mode: picked, tx: +tx.toFixed(1), tz: +tz.toFixed(1) };
  }, mode);

  await page.evaluate(() => { window.NEON_VICE.debug.teleport(-200, -150); window.NEON_VICE.debug.clearPolice(); });
  await sleep(600);
  await page.evaluate((n) => window.NEON_VICE.debug.setWanted(n), STARS);
  await sleep(800);
  const t0 = (await stats()).gt;
  let proof = null;
  let escapedAt = null;
  let maxProgress = 0;
  const trace = [];
  let lastPos = null;
  let slideUntil = -1;
  let slideDir = 'slideL';
  let stuckEvents = 0;
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  try {
    for (let i = 0; i < 900; i += 1) {
      const s = await stats();
      if (s.progress > maxProgress) maxProgress = s.progress;
      if (i % 8 === 0) {
        const h = await hero();
        trace.push({ ...s, hx: +h.x.toFixed(1), hz: +h.z.toFixed(1) });
        if (lastPos && Math.hypot(h.x - lastPos.x, h.z - lastPos.z) < 1.5) {
          stuckEvents += 1;
          slideDir = slideDir === 'slideL' ? 'slideR' : 'slideL';
          slideUntil = i + 16;
          console.log(`STUCK at gt=${s.gt} hero=(${h.x.toFixed(1)},${h.z.toFixed(1)}) -> ${slideDir} x16`);
        }
        lastPos = { x: h.x, z: h.z };
      }
      if (s.wanted === 0) { escapedAt = s; break; }
      if (!proof && s.escaping && s.nearest !== null && s.nearest < 70 && s.nearestLos === false) {
        proof = { ...s, hero: await hero() };
        await page.screenshot({ path: `${OUT}/los-escape-hud-w${STARS}.png` });
        console.log('LOS PROOF:', JSON.stringify(proof));
      }
      const mode = i <= slideUntil ? slideDir : 'cover';
      await stepSteer(mode);
      if (i % 4 === 0) await heal();
      await sleep(200);
    }
  } finally { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); }
  R[`w${STARS}_onfoot`] = {
    gtStart: t0, escapedAt, durationGt: escapedAt ? +(escapedAt.gt - t0).toFixed(2) : null,
    proof, maxProgress, stuckEvents, trace,
  };
  console.log(`w${STARS} on-foot:`, JSON.stringify({ escapedAt, durationGt: R[`w${STARS}_onfoot`].durationGt, proof: !!proof, maxProgress, stuckEvents }));
  await page.screenshot({ path: `${OUT}/los-escape-after-w${STARS}.png` });
  R.errors = errors;
  R.external = external;
  fs.writeFileSync(`${OUT}/los-escape-w${STARS}.json`, JSON.stringify(R, null, 2));
  await browser.close();
  console.log(`W2 done errors=${errors.length} external=${external.length}`);
  process.exit(0);
}
main().catch((e) => { console.error('W2 FAIL', e); process.exit(2); });
