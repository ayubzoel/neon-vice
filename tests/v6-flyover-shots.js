// Neon Vice — v6 flyover beauty shots (Playwright, SwiftShader).
// Usage: node tests/v6-flyover-shots.js
// Two angles of the (60,0) flyover corridor for Ayub's review:
//  - from the south approach (player at (60,-85), camera steep) showing
//    the approach arrows + lane dividers + ramp + deck;
//  - from the deck itself (car on deck at (60,6,0)) showing the deck
//    lanes + barriers.
// Writes to tests/evidence-v6/flyover/.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8130;
const URL = `http://localhost:${PORT}/?autostart=new`;
const OUT = '/home/hatch/workspace/makefun/neon-vice-entry/tests/evidence-v6/flyover';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
function waitForServer(port, timeoutMs = 20000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { res.resume(); resolve(true); });
      req.on('error', () => {
        if (Date.now() - t0 > timeoutMs) reject(new Error('server did not start'));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

async function main() {
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: process.cwd(), stdio: 'pipe' });
  try {
    await waitForServer(PORT);
    const { chromium } = await import('/home/hatch/workspace/custom-skills/playwright_skill/node_modules/playwright-core/index.mjs');
    const browser = await chromium.launch({
      executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
      args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
    });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 30000 });
    await page.evaluate(() => window.NEON_VICE.debug.setStepBudget(24));
    await sleep(4000);
    // Shot 1: south approach — player on foot at (60,-85) facing the
    // flyover (heading 0 = south), camera high behind.
    await page.evaluate(() => {
      window.NEON_VICE.debug.teleport(60, -85);
      const g = window.NEON_VICE.game;
      g.player.heading = 0;
    });
    await page.evaluate(() => window.NEON_VICE.debug.setCameraOrbit(0, 1.05));
    await sleep(2500);
    await page.screenshot({ path: path.join(OUT, 'flyover-approach-60.png') });
    // Shot 2: on the deck — drive the plaza sedan onto the deck.
    await page.evaluate(() => window.NEON_VICE.debug.teleport(15, 8));
    await sleep(400);
    const stats = () => page.evaluate(() => window.NEON_VICE.stats());
    for (let i = 0; i < 3 && !(await stats()).driving; i += 1) {
      await page.keyboard.press('KeyE');
      await sleep(600);
    }
    await page.evaluate(() => {
      const g = window.NEON_VICE.game;
      const p = g.player.group.position;
      let best = null; let bestD = Infinity;
      for (const v of g.vehicles.list) {
        const d = Math.hypot(v.mesh.position.x - p.x, v.mesh.position.z - p.z);
        if (d < bestD) { bestD = d; best = v; }
      }
      if (best) {
        best.mesh.position.set(61.5, 6, 0);
        best.heading = 0; best.mesh.rotation.y = 0; best.speed = 0;
        g.player.group.position.set(61.5, 6, 0);
      }
    });
    await page.evaluate(() => window.NEON_VICE.debug.setCameraOrbit(0.5, 0.7));
    await sleep(2500);
    await page.screenshot({ path: path.join(OUT, 'flyover-deck-60.png') });
    console.log('shots done, errors:', JSON.stringify(errors));
    await browser.close();
    process.exit(errors.length ? 1 : 0);
  } finally {
    server.kill();
  }
}
main().catch((e) => { console.error(e); process.exit(2); });
