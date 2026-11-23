// TUNE DIAGNOSTIC — ★1 on foot with the COVER-SEEKING policy (same as the
// A runs), to tell whether the two B1 failures are a ★1 mechanic problem
// or just the weak "run away from the nearest cop" steering (no cover
// seeking — it pins the player against facades). Same build, no code change.
// Usage: node tests/evidence-v6/v63-tune/tune3.js   (dev server :8112)
const fs = require('fs');
const OUT = '/home/hatch/workspace/makefun/neon-vice-entry/tests/evidence-v6/v63-tune';
const URL = 'http://localhost:8112/?autostart=new';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { chromium } = await import('/home/hatch/workspace/custom-skills/playwright_skill/node_modules/playwright-core/index.mjs');
  const browser = await chromium.launch({
    executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const errors = [];
  const R = {};
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 60000 });
  await sleep(2000);
  await page.evaluate(() => { if (window.NEON_VICE.debug.setStepBudget) window.NEON_VICE.debug.setStepBudget(24); });
  const stats = async () => page.evaluate(() => {
    const s = window.NEON_VICE.stats();
    return { gt: +s.gameTime.toFixed(2), wanted: s.wanted, canSee: s.policeCanSee, escaping: s.escaping, progress: s.escapeProgress, needed: s.escapeNeeded, nearest: s.nearestPoliceDist, nearestLos: s.nearestPoliceLos, hp: s.hp };
  });
  const hero = async () => page.evaluate(() => window.NEON_VICE.hero());
  const heal = () => page.evaluate(() => window.NEON_VICE.debug.setHp(100));
  const findCover = () => page.evaluate(() => {
    const g = window.NEON_VICE.game;
    const p = g.player.group.position;
    const w = g.world;
    const units = [...g.combat.police, ...g.combat.policeCars].filter((u) => !u.dead).map((u) => ({ x: u.mesh.position.x, z: u.mesh.position.z }));
    if (!units.length) return null;
    const blocked = (ax, az, bx, bz, r) => {
      const dx = bx - ax, dz = bz - az, dist = Math.hypot(dx, dz);
      const n = Math.max(1, Math.ceil(dist / 4));
      for (let i = 1; i < n; i += 1) { const t = i / n; if (w.collides(ax + dx * t, az + dz * t, r)) return true; }
      return false;
    };
    let best = null, bestScore = -1e9;
    for (let k = 0; k < 24; k += 1) {
      const a = (k / 24) * Math.PI * 2;
      for (const r of [14, 22, 30]) {
        const cx = p.x + Math.cos(a) * r, cz = p.z + Math.sin(a) * r;
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
      for (const u of units) { const d = Math.hypot(u.mesh.position.x - p.x, u.mesh.position.z - p.z); if (d < bd) { bd = d; bx = u.mesh.position.x; bz = u.mesh.position.z; } }
      tx = p.x + (p.x - bx); tz = p.z + (p.z - bz);
    }
    const h = Math.atan2(tx - p.x, tz - p.z);
    window.NEON_VICE.debug.setCameraOrbit(h);
    g.player.heading = h; g.player.group.rotation.y = h;
    return h;
  }, target);

  await page.evaluate(() => { window.NEON_VICE.debug.teleport(-200, -150); window.NEON_VICE.debug.clearPolice(); });
  await sleep(600);
  await page.evaluate(() => window.NEON_VICE.debug.setWanted(1));
  await sleep(800);
  const t0 = (await stats()).gt;
  let esc = null, maxProgress = 0, resets = 0, progressHigh = false;
  let keysDown = false, lastPos = null, fleeUntil = -1;
  const keysUp = async () => { if (keysDown) { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); keysDown = false; } };
  const keysDownFn = async () => { if (!keysDown) { await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); keysDown = true; } };
  try {
    for (let i = 0; i < 600; i += 1) {
      const s = await stats();
      if (s.progress > maxProgress) maxProgress = s.progress;
      if (progressHigh && s.progress < 0.05 && s.wanted > 0) { resets += 1; progressHigh = false; }
      if (s.progress > 0.3) progressHigh = true;
      if (s.wanted === 0) { esc = s; break; }
      if (s.escaping) { await keysUp(); }
      else {
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
  R.B1cover = { escaped: !!esc, durationGt: esc ? +(esc.gt - t0).toFixed(2) : null, maxProgress: +maxProgress.toFixed(3), resets, needed: 5 };
  console.log('[B1cover]', JSON.stringify(R.B1cover));
  await page.screenshot({ path: `${OUT}/b1-cover-after.png` });
  R.errors = errors;
  fs.writeFileSync(`${OUT}/tune3.json`, JSON.stringify(R, null, 2));
  await browser.close();
  console.log(`TUNE3 done errors=${errors.length}`);
  process.exit(0);
}
main().catch((e) => { console.error('TUNE3 FAIL', e); process.exit(2); });
