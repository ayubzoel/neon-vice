// Neon Vice — Builder C: keyboard + touch input.
// Keyboard: W/S forward/back, A/D turn, Shift run, E interact, H holster,
// 1/2 weapon, M map, B phone/backpack, N mute, R reload, Space jump.
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
  KeyH: 'holster',
  KeyM: 'map',
  KeyB: 'phone',
  KeyN: 'mute',
  KeyR: 'reload',
  Space: 'jump',
  Digit1: 'weapon1',
  Digit2: 'weapon2',
};

export function createInput() {
  const keys = new Set();
  const pressed = new Set(); // edge-triggered actions, consumed each frame
  const stick = { active: false, x: 0, y: 0 }; // x: -1..1 (right +), y: -1..1 (up +)
  const touchBtn = { run: false, fire: false, car: false, jump: false };
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
      if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        document.getElementById('touch')?.classList.add('on');
        document.body.classList.add('touch-device'); // hides the WASD hint
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
        stick: { active: stick.active, x: stick.x, y: stick.y },
      };
    },
  };
}
