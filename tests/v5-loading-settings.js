// Neon Vice — v5 item 5+6 harness (Playwright, SwiftShader).
// Loading screen (Start Game + Settings only) + in-game Settings panel.
// Usage: node tests/v5-loading-settings.js   (starts its own server on 8124)
// Writes screenshots + results.json to /tmp/neon-vice-v5/item56/.
// NOTE: .js (CJS — repo has no package.json), so playwright-core ESM is
// loaded with a dynamic import, per the task's import path.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8124;
const URL = `http://localhost:${PORT}/`;
const OUT = '/tmp/neon-vice-v5/item56';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

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
  const { chromium } = await import('/home/hatch/workspace/custom-skills/playwright_skill/node_modules/playwright-core/index.mjs');
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: process.cwd(), stdio: 'pipe' });
  let serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  try {
    await waitForServer(PORT);
  } catch (e) {
    console.log('server log:', serverLog.slice(0, 2000));
    throw e;
  }

  const browser = await chromium.launch({
    executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });

  async function newPage(viewport, touch) {
    const ctx = await browser.newContext({ viewport, hasTouch: !!touch, isMobile: !!touch });
    const page = await ctx.newPage();
    const errors = [];
    const requests = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
    page.on('request', (r) => { if (!r.url().startsWith(URL)) requests.push(r.url()); });
    await page.goto(URL, { waitUntil: 'load', timeout: 20000 });
    await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
    return { page, ctx, errors, requests };
  }
  const vis = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return 'missing';
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return (cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0) ? 'visible' : 'hidden';
  }, sel);
  // Poll for a visibility state instead of a fixed sleep: under SwiftShader
  // the game runs at ~2 FPS, so a tap's effect can take >1 s to land, and
  // a fixed 300-400 ms sleep flakes. Times out (false) rather than throwing.
  const waitVis = async (page, sel, want, timeout = 10000) => {
    try {
      // NOTE: waitForFunction takes ONE arg — pass [sel, want] as an array.
      await page.waitForFunction(([s, w]) => {
        const el = document.querySelector(s);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const v = (cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0) ? 'visible' : 'hidden';
        return v === w;
      }, [sel, want], { timeout });
      return true;
    } catch { return false; }
  };
  const stats = (page) => page.evaluate(() => window.NEON_VICE.stats());
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

  // ---------- Desktop context ----------
  const d = await newPage({ width: 1280, height: 800 }, false);

  // (a) Loading screen: ONLY Start Game + Settings visible.
  check('a1 loading: startMain visible', (await vis(d.page, '#startMain')) === 'visible');
  check('a2 loading: btnPlay visible', (await vis(d.page, '#btnPlay')) === 'visible');
  check('a3 loading: btnSettings visible', (await vis(d.page, '#btnSettings')) === 'visible');
  check('a4 loading: New/Continue hidden until Start Game', (await vis(d.page, '#btnNew')) === 'hidden' && (await vis(d.page, '#btnContinue')) === 'hidden');
  const st0 = await d.page.evaluate(() => window.NEON_VICE.state());
  check('a6 loading: debug state() == title', st0 === 'title', `state=${st0}`);
  const btnBox = await d.page.locator('#btnPlay').boundingBox();
  check('a7 loading: btnPlay touch target >=48px', btnBox && btnBox.height >= 48, `h=${btnBox && btnBox.height}`);
  check('a8 loading: tutorial banner hidden on title (only Start Game + Settings)', (await vis(d.page, '#topBanner')) === 'hidden');
  await shot(d.page, '01-loading-desktop.png');

  // Settings from the loading screen (before any save): change music volume,
  // close, reload — it must persist (settings live in their own key).
  await d.page.click('#btnSettings');
  await sleep(300);
  check('d0 title settings panel opens', (await vis(d.page, '#settingsPanel')) === 'visible');
  await d.page.locator('#musicSlider').fill('0.3');
  await sleep(200);
  await d.page.click('#btnCloseSettings');
  await sleep(200);
  await d.page.reload({ waitUntil: 'load' });
  await d.page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
  const sAfterTitle = await stats(d.page);
  check('d1 title-settings music volume persists across reload', Math.abs(sAfterTitle.settings.musicVolume - 0.3) < 0.01, `musicVolume=${sAfterTitle.settings.musicVolume}`);

  // (b) Start Game -> New Game -> game runs.
  await d.page.click('#btnPlay');
  await sleep(300);
  check('b1 play view: New visible, Continue disabled (no save)', (await vis(d.page, '#btnNew')) === 'visible'
    && (await d.page.evaluate(() => document.getElementById('btnContinue').disabled)) === true
    && (await vis(d.page, '#continueNote')) === 'visible');
  await shot(d.page, '02-play-view-no-save.png');
  await d.page.click('#btnNew');
  await sleep(600);
  const st1 = await d.page.evaluate(() => window.NEON_VICE.state());
  check('b2 New Game starts playing', st1 === 'playing', `state=${st1}`);
  check('b3 HUD visible after New Game', (await vis(d.page, '#hud')) === 'visible');
  check('b4 top banner (tutorial) visible after start', (await vis(d.page, '#topBanner')) === 'visible');
  check('b5 desktop quick SET button visible in game', (await vis(d.page, '#btnQuickSet')) === 'visible');

  // Build a save: money 7777 + mission 1 active, then save via Save Now.
  await d.page.evaluate(() => { window.NEON_VICE.debug.setMoney(7777); window.NEON_VICE.debug.startMission(1); });
  await sleep(400);
  await d.page.click('#btnQuickSet');
  await sleep(300);
  check('d2 in-game settings opens from HUD quick SET', (await vis(d.page, '#settingsPanel')) === 'visible');
  await d.page.click('#btnSaveNow');
  await sleep(300);
  await d.page.click('#btnCloseSettings');
  await sleep(200);

  // (c) Reload -> Continue loads the old save (money + mission).
  await d.page.reload({ waitUntil: 'load' });
  await d.page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
  await d.page.click('#btnPlay');
  await sleep(300);
  check('c1 Continue enabled after save exists', (await d.page.evaluate(() => document.getElementById('btnContinue').disabled)) === false);
  await shot(d.page, '03-play-view-with-save.png');
  await d.page.click('#btnContinue');
  await sleep(600);
  const sCont = await stats(d.page);
  check('c2 Continue restores money 7777', sCont.money === 7777, `money=${sCont.money}`);
  check('c3 Continue restores mission 1', sCont.missionId === 1, `missionId=${sCont.missionId}`);
  await shot(d.page, '04-continued-game.png');

  // (d) In-game settings: volume persists; quality changes render; sensitivity works.
  await d.page.click('#btnQuickSet');
  await sleep(300);
  await d.page.locator('#volSlider').fill('0.25');
  await d.page.locator('#sfxSlider').fill('0.4');
  await d.page.locator('#sensSlider').fill('1.8');
  await sleep(200);
  const sSet = await stats(d.page);
  check('d3 settings apply live (vol/sfx/sens)', Math.abs(sSet.settings.volume - 0.25) < 0.01
    && Math.abs(sSet.settings.sfxVolume - 0.4) < 0.01 && Math.abs(sSet.settings.camSensitivity - 1.8) < 0.01,
    JSON.stringify(sSet.settings));
  // Quality: SwiftShader boots low (0.75x backing); High must raise canvas width.
  const wLow = await d.page.evaluate(() => document.getElementById('game').width);
  await d.page.selectOption('#qualitySel', 'high');
  await sleep(300);
  const wHigh = await d.page.evaluate(() => document.getElementById('game').width);
  const sQ = await stats(d.page);
  check('d4 quality High changes render (canvas backing grows)', sQ.settings.quality === 'high' && wHigh > wLow, `low=${wLow} high=${wHigh}`);
  await d.page.click('#btnCloseSettings');
  await sleep(200);
  // Camera sensitivity: same 100px drag moves yaw ~2x further at 2.0x than 1.0x.
  // Sensitivity via the real UI: open settings, set slider, close, drag.
  async function yawAfterDrag(sensValue) {
    await d.page.click('#btnQuickSet');
    await sleep(200);
    await d.page.locator('#sensSlider').fill(String(sensValue));
    await d.page.click('#btnCloseSettings');
    await sleep(200);
    await d.page.evaluate(() => window.NEON_VICE.debug.setCameraOrbit(0, 0.33));
    await sleep(150);
    const before = await d.page.evaluate(() => window.NEON_VICE.debug.getCameraOrbit().yawTarget);
    await d.page.mouse.move(640, 400);
    await d.page.mouse.down();
    for (let i = 1; i <= 10; i += 1) { await d.page.mouse.move(640 + i * 10, 400); await sleep(16); }
    await d.page.mouse.up();
    await sleep(400);
    const after = await d.page.evaluate(() => window.NEON_VICE.debug.getCameraOrbit().yawTarget);
    return after - before;
  }
  const dy1 = await yawAfterDrag(1.0);
  const dy2 = await yawAfterDrag(2.0);
  check('d5 camera sensitivity 2.0x moves yaw ~2x vs 1.0x', dy1 > 0.05 && dy2 > dy1 * 1.6 && dy2 < dy1 * 2.5, `1.0x=${dy1.toFixed(3)} 2.0x=${dy2.toFixed(3)}`);
  // Reload: volume + sensitivity + quality persist, live AND stored.
  // (v4 auto-degrade used to rewrite the stored choice to 'low'; fixed in
  // v5: it only lowers the live render, the player's High choice survives.)
  await d.page.reload({ waitUntil: 'load' });
  await d.page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
  const sRel = await stats(d.page);
  const persistedQ = await d.page.evaluate(() => {
    try { return JSON.parse(window.localStorage.getItem('neonvice-settings-v1') || '{}').quality; } catch { return null; }
  });
  check('d6 settings persist across reload (vol/sens/quality, live + stored)', Math.abs(sRel.settings.volume - 0.25) < 0.01
    && Math.abs(sRel.settings.camSensitivity - 2.0) < 0.01 && sRel.settings.quality === 'high' && persistedQ === 'high',
    `live=${JSON.stringify(sRel.settings)} storedQuality=${persistedQ} renderQuality=${sRel.renderQuality}`);

  // (e) Save Data: set money 5555, Save Now, reload, Continue -> 5555.
  await d.page.click('#btnPlay');
  await sleep(200);
  await d.page.click('#btnContinue');
  await sleep(500);
  await d.page.evaluate(() => window.NEON_VICE.debug.setMoney(5555));
  await d.page.click('#btnQuickSet');
  await sleep(200);
  await d.page.click('#btnSaveNow');
  await sleep(200);
  await d.page.click('#btnCloseSettings');
  await d.page.reload({ waitUntil: 'load' });
  await d.page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
  await d.page.click('#btnPlay');
  await sleep(200);
  await d.page.click('#btnContinue');
  await sleep(500);
  const sSave = await stats(d.page);
  check('e1 Save Now + reload + Continue keeps money 5555', sSave.money === 5555, `money=${sSave.money}`);

  // Load button: change money without saving, Load restores the save.
  await d.page.evaluate(() => window.NEON_VICE.debug.setMoney(9999));
  await d.page.click('#btnQuickSet');
  await sleep(200);
  await d.page.click('#btnLoadSave');
  await sleep(400);
  const sLoad = await stats(d.page);
  check('e2 Load button restores saved money 5555', sLoad.money === 5555, `money=${sLoad.money}`);
  await shot(d.page, '05-settings-ingame.png');
  await d.page.click('#btnCloseSettings');
  await sleep(200);

  // (f) New Game with a save: confirm view, Cancel keeps title, Confirm starts fresh.
  await d.page.reload({ waitUntil: 'load' });
  await d.page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
  await d.page.click('#btnPlay');
  await sleep(200);
  await d.page.click('#btnNew');
  await sleep(300);
  check('f1 New Game with save shows overwrite confirm', (await vis(d.page, '#startConfirm')) === 'visible');
  await d.page.click('#btnCancelNew');
  await sleep(200);
  const stCancel = await d.page.evaluate(() => window.NEON_VICE.state());
  check('f2 Cancel keeps title screen (no new game)', stCancel === 'title' && (await vis(d.page, '#startPlay')) === 'visible', `state=${stCancel}`);
  await d.page.click('#btnNew');
  await sleep(200);
  await d.page.click('#btnConfirmNew');
  await sleep(500);
  const sFresh = await stats(d.page);
  // Fresh game = starting money $250. Mission 1 shows as current because a
  // fresh game auto-starts it at spawn (v5 item 7 proximity auto-start) —
  // that is the designed fresh state, not leftover progress. The real proof
  // the old save is gone: no save on disk any more, so a reload offers no
  // Continue (checked in f3b below).
  const saveGone = await d.page.evaluate(() => window.NEON_VICE.debug.saveExists());
  check('f3 Confirm starts fresh game (money 250, old save wiped)', sFresh.money === 250 && saveGone === false,
    `money=${sFresh.money} missionId=${sFresh.missionId} mission=${sFresh.mission} saveExists=${saveGone}`);
  await d.page.reload({ waitUntil: 'load' });
  await d.page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
  await d.page.click('#btnPlay');
  await sleep(300);
  check('f3b after fresh New Game + reload: Continue disabled (no old save)', (await d.page.evaluate(() => document.getElementById('btnContinue').disabled)) === true);

  // Reset progress (last on desktop ctx): make a fresh save first (f3 wiped
  // the old one), then settings -> Delete -> confirm -> reload.
  await d.page.click('#btnNew');
  await sleep(500);
  await d.page.click('#btnQuickSet');
  await sleep(300);
  await d.page.click('#btnSaveNow');
  await sleep(300);
  await d.page.click('#btnCloseSettings');
  await sleep(200);
  check('f5a fresh save exists before reset', (await d.page.evaluate(() => window.NEON_VICE.debug.saveExists())) === true);
  await d.page.click('#btnQuickSet');
  await sleep(300);
  await d.page.click('#btnResetSave');
  await sleep(200);
  check('f5 reset confirm inline appears', (await vis(d.page, '#resetConfirm')) === 'visible');
  await d.page.click('#btnConfirmReset');
  await sleep(800);
  await d.page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
  const afterReset = await d.page.evaluate(() => window.NEON_VICE.debug.saveExists());
  await d.page.click('#btnPlay');
  await sleep(200);
  check('f6 after reset: no save, Continue disabled', afterReset === false
    && (await d.page.evaluate(() => document.getElementById('btnContinue').disabled)) === true);

  // ?autostart=new boots straight into the game (debug path).
  await d.page.goto(URL + '?autostart=new', { waitUntil: 'load' });
  await d.page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
  await sleep(400);
  check('g1 ?autostart=new boots into playing', (await d.page.evaluate(() => window.NEON_VICE.state())) === 'playing');

  check('h1 desktop: 0 console/page errors', d.errors.length === 0, d.errors.slice(0, 3).join(' | '));
  check('h2 desktop: 0 external requests', d.requests.length === 0, d.requests.slice(0, 3).join(' | '));
  await d.ctx.close();

  // ---------- Mobile context (390x844, touch): tap flow ----------
  const m = await newPage({ width: 390, height: 844 }, true);
  async function tap(page, sel) {
    const box = await page.locator(sel).boundingBox();
    if (!box) throw new Error('no box for ' + sel);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  }
  check('m1 mobile loading: only Start Game + Settings visible', (await vis(m.page, '#btnPlay')) === 'visible'
    && (await vis(m.page, '#btnSettings')) === 'visible' && (await vis(m.page, '#btnNew')) === 'hidden');
  await shot(m.page, '06-loading-mobile.png');
  await tap(m.page, '#btnPlay');
  await sleep(300);
  check('m2 mobile tap Start Game shows New/Continue', (await vis(m.page, '#btnNew')) === 'visible');
  await tap(m.page, '#btnNew');
  await sleep(600);
  check('m3 mobile tap New Game starts playing', (await m.page.evaluate(() => window.NEON_VICE.state())) === 'playing');
  const setBox = await m.page.locator('#btnSet').boundingBox();
  check('m4 mobile HUD SET button visible, >=48px', setBox && setBox.width >= 48 && setBox.height >= 48, setBox ? `${setBox.width}x${setBox.height}` : 'no box');
  await tap(m.page, '#btnSet');
  check('m5 mobile tap SET opens settings panel', await waitVis(m.page, '#settingsPanel', 'visible'));
  await shot(m.page, '07-settings-mobile.png');
  await m.page.locator('#volSlider').fill('0.6');
  await sleep(200);
  // The settings card scrolls (max-height 92vh): on a 390x844 phone the
  // Close button sits below the fold, so scroll it into view before
  // tapping — a raw tap at its off-viewport coordinates does nothing.
  await m.page.evaluate(() => document.getElementById('btnCloseSettings').scrollIntoView({ block: 'center' }));
  await sleep(200);
  await tap(m.page, '#btnCloseSettings');
  check('m6 mobile settings close returns to game', await waitVis(m.page, '#settingsPanel', 'hidden')
    && (await m.page.evaluate(() => window.NEON_VICE.state())) === 'playing');
  await m.page.reload({ waitUntil: 'load' });
  await m.page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
  const sMob = await stats(m.page);
  check('m7 mobile volume persists across reload', Math.abs(sMob.settings.volume - 0.6) < 0.01, `volume=${sMob.settings.volume}`);
  check('h3 mobile: 0 console/page errors', m.errors.length === 0, m.errors.slice(0, 3).join(' | '));
  check('h4 mobile: 0 external requests', m.requests.length === 0, m.requests.slice(0, 3).join(' | '));
  await m.ctx.close();

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, at: new Date().toISOString() }, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Evidence: ${OUT}`);
  process.exitCode = failed.length ? 1 : 0;
  server.kill();
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
