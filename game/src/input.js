// Neon Vice — keyboard and touch input.
//
// On keyboard: W/S drive forward/back, A/D steer, Shift runs, E interacts,
// H holsters, 1/2 swap weapons, M opens the map, B the backpack/phone, N
// mutes, R reloads, Space jumps. On touch, the left stick is
// CAMERA-RELATIVE: pushing up moves Vera away from the camera (up-screen),
// pushing right moves her screen-right. The stick vector goes out raw
// (stick.x / stick.y) and main.js converts it with the camera basis, which
// is what keeps the on-screen direction correct. Right-side buttons:
// RUN / FIRE / CAR / JUMP.
//
// read() hands back one frame of intent; pressed(action) is edge-triggered
// and main.js consumes it once per frame (call consumePressed() after
// polling).

const KEYMAP = Object.fromEntries([
  ["KeyW", "forward"],
  ["ArrowUp", "forward"],
  ["KeyS", "back"],
  ["ArrowDown", "back"],
  ["KeyA", "left"],
  ["ArrowLeft", "left"],
  ["KeyD", "right"],
  ["ArrowRight", "right"],
  ["ShiftLeft", "run"],
  ["ShiftRight", "run"],
]);

const ACTION_KEYS = Object.fromEntries([
  ["KeyE", "interact"],
  ["KeyF", "exitVehicle"], // dedicated exit key: never opens a shop or enters a car
  ["KeyH", "holster"],
  ["KeyM", "map"],
  ["KeyB", "backpack"],
  ["KeyN", "mute"],
  ["KeyR", "reload"],
  ["Space", "jump"],
  ["Digit1", "weapon1"],
  ["Digit2", "weapon2"],
  // Digits 3-9 pick a map destination by number — but ONLY while the
  // map is open (main.js paused branch); while playing they do nothing.
  ["Digit3", "dest3"],
  ["Digit4", "dest4"],
  ["Digit5", "dest5"],
  ["Digit6", "dest6"],
  ["Digit7", "dest7"],
  ["Digit8", "dest8"],
  ["Digit9", "dest9"],
  ["Escape", "pause"],
  ["KeyP", "pause"],
]);

// Plain-language labels for Settings > Controls (ui.js shows them
// read-only: remapping is deliberately NOT offered — a remap saved to
// localStorage could silently break the playtest harness, which drives
// the game by physical key code).
const KEY_LABELS = Object.fromEntries([
  ["KeyW", "W"],
  ["KeyA", "A"],
  ["KeyS", "S"],
  ["KeyD", "D"],
  ["ArrowUp", "↑"],
  ["ArrowDown", "↓"],
  ["ArrowLeft", "←"],
  ["ArrowRight", "→"],
  ["ShiftLeft", "Shift"],
  ["ShiftRight", "Shift"],
  ["Space", "Space"],
  ["Escape", "Esc"],
]);

function keyLabel(code) { // code -> display label
  const known = KEY_LABELS[code];
  if (known) return known;
  const cut = code.startsWith("Key") ? 3 : code.startsWith("Digit") ? 5 : 0;
  return cut ? code.slice(cut) : code;
}

const ACTION_LABELS = Object.fromEntries([
  ["forward", "Move forward / Gas while driving"],
  ["back", "Move back / Brake & reverse while driving"],
  ["left", "Turn left"],
  ["right", "Turn right"],
  ["run", "Run"],
  ["interact", "Enter car / open shop / exit"],
  ["exitVehicle", "Exit vehicle"],
  ["holster", "Holster / draw weapon"],
  ["map", "Open map"],
  ["backpack", "Open backpack / phone"],
  ["phone", "Open backpack / phone"],
  ["mute", "Mute / unmute"],
  ["reload", "Reload"],
  ["jump", "Jump"],
  ["weapon1", "Select pistol"],
  ["weapon2", "Select SMG"],
  ["pause", "Pause / settings"],
  ["dest3", "Select map destination 3"],
  ["dest4", "Select map destination 4"],
  ["dest5", "Select map destination 5"],
  ["dest6", "Select map destination 6"],
  ["dest7", "Select map destination 7"],
  ["dest8", "Select map destination 8"],
  ["dest9", "Select map destination 9"],
  ["gas", "Gas — touch pedal while driving"],
  ["brake", "Brake & reverse — touch pedal while driving"],
  ["camOrbit", "Orbit camera — drag empty screen / mouse drag (360°, smooth)"],
]);

function getBindings() {
  const rows = []; // {action, label, keys} rows for the Controls list
  const byAction = new Map();
  const add = (code, action) => {
    const label = ACTION_LABELS[action] || action;
    const key = keyLabel(code);
    const row = byAction.get(action);
    if (row) {
      row.keys += " / " + key;
    } else {
      const fresh = { action, label, keys: key };
      byAction.set(action, fresh);
      rows.push(fresh);
    }
  };
  for (const entry of Object.entries(KEYMAP)) {
    const [code, action] = entry;
    if (!byAction.has(action)) add(code, action);
  }
  for (const [code, action] of Object.entries(ACTION_KEYS)) add(code, action);
  // Touch-only pedals + camera orbit (no keyboard binding).
  rows.push(
    { action: "gas", label: ACTION_LABELS.gas, keys: "GAS" },
    { action: "brake", label: ACTION_LABELS.brake, keys: "REM" },
    { action: "camOrbit", label: ACTION_LABELS.camOrbit, keys: "Drag" },
  );
  return rows; // bindings for the Controls list
}

const TOUCH_BUTTONS = [
  ["btnRun", "run", true],
  ["btnFire", "fire", true],
  ["btnCar", "interact", false],
  ["btnJump", "jump", false],
  ["btnHolster", "holster", false],
  // Touch driving pedals (hold buttons, shown only while driving —
  // see body.driving in index.html).
  ["btnGas", "gas", true],
  ["btnBrake", "brake", true],
  // MAP opens the full map, PACK opens Backpack/Phone, SET opens
  // Settings (pause). Edge-triggered like the other tap buttons.
  ["btnMap", "map", false],
  ["btnPack", "backpack", false],
  ["btnSet", "pause", false],
];

const HINT_SWAPS = [
  ["Press E to ", "Tap CAR to "],
  ["Tekan E untuk ", "Ketuk CAR untuk "],
  [
    "WASD move · Shift run · E interact · M map · B backpack · H holster",
    "Left stick to move · CAR to enter a car",
  ],
  ["Swimming — steer toward the shore", "Swimming — stick toward the shore"],
];

function createInput() {
  const keys = new Set(), pressed = new Set(); // held moves; edges, consumed per frame
  const stick = { active: false, x: 0, y: 0 }; // x -1..1 (right +), y -1..1 (up +)
  const touchBtn = { run: false, fire: false, car: false, jump: false, gas: false, brake: false }; // held touch buttons
  // Camera-orbit drag: pointer drags on the empty canvas only. The stick
  // and every button sit in elements above the canvas, so a drag starting
  // on them never reaches here. Deltas pile up in pixels and main.js
  // consumes them once per rendered frame (consumeCamDrag); mouse drags
  // take the same path.
  const camDrag = { dx: 0, dy: 0 }; // orbit deltas
  let dragPointerId = null, dragLastX = 0, dragLastY = 0, dragMoved = 0; // px in this drag
  let stickEl = null, knobEl = null;

  function onKeyDown(event) { // key pressed
    const move = KEYMAP[event.code];
    const act = ACTION_KEYS[event.code];
    if (!move && !act) return;
    if (move) keys.add(move);
    else if (event.repeat === false) pressed.add(act);
    event.preventDefault(); // the game owns this key
  }
  function onKeyUp(event) { // release a held move
    const move = KEYMAP[event.code];
    if (move) keys.delete(move);
  }

  function moveKnob(dx, dy) {
    if (!knobEl) return;
    knobEl.style.left = 44 + dx * 40 + "px";
    knobEl.style.top = 44 + dy * 40 + "px";
  }

  function stickMove(event) { // stick dragged
    if (!stick.active || stickEl === null) return;
    const rect = stickEl.getBoundingClientRect(); // stick base box
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const radius = rect.width * 0.5;
    let dx = (event.clientX - cx) / radius; // -1..1
    let dy = (event.clientY - cy) / radius; // -1..1
    const len = Math.hypot(dx, dy); // deflection
    if (len > 1) { // clamp to the rim
      dx = dx / len;
      dy = dy / len;
    }
    stick.x = dx; // right is +
    stick.y = -dy; // up is +
    moveKnob(dx, dy);
  }

  function stickEnd() { // stick released
    Object.assign(stick, { active: false, x: 0, y: 0 });
    moveKnob(0, 0);
  }

  function bindTouchButton(id, name, isHold) { // wire one touch button
    const el = document.getElementById(id); // touch button element
    if (!el) {
      return;
    }
    const down = (ev) => {
      ev.preventDefault();
      if (isHold) {
        touchBtn[name] = true;
      } else {
        pressed.add(name);
      }
    };
    const up = (ev) => {
      ev.preventDefault();
      if (isHold) {
        touchBtn[name] = false;
      }
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", up);
  }

  // Touch enter/exit hint: main.js writes the contextual hint into #hudHint
  // ("Press E to enter" / "Press E to exit"), but that bar stays hidden on
  // touch devices since it names keyboard keys. Mirror it into a touch pill
  // (#touchHint, index.html) with tap wording instead, and make the CAR
  // button itself read EXIT while driving and pulse when a vehicle is close
  // enough to enter. A MutationObserver watches #hudHint, so the pill
  // follows main.js (and the language) for free.
  function setupTouchHint() { // mirror the hint pill
    const hint = document.getElementById("hudHint");
    const pill = document.getElementById("touchHint");
    const carBtn = document.getElementById("btnCar");
    if (!hint || !pill) {
      return;
    }
    const translate = (text) =>
      HINT_SWAPS.reduce((acc, [from, to]) => acc.replace(from, to), text);
    const sync = () => { // refresh pill + CAR label
      const playing = document.getElementById("startScreen")?.classList.contains("hidden");
      if (!playing) {
        pill.classList.remove("show");
        return;
      }
      const text = translate(hint.textContent || "");
      if (pill.textContent !== text) {
        pill.textContent = text;
      }
      pill.classList.toggle("show", text.length > 0);
      pill.classList.toggle("action", /CAR/.test(text));
      if (carBtn) { // EXIT vs CAR label
        const exiting = /exit|keluar/i.test(text); // leaving a car?
        const entering = /enter|masuk|open/i.test(text); // getting in?
        const label = exiting ? "EXIT" : "CAR";
        if (carBtn.textContent !== label) {
          carBtn.textContent = label;
        }
        carBtn.classList.toggle("ready", entering);
      }
    };
    const watcher = new MutationObserver(sync);
    watcher.observe(hint, { childList: true, characterData: true, subtree: true });
    sync();
  }

  function onDragStart(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (dragPointerId !== null) {
      return;
    }
    dragPointerId = event.pointerId; // track this pointer
    dragLastX = event.clientX; // drag origin
    dragLastY = event.clientY; // drag origin
    dragMoved = 0; // fresh drag
  }

  function onDragMove(event) {
    if (event.pointerId !== dragPointerId) {
      return;
    }
    const stepX = event.clientX - dragLastX;
    const stepY = event.clientY - dragLastY;
    dragLastX = event.clientX; // track the pointer
    dragLastY = event.clientY; // track the pointer
    dragMoved = dragMoved + Math.abs(stepX) + Math.abs(stepY);
    camDrag.dx = camDrag.dx + stepX;
    camDrag.dy = camDrag.dy + stepY;
  }

  function onDragEnd(event) {
    if (event.pointerId === dragPointerId) {
      dragPointerId = null;
    }
  }

  return {
    attach() { // wire everything up
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      stickEl = document.getElementById("stick");
      knobEl = document.getElementById("stickKnob");
      if (stickEl) { // virtual stick
        stickEl.addEventListener("pointerdown", (event) => {
          stick.active = true; // grabbing the stick
          stickEl.setPointerCapture(event.pointerId); // keep moves coming
          stickMove(event); // jump the knob to the touch
        });
        stickEl.addEventListener("pointermove", stickMove);
        stickEl.addEventListener("pointerup", stickEnd);
        stickEl.addEventListener("pointercancel", stickEnd);
      }
      for (const [id, name, isHold] of TOUCH_BUTTONS) bindTouchButton(id, name, isHold);
      // Camera-orbit drag on the game canvas.
      const canvas = document.getElementById("game");
      if (canvas) { // orbit drag
        canvas.addEventListener("pointerdown", onDragStart);
        canvas.addEventListener("pointermove", onDragMove);
        canvas.addEventListener("pointerup", onDragEnd);
        canvas.addEventListener("pointercancel", onDragEnd);
      }
      if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
        document.getElementById("touch")?.classList.add("on");
        document.body.classList.add("touch-device"); // hides the WASD hint
        setupTouchHint(); // mirror the hint pill
      }
    },

    detach() { // keyboard only; touch stays
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    },

    // Test hook: drive the stick by script (Playwright tests).
    setStick(x, y) { // test hook
      Object.assign(stick, { active: true, x, y });
    },
    clearStick() { // test hook
      Object.assign(stick, { active: false, x: 0, y: 0 });
    },
    press(action) { // queue the edge
      pressed.add(action); // queue the edge
    },
    setTouchButton(name, value) { // test hook
      touchBtn[name] = value; // test hook
    },

    // Orbit drag deltas, consumed once per rendered frame by main.js.
    consumeCamDrag() { // take the orbit deltas
      const out = { dx: camDrag.dx, dy: camDrag.dy }; // snapshot
      camDrag.dx = 0; // consumed
      camDrag.dy = 0; // consumed
      return out; // hand it over
    },
    // Read the pending drag deltas without consuming — test hook.
    peekCamDrag() { // read without consuming
      return { dx: camDrag.dx, dy: camDrag.dy }; // no consume
    },
    // True while this canvas drag has travelled past the tap threshold,
    // so main.js can suppress hold-to-fire while orbiting: dragging the
    // camera with the mouse must never fire the weapon, while a plain
    // hold (standing still) still shoots.
    isCamDragging() { // past the tap threshold?
      return dragPointerId !== null && dragMoved > 8; // past the tap threshold
    },

    consumePressed() { // take the queued edges
      const out = new Set(pressed); // snapshot the edges
      pressed.clear(); // consumed
      return out; // edges for this frame
    },

    // One frame of intent: forward/turn come from heading keys, while
    // the stick stays a raw camera-relative vector (main.js converts it).
    read() {
      const fwd = (keys.has("forward") ? 1 : 0) - (keys.has("back") ? 1 : 0);
      const trn = (keys.has("left") ? 1 : 0) - (keys.has("right") ? 1 : 0);
      const pinch = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);
      const run = keys.has("run") || touchBtn.run || (stick.active && Math.hypot(stick.x, stick.y) > 0.85);
      const fire = touchBtn.fire; // hold-to-fire
      return {
        forward: pinch(fwd),
        turn: pinch(trn),
        run,
        fire,
        gas: Boolean(touchBtn.gas),
        brake: Boolean(touchBtn.brake),
        stick: { active: stick.active, x: stick.x, y: stick.y }, // raw vector
      };
    },
  };
}

export { createInput, getBindings };
