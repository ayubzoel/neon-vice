// Neon Vice v6.2 — unstuck proof for the DECK case (Playwright, SwiftShader).
// The v6.1 unstuck only proved the building case, where nearest-road
// teleport trivially works. This proves the case that actually failed
// in the independent probe: a car wedged ON a flyover deck.
// Four cases, one page load: both flyovers x both facings.
//   A: deck x=300, heading north (probe run2 id=10 wedge spot)
//   B: deck x=60,  heading south (tester car B, 3 failed firings)
//   C: deck x=300, heading south
//   D: deck x=60,  heading north
// Plus two barrier-facing cases (the id=10 final state), placed 1 m
// off the deck centre so the exit turn clips the barrier and the car
// cannot free itself by driving:
//   E: deck x=300, heading west, x=299
//   F: deck x=60,  heading east, x=61
// Each car must return to the road (displacement > 10 m in a later
// 10 s window) within 45 s game-time — by driving off (the v6.2 exit
// override) or by the unstuck. Any unstuck firing must be a GOOD
// teleport: jump >= 2 m, landing at ground level on a road (a deck
// firing must land near a ramp foot). A firing that teleports the car
// to (almost) its own position fails the case, as in v6.1.
// Run twice (node tests/v62-unstuck-deck.js run1|run2).
// Usage: node tests/v62-unstuck-deck.js [runTag]  (dev server on :8110)
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

  // Place 6 cars on the decks: both flyovers x NS facings + 2
  // barrier-facing (1 m off-centre, so the exit turn clips).
  // NOTE: ambient cars live in vehicles.list, not vehicles.traffic
  // (the v6.1 tester script read vehicles.traffic and silently placed
  // only 2 cars — its car C never existed).
  const placed = await page.evaluate(() => {
    const g = window.NEON_VICE.game;
    const stock = g.vehicles.list.filter((v) => v.traffic && v.id < 1000);
    const amb = g.vehicles.list.filter((v) => v.traffic && v.id >= 1000);
    const out = [];
    const put = (v, x, y, z, h, label) => {
      v.mesh.position.set(x, y, z);
      v.heading = h; v.mesh.rotation.y = h; v.speed = 0;
      v.reverse = 0; v.wait = 0;
      v._stuckX = undefined; v._stuckT = 0;
      out.push({ id: v.id, label, at: { x, y, z }, h });
    };
    put(stock[0], 300, 6, 5, Math.PI, 'A deck x=300 north');
    put(stock[1], 60, 6, -5, 0, 'B deck x=60 south');
    if (amb[0]) put(amb[0], 300, 6, -5, 0, 'C deck x=300 south');
    if (amb[1]) put(amb[1], 60, 6, 5, Math.PI, 'D deck x=60 north');
    put(stock[2], 299, 6, 0, 4.67, 'E deck x=300 west (barrier)');
    put(stock[3], 61, 6, 0, 1.57, 'F deck x=60 east (barrier)');
    return out;
  });
  check('6 mobil ditempatkan di deck (2 flyover x NS + 2 hadap pembatas)', placed.length === 6, JSON.stringify(placed.map((p) => `${p.label} id=${p.id}`)));
  const ids = placed.map((p) => p.id);

  const t0 = await page.evaluate(() => window.NEON_VICE.stats().gameTime);
  const snaps = [];
  let gt = t0;
  while (gt - t0 < 45) {
    const s = await page.evaluate((want) => ({
      gt: window.NEON_VICE.stats().gameTime,
      cars: window.NEON_VICE.game.vehicles.list
        .filter((v) => want.includes(v.id))
        .map((v) => ({ id: v.id, x: +v.mesh.position.x.toFixed(2), y: +v.mesh.position.y.toFixed(2), z: +v.mesh.position.z.toFixed(2), v: +v.speed.toFixed(2), h: +v.heading.toFixed(2), u: v._unstuckCount || 0, onRoad: !!window.NEON_VICE.game.world.roadGraph.isOnRoad(v.mesh.position.x, v.mesh.position.z) })),
    }), ids);
    snaps.push(s);
    gt = s.gt;
    // Stop early once every car has driven away (maxDisp10s > 10).
    const allFreed = placed.every((p) => {
      const tr = snaps.map((x) => ({ gt: x.gt, ...x.cars.find((c) => c.id === p.id) })).filter((x) => x.x !== undefined);
      for (let a = 0; a < tr.length; a++) {
        const b = tr.findIndex((x) => x.gt - tr[a].gt >= 10);
        if (b < 0) break;
        if (Math.hypot(tr[b].x - tr[a].x, tr[b].z - tr[a].z) > 10) return true;
      }
      return false;
    });
    if (allFreed) break;
    await sleep(1500);
  }
  await browser.close();

  // Analyze each car: unstuck firings (with position jump), first firing
  // time, max displacement in any 10 s window, final state.
  const report = { tag: TAG, head: 'v6.2', placed, errors, external, cars: {} };
  for (const p of placed) {
    const tr = snaps.map((s) => ({ gt: s.gt, ...s.cars.find((c) => c.id === p.id) })).filter((t) => t.x !== undefined);
    const firings = [];
    for (let i = 1; i < tr.length; i++) {
      if (tr[i].u > tr[i - 1].u) {
        firings.push({ gt: +(tr[i].gt - t0).toFixed(1), u: tr[i].u, before: { x: tr[i - 1].x, y: tr[i - 1].y, z: tr[i - 1].z }, after: { x: tr[i].x, y: tr[i].y, z: tr[i].z, onRoad: tr[i].onRoad }, jump: +Math.hypot(tr[i].x - tr[i - 1].x, tr[i].z - tr[i - 1].z).toFixed(2) });
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
    const first = tr[0];
    const last = tr[tr.length - 1];
    const freed = maxDisp10 > 10;
    // A good firing teleports >= 2 m to ground level on a road — never
    // to (almost) the same spot on the deck (the v6.1 failure). A deck
    // firing must land near a ramp foot (|z| ~ 65, on the flyover lane).
    const badFiring = firings.find((f) => !(f.jump >= 2 && f.after.y < 0.5 && f.after.onRoad));
    const footFiring = firings.some((f) => f.jump >= 2 && f.after.y < 0.5
      && (Math.abs(f.after.x - 60) < 3 || Math.abs(f.after.x - 300) < 3) && Math.abs(Math.abs(f.after.z) - 65) < 8);
    report.cars[p.id] = {
      label: p.label,
      firings, unstuckTotal: last.u,
      firstFiringGt: firings.length ? firings[0].gt : null,
      maxDisp10s: +maxDisp10.toFixed(2),
      freed, freedAt,
      goodFiring: !badFiring && firings.length > 0,
      footFiring,
      start: { x: first.x, y: first.y, z: first.z },
      end: { x: last.x, y: last.y, z: last.z, v: last.v, gt: +(last.gt - t0).toFixed(1) },
    };
    check(`${p.label} (id=${p.id}): kembali ke jalan dalam 45 dtk game-time, tanpa teleport gagal`,
      freed && !badFiring,
      `firings=${firings.length} jump=${firings.map((f) => f.jump).join(',')} footFiring=${footFiring} freedAt~${freedAt}s maxDisp10s=${maxDisp10.toFixed(1)}m end=(${last.x},${last.y},${last.z})`);
  }
  check('0 console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('0 request eksternal', external.length === 0, external.slice(0, 3).join(' | '));
  fs.writeFileSync(`${OUT}/v62-unstuck-deck-${TAG}.json`, JSON.stringify({ results, report }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nv6.2 unstuck deck ${TAG}: ${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
