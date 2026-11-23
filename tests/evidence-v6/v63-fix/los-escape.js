// v6.3 LOS fix — verification (builder-side, Playwright headless).
// Proves: on-foot escape at 2 stars works by breaking line-of-sight
// behind a building (nearest police < 70 m AND nearestPoliceLos === false
// while escaping), then wanted clears in ~8 s game-time.
// Regressions: 1-star on foot (~5 s), 3-star driving (~12 s).
// Reset: half-way escape, then get seen again -> progress back to ~0.
// Usage: node tests/evidence-v6/v63-fix/los-escape.js  (dev server :8111)
const fs = require('fs');
const OUT = '/home/hatch/workspace/makefun/neon-vice-entry/tests/evidence-v6/v63-fix';
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
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const stats = async () => page.evaluate(() => {
    const s = window.NEON_VICE.stats();
    return {
      gt: +s.gameTime.toFixed(2), wanted: s.wanted, police: s.police, policeCars: s.policeCars,
      canSee: s.policeCanSee, escaping: s.escaping, progress: s.escapeProgress, needed: s.escapeNeeded,
      nearest: s.nearestPoliceDist, nearestLos: s.nearestPoliceLos, driving: s.driving,
      fps: s.fps, ratio: +s.ratio.toFixed(2), hp: s.hp,
    };
  });
  const hero = async () => page.evaluate(() => window.NEON_VICE.hero());
  const heal = () => page.evaluate(() => window.NEON_VICE.debug.setHp(100));

  const probe = await stats();
  // Sanity: the LOS fix is actually served (new stats field present).
  R.servedLosField = await page.evaluate(() => 'nearestPoliceLos' in window.NEON_VICE.stats());
  console.log('probe stats:', JSON.stringify(probe), 'servedLosField=', R.servedLosField);
  if (!R.servedLosField) throw new Error('server is stale: nearestPoliceLos missing from stats()');

  // Best on-foot cover point: walkable in a straight line from the player,
  // and the segment EVERY living police unit -> point is blocked
  // (world.collides sampling, same ~4 m step as the game). The game only
  // lets the escape timer run when NO unit sees the player, so hiding
  // from the nearest unit alone is not enough — run 3 proved it: the
  // player hid from the patrol car while a foot cop on the other side
  // still had LOS, and the timer kept resetting. Scores by distance
  // from the closest threat.
  const coverTarget = () => page.evaluate(() => {
    const g = window.NEON_VICE.game;
    const p = g.player.group.position;
    const w = g.world;
    const units = [...g.combat.police, ...g.combat.policeCars]
      .filter((u) => !u.dead)
      .map((u) => ({ x: u.mesh.position.x, z: u.mesh.position.z }));
    if (!units.length) return null;
    const blocked = (ax, az, bx, bz, r = 0) => {
      const dx = bx - ax, dz = bz - az, dist = Math.hypot(dx, dz);
      const n = Math.max(1, Math.ceil(dist / 4));
      for (let i = 1; i < n; i += 1) {
        const t = i / n;
        if (w.collides(ax + dx * t, az + dz * t, r)) return true;
      }
      return false;
    };
    let best = null, bestScore = -1e9;
    for (let k = 0; k < 24; k += 1) {
      const a = (k / 24) * Math.PI * 2;
      for (const r of [14, 22, 30]) {
        const cx = p.x + Math.cos(a) * r;
        const cz = p.z + Math.sin(a) * r;
        if (Math.abs(cx) > 480 || Math.abs(cz) > 420) continue;
        if (w.collides(cx, cz, 0.6)) continue;
        // Walkable straight line at the player's own radius (r=0.6): an
        // r=0 sample can pass through a building corner the player (r=0.6)
        // cannot, which pinned the player in run 2.
        if (blocked(p.x, p.z, cx, cz, 0.6)) continue;
        // LOS from EVERY living unit to the point must be blocked.
        let minD = 1e9;
        let hidden = true;
        for (const u of units) {
          const d = Math.hypot(cx - u.x, cz - u.z);
          if (d < minD) minD = d;
          if (!blocked(u.x, u.z, cx, cz)) { hidden = false; break; }
        }
        if (!hidden) continue;
        const score = minD - 0.3 * r;
        if (score > bestScore) { bestScore = score; best = { x: cx, z: cz }; }
      }
    }
    return best;
  });

  // Steer the on-foot player toward `target` (or away from nearest cop).
  // KEY LESSON (this run): keyboard W is CAMERA-relative (player.js),
  // so setting player.heading alone does NOT steer — W walks where the
  // camera looks. The first run of this script set heading only and the
  // player walked straight into a building and stayed there (~9 m in
  // 11 s game-time, cops holding at ~16 m). So steer via the test hook
  // debug.setCameraOrbit(heading): W then moves toward the target, and
  // the hook's 60 s follow-hold is refreshed every poll.
  const steerOnFoot = async (target) => page.evaluate((t) => {
    const g = window.NEON_VICE.game;
    const p = g.player.group.position;
    let tx, tz;
    if (t) { tx = t.x; tz = t.z; }
    else {
      const units = [...g.combat.police, ...g.combat.policeCars].filter((u) => !u.dead);
      let bx = p.x, bz = p.z - 1, bd = 1e9;
      for (const u of units) {
        const d = Math.hypot(u.mesh.position.x - p.x, u.mesh.position.z - p.z);
        if (d < bd) { bd = d; bx = u.mesh.position.x; bz = u.mesh.position.z; }
      }
      tx = p.x + (p.x - bx); tz = p.z + (p.z - bz);
    }
    const h = Math.atan2(tx - p.x, tz - p.z);
    window.NEON_VICE.debug.setCameraOrbit(h);
    g.player.heading = h;
    g.player.group.rotation.y = h;
    return h;
  }, target);

  // ---- (a) 2 stars ON FOOT, escape behind buildings ----
  await ev(() => { window.NEON_VICE.debug.teleport(-200, -150); window.NEON_VICE.debug.clearPolice(); });
  await sleep(600);
  await ev(() => window.NEON_VICE.debug.setWanted(2));
  await sleep(800);
  const t0 = (await stats()).gt;
  let proof = null; // escaping && nearest<70 && nearestLos===false
  let escapedAt = null;
  const trace = [];
  // Run (Shift + W): walk is 6 m/s, foot cops chase at 7-7.5 m/s — the
  // tester brief's "pelari (11 m/s)" is Shift-run. Holding W alone was
  // the run-2 failure mode (player out-walked by the cops, then pinned).
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  let lastPos = null;
  let fleeUntil = -1;
  try {
    for (let i = 0; i < 400; i += 1) {
      const s = await stats();
      if (i % 4 === 0) { const h = await hero(); trace.push({ ...s, hx: +h.x.toFixed(1), hz: +h.z.toFixed(1) }); }
      if (s.wanted === 0) { escapedAt = s; break; }
      if (!proof && s.escaping && s.nearest !== null && s.nearest < 70 && s.nearestLos === false) {
        proof = { ...s, hero: await hero() };
        await page.screenshot({ path: `${OUT}/los-escape-hud.png` });
        console.log('LOS PROOF:', JSON.stringify(proof));
      }
      // Anti-stuck: if the player barely moved in the last 8 polls, stop
      // cover-seeking and flee straight away from the nearest cop for a
      // while (open ground unpins the player).
      if (i % 8 === 0) {
        const h = await hero();
        if (lastPos && Math.hypot(h.x - lastPos.x, h.z - lastPos.z) < 2) fleeUntil = i + 12;
        lastPos = { x: h.x, z: h.z };
      }
      const tgt = i <= fleeUntil ? null : await coverTarget();
      await steerOnFoot(tgt);
      await heal();
      await sleep(250);
    }
  } finally { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); }
  R.w2_onfoot = {
    gtStart: t0, escapedAt, durationGt: escapedAt ? +(escapedAt.gt - t0).toFixed(2) : null,
    proof, trace: trace.filter((_, i) => i % 3 === 0),
  };
  console.log('w2 on-foot:', JSON.stringify({ escapedAt, durationGt: R.w2_onfoot.durationGt, proof: !!proof }));
  await page.screenshot({ path: `${OUT}/los-escape-after.png` });
  await sleep(1500);
  R.w2_after = await stats();

  // ---- (b1) 1 star ON FOOT regression (run away, no cover needed) ----
  await ev(() => { window.NEON_VICE.debug.teleport(-200, -150); window.NEON_VICE.debug.clearPolice(); });
  await sleep(600);
  await ev(() => window.NEON_VICE.debug.setWanted(1));
  await sleep(800);
  const t1 = (await stats()).gt;
  let esc1 = null;
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  try {
    for (let i = 0; i < 300; i += 1) {
      const s = await stats();
      if (s.wanted === 0) { esc1 = s; break; }
      await steerOnFoot(null);
      await heal();
      await sleep(250);
    }
  } finally { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); }
  R.w1_onfoot = { gtStart: t1, escapedAt: esc1, durationGt: esc1 ? +(esc1.gt - t1).toFixed(2) : null };
  console.log('w1 on-foot:', JSON.stringify(R.w1_onfoot));

  // ---- (b2) 3 stars DRIVING regression ----
  async function getCar() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const parked = await page.evaluate(() => {
        const p = window.NEON_VICE.hero();
        const vs = window.NEON_VICE.game.vehicles.list
          .filter((v) => v.parked && v.kind !== 'boat')
          .map((v) => ({ id: v.id, x: v.mesh.position.x, z: v.mesh.position.z, d: Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z) }))
          .sort((a, b) => a.d - b.d);
        return vs[0] || null;
      });
      if (parked) {
        await page.evaluate(([x, z]) => window.NEON_VICE.debug.teleport(x + 3, z), [parked.x, parked.z]);
        await sleep(800);
        await page.keyboard.press('KeyE');
        await sleep(800);
        if (await page.evaluate(() => window.NEON_VICE.stats().driving)) return { mode: 'parked', id: parked.id };
      }
      await page.evaluate(() => window.NEON_VICE.debug.teleport(0, 0));
      await sleep(500);
      for (let i = 0; i < 40; i += 1) {
        const near = await page.evaluate(() => {
          const p = window.NEON_VICE.hero();
          const vs = window.NEON_VICE.game.vehicles.list
            .filter((v) => v.traffic && v.kind !== 'boat')
            .map((v) => ({ id: v.id, d: Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z) }))
            .sort((a, b) => a.d - b.d);
          return vs[0] || null;
        });
        if (near && near.d < 5.5) {
          await page.keyboard.press('KeyE');
          await sleep(700);
          if (await page.evaluate(() => window.NEON_VICE.stats().driving)) return { mode: 'traffic', id: near.id };
        }
        await sleep(400);
      }
    }
    return null;
  }
  const car = await getCar();
  R.w3_car = car;
  console.log('w3 car:', JSON.stringify(car));
  if (car) {
    await ev(() => window.NEON_VICE.debug.setWanted(3));
    await sleep(800);
    const t3 = (await stats()).gt;
    let esc3 = null;
    await page.keyboard.down('KeyW');
    try {
      for (let i = 0; i < 400; i += 1) {
        const s = await stats();
        if (s.wanted === 0) { esc3 = s; break; }
        await page.evaluate(() => {
          const g = window.NEON_VICE.game;
          const p = g.player.group.position;
          const units = [...g.combat.police, ...g.combat.policeCars].filter((u) => !u.dead);
          let bx = null, bz = null, bd = 1e9;
          for (const u of units) {
            const d = Math.hypot(u.mesh.position.x - p.x, u.mesh.position.z - p.z);
            if (d < bd) { bd = d; bx = u.mesh.position.x; bz = u.mesh.position.z; }
          }
          if (bx !== null) {
            const h = Math.atan2(p.x - bx, p.z - bz);
            let best = null, bdd = 1e9;
            for (const v of g.vehicles.list) {
              const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
              if (d < bdd) { bdd = d; best = v; }
            }
            if (best) best.heading = h;
          }
        });
        await heal();
        await sleep(250);
      }
    } finally { await page.keyboard.up('KeyW'); }
    R.w3_driving = { gtStart: t3, escapedAt: esc3, durationGt: esc3 ? +(esc3.gt - t3).toFixed(2) : null };
    console.log('w3 driving:', JSON.stringify(R.w3_driving));
    await page.evaluate(() => window.NEON_VICE.debug.exitVehicle());
    await sleep(500);
  }

  // ---- (c) RESET: 2 stars, escape half-way behind cover, then get seen ----
  let reset = null;
  for (let attempt = 0; attempt < 2 && !reset; attempt += 1) {
    await ev(() => { window.NEON_VICE.debug.teleport(-200, -150); window.NEON_VICE.debug.clearPolice(); });
    await sleep(600);
    await ev(() => window.NEON_VICE.debug.setWanted(2));
    await sleep(800);
    let mid = null;
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    try {
      for (let i = 0; i < 300; i += 1) {
        const s = await stats();
        if (s.wanted === 0) break; // escaped before reaching mid — retry
        if (s.escaping && s.progress >= 0.3 && s.progress <= 0.55) { mid = s; break; }
        const tgt = await coverTarget();
        await steerOnFoot(tgt);
        await heal();
        await sleep(250);
      }
    } finally { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); }
    if (!mid) { console.log(`reset attempt ${attempt}: no mid-progress point`); continue; }
    console.log(`reset attempt ${attempt} mid:`, JSON.stringify(mid));
    // Stand still; police round the corner and see the player again.
    let seen = null;
    const t0r = Date.now();
    while (Date.now() - t0r < 120000) {
      const s = await stats();
      if (s.wanted === 0) { console.log('reset: escaped before being seen'); break; }
      if (s.canSee === true) { seen = s; break; }
      await heal();
      await sleep(300);
    }
    await sleep(400);
    const after = await stats();
    if (seen) reset = { attempt, mid, seen, afterSeen: after, progressAfterSeen: after.progress };
    console.log('reset result:', JSON.stringify(reset));
  }
  R.reset = reset;
  await ev(() => { window.NEON_VICE.debug.clearPolice(); window.NEON_VICE.debug.setWanted(0); });

  R.errors = errors;
  R.external = external;
  fs.writeFileSync(`${OUT}/los-escape.json`, JSON.stringify(R, null, 2));
  await browser.close();
  console.log(`LOS-ESCAPE done errors=${errors.length} external=${external.length}`);
  process.exit(0);
}
main().catch((e) => { console.error('LOS-ESCAPE FAIL', e); process.exit(2); });
