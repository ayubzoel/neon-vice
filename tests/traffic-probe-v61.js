// Parent probe v2: lalu lintas nyangkut di koridor flyover v6?
// Pelacakan per id stabil (v.id), BUKAN nearest-neighbor.
// Sampling ~1.5 dtk wall selama ~100 dtk game-time; analisis jendela geser 20 dtk.
// Usage: node /tmp/neon-vice-v6/parent/traffic-probe2.js
const fs = require('fs');
const OUT = '/home/hatch/workspace/makefun/neon-vice-entry/tests/evidence-v6/v61';
const URL = 'http://localhost:8110/?autostart=new';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  const samples = [];
  const t0 = await page.evaluate(() => window.NEON_VICE.stats().gameTime);
  let gt = t0;
  while (gt - t0 < 100) {
    const s = await page.evaluate(() => ({
      gt: window.NEON_VICE.stats().gameTime,
      cars: window.NEON_VICE.game.vehicles.list.filter((v) => v.traffic).map((v) => ({
        id: v.id, x: +v.mesh.position.x.toFixed(2), z: +v.mesh.position.z.toFixed(2),
        y: +v.mesh.position.y.toFixed(2), speed: +v.speed.toFixed(2),
        heading: +v.heading.toFixed(2), kind: v.kind, unstuck: v._unstuckCount || 0,
      })),
    }));
    samples.push(s);
    gt = s.gt;
    await sleep(1500);
  }
  await browser.close();

  const nearFly = (p) => [60, 300].some((fx) => Math.abs(p.x - fx) < 15 && Math.abs(p.z) < 70);
  // Build per-id tracks.
  const tracks = new Map();
  for (const s of samples) for (const c of s.cars) {
    if (!tracks.has(c.id)) tracks.set(c.id, []);
    tracks.get(c.id).push({ gt: s.gt, ...c });
  }
  const flagged = [];
  for (const [id, tr] of tracks) {
    for (let a = 0; a < tr.length; a += 1) {
      const b = tr.findIndex((t) => t.gt - tr[a].gt >= 20);
      if (b < 0) break;
      const d = Math.hypot(tr[b].x - tr[a].x, tr[b].z - tr[a].z);
      if (d < 3 && (nearFly(tr[a]) || nearFly(tr[b]))) {
        flagged.push({ id, kind: tr[a].kind, fromGt: +tr[a].gt.toFixed(1), toGt: +tr[b].gt.toFixed(1), disp: +d.toFixed(2), at: tr[b], track: tr.slice(a, b + 1) });
        break; // satu flag per mobil
      }
    }
  }
  const unstuckTotal = samples.length ? samples[samples.length-1].cars.reduce((a,c)=>a+(c.unstuck||0),0) : 0;
  const report = { samples: samples.length, unstuckTotal, gameTimeSpan: +(gt - t0).toFixed(1), trafficCount: samples[0].cars.length, ids: [...tracks.keys()].length, errors, flagged };
  fs.writeFileSync(`${OUT}/traffic-probe-v61-${process.argv[2] || 'run1'}.json`, JSON.stringify(report, null, 2));
  console.log(`samples=${samples.length} span=${report.gameTimeSpan}s game-time traffic=${report.trafficCount} ids=${report.ids} errors=${errors.length}`);
  console.log(`FLAGGED stuck cars (id-tracked): ${flagged.length}`);
  for (const f of flagged) {
    console.log(`- id=${f.id} ${f.kind} gt ${f.fromGt}->${f.toGt} disp=${f.disp}m at=(${f.at.x},${f.at.y},${f.at.z}) v=${f.at.speed} h=${f.at.heading}`);
    const step = Math.max(1, Math.floor(f.track.length / 12));
    for (let i = 0; i < f.track.length; i += step) {
      const t = f.track[i];
      console.log(`    gt=${t.gt.toFixed(1)} (${t.x},${t.y},${t.z}) v=${t.speed} h=${t.heading}`);
    }
    const last = f.track[f.track.length - 1];
    console.log(`    last gt=${last.gt.toFixed(1)} (${last.x},${last.y},${last.z}) v=${last.speed} h=${last.heading}`);
  }
}
main().catch((e) => { console.error('PROBE FAIL', e); process.exit(1); });
