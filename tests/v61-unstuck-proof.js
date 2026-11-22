// Neon Vice v6.1 — unstuck safety-net proof (Playwright, SwiftShader).
// Teleports one stock traffic car and one ambient traffic car INTO
// building footprints (where no forward/reverse step can ever pass) and
// proves the v6.1 unstuck teleports each back onto a road within ~15 s
// of game time, with _unstuckCount incrementing. The 100 s traffic
// probe proves wedges no longer OCCUR; this proves the backstop WORKS
// if one ever does.
// Usage: node tests/v61-unstuck-proof.js  (uses the dev server on :8110)
const fs = require('fs');
const OUT = '/home/hatch/workspace/makefun/neon-vice-entry/tests/evidence-v6/v61';
const URL = 'http://localhost:8110/?autostart=new';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  const { chromium } = await import('/home/hatch/workspace/custom-skills/playwright_skill/node_modules/playwright-core/index.mjs');
  const browser = await chromium.launch({
    executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 60000 });
  await sleep(3000);

  // Find two building-interior spots (collides, off-road) in different blocks.
  const spots = await page.evaluate(() => {
    const g = window.NEON_VICE.game;
    const found = [];
    outer: for (let bx = -420; bx <= 360; bx += 60) {
      for (let bz = -300; bz <= 300; bz += 60) {
        for (let ox = 20; ox <= 40; ox += 10) {
          for (let oz = 20; oz <= 40; oz += 10) {
            const x = bx + ox;
            const z = bz + oz;
            if (g.world.collides(x, z, 1.5) && !g.world.roadGraph.isOnRoad(x, z)) {
              if (found.every((f) => Math.hypot(f.x - x, f.z - z) > 150)) found.push({ x, z });
              if (found.length >= 2) break outer;
            }
          }
        }
      }
    }
    return found;
  });
  check('dua titik di dalam bangunan ditemukan (collides + off-road)', spots.length >= 2, JSON.stringify(spots));
  if (spots.length < 2) { await browser.close(); process.exit(1); }

  // Teleport one stock car (id<1000) to spots[0], one ambient car (id>=1000) to spots[1].
  const placed = await page.evaluate((sp) => {
    const g = window.NEON_VICE.game;
    const stock = g.vehicles.traffic[0];
    const amb = g.vehicles.list.find((v) => v.traffic && v.id >= 1000);
    const out = [];
    for (const [v, s] of [[stock, sp[0]], [amb, sp[1]]]) {
      if (!v) { out.push(null); continue; }
      v.mesh.position.set(s.x, 0, s.z);
      v.heading = 0; v.mesh.rotation.y = 0; v.speed = 0; v.reverse = 0; v.wait = 0;
      v._stuckX = undefined; v._stuckT = 0;
      out.push({ id: v.id, at: s });
    }
    return out;
  }, spots);
  check('mobil stock + ambient ditempatkan di dalam bangunan', placed.every(Boolean), JSON.stringify(placed));
  const ids = placed.map((p) => p.id);

  const gameTime = () => page.evaluate(() => window.NEON_VICE.stats().gameTime);
  const sample = () => page.evaluate((ids2) => {
    const g = window.NEON_VICE.game;
    return ids2.map((id) => {
      const v = g.vehicles.list.find((c) => c.id === id);
      return v ? {
        id, x: +v.mesh.position.x.toFixed(1), z: +v.mesh.position.z.toFixed(1),
        onRoad: !!g.world.roadGraph.isOnRoad(v.mesh.position.x, v.mesh.position.z),
        unstuck: v._unstuckCount || 0, speed: +v.speed.toFixed(1),
      } : null;
    });
  }, ids);

  const t0 = await gameTime();
  let tracks = { [ids[0]]: [], [ids[1]]: [] };
  let gt = t0;
  while (gt - t0 < 30) {
    const s = await sample();
    gt = await gameTime();
    for (const c of s) if (c) tracks[c.id].push({ gt: +(gt - t0).toFixed(1), ...c });
    await sleep(1500);
  }
  const final = await sample();
  for (const c of final) {
    const tr = tracks[c.id];
    const firedAt = tr.find((t) => t.unstuck >= 1);
    check(`mobil id=${c.id}: unstuck bekerja (teleport ke jalan, _unstuckCount>=1)`,
      c.unstuck >= 1 && c.onRoad,
      `unstuck=${c.unstuck} onRoad=${c.onRoad} at=(${c.x},${c.z}) fired~${firedAt ? firedAt.gt + 's' : '?'}`);
  }
  check('0 console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  fs.writeFileSync(`${OUT}/v61-unstuck-proof.json`, JSON.stringify({ results, errors, tracks }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nv6.1 unstuck proof: ${results.length - failed}/${results.length} passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
