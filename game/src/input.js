// Neon Vice — Builder C: keyboard + touch input.
// Keyboard: W/S forward/back, A/D turn, Shift run, E interact, H holster,
// 1/2 weapon, M map, B backpack/phone, N mute, R reload, Space jump.
// Touch: left stick is CAMERA-RELATIVE — stick up moves Vera away from the
// camera (up-screen), stick right moves her to screen-right. The stick
// vector is passed through raw (stick.x / stick.y) and main.js turns it into
// a world direction with the camera basis; that is what makes the direction
// correct on screen. Right-side buttons: RUN / FIRE / CAR / JUMP.
//
// read() returns one frame of intent; pressed(action) is edge-triggered and
// consumed once per frame by main.js (call consumePressed() after polling).

const KEYMAP = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'run',
  ShiftRight: 'run',
};

const ACTION_KEYS = {
  KeyE: 'interact',
  KeyF: 'exitVehicle', // dedicated exit key: never opens a shop or enters a car
  KeyH: 'holster',
  KeyM: 'map',
  KeyB: 'backpack',
  KeyN: 'mute',
  KeyR: 'reload',
  Space: 'jump',
  Digit1: 'weapon1',
  Digit2: 'weapon2',
  Escape: 'pause',
  KeyP: 'pause',
};

// Human-readable labels for the Settings > Controls list (ui.js renders
// them read-only: remapping is deliberately NOT offered — a remap saved to
// localStorage could silently break the playtest harness, which drives the
// game by physical key code).
const KEY_LABELS = {
  KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  ShiftLeft: 'Shift', ShiftRight: 'Shift', Space: 'Space', Escape: 'Esc',
};
function keyLabel(code) {
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}
const ACTION_LABELS = {
  forward: 'Move forward / Gas while driving', back: 'Move back / Brake & reverse while driving', left: 'Turn left', right: 'Turn right',
  run: 'Run', interact: 'Enter car / open shop / exit', exitVehicle: 'Exit vehicle',
  holster: 'Holster / draw weapon',
  map: 'Open map', backpack: 'Open backpack / phone', phone: 'Open backpack / phone',
  mute: 'Mute / unmute', reload: 'Reload', jump: 'Jump',
  weapon1: 'Select pistol', weapon2: 'Select SMG', pause: 'Pause / settings',
  gas: 'Gas — touch pedal while driving', brake: 'Brake — touch pedal while driving (stops, no reverse)',
  camOrbit: 'Orbit camera — drag empty screen / mouse drag (360°, smooth)',
};
export function getBindings() {
  const out = [];
  const seen = new Set();
  for (const [code, action] of Object.entries(KEYMAP)) {
    if (seen.has(action)) continue;
    seen.add(action);
    out.push({ action, label: ACTION_LABELS[action] || action, keys: keyLabel(code) });
  }
  for (const [code, action] of Object.entries(ACTION_KEYS)) {
    const row = out.find((r) => r.action === action);
    if (row) row.keys += ` / ${keyLabel(code)}`;
    else out.push({ action, label: ACTION_LABELS[action] || action, keys: keyLabel(code) });
  }
  // Touch-only driving pedals + camera orbit (no keyboard binding).
  out.push(
    { action: 'gas', label: ACTION_LABELS.gas, keys: 'GAS' },
    { action: 'brake', label: ACTION_LABELS.brake, keys: 'REM' },
    { action: 'camOrbit', label: ACTION_LABELS.camOrbit, keys: 'Drag' },
  );
  return out;
}

export function createInput() {
  const keys = new Set();
  const pressed = new Set(); // edge-triggered actions, consumed each frame
  const stick = { active: false, x: 0, y: 0 }; // x: -1..1 (right +), y: -1..1 (up +)
  const touchBtn = { run: false, fire: false, car: false, jump: false, gas: false, brake: false };
  // Camera-orbit drag (Builder B v4, rev 7): pointer drags on the empty
  // canvas only — the stick and every button are separate elements above
  // the canvas, so a drag that starts on them never reaches here. Deltas
  // accumulate in pixels and are consumed once per rendered frame by
  // main.js (consumeCamDrag); mouse drags use the same path.
  const camDrag = { dx: 0, dy: 0 };
  let dragPointerId = null;
  let dragLastX = 0;
  let dragLastY = 0;
  let dragMoved = 0; // px travelled in the current drag (shoot suppression)
  let stickEl = null;
  let knobEl = null;

  function onKeyDown(event) {
    if (KEYMAP[event.code]) {
      keys.add(KEYMAP[event.code]);
      event.preventDefault();
    } else if (ACTION_KEYS[event.code]) {
      if (!event.repeat) pressed.add(ACTION_KEYS[event.code]);
      event.preventDefault();
    }
  }
  function onKeyUp(event) {
    keys.delete(KEYMAP[event.code]);
  }

  function stickMove(event) {
    if (!stick.active || !stickEl) return;
    const rect = stickEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = rect.width / 2;
    let dx = (event.clientX - cx) / radius;
    let dy = (event.clientY - cy) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    stick.x = dx; // +right on screen
    stick.y = -dy; // +up on screen
    if (knobEl) {
      knobEl.style.left = `${44 + dx * 40}px`;
      knobEl.style.top = `${44 + dy * 40}px`;
    }
  }
  function stickEnd() {
    stick.active = false;
    stick.x = 0;
    stick.y = 0;
    if (knobEl) {
      knobEl.style.left = '44px';
      knobEl.style.top = '44px';
    }
  }

  function bindTouchButton(id, name, isHold) {
    const el = document.getElementById(id);
    if (!el) return;
    const down = (e) => {
      e.preventDefault();
      if (isHold) touchBtn[name] = true;
      else pressed.add(name);
    };
    const up = (e) => {
      e.preventDefault();
      if (isHold) touchBtn[name] = false;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  // Touch enter/exit hint: main.js writes the contextual hint into
  // #hudHint ("Press E to enter" / "Press E to exit"), but that bar is
  // hidden on touch devices because it names keyboard keys — so mirror it
  // into a touch pill (#touchHint, index.html) with tap wording, and make
  // the CAR button itself read EXIT while driving and pulse when a
  // vehicle is near enough to enter. Watches #hudHint with a
  // MutationObserver, so it follows main.js (and the language) for free.
  function setupTouchHint() {
    const hint = document.getElementById('hudHint');
    const pill = document.getElementById('touchHint');
    const carBtn = document.getElementById('btnCar');
    if (!hint || !pill) return;
    const translate = (text) => text
      .replace('Press E to ', 'Tap CAR to ')
      .replace('Tekan E untuk ', 'Ketuk CAR untuk ')
      .replace('WASD move · Shift run · E interact · M map · B backpack · H holster',
        'Left stick to move · CAR to enter a car')
      .replace('Swimming — steer toward the shore', 'Swimming — stick toward the shore');
    const sync = () => {
      const playing = document.getElementById('startScreen')?.classList.contains('hidden');
      if (!playing) { pill.classList.remove('show'); return; }
      const text = translate(hint.textContent || '');
      if (pill.textContent !== text) pill.textContent = text;
      pill.classList.toggle('show', text.length > 0);
      pill.classList.toggle('action', /CAR/.test(text));
      if (carBtn) {
        const exiting = /exit|keluar/i.test(text);
        const entering = /enter|masuk|open/i.test(text);
        const label = exiting ? 'EXIT' : 'CAR';
        if (carBtn.textContent !== label) carBtn.textContent = label;
        carBtn.classList.toggle('ready', entering);
      }
    };
    new MutationObserver(sync).observe(hint, { childList: true, characterData: true, subtree: true });
    sync();
  }

  return {
    attach() {
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      stickEl = document.getElementById('stick');
      knobEl = document.getElementById('stickKnob');
      if (stickEl) {
        stickEl.addEventListener('pointerdown', (event) => {
          stick.active = true;
          stickEl.setPointerCapture(event.pointerId);
          stickMove(event);
        });
        stickEl.addEventListener('pointermove', stickMove);
        stickEl.addEventListener('pointerup', stickEnd);
        stickEl.addEventListener('pointercancel', stickEnd);
      }
      bindTouchButton('btnRun', 'run', true);
      bindTouchButton('btnFire', 'fire', true);
      bindTouchButton('btnCar', 'interact', false);
      bindTouchButton('btnJump', 'jump', false);
      bindTouchButton('btnHolster', 'holster', false);
      // Builder B v4 rev 3: touch driving pedals (hold buttons, shown
      // only while driving — see body.driving in index.html).
      bindTouchButton('btnGas', 'gas', true);
      bindTouchButton('btnBrake', 'brake', true);
      // Builder B v4 rev 7: camera-orbit drag on the game canvas.
      const canvas = document.getElementById('game');
      if (canvas) {
        canvas.addEventListener('pointerdown', (event) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          if (dragPointerId !== null) return;
          dragPointerId = event.pointerId;
          dragLastX = event.clientX;
          dragLastY = event.clientY;
          dragMoved = 0;
        });
        canvas.addEventListener('pointermove', (event) => {
          if (event.pointerId !== dragPointerId) return;
          const dx = event.clientX - dragLastX;
          const dy = event.clientY - dragLastY;
          dragLastX = event.clientX;
          dragLastY = event.clientY;
          dragMoved += Math.abs(dx) + Math.abs(dy);
          camDrag.dx += dx;
          camDrag.dy += dy;
        });
        const dragEnd = (event) => {
          if (event.pointerId === dragPointerId) dragPointerId = null;
        };
        canvas.addEventListener('pointerup', dragEnd);
        canvas.addEventListener('pointercancel', dragEnd);
      }
      // Builder UI: MAP opens the full map, PACK opens Backpack/Phone,
      // SET opens Settings (pause). Edge-triggered like the other tap buttons.
      bindTouchButton('btnMap', 'map', false);
      bindTouchButton('btnPack', 'backpack', false);
      bindTouchButton('btnSet', 'pause', false);
      if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        document.getElementById('touch')?.classList.add('on');
        document.body.classList.add('touch-device'); // hides the WASD hint
        setupTouchHint();
      }
    },

    detach() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },

    // Test/debug hook: drive the stick programmatically (Playwright tests).
    setStick(x, y) {
      stick.active = true;
      stick.x = x;
      stick.y = y;
    },
    clearStick() {
      stick.active = false;
      stick.x = 0;
      stick.y = 0;
    },
    press(action) {
      pressed.add(action);
    },
    setTouchButton(name, value) {
      touchBtn[name] = value;
    },

    // Camera-orbit drag, consumed once per rendered frame by main.js.
    consumeCamDrag() {
      const out = { dx: camDrag.dx, dy: camDrag.dy };
      camDrag.dx = 0;
      camDrag.dy = 0;
      return out;
    },
    // Peek at the accumulated (not yet consumed) drag deltas — test hook.
    peekCamDrag() {
      return { dx: camDrag.dx, dy: camDrag.dy };
    },
    // True while the current canvas drag has moved past the tap threshold:
    // main.js suppresses hold-to-fire shooting during such a drag, so
    // orbiting the camera with the mouse never fires the weapon. A plain
    // hold (no movement) still shoots.
    isCamDragging() {
      return dragPointerId !== null && dragMoved > 8;
    },

    consumePressed() {
      const out = new Set(pressed);
      pressed.clear();
      return out;
    },

    // One frame of intent. forward/turn are heading-based (keyboard);
    // stick is the raw camera-relative vector (main.js converts it).
    read() {
      let forward = 0;
      let turn = 0;
      if (keys.has('forward')) forward += 1;
      if (keys.has('back')) forward -= 1;
      if (keys.has('left')) turn += 1;
      if (keys.has('right')) turn -= 1;
      const run = keys.has('run') || touchBtn.run || (stick.active && Math.hypot(stick.x, stick.y) > 0.85);
      const fire = touchBtn.fire;
      return {
        forward: Math.max(-1, Math.min(1, forward)),
        turn: Math.max(-1, Math.min(1, turn)),
        run,
        fire,
        gas: !!touchBtn.gas,
        brake: !!touchBtn.brake,
        stick: { active: stick.active, x: stick.x, y: stick.y },
      };
    },
  };
}
