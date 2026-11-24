// Neon Vice — the full-screen map and the GPS.
//
// Pressing M opens the map overlay on a 2D canvas: city bounds, streets
// from the road graph when one exists (otherwise a plain grid plus the
// named places), markers for every destination from world.destinations
// (or CONFIG.places as fallback), the player arrow, and the GPS line to
// the chosen target. Tapping a destination — or pressing its number —
// sets that GPS target, and main.js draws the 3D arrow and HUD distance
// from the very same target.

import { CONFIG as GAME_CFG } from "./config.js";

const INK = {
  bg: "#0b1026",
  block: "#16213a",
  water: "#0e3a5c",
  road: "#3b4a63",
  deck: "#f59e0b",
  garden: "#166534",
  gps: "#f472b6",
  pin: "#22d3ee",
  label: "#e2e8f0",
  gold: "#ffd400",
  dark: "#111111",
  amber: "#f59e0b",
};

function createMap(world) {
  const MAP_W = GAME_CFG.world.width, MAP_D = GAME_CFG.world.depth;
  let gpsTarget = null, open = false, lastPins = null; // target {x, z, name}; pins in canvas px

  function destinations() { // named places for the overlay
    const list = world.destinations;
    if (list && list.length > 0) {
      return list.map((d) => ({ x: d.x, z: d.z, name: d.name || d.id }));
    }
    return Object.entries(GAME_CFG.places).map(([id, p]) => ({ x: p.x, z: p.z, name: p.name, id }));
  }

  function draw(canvas, playerPos, heading, missionTarget, extras) { // repaint the whole overlay
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = INK.bg;
    ctx.fillRect(0, 0, w, h); // paint the backdrop
    const scale = Math.min(w / MAP_W, h / MAP_D) * 0.92;
    const ox = (w - MAP_W * scale) / 2, oy = (h - MAP_D * scale) / 2;
    const toMap = (x, z) => {
      const mx = ox + (x + MAP_W / 2) * scale;
      const my = oy + (z + MAP_D / 2) * scale;
      return [mx, my];
    };
    const strokeLine = (x1, y1, x2, y2) => {
      const path = new Path2D();
      path.moveTo(x1, y1);
      path.lineTo(x2, y2);
      ctx.stroke(path);
    };
    const fillDot = (x, y, r) => {
      const circ = new Path2D();
      circ.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill(circ);
    };

    // The city block itself.
    ctx.fillStyle = INK.block;
    const [bx, by] = toMap(-MAP_W / 2, -MAP_D / 2);
    ctx.fillRect(bx, by, MAP_W * scale, MAP_D * scale);
    // Water strip along the east edge.
    const [wx, wy] = toMap(GAME_CFG.water.x0, GAME_CFG.water.z0);
    ctx.fillStyle = INK.water;
    ctx.fillRect(wx, wy, (GAME_CFG.water.x1 - GAME_CFG.water.x0) * scale, (GAME_CFG.water.z1 - GAME_CFG.water.z0) * scale);
    // Streets: road-graph segments when present, else a light grid.
    ctx.strokeStyle = INK.road;
    ctx.lineWidth = 2; // thin street lines
    const segs = world.roadGraph && world.roadGraph.segments;
    if (segs) {
      for (const s of segs) {
        const a = toMap(s.ax, s.az), b = toMap(s.bx, s.bz);
        strokeLine(a[0], a[1], b[0], b[1]);
      }
    } else {
      for (let gx = -500; gx <= 500; gx += 100) {
        const top = toMap(gx, -MAP_D / 2), bot = toMap(gx, MAP_D / 2);
        strokeLine(top[0], top[1], bot[0], bot[1]);
      }
      for (let gz = -400; gz <= 400; gz += 100) {
        const lft = toMap(-MAP_W / 2, gz), rgt = toMap(MAP_W / 2, gz);
        strokeLine(lft[0], lft[1], rgt[0], rgt[1]);
      }
    }
    // Flyover decks: the raised NS lanes over z=0 as an amber strip, so
    // the 4-lane layout reads — the deck is the two centre lanes, while
    // the surface turn lanes are the road itself, open to the crossing.
    if (world.flyovers) { // raised decks
      ctx.strokeStyle = INK.deck;
      ctx.lineWidth = 4; // chunky amber decks
      for (const deck of world.flyovers) {
        const a = toMap(deck.x, deck.z - 60), b = toMap(deck.x, deck.z + 60);
        strokeLine(a[0], a[1], b[0], b[1]);
      }
    }
    // Flyover gardens: green patches so the parks read on the map.
    if (world.flyoverGardens) { // park patches
      ctx.fillStyle = INK.garden;
      for (const patch of world.flyoverGardens) {
        const [gx, gy] = toMap(patch.x0, patch.z0);
        const [gx2, gy2] = toMap(patch.x1, patch.z1);
        ctx.fillRect(gx, gy, gx2 - gx, gy2 - gy); // park patch
      }
    }
    // GPS route: a straight line (road routing is the 3D arrow's job).
    if (gpsTarget) { // draw the route line
      const [sx, sy] = toMap(playerPos.x, playerPos.z);
      const [nx, ny] = toMap(gpsTarget.x, gpsTarget.z);
      ctx.strokeStyle = INK.gps;
      ctx.lineWidth = 3; // route weight
      ctx.setLineDash([8, 6]); // dashed pink route
      strokeLine(sx, sy, nx, ny);
      ctx.setLineDash([]); // solid again
    }
    // Destinations. Labels dodge each other greedily: every label tries
    // right / left / above / below its dot and takes the first slot whose
    // box overlaps nothing placed yet (the 4 reported pairs all sat
    // ~120 m apart on one row, so right-only labels always collided).
    const dests = destinations(); // places to pin
    ctx.font = "12px system-ui, sans-serif"; // place labels
    const placedBoxes = []; // label boxes already taken
    // The dots count as obstacles too: one dot used to sit on top of
    // another place's label ("Masjid Al-Nur" lost its N under the dot).
    const dotBoxes = dests.map((place) => {
      const [qx, qy] = toMap(place.x, place.z);
      return { x0: qx - 8, y0: qy - 8, x1: qx + 8, y1: qy + 8 };
    });
    const collides = (b, selfIdx) => {
      const pool = placedBoxes.concat(dotBoxes.filter((_, j) => j !== selfIdx));
      for (const o of pool) {
        if (b.x0 < o.x1 + 4 && b.x1 > o.x0 - 4 && b.y0 < o.y1 + 4 && b.y1 > o.y0 - 4) return true;
      }
      return false; // no overlap found
    };
    for (let i = 0; i < dests.length; i++) {
      const d = dests[i];
      const [dx, dy] = toMap(d.x, d.z);
      const selected = !!gpsTarget && gpsTarget.name === d.name;
      ctx.fillStyle = selected ? INK.gps : INK.pin;
      fillDot(dx, dy, selected ? 7 : 5);
      const label = (i + 1) + ". " + d.name;
      const tw = ctx.measureText(label).width; // label width
      // The up/down slots sit far off (±22/28 px) on purpose: the
      // colliding pairs are ~120 m apart on nearly the same row, so a
      // same-row label lands only ~13 px below its neighbour — visually
      // still a collision.
      const right = dx + 9, left = dx - 9 - tw;
      const cands = [
        [right, dy + 4], [left, dy + 4],
        [right, dy - 22], [right, dy + 28],
        [left, dy - 22], [left, dy + 28],
      ];
      let slot = cands[0];
      for (const cand of cands) {
        const lx = cand[0], ly = cand[1];
        const box = { x1: lx + tw + 2, y1: ly + 5, x0: lx - 2, y0: ly - 12 };
        if (!collides(box, i)) {
          slot = [lx, ly];
          placedBoxes.push(box);
          break;
        }
      }
      const slotBox = { x0: slot[0] - 2, y0: slot[1] - 12, x1: slot[0] + tw + 2, y1: slot[1] + 5 };
      if (!placedBoxes.some((o) => o.x0 === slotBox.x0 && o.y0 === slotBox.y0)) {
        placedBoxes.push(slotBox);
      }
      ctx.fillStyle = INK.label;
      ctx.fillText(label, slot[0], slot[1]); // draw the label
    }
    // Mission target: a gold diamond with "!" and a label, drawn over
    // the destinations so it cannot be mistaken for a place dot.
    if (missionTarget) { // mission diamond
      const [fx, fy] = toMap(missionTarget.x, missionTarget.z);
      const dia = new Path2D();
      dia.moveTo(fx, fy - 16);
      dia.lineTo(fx + 14, fy);
      dia.lineTo(fx, fy + 16);
      dia.lineTo(fx - 14, fy);
      dia.closePath();
      ctx.fillStyle = INK.gold;
      ctx.fill(dia);
      ctx.strokeStyle = INK.gps;
      ctx.lineWidth = 3; // diamond outline
      ctx.stroke(dia);
      ctx.fillStyle = INK.dark;
      ctx.font = "bold 18px system-ui, sans-serif";
      Object.assign(ctx, { textAlign: "center", textBaseline: "middle" });
      ctx.fillText("!", fx, fy + 1);
      ctx.fillStyle = INK.gold;
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.fillText("MISSION TARGET", fx + 20, fy - 8);
    }
    // Living city dots: amber for traffic cars, white for pedestrians.
    if (extras) { // ambient life
      if (Array.isArray(extras.traffic)) { // amber car dots
        ctx.fillStyle = INK.amber;
        for (const car of extras.traffic) {
          const [cx, cy] = toMap(car.x, car.z);
          fillDot(cx, cy, 3);
        }
      }
      if (Array.isArray(extras.pedestrians)) { // white walker dots
        ctx.fillStyle = INK.label;
        for (const walker of extras.pedestrians) {
          const [ex, ey] = toMap(walker.x, walker.z);
          fillDot(ex, ey, 2);
        }
      }
    }
    // Player arrow, rotated to the heading without save/restore: the
    // triangle corners are rotated by hand (same maths as ctx.rotate).
    const [ax, ay] = toMap(playerPos.x, playerPos.z);
    const ang = Math.atan2(Math.sin(heading), Math.cos(heading));
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const corners = [[0, -10], [7, 8], [-7, 8]].map(([x, y]) => [
      ax + x * ca - y * sa,
      ay + x * sa + y * ca,
    ]);
    ctx.fillStyle = INK.amber;
    const tri = new Path2D();
    tri.moveTo(corners[0][0], corners[0][1]);
    tri.lineTo(corners[1][0], corners[1][1]);
    tri.lineTo(corners[2][0], corners[2][1]);
    tri.closePath();
    ctx.fill(tri);
    // Keep the pin positions (canvas pixels) so the next tap can hit-test.
    let missionPin = null;
    if (missionTarget) { // stash the mission pin
      const [kx, ky] = toMap(missionTarget.x, missionTarget.z);
      missionPin = { x: kx, y: ky, wx: missionTarget.x, wz: missionTarget.z };
    }
    lastPins = { // pins for the next tap
      dests: dests.map((place) => {
        const [jx, jy] = toMap(place.x, place.z);
        return { x: jx, y: jy, name: place.name };
      }),
      mission: missionPin,
    };
    return dests; // pins + places for the caller
  }

  return {
    get isOpen() { return open; }, // overlay visible?
    get gpsTarget() { return gpsTarget; }, // current target
    open: () => {
      open = true;
    },
    close: () => {
      open = false;
    },
    toggle: () => {
      open = !open;
      return open;
    },
    setGps: (name) => {
      const d = destinations().find((place) => place.name === name);
      if (d) {
        gpsTarget = d;
      }
      return gpsTarget; // target (maybe unchanged)
    },
    // GPS to any point at all — the mission target, say, which is not a
    // named destination. The 3D arrow and HUD distance follow it alike.
    setGpsTarget: (x, z, name) => {
      gpsTarget = { x, z, name: name || "Target" };
      return gpsTarget; // the new target
    },
    // Tap hit-test for pointerdown on #mapCanvas. The mission diamond
    // wins first (radius ~20 canvas px), then the dots (~12 px). Client
    // coords go through the canvas rect and the canvas/CSS scale, so a
    // CSS-scaled canvas still hit-tests right. Null on empty space —
    // the caller must NOT clear the GPS then.
    hitTest: (canvas, clientX, clientY) => {
      if (!lastPins) {
        return null; // no pins yet
      }
      const rect = canvas.getBoundingClientRect(); // CSS box
      if (rect.width <= 0 || rect.height <= 0) {
        return null; // zero-size canvas
      }
      const x = (clientX - rect.left) * canvas.width / rect.width;
      const y = (clientY - rect.top) * canvas.height / rect.height;
      if (lastPins.mission) { // diamond first
        const m = lastPins.mission; // mission pin
        if (Math.hypot(m.x - x, m.y - y) <= 20) {
          return { type: "mission", x: m.wx, z: m.wz };
        }
      }
      for (const pin of lastPins.dests) {
        if (Math.hypot(x - pin.x, y - pin.y) <= 12) return { type: "dest", name: pin.name };
      }
      return null; // empty space
    },
    setGpsByIndex: (i) => {
      const d = destinations()[i]; // place by number
      if (d) {
        gpsTarget = d;
      }
      return gpsTarget; // target by number
    },
    clearGps: () => {
      gpsTarget = null;
    },
    destinations, draw,
  };
}

export { createMap };
