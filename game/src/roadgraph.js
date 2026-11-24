// Neon Vice — road graph. Pure logic, no THREE dependency: a connected
// grid of streets over Vice Harbor, with BFS pathfinding and nearest-road
// queries feeding gameplay and the GPS.

// One 20 s signal cycle, the single source of truth for both the visual
// heads in world.js and the traffic drivers in vehicles.js / ambient.js:
// north-south green 0-8 s, yellow 8-10 s, east-west green 10-18 s,
// yellow 18-20 s.
function trafficLightState(axis, nowMs = Date.now()) {
  const cycle = 20;
  const t = ((nowMs / 1000) % cycle + cycle) % cycle;
  if (axis === "NS") {
    if (t < 8) return "green";
    if (t < 10) return "yellow";
    return "red";
  }
  if (t >= 18) return "yellow";
  if (t >= 10) return "green";
  return "red";
}

// xs holds the vertical streets (fixed x), zs the horizontal ones
// (fixed z); vWidths[i] / hWidths[j] give the full width of street i / j.
function buildRoadGraph(xs, zs, vWidths, hWidths) {
  const nCols = xs.length;
  const nRows = zs.length;
  const nodes = zs.flatMap((z, r) =>
    xs.map((x, c) => ({ id: r * nCols + c, x, z, col: c, row: r })),
  );
  const segments = []; // every street piece, in build order
  const adjacency = Array.from(nodes, () => []);

  function link(from, to, width, arterial, kind) {
    const start = nodes[from];
    const end = nodes[to];
    segments.push({
      a: from,
      b: to,
      ax: start.x,
      az: start.z,
      bx: end.x,
      bz: end.z,
      length: Math.hypot(end.x - start.x, end.z - start.z),
      width,
      arterial,
      kind,
    });
    const idx = segments.length - 1;
    adjacency[from].push({ to, seg: idx });
    adjacency[to].push({ to: from, seg: idx });
  }

  // Horizontal pieces: along each z-row, between adjacent vertical streets.
  for (let row = 0; row < nRows; row++) {
    for (let col = 0; col + 1 < nCols; col++) {
      const id = (c, r) => r * nCols + c;
      link(id(col, row), id(col + 1, row), hWidths[row], hWidths[row] >= 12, "horizontal");
    }
  }
  // Vertical pieces: along each x-column, between adjacent horizontal streets.
  for (let col = 0; col < nCols; col++) {
    for (let row = 0; row + 1 < nRows; row++) {
      const id = (c, r) => r * nCols + c;
      link(id(col, row), id(col, row + 1), vWidths[col], vWidths[col] >= 12, "vertical");
    }
  }

  // Which nodes sit at a signalised crossing is fixed at build time,
  // so work it out once here instead of re-scanning edges per query.
  const touchH = new Set();
  const touchV = new Set();
  for (let k = 0; k < segments.length; k++) {
    const s = segments[k];
    if (!s.arterial) continue;
    const bucket = s.kind === "horizontal" ? touchH : touchV;
    bucket.add(s.a);
    bucket.add(s.b);
  }
  const arterialIds = new Set([...touchH].filter((id) => touchV.has(id)));

  function closestNode(x, z) {
    return nodes.reduce((best, n) => {
      const d = Math.hypot(x - n.x, z - n.z);
      return d < best.d ? { node: n, d } : best;
    }, { node: null, d: Infinity }).node;
  }

  // BFS answers are memoised per start node: the graph never changes,
  // and the GPS, driving AI and pedestrians ask for paths from the same
  // few nodes every frame — re-running the search each time is waste.
  // Memoised `prev` maps are read-only for findPath/bfsFrom callers.
  const bfsMemo = new Map();
  function runBfs(startId) {
    const hit = bfsMemo.get(startId);
    if (hit) return hit;
    const prev = new Map();
    prev.set(startId, -1);
    const queue = Array.of(startId);
    let cursor = 0;
    while (cursor < queue.length) {
      const cur = queue[cursor++];
      for (const edge of adjacency[cur]) {
        if (prev.has(edge.to)) continue;
        prev.set(edge.to, cur);
        queue.push(edge.to);
      }
    }
    bfsMemo.set(startId, prev);
    return bfsMemo.get(startId);
  }

  function resolveId(p) {
    return typeof p === "number" ? p : closestNode(p.x, p.z).id;
  }

  function closestOnRoad(x, z) {
    return segments.reduce((best, s, i) => {
      const ex = s.bx - s.ax;
      const ez = s.bz - s.az;
      const len2 = ex * ex + ez * ez;
      let t = len2 === 0 ? 0 : ((x - s.ax) * ex + (z - s.az) * ez) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = s.ax + ex * t;
      const pz = s.az + ez * t;
      const dist = Math.hypot(px - x, pz - z);
      return !best || dist < best.dist ? { x: px, z: pz, dist, segment: i } : best;
    }, null);
  }

  const graph = { // the road network handle handed back to the game
    nodes,
    segments, adjacency, // pieces + per-node edge lists
    nearestNode: closestNode,
    // Signalised crossing: an arterial street crosses an arterial street
    // (both at least 12 m wide). Only these nodes carry traffic lights,
    // and world.js plants its poles exactly on them.
    isArterialNode: (nodeId) => arterialIds.has(nodeId),
    // Closest signalised node to (x, z) within maxD metres, else null.
    arterialNodeNear: (x, z, maxD = 3) =>
      nodes.reduce(
        (best, n) => {
          if (!arterialIds.has(n.id)) return best;
          const d2 = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
          return d2 < best.d ? { node: n, d: d2 } : best;
        },
        { node: null, d: maxD * maxD },
      ).node,
    // Signal state for one travel axis: 'NS' runs along a vertical
    // street, 'EW' along a horizontal one. Same 20 s cycle as the heads.
    trafficLight: (axis) => trafficLightState(axis),
    // Reachable node ids from a start node, via the memoised BFS.
    bfsFrom: (startId) => new Set([...runBfs(startId).keys()]),
    countDeadEnds: () =>
      adjacency.reduce((n, edges) => n + (edges.length < 2 ? 1 : 0), 0),
    // a, b take {x,z} points or node ids; returns [{x,z}, ...] or null.
    findPath: (a, b) => {
      const start = resolveId(a);
      const goal = resolveId(b);
      const single = [{ x: nodes[start].x, z: nodes[start].z }];
      if (start === goal) return single;
      const prev = runBfs(start);
      if (prev.has(goal) === false) return null;
      const path = new Array();
      for (let cur = goal; cur !== -1; cur = prev.get(cur)) {
        path.unshift({ x: nodes[cur].x, z: nodes[cur].z });
      }
      return [...path];
    },
    // Nearest point on any street piece to (x, z).
    nearestOnRoad: closestOnRoad,
    isOnRoad: (x, z) => {
      const near = closestOnRoad(x, z);
      return !!near && near.dist <= segments[near.segment].width / 2 + 0.5;
    },
  };
  return graph; // done — the caller keeps this handle for the session
}

export { trafficLightState, buildRoadGraph };
