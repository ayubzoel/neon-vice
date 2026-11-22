// Neon Vice — city data (Builder B): street grid, zones, reserved plots for
// worship / vital buildings, palettes. Pure data + a seeded RNG so the city
// is identical on every load.

// Street grid (metres, centred on 0,0). Vertical streets at these x values,
// horizontal streets at these z values. East edge x>420 is beach, x>470 water.
export const XS = [-540, -420, -300, -180, -60, 60, 180, 300, 360, 400];
export const ZS = [-360, -240, -120, 0, 120, 240, 360];
// Road widths: arterials 12 m, ring/residential 8-10 m.
export const V_WIDTHS = [10, 12, 8, 12, 8, 12, 8, 12, 10, 8];
export const H_WIDTHS = [10, 12, 8, 12, 8, 12, 10];

export const WATER_X0 = 470; // water starts here (east strip)
export const SAND_X0 = 420; // beach sand starts here
export const QUAY_X0 = 360; // concrete quay starts here
export const DOWNTOWN_BOUNDARY_X = -80; // x < this is downtown (see zoneOf)

// Zones by cell centre (cx, cz).
export function zoneOf(cx, cz) {
  if (cx >= QUAY_X0) return 'quay';
  if (cx < DOWNTOWN_BOUNDARY_X) return 'downtown';
  if (cz < 0) return 'harbor';
  return 'beach';
}

// Reserved plots: worship + vital buildings, 2 of each per area
// (downtown / harbor / beach). Centres sit inside block interiors, never on
// a road. Footprints are kept clear of random buildings by world.js.
export const RESERVED = [
  // Downtown (x < DOWNTOWN_BOUNDARY_X)
  { id: 'worship-1', kind: 'worship', name: 'Gereja St. Maria', area: 'downtown', x: -480, z: -300, w: 22, d: 18, h: 16 },
  { id: 'worship-2', kind: 'worship', name: 'Masjid Al-Nur', area: 'downtown', x: -120, z: 300, w: 24, d: 20, h: 15 },
  { id: 'vital-1', kind: 'vital-hospital', name: 'RS Umum Vice', area: 'downtown', x: -480, z: 300, w: 30, d: 22, h: 18 },
  { id: 'vital-2', kind: 'vital-police', name: 'Polsek Downtown', area: 'downtown', x: -240, z: -60, w: 24, d: 18, h: 12 },
  // Harbor (x in [DOWNTOWN_BOUNDARY_X, 360), z < 0)
  { id: 'worship-3', kind: 'worship', name: 'Kuil Dewi Harbor', area: 'harbor', x: 120, z: -300, w: 20, d: 16, h: 14 },
  { id: 'worship-4', kind: 'worship', name: 'Gereja Pelabuhan', area: 'harbor', x: 240, z: -60, w: 20, d: 16, h: 14 },
  { id: 'vital-3', kind: 'vital-hospital', name: 'RS Harbor', area: 'harbor', x: 120, z: -180, w: 28, d: 20, h: 16 },
  { id: 'vital-4', kind: 'vital-police', name: 'Polsek Pelabuhan', area: 'harbor', x: 240, z: -300, w: 24, d: 18, h: 12 },
  // Beach (x in [DOWNTOWN_BOUNDARY_X, 460), z >= 0)
  { id: 'worship-5', kind: 'worship', name: 'Masjid Pantai', area: 'beach', x: 120, z: 300, w: 22, d: 18, h: 15 },
  { id: 'worship-6', kind: 'worship', name: 'Vihara Lotus', area: 'beach', x: 240, z: 180, w: 20, d: 16, h: 13 },
  { id: 'vital-5', kind: 'vital-hospital', name: 'RS Pantai', area: 'beach', x: 120, z: 60, w: 28, d: 20, h: 16 },
  { id: 'vital-6', kind: 'vital-police', name: 'Polsek Beach', area: 'beach', x: 0, z: 300, w: 24, d: 18, h: 12 },
];

// ---- Flyovers (Builder B v4, v6: 4 lajur 2 arah) -----------------------
// Two elevated decks over the z=0 arterial, both carrying the NS arterial
// road over the EW artery so through traffic can skip the red light:
//   A: (60, 0) — the central artery past the spawn plaza (plaza loop
//      traffic + the mission/GPS spine to South Beach / Impound).
//   B: (300, 0) — the downtown artery on the mission/GPS spine to the
//      Bank / Downtown / Yacht Dock.
// v6 redesign (Ayub): the road through each flyover is 4 LANES, 2
// DIRECTIONS (2 lanes per direction, 3 m each, on the existing 12 m
// road). Per direction the LEFTMOST lane is the ordinary surface road
// for left/right turns at the intersection, and the other lane is the
// flyover (straight over the intersection only). Left-hand traffic, so
// for the southbound (+z) direction the lanes sit on the +x side and
// for northbound (-z) on the -x side:
//   southbound flyover lane centre x = f.x + 1.5, turn lane x = f.x + 4.5
//   northbound flyover lane centre x = f.x - 1.5, turn lane x = f.x - 4.5
// Geometry (per flyover, axis NS): deck 6 m wide (x ±3, the two flyover
// lanes only), flat 6 m high over z ±10 (the whole intersection box),
// ramps 50 m each side rising 0 -> 6 m (12% grade). The ground road
// under the deck stays at y=0 for EW through-traffic and for the turn
// lanes; the surface lanes run OUTSIDE the deck footprint, so a turning
// car never meets the ramp at all. The deck-edge barriers stay solid and
// height-gated (world.js), so a car on the deck cannot leave it.
export const FLYOVERS = [
  { x: 60, z: 0, axis: 'NS' },
  { x: 300, z: 0, axis: 'NS' },
];
export const FLYOVER = {
  deckH: 6, rampLen: 50, deckHalf: 10, width: 6,
  laneW: 3, // one lane = 3 m; road is 12 m = 4 lanes
  flyLaneX: 1.5, // flyover-lane centre offset from the road centreline
  turnLaneX: 4.5, // surface turn-lane centre offset from the centreline
};

// Park cell (oaks + benches, no buildings) and plaza cell (spawn area).
export const PARK_CELL = { col: 2, row: 4 }; // x[-300,-180], z[120,240]
export const PLAZA_CELL = { col: 4, row: 3 }; // x[-60,60], z[0,120]

export const NEON_COLORS = [0xff5da2, 0x22d3ee, 0xffb020, 0x34d399, 0xa78bfa, 0xff7a59];

// Deterministic RNG (mulberry32) — same city every load.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}
