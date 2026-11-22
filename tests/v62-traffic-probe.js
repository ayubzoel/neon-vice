// Neon Vice v6.2 — traffic wedge probe (Playwright, SwiftShader).
// Same method as the independent tester's v6.1 probe (per-id tracking,
// 100 s game-time, sliding 20 s windows, stuck = displacement < 3 m
// in the flyover corridor |x-60|<15 or |x-300|<15, |z|<70), so the v6.2
// numbers are directly comparable to the v6.1 verdict (run1 0 stuck,
// run2 1 stuck: id=10 on the deck at (300,6,4.97)).
// Small viewport (480x300) for render speed only — the game logic is
// identical; the probe measures positions, not pixels.
// Usage: node tests/v62-traffic-probe.js <runTag>  (server :8110)
const fs = require('fs');
const OUT = '/home/hatch/workspace/makefun/neon-vice-entry/tests/evidence-v6/v62';
const TAG = process.argv[2] || 'run1';
const URL = 'http://localhost:8110/?autostart=new';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const inCorridor = (x, z) =>
  (Math.abs(x - 60) < 15 || Math.abs(x - 300) < 15) && Math.abs(z) < 70;

async function main() {
  const { chromium } = await import('/home/hatch/workspace/custom-skills/playwright_skill/node_modules/playwright-core/index.mjs');
  const browser = await chromium.launch({
    executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 480, height: 300 } });
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith('http://localhost:8110')) external.push(r.url()); });
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 60000 });
  await sleep(3000);

  const snaps = [];
  const t0 = (await page.evaluate(() => window.NEON_VICE.stats().gameTime));
  let gt = t0;
  while (gt - t0 < 100) {
    const s = await page.evaluate(() => ({
      gt: window.NEON_VICE.stats().gameTime,
      cars: window.NEON_VICE.game.vehicles.list
        .filter((v) => v.traffic)
        .map((v) => ({
          id: v.id, kind: v.kind,
          x: +v.mesh.position.x.toFixed(2),
          y: +v.mesh.position.y.toFixed(2),
          z: +v.mesh.position.z.toFixed(2),
          v: +v.speed.toFixed(2),
          h: +v.heading.toFixed(2),
          u: v._unstuckCount || 0,
        })),
    }));
    snaps.push(s);
    gt = s.gt;
    await sleep(2000);
  }
  await browser.close();

  const tracks = new Map();
  for (const s of snaps) for (const c of s.cars) {
    if (!tracks.has(c.id)) tracks.set(c.id, []);
    tracks.get(c.id).push({ gt: s.gt, ...c });
  }
  const corridorStuck = [];
  const anywhereStuck = [];
  let corridorEntries = 0;
  for (const [id, tr] of tracks) {
    let entered = false;
    for (const p of tr) if (inCorridor(p.x, p.z)) { entered = true; break; }
    if (entered) corridorEntries++;
    for (let a = 0; a < tr.length; a++) {
      let b = -1;
      for (let j = a + 1; j < tr.length; j++) { if (tr[j].gt - tr[a].gt >= 20) { b = j; break; } }
      if (b < 0) break;
      const d = Math.hypot(tr[b].x - tr[a].x, tr[b].z - tr[a].z);
      const corr = inCorridor(tr[a].x, tr[a].z) || inCorridor(tr[b].x, tr[b].z);
      if (d < 3) {
        const rec = { id, kind: tr[a].kind, fromGt: +tr[a].gt.toFixed(1), toGt: +tr[b].gt.toFixed(1), disp: +d.toFixed(2), at: { x: tr[b].x, y: tr[b].y, z: tr[b].z, v: tr[b].v, h: tr[b].h } };
        if (corr && !corridorStuck.some((f) => f.id === id)) corridorStuck.push(rec);
        if (!anywhereStuck.some((f) => f.id === id)) anywhereStuck.push(rec);
      }
    }
  }
  let unstuckFired = 0;
  for (const [, tr] of tracks) unstuckFired += (tr[tr.length - 1].u - tr[0].u);
  let minDisp = Infinity; let minDispId = null;
  for (const [id, tr] of tracks) {
    for (let a = 0; a < tr.length; a++) {
      let b = -1;
      for (let j = a + 1; j < tr.length; j++) { if (tr[j].gt - tr[a].gt >= 20) { b = j; break; } }
      if (b < 0) break;
      const d = Math.hypot(tr[b].x - tr[a].x, tr[b].z - tr[a].z);
      if (d < minDisp) { minDisp = d; minDispId = id; }
    }
  }
  const report = {
    tag: TAG, head: 'v6.2', samples: snaps.length,
    gameTimeSpan: +(gt - t0).toFixed(1),
    trafficCount: snaps[0].cars.length, idsTracked: tracks.size,
    corridorEntries, unstuckFired,
    minDisp20s: { id: minDispId, m: +minDisp.toFixed(2) },
    corridorStuck, anywhereStuck, errors, external,
  };
  fs.writeFileSync(`${OUT}/v62-probe-${TAG}.json`, JSON.stringify(report, null, 2));
  fs.writeFileSync(`${OUT}/v62-probe-${TAG}-samples.json`, JSON.stringify(snaps));
  console.log(`[${TAG}] samples=${snaps.length} span=${report.gameTimeSpan}s traffic=${report.trafficCount} ids=${tracks.size} corridorEntries=${corridorEntries} unstuckFired=${unstuckFired}`);
  console.log(`[${TAG}] CORRIDOR STUCK: ${corridorStuck.length}  ANYWHERE STUCK: ${anywhereStuck.length}  errors=${errors.length} external=${external.length}`);
  console.log(`[${TAG}] min 20s displacement anywhere: id=${minDispId} ${minDisp.toFixed(2)} m`);
  for (const f of corridorStuck) console.log(`  STUCK id=${f.id} ${f.kind} gt ${f.fromGt}->${f.toGt} disp=${f.disp}m at=(${f.at.x},${f.at.y},${f.at.z}) v=${f.at.v}`);
  for (const f of anywhereStuck) if (!corridorStuck.some((c) => c.id === f.id)) console.log(`  stuck-anywhere id=${f.id} ${f.kind} gt ${f.fromGt}->${f.toGt} disp=${f.disp}m at=(${f.at.x},${f.at.y},${f.at.z}) v=${f.at.v}`);
  // Exit criterion: a corridor wedge, a console/page error, or an
  // external request fails the run. "Anywhere stuck" is NOT a failure
  // by itself: the raw disp<3 m metric also flags U-turns (a car that
  // drives 50 m west and 45 m back east in one window has net disp
  // ~2 m but path length ~180 m — see the path-length re-analysis).
  // A genuinely wedged car has path length < 15 m in 20 s AND the
  // 15 s still-timer fires the unstuck (unstuckFired > 0); a flagged
  // car with unstuckFired == 0 and v ~ 10 was turning around.
  const failed = corridorStuck.length || errors.length || external.length;
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('PROBE FAIL', e); process.exit(2); });
