// Neon Vice — Builder C: full-screen map + GPS.
// M opens the map overlay (a 2D canvas): the city bounds, roads from the
// road graph when Builder B provides one (fallback: a simple grid + the
// named places), destination markers from world.destinations (fallback:
// CONFIG.places), the player arrow, and the GPS route to the selected
// destination. Clicking a destination (or pressing its number) sets the GPS
// target; main.js draws the 3D arrow + HUD distance from the same target.

import { CONFIG } from './config.js';

export function createMap(world) {
  const W = CONFIG.world.width;
  const D = CONFIG.world.depth;
  let gpsTarget = null; // {x, z, name}
  let open = false;

  function destinations() {
    if (world.destinations && world.destinations.length) {
      return world.destinations.map((d) => ({ x: d.x, z: d.z, name: d.name || d.id }));
    }
    return Object.entries(CONFIG.places).map(([id, p]) => ({ x: p.x, z: p.z, name: p.name, id }));
  }

  // missionTarget: {x, z} of the active mission stage (optional) — drawn
  // as a gold diamond + "!" so the mission target is unmistakable on the map.
  // extras (optional): { pedestrians: [{x, z}], traffic: [{x, z}] } — the
  // living city as dots, so the map shows where the crowds and cars are.
  function draw(canvas, playerPos, heading, missionTarget, extras) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#0b1026';
    ctx.fillRect(0, 0, w, h);
    const scale = Math.min(w / W, h / D) * 0.92;
    const ox = (w - W * scale) / 2;
    const oy = (h - D * scale) / 2;
    const toMap = (x, z) => [ox + (x + W / 2) * scale, oy + (z + D / 2) * scale];

    // City block.
    ctx.fillStyle = '#16213a';
    const [bx, by] = toMap(-W / 2, -D / 2);
    ctx.fillRect(bx, by, W * scale, D * scale);
    // Water strip (east edge).
    const [wx, wy] = toMap(CONFIG.water.x0, CONFIG.water.z0);
    ctx.fillStyle = '#0e3a5c';
    ctx.fillRect(wx, wy, (CONFIG.water.x1 - CONFIG.water.x0) * scale, (CONFIG.water.z1 - CONFIG.water.z0) * scale);
    // Roads: from the road graph if present (segments {ax,az,bx,bz}),
    // else a light grid.
    ctx.strokeStyle = '#3b4a63';
    ctx.lineWidth = 2;
    if (world.roadGraph && world.roadGraph.segments) {
      for (const s of world.roadGraph.segments) {
        const [x1, y1] = toMap(s.ax, s.az);
        const [x2, y2] = toMap(s.bx, s.bz);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
    } else {
      for (let x = -500; x <= 500; x += 100) {
        const [x1, y1] = toMap(x, -D / 2);
        const [x2, y2] = toMap(x, D / 2);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      for (let z = -400; z <= 400; z += 100) {
        const [x1, y1] = toMap(-W / 2, z);
        const [x2, y2] = toMap(W / 2, z);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
    }
    // GPS route: straight line (road routing is the 3D arrow's job).
    if (gpsTarget) {
      const [px, py] = toMap(playerPos.x, playerPos.z);
      const [tx, ty] = toMap(gpsTarget.x, gpsTarget.z);
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Destinations. Labels use greedy collision avoidance: each label tries
    // right / left / above / below the dot and takes the first slot whose
    // box does not overlap an already-placed label (the 4 reported pairs —
    // Plaza Vera×RS Pantai, Masjid Al-Nur×Polsek Beach, Kuil Dewi Harbor×
    // Polsek Pelabuhan, Masjid Pantai×Polsek Beach — all sat ~120 m apart
    // on the same row, so right-only labels always collided).
    const dests = destinations();
    ctx.font = '12px system-ui, sans-serif';
    const placedBoxes = [];
    // Dots themselves are obstacles too: dest 17's dot sat on top of dest
    // 7's label text ("Masjid Al-Nur" lost its N under the dot).
    const dotBoxes = dests.map((d) => {
      const [mx, my] = toMap(d.x, d.z);
      return { x0: mx - 8, y0: my - 8, x1: mx + 8, y1: my + 8 };
    });
    const overlaps = (b, selfIdx) => [...placedBoxes, ...dotBoxes.filter((_, j) => j !== selfIdx)]
      .some((o) => b.x0 < o.x1 + 4 && b.x1 > o.x0 - 4 && b.y0 < o.y1 + 4 && b.y1 > o.y0 - 4);
    dests.forEach((d, i) => {
      const [mx, my] = toMap(d.x, d.z);
      const selected = gpsTarget && gpsTarget.name === d.name;
      ctx.fillStyle = selected ? '#f472b6' : '#22d3ee';
      ctx.beginPath(); ctx.arc(mx, my, selected ? 7 : 5, 0, Math.PI * 2); ctx.fill();
      const label = `${i + 1}. ${d.name}`;
      const tw = ctx.measureText(label).width;
      // Vertical offsets are deliberately large (±22/28 px): the colliding
      // pairs sit ~120 m apart on nearly the same row, so a same-row label
      // is only ~13 px below its neighbour — visually still a collision.
      const candidates = [
        [mx + 9, my + 4], [mx - 9 - tw, my + 4],
        [mx + 9, my - 22], [mx + 9, my + 28],
        [mx - 9 - tw, my - 22], [mx - 9 - tw, my + 28],
      ];
      let slot = candidates[0];
      for (const [lx, ly] of candidates) {
        const box = { x0: lx - 2, y0: ly - 12, x1: lx + tw + 2, y1: ly + 5 };
        if (!overlaps(box, i)) { slot = [lx, ly]; placedBoxes.push(box); break; }
      }
      if (!placedBoxes.some((o) => o.x0 === slot[0] - 2 && o.y0 === slot[1] - 12)) {
        placedBoxes.push({ x0: slot[0] - 2, y0: slot[1] - 12, x1: slot[0] + tw + 2, y1: slot[1] + 5 });
      }
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(label, slot[0], slot[1]);
    });
    // Mission target icon: gold diamond + "!" + label, drawn over the
    // destinations so it cannot be mistaken for a place dot.
    if (missionTarget) {
      const [mx, my] = toMap(missionTarget.x, missionTarget.z);
      ctx.save();
      ctx.translate(mx, my);
      ctx.beginPath();
      ctx.moveTo(0, -16); ctx.lineTo(14, 0); ctx.lineTo(0, 16); ctx.lineTo(-14, 0);
      ctx.closePath();
      ctx.fillStyle = '#ffd400';
      ctx.fill();
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#111111';
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', 0, 1);
      ctx.restore();
      ctx.fillStyle = '#ffd400';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillText('MISSION TARGET', mx + 20, my - 8);
    }
    // Ambient life: traffic cars as amber dots, pedestrians as white dots.
    if (extras) {
      if (Array.isArray(extras.traffic)) {
        ctx.fillStyle = '#f59e0b';
        for (const v of extras.traffic) {
          const [mx, my] = toMap(v.x, v.z);
          ctx.beginPath(); ctx.arc(mx, my, 3, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (Array.isArray(extras.pedestrians)) {
        ctx.fillStyle = '#e2e8f0';
        for (const p of extras.pedestrians) {
          const [mx, my] = toMap(p.x, p.z);
          ctx.beginPath(); ctx.arc(mx, my, 2, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    // Player arrow.
    const [px, py] = toMap(playerPos.x, playerPos.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.atan2(Math.sin(heading), Math.cos(heading)));
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(-7, 8); ctx.closePath();
    ctx.fill();
    ctx.restore();
    return dests;
  }

  return {
    get isOpen() { return open; },
    get gpsTarget() { return gpsTarget; },
    open() { open = true; },
    close() { open = false; },
    toggle() { open = !open; return open; },
    setGps(name) {
      const d = destinations().find((x) => x.name === name);
      if (d) gpsTarget = d;
      return gpsTarget;
    },
    setGpsByIndex(i) {
      const d = destinations()[i];
      if (d) gpsTarget = d;
      return gpsTarget;
    },
    clearGps() { gpsTarget = null; },
    destinations,
    draw,
  };
}
