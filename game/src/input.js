// Neon Vice — scaffold v1: keyboard + touch input, one shape for both.
// Keyboard: W/Up forward, S/Down back, A/Left and D/Right turn, Shift run.
// Touch: the on-screen stick (#stick in index.html) — up is forward, left/right
// turns; holding the stick past 85% of its radius counts as running. The touch
// layer is shown only on touch devices. Nothing here touches the game state:
// main.js polls `read()` once per frame.

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

export function createInput() {
  const keys = new Set();
  const stick = { active: false, x: 0, y: 0 }; // x: -1..1 turn, y: -1..1 (up = +1)
  let stickEl = null;
  let knobEl = null;

  function onKeyDown(event) {
    if (KEYMAP[event.code]) {
      keys.add(KEYMAP[event.code]);
      event.preventDefault();
    }
  }
  function onKeyUp(event) {
    keys.delete(KEYMAP[event.code]);
  }

  // Pointer events on the stick: drag the knob, release to re-centre.
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
    stick.x = dx;
    stick.y = -dy; // screen-up is forward
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
      // Show the touch layer only where touch exists; desktop keeps WASD.
      if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        document.getElementById('touch')?.classList.add('on');
      }
    },

    detach() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },

    // One frame of intent, normalised: forward -1..1, turn -1..1, run bool.
    read() {
      let forward = 0;
      let turn = 0;
      if (keys.has('forward')) forward += 1;
      if (keys.has('back')) forward -= 1;
      if (keys.has('left')) turn += 1;
      if (keys.has('right')) turn -= 1;
      if (stick.active) {
        forward += stick.y;
        turn += -stick.x; // stick right turns right (heading decreases)
      }
      forward = Math.max(-1, Math.min(1, forward));
      turn = Math.max(-1, Math.min(1, turn));
      const run = keys.has('run') || (stick.active && Math.hypot(stick.x, stick.y) > 0.85);
      return { forward, turn, run };
    },
  };
}
