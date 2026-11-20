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

  function draw(canvas, playerPos, heading) {
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
    // Roads: from the road graph if present, else a light grid.
    ctx.strokeStyle = '#3b4a63';
    ctx.lineWidth = 2;
    if (world.roadGraph && world.roadGraph.roads) {
      for (const road of world.roadGraph.roads) {
        ctx.beginPath();
        road.forEach(([rx, rz], i) => {
          const [mx, my] = toMap(rx, rz);
          if (i === 0) ctx.moveTo(mx, my);
          else ctx.lineTo(mx, my);
        });
        ctx.stroke();
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
    // Destinations.
    const dests = destinations();
    ctx.font = '12px system-ui, sans-serif';
    dests.forEach((d, i) => {
      const [mx, my] = toMap(d.x, d.z);
      const selected = gpsTarget && gpsTarget.name === d.name;
      ctx.fillStyle = selected ? '#f472b6' : '#22d3ee';
      ctx.beginPath(); ctx.arc(mx, my, selected ? 7 : 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(`${i + 1}. ${d.name}`, mx + 9, my + 4);
    });
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
