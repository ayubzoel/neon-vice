// Neon Vice v6.2 — deck unstuck BACKSTOP proof, primed timer (Playwright).
// The placement test (v62-unstuck-deck.js) proves no deck car stays stuck:
// every placed car drives off by itself within ~11 s game-time via the
// v6.2 exit override, so the 15 s still-timer never fires. That leaves
// the backstop itself unproven — so this script proves it directly: it
// places cars on the decks facing the barriers (the v6.1 wedge state)
// and PRIMES the still-timer (_stuckT = 14.9 s at the car's position),
// so the real unstickCar() fires on the next tick. It must teleport
// each car to the ramp foot past the flyover (jump >= 2 m, ground
// level, on the road, heading forced along the road), and the car must
// then drive away (displacement > 10 m in a later 10 s window).
// Four cases, one page load: both flyovers x both barrier facings.
// Run twice (node tests/v62-unstuck-deck-primed.js run1|run2).
// Usage: node tests/v62-unstuck-deck-primed.js [runTag]  (server :8110)
const fs = require('fs');
const OUT = '/home/hatch/workspace/makefun/neon-vice-entry/tests/evidence-v6/v62';
const TAG = process.argv[2] || 'run1';
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
  const page = await browser.newPage({ viewport: { width: 480, height: 300 } });
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith('http://localhost:8110')) external.push(r.url()); });
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 60000 });
  await page.evaluate(() => window.NEON_VICE.debug.setStepBudget(24));
  await sleep(3000);

  // Place 4 cars on the decks facing the barriers, still-timer primed
  // so the unstuck fires on the next tick. Expected foot = the nearer
  // ramp foot (heading ~EW is indecisive, so flyoverExit falls back to
  // the nearer foot), heading forced along the road away from the deck.
  const placed = await page.evaluate(() => {
    const g = window.NEON_VICE.game;
    const stock = g.vehicles.list.filter((v) => v.traffic && v.id < 1000);
    const out = [];
    const put = (v, x, y, z, h, label, exp) => {
      v.mesh.position.set(x, y, z);
      v.heading = h; v.mesh.rotation.y = h; v.speed = 0;
      v.reverse = 0; v.wait = 0;
      // Prime the still-timer: 14.9 s already "stuck" at this spot.
      v._stuckX = x; v._stuckZ = z; v._stuckT = 14.9;
      // Baseline unstuck count BEFORE the primed firing (the firing
      // lands within ~0.1 s game-time, before the first sample).
      out.push({ id: v.id, label, at: { x, y, z }, h, exp, u0: v._unstuckCount || 0 });
    };
    put(stock[0], 300, 6, 5, 4.67, 'A deck x=300 west', { x: 301.5, z: 65, h: 0 });
    put(stock[1], 60, 6, -5, 1.57, 'B deck x=60 east', { x: 58.5, z: -65, h: Math.PI });
    put(stock[2], 300, 6, -5, 1.57, 'C deck x=300 east', { x: 298.5, z: -65, h: Math.PI });
    put(stock[3], 60, 6, 5, 4.67, 'D deck x=60 west', { x: 61.5, z: 65, h: 0 });
    return out;
  });
  check('4 mobil ditempatkan di deck hadap pembatas, timer di-prime', placed.length === 4, JSON.stringify(placed.map((p) => `${p.label} id=${p.id}`)));
  const ids = placed.map((p) => p.id);

  const t0 = await page.evaluate(() => window.NEON_VICE.stats().gameTime);
  const snaps = [];
  let gt = t0;
  while (gt - t0 < 40) {
    const s = await page.evaluate((want) => ({
      gt: window.NEON_VICE.stats().gameTime,
      cars: window.NEON_VICE.game.vehicles.list
        .filter((v) => want.includes(v.id))
        .map((v) => ({ id: v.id, x: +v.mesh.position.x.toFixed(2), y: +v.mesh.position.y.toFixed(2), z: +v.mesh.position.z.toFixed(2), v: +v.speed.toFixed(2), h: +v.heading.toFixed(2), u: v._unstuckCount || 0, onRoad: !!window.NEON_VICE.game.world.roadGraph.isOnRoad(v.mesh.position.x, v.mesh.position.z) })),
    }), ids);
    snaps.push(s);
    gt = s.gt;
    const allFreed = placed.every((p) => {
      const tr = snaps.map((x) => ({ gt: x.gt, ...x.cars.find((c) => c.id === p.id) })).filter((x) => x.x !== undefined);
      if (!tr.some((x) => x.u >= 1)) return false;
      for (let a = 0; a < tr.length; a++) {
        const b = tr.findIndex((x) => x.gt - tr[a].gt >= 10);
        if (b < 0) break;
        if (Math.hypot(tr[b].x - tr[a].x, tr[b].z - tr[a].z) > 10) return true;
      }
      return false;
    });
    if (allFreed) break;
    // Sample fast (300 ms): the primed firing lands within ~0.1 s
    // game-time, and the car drives ~6 m past the foot before a 1.5 s
    // sample would see it — too late to verify the landing point.
    await sleep(300);
  }
  await browser.close();

  const report = { tag: TAG, head: 'v6.2', primed: true, placed, errors, external, cars: {} };
  for (const p of placed) {
    // Prepend a synthetic baseline sample (placement position, pre-fire
    // unstuck count): the primed firing lands before the first real
    // sample, so without it the firing is invisible to the diff.
    const tr = [{ gt: t0, x: p.at.x, y: p.at.y, z: p.at.z, v: 0, h: p.h, u: p.u0, onRoad: false },
      ...snaps.map((s) => ({ gt: s.gt, ...s.cars.find((c) => c.id === p.id) })).filter((t) => t.x !== undefined)];
    const firings = [];
    for (let i = 1; i < tr.length; i++) {
      if (tr[i].u > tr[i - 1].u) {
        firings.push({ gt: +(tr[i].gt - t0).toFixed(2), u: tr[i].u, before: { x: tr[i - 1].x, y: tr[i - 1].y, z: tr[i - 1].z }, after: { x: tr[i].x, y: tr[i].y, z: tr[i].z, h: tr[i].h, onRoad: tr[i].onRoad }, jump: +Math.hypot(tr[i].x - tr[i - 1].x, tr[i].z - tr[i - 1].z).toFixed(2) });
      }
    }
    let maxDisp10 = 0;
    let freedAt = null;
    for (let a = 0; a < tr.length; a++) {
      const b = tr.findIndex((t) => t.gt - tr[a].gt >= 10);
      if (b < 0) break;
      const d = Math.hypot(tr[b].x - tr[a].x, tr[b].z - tr[a].z);
      if (d > maxDisp10) maxDisp10 = d;
      if (d > 10 && freedAt === null) freedAt = +(tr[b].gt - t0).toFixed(1);
    }
    const last = tr[tr.length - 1];
    const freed = maxDisp10 > 10;
    // The firing must land on the expected ramp foot (within 2 m),
    // at ground level, on the road, with the heading forced along it.
    const f = firings[0];
    const footOk = !!f && f.jump >= 2 && f.after.y < 0.5 && f.after.onRoad
      && Math.hypot(f.after.x - p.exp.x, f.after.z - p.exp.z) < 2
      && Math.abs(((f.after.h - p.exp.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.2;
    report.cars[p.id] = {
      label: p.label, firings, unstuckTotal: last.u,
      firstFiringGt: firings.length ? firings[0].gt : null,
      maxDisp10s: +maxDisp10.toFixed(2), freed, freedAt, footOk,
      end: { x: last.x, y: last.y, z: last.z, v: last.v, gt: +(last.gt - t0).toFixed(1) },
    };
    check(`${p.label} (id=${p.id}): unstuck teleport ke kaki ramp ${JSON.stringify(p.exp)} + kembali ke jalan`,
      freed && footOk,
      `firings=${firings.length} jump=${firings.map((x) => x.jump).join(',')} after=${f ? JSON.stringify(f.after) : '?'} freedAt~${freedAt}s maxDisp10s=${maxDisp10.toFixed(1)}m`);
  }
  check('0 console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('0 request eksternal', external.length === 0, external.slice(0, 3).join(' | '));
  fs.writeFileSync(`${OUT}/v62-unstuck-deck-primed-${TAG}.json`, JSON.stringify({ results, report }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nv6.2 unstuck deck primed ${TAG}: ${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
