// Neon Vice — road graph (Builder B). Pure logic, no THREE dependency:
// a connected grid of streets over Vice Harbor, with BFS pathfinding and
// nearest-road queries used by gameplay (Builder C) and the GPS.

// 20 s signal cycle, the single source of truth for both the visual heads
// in world.js and the traffic drivers in vehicles.js / ambient.js:
// NS green 0-8 s, yellow 8-10 s, EW green 10-18 s, yellow 18-20 s.
export function trafficLightState(axis, nowMs = Date.now()) {
  const t = (((nowMs / 1000) % 20) + 20) % 20;
  if (axis === 'NS') return t < 8 ? 'green' : t < 10 ? 'yellow' : 'red';
  return t >= 10 && t < 18 ? 'green' : t >= 18 ? 'yellow' : 'red';
}

// xs: vertical streets (constant x), zs: horizontal streets (constant z).
// vWidths[i] / hWidths[j]: full road width of street i / j.
export function buildRoadGraph(xs, zs, vWidths, hWidths) {
  const cols = xs.length;
  const rows = zs.length;
  const nodes = [];
  const nodeId = (c, r) => r * cols + c;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      nodes.push({ id: nodeId(c, r), x: xs[c], z: zs[r], col: c, row: r });
    }
  }

  const segments = [];
  const adjacency = nodes.map(() => []);
  function addSegment(a, b, width, arterial, kind) {
    const na = nodes[a];
    const nb = nodes[b];
    const seg = {
      a, b,
      ax: na.x, az: na.z, bx: nb.x, bz: nb.z,
      length: Math.hypot(nb.x - na.x, nb.z - na.z),
      width, arterial, kind,
    };
    const idx = segments.length;
    segments.push(seg);
    adjacency[a].push({ to: b, seg: idx });
    adjacency[b].push({ to: a, seg: idx });
    return idx;
  }

  // Horizontal segments: along each z-row, between adjacent vertical streets.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      addSegment(nodeId(c, r), nodeId(c + 1, r), hWidths[r], hWidths[r] >= 12, 'horizontal');
    }
  }
  // Vertical segments: along each x-column, between adjacent horizontal streets.
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows - 1; r++) {
      addSegment(nodeId(c, r), nodeId(c, r + 1), vWidths[c], vWidths[c] >= 12, 'vertical');
    }
  }

  function nearestNode(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const n of nodes) {
      const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  // The graph is static (built once above), so BFS results are cached per
  // start node: GPS, driving AI and pedestrians call findPath() every frame
  // from the same few nodes, and re-running BFS each time is pure waste.
  // Cached `prev` maps are only read, never mutated, by findPath/bfsFrom.
  const bfsCache = new Map();
  function bfs(startId) {
    const cached = bfsCache.get(startId);
    if (cached) return cached;
    const prev = new Map([[startId, -1]]);
    const queue = [startId];
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      for (const { to } of adjacency[cur]) {
        if (!prev.has(to)) { prev.set(to, cur); queue.push(to); }
      }
    }
    bfsCache.set(startId, prev);
    return prev;
  }

  const graph = {
    nodes,
    segments,
    adjacency,

    nearestNode,
    // A signalised intersection: an arterial street crosses an arterial
    // street here (both widths >= 12 m) — the only nodes with traffic
    // lights (world.js puts poles exactly on these nodes).
    isArterialNode(nodeId) {
      const n = nodes[nodeId];
      if (!n) return false;
      let hArt = false;
      let vArt = false;
      for (const e of adjacency[nodeId]) {
        const s = segments[e.seg];
        if (s.kind === 'horizontal' && s.arterial) hArt = true;
        if (s.kind === 'vertical' && s.arterial) vArt = true;
      }
      return hArt && vArt;
    },
    // Nearest arterial node to (x, z) within maxD metres, or null.
    arterialNodeNear(x, z, maxD = 3) {
      let best = null;
      let bestD = maxD;
      for (const n of nodes) {
        if (!this.isArterialNode(n.id)) continue;
        const d = Math.hypot(n.x - x, n.z - z);
        if (d < bestD) { bestD = d; best = n; }
      }
      return best;
    },
    // Signal state for one travel axis ('NS' = along a vertical street,
    // 'EW' = along a horizontal street). Same 20 s cycle as the heads.
    trafficLight(axis) {
      return trafficLightState(axis);
    },
    // BFS from a node id: set of reachable node ids.
    bfsFrom(startId) {
      return new Set(bfs(startId).keys());
    },
    countDeadEnds() {
      let n = 0;
      for (let i = 0; i < nodes.length; i++) if (adjacency[i].length <= 1) n++;
      return n;
    },
    // a, b: {x,z} points or node ids. Returns [{x,z}, ...] or null.
    findPath(a, b) {
      const start = typeof a === 'number' ? a : nearestNode(a.x, a.z).id;
      const goal = typeof b === 'number' ? b : nearestNode(b.x, b.z).id;
      if (start === goal) {
        const n = nodes[start];
        return [{ x: n.x, z: n.z }];
      }
      const prev = bfs(start);
      if (!prev.has(goal)) return null;
      const path = [];
      let cur = goal;
      while (cur !== -1) {
        const n = nodes[cur];
        path.push({ x: n.x, z: n.z });
        cur = prev.get(cur);
      }
      path.reverse();
      return path;
    },
    // Closest point on any segment to (x,z).
    nearestOnRoad(x, z) {
      let best = null;
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        const dx = s.bx - s.ax;
        const dz = s.bz - s.az;
        const len2 = dx * dx + dz * dz;
        let t = len2 === 0 ? 0 : ((x - s.ax) * dx + (z - s.az) * dz) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = s.ax + dx * t;
        const pz = s.az + dz * t;
        const dist = Math.hypot(x - px, z - pz);
        if (!best || dist < best.dist) best = { x: px, z: pz, dist, segment: i };
      }
      return best;
    },
    isOnRoad(x, z) {
      const near = this.nearestOnRoad(x, z);
      if (!near) return false;
      return near.dist <= segments[near.segment].width / 2 + 0.5;
    },
  };
  return graph;
}
