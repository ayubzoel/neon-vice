// TUNE SUPPLEMENT — fills the three gaps of tune.js (same build, no code
// change): (1) ESCAPING HUD screenshots EN+ID, captured with the full
// A-run steering policy INCLUDING stuck detection (tune.js D-phase lacked
// it, so the player could pin against a facade forever); (2) reset check
// done actively: catch mid-progress, then walk INTO the open toward the
// nearest police so they see the player within ~1-2 s game-time (with the
// 6 s timer, standing still and waiting for them to round the corner is
// too slow — B3 attempt 1 escaped first); (3) one B1 retry, identical
// strategy to the retester, to tell flake from regression.
// Usage: node tests/evidence-v6/v63-tune/tune2.js   (dev server :8112)
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
  const R = { note: 'supplement: escaping shots EN+ID, active reset, B1 retry' };

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
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
      nearest: s.nearestPoliceDist, nearestLos: s.nearestPoliceLos, driving: s.driving, hp: s.hp,
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
  // Steer TOWARD the nearest living police unit (for the active reset).
  const steerTowardPolice = async () => page.evaluate(() => {
    const g = window.NEON_VICE.game;
    const p = g.player.group.position;
    const units = [...g.combat.police, ...g.combat.policeCars].filter((u) => !u.dead);
    let bx = null, bz = null, bd = 1e9;
    for (const u of units) {
      const d = Math.hypot(u.mesh.position.x - p.x, u.mesh.position.z - p.z);
      if (d < bd) { bd = d; bx = u.mesh.position.x; bz = u.mesh.position.z; }
    }
    if (bx === null) return null;
    const h = Math.atan2(bx - p.x, bz - p.z);
    window.NEON_VICE.debug.setCameraOrbit(h);
    g.player.heading = h;
    g.player.group.rotation.y = h;
    return { dist: +bd.toFixed(1) };
  });

  // ---------- D2. ESCAPING screenshots EN + ID (full A policy) ----------
  async function escapingShot(lang, tag) {
    await page.evaluate((l) => window.NEON_VICE.game.ui.setLang(l), lang);
    await sleep(300);
    let shot = null;
    for (let attempt = 0; attempt < 2 && !shot; attempt += 1) {
      await resetScene(-200, -150);
      await page.evaluate(() => window.NEON_VICE.debug.setWanted(2));
      await sleep(800);
      let keysDown = false, lastPos = null, fleeUntil = -1;
      const keysUp = async () => { if (keysDown) { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); keysDown = false; } };
      const keysDownFn = async () => { if (!keysDown) { await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); keysDown = true; } };
      try {
        for (let i = 0; i < 600; i += 1) {
          const s = await stats();
          if (s.wanted === 0) break;
          if (s.escaping && s.progress >= 0.15) {
            const h = await hud();
            const wantPrefix = lang === 'id' ? 'KABUR...' : 'ESCAPING...';
            shot = { attempt, stats: s, hud: h, labelOk: !!h.label && h.label.startsWith(wantPrefix), visibleOk: !h.hidden, trackShownOk: h.trackDisplay !== 'none', greenOk: h.labelColor === 'rgb(74, 222, 128)', barOk: h.barWidth === `${Math.round(s.progress * 100)}%` };
            console.log(`[D2-${tag}] ESCAPING:`, JSON.stringify(shot));
            await page.screenshot({ path: `${OUT}/hud-escaping-${tag}.png` });
            break;
          }
          if (s.escaping) { await keysUp(); }
          else {
            await keysDownFn();
            if (i % 8 === 0) {
              const hh = await hero();
              if (lastPos && Math.hypot(hh.x - lastPos.x, hh.z - lastPos.z) < 2) fleeUntil = i + 12;
              lastPos = { x: hh.x, z: hh.z };
            }
            const tgt = i <= fleeUntil ? null : await findCover();
            await steerTo(tgt);
          }
          await heal();
          await sleep(250);
        }
      } finally { await keysUp(); }
      if (!shot) console.log(`[D2-${tag}] attempt ${attempt}: no escaping shot (escaped or never hid)`);
    }
    await page.evaluate(() => { window.NEON_VICE.debug.clearPolice(); window.NEON_VICE.debug.setWanted(0); });
    return shot;
  }
  R.D2 = { en: await escapingShot('en', 'en'), id: await escapingShot('id', 'id') };

  // ---------- B3b. ACTIVE RESET: mid-progress -> walk into the open
  // toward the nearest police -> progress must return to 0, wanted stays 2.
  {
    let reset = null;
    for (let attempt = 0; attempt < 3 && !reset; attempt += 1) {
      await resetScene(-200, -150);
      await page.evaluate(() => window.NEON_VICE.debug.setWanted(2));
      await sleep(800);
      let mid = null;
      let keysDown = false, lastPos = null, fleeUntil = -1;
      const keysUp = async () => { if (keysDown) { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); keysDown = false; } };
      const keysDownFn = async () => { if (!keysDown) { await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); keysDown = true; } };
      try {
        for (let i = 0; i < 600; i += 1) {
          const s = await stats();
          if (s.wanted === 0) break;
          if (s.escaping && s.progress >= 0.15 && s.progress <= 0.45) { mid = s; break; }
          if (s.escaping) { await keysUp(); }
          else {
            await keysDownFn();
            if (i % 8 === 0) {
              const hh = await hero();
              if (lastPos && Math.hypot(hh.x - lastPos.x, hh.z - lastPos.z) < 2) fleeUntil = i + 12;
              lastPos = { x: hh.x, z: hh.z };
            }
            const tgt = i <= fleeUntil ? null : await findCover();
            await steerTo(tgt);
          }
          await heal();
          await sleep(250);
        }
      } finally { await keysUp(); }
      if (!mid) { console.log(`[B3b] attempt ${attempt}: no mid-progress point`); continue; }
      console.log(`[B3b] attempt ${attempt} mid:`, JSON.stringify(mid));
      // Walk straight at the nearest police until seen again.
      let seen = null;
      await page.keyboard.down('ShiftLeft');
      await page.keyboard.down('KeyW');
      try {
        const wall0 = Date.now();
        while (Date.now() - wall0 < 60000) {
          await steerTowardPolice();
          const s = await stats();
          if (s.wanted === 0) { console.log('[B3b] escaped before being seen'); break; }
          if (s.canSee === true) { seen = s; break; }
          await heal();
          await sleep(200);
        }
      } finally { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); }
      await sleep(400);
      const after = await stats();
      if (seen) reset = { attempt, midProgress: mid.progress, seenProgress: seen.progress, afterProgress: after.progress, wantedAfter: after.wanted, canSeeAfter: after.canSee, pass: after.progress === 0 && after.wanted === 2 };
      console.log('[B3b] reset:', JSON.stringify(reset));
    }
    R.B3b = reset;
    await page.evaluate(() => { window.NEON_VICE.debug.clearPolice(); window.NEON_VICE.debug.setWanted(0); });
  }

  // ---------- B1b. ★1 ON FOOT retry, identical strategy to the retester
  // (hold Shift+W, steer away from the nearest cop every poll). ----------
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
    R.B1b = { escaped: !!esc, durationGt: esc ? +(esc.gt - t0).toFixed(2) : null, maxProgress: +maxProgress.toFixed(3), needed: neededSeen };
    console.log('[B1b]', JSON.stringify(R.B1b));
    await page.screenshot({ path: `${OUT}/b1-retry-after.png` });
  }

  R.errors = errors;
  R.external = external;
  fs.writeFileSync(`${OUT}/tune2.json`, JSON.stringify(R, null, 2));
  await browser.close();
  console.log(`TUNE2 done errors=${errors.length} external=${external.length}`);
  console.log('D2 EN:', JSON.stringify(R.D2.en && { labelOk: R.D2.en.labelOk, greenOk: R.D2.en.greenOk, barOk: R.D2.en.barOk }), '| D2 ID:', JSON.stringify(R.D2.id && { labelOk: R.D2.id.labelOk, greenOk: R.D2.id.greenOk, barOk: R.D2.id.barOk }));
  console.log('B3b reset:', JSON.stringify(R.B3b), '| B1b:', JSON.stringify(R.B1b));
  process.exit(0);
}
main().catch((e) => { console.error('TUNE2 FAIL', e); process.exit(2); });
