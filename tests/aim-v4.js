// Neon Vice — Builder A v4 verification harness (Playwright, SwiftShader).
// Usage: node tests/aim-v4.js
// Verifies: (1) aim lock on thug + police, consistent HP loss per shot,
// crosshair + lock marker, lock release; (2) top banner replaces all
// centre/bottom tutorial text on desktop 1280x800 and phone 390x844,
// dismiss via X and re-open via T; (3) no regressions (peds, traffic,
// console errors, external requests).
const { chromium } = require('/home/hatch/workspace/custom-skills/playwright_skill/node_modules/playwright');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

const PORT = 8915;
const URL = `http://localhost:${PORT}/`;
const OUT = '/home/hatch/workspace/makefun/neon-vice-entry/tests/evidence'; // NOT screenshots/: main.ts dossier gate allows only 3-4 files there
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForServer(port, timeoutMs = 15000) {
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

async function newPage(browser, viewport, touch) {
  const ctx = await browser.newContext({
    viewport: viewport || { width: 640, height: 400 },
    hasTouch: !!touch,
    isMobile: !!touch,
  });
  const page = await ctx.newPage();
  const errors = [];
  const requests = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('request', (r) => { if (!r.url().startsWith(URL)) requests.push(r.url()); });
  let loaded = false;
  for (let i = 0; i < 6 && !loaded; i += 1) {
    try {
      await page.goto(URL, { waitUntil: 'load', timeout: 15000 });
      loaded = true;
    } catch (e) { await sleep(2000); }
  }
  if (!loaded) throw new Error('server unreachable after retries');
  await page.waitForFunction(() => window.NEON_VICE && window.NEON_VICE.ready, null, { timeout: 20000 });
  return { page, ctx, errors, requests };
}

async function startGame(page) {
  await page.click('#btnNew');
  await sleep(500);
}

// Fire one real shot through combat.shoot(), retrying until the cooldown
// lets it through (game time runs slower than wall time on SwiftShader).
async function fireOnce(page, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ok = await page.evaluate(() => window.NEON_VICE.game.combat.shoot());
    if (ok) return true;
    await sleep(300);
  }
  return false;
}

async function main() {
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], {
    cwd: '/home/hatch/workspace/makefun/neon-vice-entry',
    stdio: 'ignore',
  });
  await waitForServer(PORT);
  const browser = await chromium.launch({
    executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const results = [];
  const log = (name, ok, note) => { results.push({ name, ok, note: note || '' }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ' — ' + note : ''}`); };

  try {
    // ---------- Desktop 1280x800 ----------
    const d = await newPage(browser, { width: 1280, height: 800 }, false);
    const page = d.page;
    await startGame(page);
    await page.evaluate(() => window.NEON_VICE.debug.setStepBudget(24));
    await sleep(1500);

    // Banner: visible, top strip, centre of the screen is the bare canvas.
    const banner = await page.evaluate(() => {
      const b = document.getElementById('topBanner');
      const r = b.getBoundingClientRect();
      const el = document.elementFromPoint(640, 400);
      const hint = document.getElementById('hudHint');
      const pill = document.getElementById('touchHint');
      const cs = (e) => window.getComputedStyle(e).display;
      return {
        visible: !b.classList.contains('hidden') && cs(b) !== 'none',
        top: Math.round(r.top), height: Math.round(r.height),
        text: document.getElementById('bannerText').textContent,
        centreEl: el ? el.id : null,
        hintDisplay: cs(hint), pillDisplay: cs(pill),
        hudMsgGone: !document.getElementById('hudMsg'),
      };
    });
    log('banner: top strip, centre clear (desktop)',
      banner.visible && banner.top <= 12 && banner.centreEl === 'game'
      && banner.hintDisplay === 'none' && banner.pillDisplay === 'none' && banner.hudMsgGone,
      `top=${banner.top} h=${banner.height} centre=${banner.centreEl} text="${banner.text.slice(0, 60)}"`);

    // Dismiss with X, re-open with T, dismiss again with T.
    await page.click('#bannerClose');
    await sleep(200);
    const dismissed = await page.evaluate(() => ({
      bannerHidden: document.getElementById('topBanner').classList.contains('hidden'),
      showVisible: !document.getElementById('bannerShow').classList.contains('hidden'),
    }));
    log('banner: X dismisses', dismissed.bannerHidden && dismissed.showVisible, JSON.stringify(dismissed));
    await page.keyboard.press('KeyT');
    await sleep(200);
    const reopened = await page.evaluate(() => !document.getElementById('topBanner').classList.contains('hidden'));
    log('banner: T re-opens', reopened, '');
    await page.keyboard.press('KeyT');
    await sleep(200);
    const dismissed2 = await page.evaluate(() => document.getElementById('topBanner').classList.contains('hidden'));
    log('banner: T dismisses again', dismissed2, '');
    await page.keyboard.press('KeyT'); // leave it open for the screenshots
    await sleep(200);

    // --- Aim: draw weapon, spawn thug 15 m ahead, hold right mouse. ---
    await page.keyboard.press('KeyH'); // draw pistol
    await sleep(300);
    await page.evaluate(() => window.NEON_VICE.debug.spawnThug(15));
    await page.mouse.move(640, 400);
    await page.mouse.down({ button: 'right' });
    await sleep(1200);
    const lock1 = await page.evaluate(() => window.NEON_VICE.debug.aimInfo());
    const crosshair = await page.evaluate(() => document.getElementById('crosshair').classList.contains('show'));
    const marker = await page.evaluate(() => {
      const m = document.getElementById('lockMarker');
      return { shown: m.classList.contains('show'), label: document.getElementById('lockLabel').textContent };
    });
    log('aim: right-hold locks nearest thug + crosshair + marker',
      lock1.locked && lock1.locked.kind === 'thug' && lock1.locked.hp === 100 && crosshair && marker.shown,
      `lock=${JSON.stringify(lock1.locked)} marker="${marker.label}"`);

    // Three locked shots: pistol does 34 dmg — the THUG's own HP must fall
    // 100 -> 66 -> 32 -> dead. (Read the thug directly, not aimInfo: after
    // the kill a freshly spawned cop can become the new lock at 100 HP.)
    const hpSeq = [];
    for (let i = 0; i < 3; i += 1) {
      const fired = await fireOnce(page);
      await sleep(400);
      const thug = await page.evaluate(() => {
        const e = window.NEON_VICE.game.combat.enemies[0];
        return e ? { hp: e.hp, dead: e.dead } : null;
      });
      hpSeq.push(thug ? (thug.dead ? 'dead' : thug.hp) : 'gone');
      if (!fired) { hpSeq.push('(shot-blocked)'); break; }
    }
    const thugDead = await page.evaluate(() => window.NEON_VICE.game.combat.enemies.every((e) => e.dead));
    log('aim: locked shots hit consistently (34 dmg each)',
      hpSeq[0] === 66 && hpSeq[1] === 32 && thugDead,
      `hp after shots: ${JSON.stringify(hpSeq)} dead=${thugDead}`);

    // Release: lock + crosshair + marker all go away (poll — at
    // SwiftShader frame rates a single 600 ms sample can land before the
    // next rendered frame runs the overlay update).
    await page.mouse.up({ button: 'right' });
    let released = null;
    for (let i = 0; i < 10; i += 1) {
      await sleep(300);
      released = await page.evaluate(() => ({
        info: window.NEON_VICE.debug.aimInfo(),
        cross: document.getElementById('crosshair').classList.contains('show'),
        mark: document.getElementById('lockMarker').classList.contains('show'),
      }));
      if (released.info.locked === null && !released.cross && !released.mark) break;
    }
    log('aim: release drops lock + crosshair + marker',
      released.info.locked === null && !released.cross && !released.mark,
      JSON.stringify(released));

    // --- Aim: police lock. Wanted 1 spawns foot police 35 m out. ---
    await page.evaluate(() => window.NEON_VICE.debug.setWanted(1));
    let copNear = false;
    for (let i = 0; i < 40; i += 1) {
      await sleep(1000);
      const info = await page.evaluate(() => window.NEON_VICE.debug.police());
      if (info.foot > 0 && info.nearestFoot !== null && info.nearestFoot < 45) { copNear = true; break; }
    }
    log('police: wanted 1 spawns foot police in range', copNear, '');
    if (copNear) {
      // Face the nearest cop: the aim cone follows Vera's heading, and a
      // chasing cop approaches from a random side — a real player turns
      // with A/D, so the test turns her the same way (set heading toward
      // the cop each second, then check the lock).
      await page.mouse.down({ button: 'right' });
      let copLock = null;
      for (let i = 0; i < 20; i += 1) {
        await page.evaluate(() => {
          const g = window.NEON_VICE.game;
          let best = null;
          let bestD = Infinity;
          for (const p of g.combat.police) {
            if (p.dead) continue;
            const d = Math.hypot(p.mesh.position.x - g.player.group.position.x, p.mesh.position.z - g.player.group.position.z);
            if (d < bestD) { bestD = d; best = p; }
          }
          if (best) {
            const dx = best.mesh.position.x - g.player.group.position.x;
            const dz = best.mesh.position.z - g.player.group.position.z;
            g.player.heading = Math.atan2(dx, dz);
          }
        });
        await sleep(800);
        const info = await page.evaluate(() => window.NEON_VICE.debug.aimInfo());
        if (info.locked && info.locked.kind === 'police') { copLock = info.locked; break; }
      }
      log('aim: locks police', !!copLock, `lock=${JSON.stringify(copLock)}`);
      if (copLock) {
        await fireOnce(page);
        await sleep(400);
        const after = await page.evaluate(() => window.NEON_VICE.debug.aimInfo());
        const hpAfter = after.locked ? after.locked.hp : 'dead';
        log('aim: locked shot drops police HP by 34', hpAfter === 66, `hp=${hpAfter} (was ${copLock.hp})`);
      }
      await page.mouse.up({ button: 'right' });
      await sleep(400);
    }
    await page.evaluate(() => { window.NEON_VICE.debug.clearPolice(); window.NEON_VICE.debug.setWanted(0); });

    // Regression: v2/v3 features intact. Counts are Builder C's live
    // tuning knob (40/22 at HEAD, 60/28 in C's staged v4) — assert the
    // INVARIANTS, not the exact count: peds on sidewalks, traffic on
    // roads, 12 missions.
    const reg = await page.evaluate(() => ({
      peds: window.NEON_VICE.debug.checkPedestrians(),
      traffic: window.NEON_VICE.debug.checkTraffic(),
      missions: window.NEON_VICE.debug.listMissions().length,
      wanted: window.NEON_VICE.stats().wanted,
    }));
    log('regression: peds on sidewalks, traffic on roads, 12 missions',
      reg.peds.count >= 30 && reg.peds.count <= 70 && reg.peds.maxOwnOffsetErr < 0.6 && reg.peds.onRoadGlobal <= 8
      && reg.traffic.onRoad === reg.traffic.traffic && reg.traffic.traffic >= 18 && reg.traffic.traffic <= 32 && reg.missions === 12,
      `peds=${JSON.stringify(reg.peds)} traffic=${JSON.stringify(reg.traffic)}`);
    await page.screenshot({ path: `${OUT}/aim-v4-desktop.jpg`, type: 'jpeg', quality: 75 });
    log('desktop: no console errors / no external requests',
      d.errors.length === 0 && d.requests.length === 0,
      `errors=${d.errors.slice(0, 2).join(' | ')} ext=${d.requests.slice(0, 2).join(' | ')}`);
    await page.close();
    await d.ctx.close();

    // ---------- Phone 390x844 (touch) ----------
    const m = await newPage(browser, { width: 390, height: 844 }, true);
    const mp = m.page;
    await startGame(mp);
    await mp.evaluate(() => window.NEON_VICE.debug.setStepBudget(24));
    await sleep(1500);
    const mob = await mp.evaluate(() => {
      const b = document.getElementById('topBanner');
      const r = b.getBoundingClientRect();
      const aim = document.getElementById('btnAim').getBoundingClientRect();
      const el = document.elementFromPoint(195, 422);
      return {
        bannerVisible: !b.classList.contains('hidden'),
        bannerTop: Math.round(r.top), bannerBottom: Math.round(r.bottom),
        bannerText: document.getElementById('bannerText').textContent,
        aimBtn: { x: Math.round(aim.x), y: Math.round(aim.y), w: Math.round(aim.width) },
        centreEl: el ? el.id : null,
      };
    });
    log('mobile: banner visible, centre clear, AIM button present',
      mob.bannerVisible && mob.centreEl === 'game' && mob.aimBtn.w >= 60,
      `banner y=${mob.bannerTop}-${mob.bannerBottom} aim=${JSON.stringify(mob.aimBtn)} text="${mob.bannerText.slice(0, 50)}"`);

    // Hold AIM (synthetic pointer events — same handlers as a real thumb),
    // lock a thug, and move the stick at the same time.
    await mp.keyboard.press('KeyH');
    await sleep(300);
    await mp.evaluate(() => window.NEON_VICE.debug.spawnThug(15));
    const pos0 = await mp.evaluate(() => window.NEON_VICE.hero());
    await mp.evaluate(() => {
      const el = document.getElementById('btnAim');
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    });
    await sleep(1200);
    const mLock = await mp.evaluate(() => window.NEON_VICE.debug.aimInfo());
    const mCross = await mp.evaluate(() => document.getElementById('crosshair').classList.contains('show'));
    log('mobile: AIM hold locks thug + crosshair',
      mLock.locked && mLock.locked.kind === 'thug' && mCross,
      `lock=${JSON.stringify(mLock.locked)}`);
    // Joystick while AIM is held: Vera must still move.
    await mp.evaluate(() => window.NEON_VICE.game.input.setStick(0, 1));
    await sleep(2500);
    const pos1 = await mp.evaluate(() => window.NEON_VICE.hero());
    const moved = Math.hypot(pos1.x - pos0.x, pos1.z - pos0.z);
    await mp.evaluate(() => window.NEON_VICE.game.input.clearStick());
    log('mobile: stick moves Vera while AIM held', moved > 2, `moved=${moved.toFixed(1)}m`);
    await mp.evaluate(() => {
      const el = document.getElementById('btnAim');
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
    });
    await sleep(600);
    const mRel = await mp.evaluate(() => window.NEON_VICE.debug.aimInfo());
    log('mobile: releasing AIM drops the lock', mRel.locked === null, JSON.stringify(mRel));
    // AIM shares its corner with Builder B's BRAKE pedal: AIM hides while
    // driving (body.driving), BRAKE is display:none on foot — no overlap.
    const hideCheck = await mp.evaluate(() => {
      const el = document.getElementById('btnAim');
      const vis = () => window.getComputedStyle(el).display;
      const onFoot = vis();
      document.body.classList.add('driving');
      const driving = vis();
      document.body.classList.remove('driving');
      return { onFoot, driving };
    });
    log('mobile: AIM hidden while driving, visible on foot',
      hideCheck.onFoot !== 'none' && hideCheck.driving === 'none', JSON.stringify(hideCheck));
    await mp.screenshot({ path: `${OUT}/aim-v4-mobile.jpg`, type: 'jpeg', quality: 75 });
    log('mobile: no console errors / no external requests',
      m.errors.length === 0 && m.requests.length === 0,
      `errors=${m.errors.slice(0, 2).join(' | ')} ext=${m.requests.slice(0, 2).join(' | ')}`);
    await mp.close();
    await m.ctx.close();
  } finally {
    await browser.close();
    server.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED: ' + failed.map((r) => r.name).join(' | ')); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exit(1); });
