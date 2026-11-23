// TUNING CHECK — Neon Vice v6.3 tune (★2 8 -> 6 dtk + indikator TERLIHAT).
// One small tuning round after the independent retest (1/3 ★2 on foot).
// Verifies with real input (keyboard) via Playwright headless Chromium vs
// dev server `node serve.ts --port 8112`. No code changes here.
// Usage: node tests/evidence-v6/v63-tune/tune.js   (dev server :8112)
const fs = require('fs');
const OUT = '/home/hatch/workspace/makefun/neon-vice-entry/tests/evidence-v6/v63-tune';
const URL = 'http://localhost:8112/?autostart=new';
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
  const R = { head: 'tune-on-6686263', port: 8112 };

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push('desktop pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('desktop console: ' + m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith('http://localhost:8112')) external.push(r.url()); });
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 60000 });
  await sleep(2000);
  await page.evaluate(() => { if (window.NEON_VICE.debug.setStepBudget) window.NEON_VICE.debug.setStepBudget(24); });

  const stats = async () => page.evaluate(() => {
    const s = window.NEON_VICE.stats();
    return {
      gt: +s.gameTime.toFixed(2), wanted: s.wanted, police: s.police, policeCars: s.policeCars,
      canSee: s.policeCanSee, escaping: s.escaping, progress: s.escapeProgress, needed: s.escapeNeeded,
      nearest: s.nearestPoliceDist, nearestLos: s.nearestPoliceLos, driving: s.driving,
      fps: s.fps, hp: s.hp,
    };
  });
  const hero = async () => page.evaluate(() => window.NEON_VICE.hero());
  const heal = () => page.evaluate(() => window.NEON_VICE.debug.setHp(100));
  const hud = async () => page.evaluate(() => {
    const el = document.getElementById('hudEscape');
    const label = document.getElementById('hudEscapeLabel');
    const track = document.getElementById('hudEscapeTrack');
    const bar = document.getElementById('hudEscapeBar');
    return {
      hidden: el ? el.classList.contains('hidden') : null,
      label: label ? label.textContent : null,
      labelColor: label ? getComputedStyle(label).color : null,
      trackDisplay: track ? getComputedStyle(track).display : null,
      barWidth: bar ? bar.style.width : null,
    };
  });
  const resetScene = async (x, z) => {
    await page.evaluate(([xx, zz]) => { window.NEON_VICE.debug.teleport(xx, zz); window.NEON_VICE.debug.clearPolice(); }, [x, z]);
    await sleep(600);
  };

  // Cover finder (same rule as the game: LOS-blocked from EVERY living
  // police unit, walkable from the player). Copied from the retest harness.
  const findCover = () => page.evaluate(() => {
    const g = window.NEON_VICE.game;
    const p = g.player.group.position;
    const w = g.world;
    const units = [...g.combat.police, ...g.combat.policeCars]
      .filter((u) => !u.dead)
      .map((u) => ({ x: u.mesh.position.x, z: u.mesh.position.z }));
    if (!units.length) return null;
    const blocked = (ax, az, bx, bz, r) => {
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
        if (blocked(p.x, p.z, cx, cz, 0.6)) continue;
        let minD = 1e9, hidden = true;
        for (const u of units) {
          const d = Math.hypot(cx - u.x, cz - u.z);
          if (d < minD) minD = d;
          if (!blocked(u.x, u.z, cx, cz, 0)) { hidden = false; break; }
        }
        if (!hidden) continue;
        const score = minD - 0.3 * r;
        if (score > bestScore) { bestScore = score; best = { x: +cx.toFixed(1), z: +cz.toFixed(1) }; }
      }
    }
    return best;
  });

  // Camera-relative steering: point the orbit camera at the target, then
  // Shift+W runs (11 m/s). Null target = run away from the nearest cop.
  const steerTo = async (target) => page.evaluate((t) => {
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

  // ---------- A. ★2 ON FOOT, 3 runs (retest policy: stand still while
  // escaping, run to fresh cover only while seen) ----------
  async function escapeRun2(runNo) {
    await resetScene(-200, -150);
    await page.evaluate(() => window.NEON_VICE.debug.setWanted(2));
    await sleep(800);
    const s0 = await stats();
    const t0 = s0.gt;
    let proof = null, escapedAt = null, maxProgress = 0, resets = 0, progressHigh = false;
    let lastPos = null, fleeUntil = -1, keysDown = false;
    const neededSeen = s0.needed;
    const keysUp = async () => { if (keysDown) { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); keysDown = false; } };
    const keysDownFn = async () => { if (!keysDown) { await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); keysDown = true; } };
    try {
      for (let i = 0; i < 600; i += 1) {
        const s = await stats();
        if (s.progress > maxProgress) maxProgress = s.progress;
        if (progressHigh && s.progress < 0.05 && s.wanted > 0) { resets += 1; progressHigh = false; }
        if (s.progress > 0.3) progressHigh = true;
        if (s.wanted === 0) { escapedAt = s; break; }
        if (!proof && s.escaping && s.nearest !== null && s.nearest < 70 && s.nearestLos === false) {
          proof = { ...s, hero: await hero() };
          console.log(`[A${runNo}] LOS PROOF:`, JSON.stringify(proof));
        }
        if (s.escaping) {
          await keysUp();
        } else {
          await keysDownFn();
          if (i % 8 === 0) {
            const h = await hero();
            if (lastPos && Math.hypot(h.x - lastPos.x, h.z - lastPos.z) < 2) fleeUntil = i + 12;
            lastPos = { x: h.x, z: h.z };
          }
          const tgt = i <= fleeUntil ? null : await findCover();
          await steerTo(tgt);
        }
        await heal();
        await sleep(250);
      }
    } finally { await keysUp(); }
    const end = await stats();
    const hudAfter = await hud();
    const res = {
      run: runNo, escaped: !!escapedAt, durationGt: escapedAt ? +(escapedAt.gt - t0).toFixed(2) : null,
      maxProgress: +maxProgress.toFixed(3), resets, needed: neededSeen, proof,
      hudWhenWanted0: escapedAt ? hudAfter : null,
      failState: escapedAt ? null : end,
    };
    console.log(`[A${runNo}] escaped=${res.escaped} dur=${res.durationGt} maxProg=${res.maxProgress} resets=${resets} needed=${neededSeen} proof=${!!proof}`);
    await page.screenshot({ path: `${OUT}/a-run${runNo}-end.png` });
    return res;
  }
  R.A = [];
  for (let n = 1; n <= 3; n++) R.A.push(await escapeRun2(n));
  R.A_pass = R.A.filter((r) => r.escaped).length + '/3';

  // ---------- B1. ★1 ON FOOT (regression, ~5 dtk) ----------
  {
    await resetScene(-200, -150);
    await page.evaluate(() => window.NEON_VICE.debug.setWanted(1));
    await sleep(800);
    const t0 = (await stats()).gt;
    const neededSeen = (await stats()).needed;
    let esc = null, maxProgress = 0;
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    try {
      for (let i = 0; i < 300; i += 1) {
        const s = await stats();
        if (s.progress > maxProgress) maxProgress = s.progress;
        if (s.wanted === 0) { esc = s; break; }
        await steerTo(null);
        await heal();
        await sleep(250);
      }
    } finally { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); }
    R.B1 = { escaped: !!esc, durationGt: esc ? +(esc.gt - t0).toFixed(2) : null, maxProgress: +maxProgress.toFixed(3), needed: neededSeen };
    console.log('[B1]', JSON.stringify(R.B1));
    await page.screenshot({ path: `${OUT}/b1-after.png` });
  }

  // ---------- B2. ★3 DRIVING (regression, ~12 dtk, straight z=120 run) ----------
  async function getCar() {
    const parked = await page.evaluate(() => {
      const p = window.NEON_VICE.hero();
      const vs = window.NEON_VICE.game.vehicles.list
        .filter((v) => v.parked && v.kind !== 'boat')
        .map((v) => ({ x: v.mesh.position.x, z: v.mesh.position.z, d: Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z) }))
        .sort((a, b) => a.d - b.d);
      return vs[0] || null;
    });
    if (!parked) return false;
    await page.evaluate(([x, z]) => window.NEON_VICE.debug.teleport(x + 3, z), [parked.x, parked.z]);
    await sleep(800);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('KeyE');
      await sleep(700);
      if (await page.evaluate(() => window.NEON_VICE.stats().driving)) return true;
    }
    return false;
  }
  {
    const entered = await getCar();
    R.B2 = { entered };
    console.log('[B2] entered car:', entered);
    if (entered) {
      await page.evaluate(() => { window.NEON_VICE.debug.teleport(0, 120); window.NEON_VICE.debug.clearPolice(); });
      await sleep(400);
      await page.evaluate(() => {
        const g = window.NEON_VICE.game;
        const p = g.player.group.position;
        let best = null, bd = 1e9;
        for (const v of g.vehicles.list) {
          const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
          if (d < bd) { bd = d; best = v; }
        }
        if (best) { best.heading = Math.PI / 2; best.mesh.rotation.y = Math.PI / 2; best.speed = 5; }
      });
      await sleep(300);
      await page.evaluate(() => window.NEON_VICE.debug.setWanted(3));
      await sleep(800);
      const t0 = (await stats()).gt;
      const neededSeen = (await stats()).needed;
      let esc = null, maxProgress = 0, maxNearest = 0;
      const carState = async () => page.evaluate(() => {
        const g = window.NEON_VICE.game;
        const p = g.player.group.position;
        let best = null, bd = 1e9;
        for (const v of g.vehicles.list) {
          const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
          if (d < bd) { bd = d; best = v; }
        }
        return best ? { x: +best.mesh.position.x.toFixed(1), z: +best.mesh.position.z.toFixed(1), heading: +best.heading.toFixed(3), speed: +best.speed.toFixed(2) } : null;
      });
      await page.keyboard.down('KeyW');
      let steerKey = null;
      const setSteer = async (k) => {
        if (steerKey === k) return;
        if (steerKey) await page.keyboard.up(steerKey);
        steerKey = k;
        if (k) await page.keyboard.down(k);
      };
      try {
        for (let i = 0; i < 600; i += 1) {
          const s = await stats();
          if (s.progress > maxProgress) maxProgress = s.progress;
          if (s.nearest !== null && s.nearest > maxNearest) maxNearest = s.nearest;
          if (s.wanted === 0) { esc = s; break; }
          const c = await carState();
          if (c) {
            const zErr = 120 - c.z;
            const want = Math.PI / 2 - Math.max(-0.3, Math.min(0.3, zErr * 0.02));
            let d2 = want - c.heading;
            while (d2 > Math.PI) d2 -= 2 * Math.PI;
            while (d2 < -Math.PI) d2 += 2 * Math.PI;
            if (d2 > 0.12) await setSteer('KeyA');
            else if (d2 < -0.12) await setSteer('KeyD');
            else await setSteer(null);
          }
          await heal();
          await sleep(250);
        }
      } finally {
        await setSteer(null);
        await page.keyboard.up('KeyW');
      }
      R.B2.escaped = !!esc;
      R.B2.durationGt = esc ? +(esc.gt - t0).toFixed(2) : null;
      R.B2.maxProgress = +maxProgress.toFixed(3);
      R.B2.maxNearest = +maxNearest.toFixed(1);
      R.B2.needed = neededSeen;
      console.log('[B2]', JSON.stringify(R.B2));
      await page.screenshot({ path: `${OUT}/b2-after.png` });
      await page.evaluate(() => window.NEON_VICE.debug.exitVehicle());
      await sleep(500);
    }
  }

  // ---------- B3. RESET still full to 0 ----------
  {
    let reset = null;
    for (let attempt = 0; attempt < 2 && !reset; attempt += 1) {
      await resetScene(-200, -150);
      await page.evaluate(() => window.NEON_VICE.debug.setWanted(2));
      await sleep(800);
      let mid = null;
      let keysDown = false;
      const keysUp = async () => { if (keysDown) { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); keysDown = false; } };
      try {
        for (let i = 0; i < 300; i += 1) {
          const s = await stats();
          if (s.wanted === 0) break;
          if (s.escaping && s.progress >= 0.3 && s.progress <= 0.55) { mid = s; break; }
          if (s.escaping) { await keysUp(); }
          else {
            if (!keysDown) { await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); keysDown = true; }
            await steerTo(await findCover());
          }
          await heal();
          await sleep(250);
        }
      } finally { await keysUp(); }
      if (!mid) { console.log(`[B3] attempt ${attempt}: no mid-progress point`); continue; }
      console.log(`[B3] attempt ${attempt} mid:`, JSON.stringify(mid));
      let seen = null;
      const wall0 = Date.now();
      while (Date.now() - wall0 < 120000) {
        const s = await stats();
        if (s.wanted === 0) { console.log('[B3] escaped before being seen'); break; }
        if (s.canSee === true) { seen = s; break; }
        await heal();
        await sleep(300);
      }
      await sleep(400);
      const after = await stats();
      if (seen) reset = { attempt, mid, seen, afterSeen: after, progressAfterSeen: after.progress, wantedAfter: after.wanted };
      console.log('[B3] reset:', JSON.stringify(reset));
    }
    R.B3 = reset;
    await page.evaluate(() => { window.NEON_VICE.debug.clearPolice(); window.NEON_VICE.debug.setWanted(0); });
  }

  // ---------- D. HUD INDICATOR: SPOTTED vs ESCAPING, EN + ID ----------
  // For each language: setWanted(2) -> wait canSee=true -> assert label
  // SPOTTED!/TERLIHAT! (red, bar hidden) + screenshot; then run to cover
  // -> wait escaping with progress>0.1 -> assert ESCAPING.../KABUR... + %
  // (green, bar shown) + screenshot. Also assert label hidden at wanted 0.
  async function hudShots(lang, tag) {
    await page.evaluate((l) => window.NEON_VICE.game.ui.setLang(l), lang);
    await sleep(300);
    await resetScene(-200, -150);
    await page.evaluate(() => window.NEON_VICE.debug.setWanted(2));
    await sleep(800);
    const res = { lang, spotted: null, escaping: null, hiddenAtWanted0: null };
    // SPOTTED: wait until a police unit can see the player.
    const wall0 = Date.now();
    let spottedState = null;
    while (Date.now() - wall0 < 90000) {
      const s = await stats();
      if (s.canSee === true && s.wanted > 0) { spottedState = s; break; }
      await heal();
      await sleep(250);
    }
    if (spottedState) {
      const h = await hud();
      res.spotted = { stats: spottedState, hud: h, labelOk: h.label === (lang === 'id' ? 'TERLIHAT!' : 'SPOTTED!'), visibleOk: !h.hidden, trackHiddenOk: h.trackDisplay === 'none', redOk: h.labelColor === 'rgb(239, 68, 68)' };
      console.log(`[D-${tag}] SPOTTED:`, JSON.stringify(res.spotted));
      await page.screenshot({ path: `${OUT}/hud-spotted-${tag}.png` });
    } else {
      console.log(`[D-${tag}] SPOTTED: never seen within 90 s wall`);
    }
    // ESCAPING: run to cover, wait for the timer to run with progress.
    let escState = null;
    let keysDown = false;
    const keysUp = async () => { if (keysDown) { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); keysDown = false; } };
    try {
      const wall1 = Date.now();
      while (Date.now() - wall1 < 120000) {
        const s = await stats();
        if (s.wanted === 0) break;
        if (s.escaping && s.progress > 0.1) { escState = s; break; }
        if (s.escaping) { await keysUp(); }
        else {
          if (!keysDown) { await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); keysDown = true; }
          await steerTo(await findCover());
        }
        await heal();
        await sleep(250);
      }
    } finally { await keysUp(); }
    if (escState) {
      const h = await hud();
      const wantPrefix = lang === 'id' ? 'KABUR...' : 'ESCAPING...';
      res.escaping = { stats: escState, hud: h, labelOk: h.label && h.label.startsWith(wantPrefix), visibleOk: !h.hidden, trackShownOk: h.trackDisplay !== 'none', greenOk: h.labelColor === 'rgb(74, 222, 128)' };
      console.log(`[D-${tag}] ESCAPING:`, JSON.stringify(res.escaping));
      await page.screenshot({ path: `${OUT}/hud-escaping-${tag}.png` });
    } else {
      console.log(`[D-${tag}] ESCAPING: never reached progress>0.1 within 120 s wall`);
    }
    // Wanted 0 -> label hidden.
    await page.evaluate(() => { window.NEON_VICE.debug.clearPolice(); window.NEON_VICE.debug.setWanted(0); });
    await sleep(800);
    const h0 = await hud();
    res.hiddenAtWanted0 = { hud: h0, ok: h0.hidden === true };
    console.log(`[D-${tag}] wanted0 hidden:`, JSON.stringify(res.hiddenAtWanted0));
    return res;
  }
  R.D = [await hudShots('en', 'en'), await hudShots('id', 'id')];

  R.errors = errors;
  R.external = external;
  fs.writeFileSync(`${OUT}/tune.json`, JSON.stringify(R, null, 2));
  await browser.close();
  console.log(`TUNE done errors=${errors.length} external=${external.length}`);
  console.log('A pass:', R.A_pass, '| B1:', JSON.stringify(R.B1), '| B2:', JSON.stringify(R.B2), '| B3 reset:', R.B3 ? `progress ${R.B3.mid.progress} -> ${R.B3.progressAfterSeen}` : 'FAIL');
  console.log('D EN spotted:', JSON.stringify(R.D[0].spotted && { labelOk: R.D[0].spotted.labelOk, redOk: R.D[0].spotted.redOk }), 'escaping:', JSON.stringify(R.D[0].escaping && { labelOk: R.D[0].escaping.labelOk, greenOk: R.D[0].escaping.greenOk }), 'hidden0:', R.D[0].hiddenAtWanted0.ok);
  console.log('D ID spotted:', JSON.stringify(R.D[1].spotted && { labelOk: R.D[1].spotted.labelOk, redOk: R.D[1].spotted.redOk }), 'escaping:', JSON.stringify(R.D[1].escaping && { labelOk: R.D[1].escaping.labelOk, greenOk: R.D[1].escaping.greenOk }), 'hidden0:', R.D[1].hiddenAtWanted0.ok);
  process.exit(0);
}
main().catch((e) => { console.error('TUNE FAIL', e); process.exit(2); });
