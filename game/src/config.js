// Neon Vice — shared constants for the game. (Was the v1 scaffold: a minimal
// playable skeleton on flat ground. The city is built now — street grid,
// buildings, beach/water, shops, missions, vehicles, weather and traffic all
// run on top of these values; the map stays small on purpose, Ayub's brief:
// "map kecil, yang penting smooth dan tanpa bug": 1200 x 900 m.)

export const CONFIG = {
  title: 'Neon Vice',
  city: 'Vice Harbor',
  heroName: 'Vera Cruz',

  // World: flat ground, metres. The player is clamped inside these bounds.
  world: {
    width: 1200,
    depth: 900,
    // Plaza disc at the spawn so the player can see movement at a glance.
    plazaRadius: 26,
  },

  spawn: { x: 0, z: 0, heading: 0 },

  player: {
    walkSpeed: 6, // m/s — brisk on foot, faster than Neon Bay v5's 1.5
    runSpeed: 11, // m/s while Shift / RUN is held
    turnSpeed: 2.6, // rad/s (A/D or stick X)
    radius: 0.6,
  },

  camera: {
    distance: 9, // metres behind the hero
    height: 4.5, // metres above the hero
    lookHeight: 1.6, // metres above ground the camera looks at
    fov: 60,
    near: 0.1,
    far: 2500,
  },

  colors: {
    sky: 0x8ec9ee, // daytime sky blue
    fog: 0x9fc6e2, // haze toward the horizon
    ground: 0x3a3f46, // dark asphalt-grey ground
    gridLine: 0x565d68, // subtle grid every 30 m, for motion reference
    plaza: 0x8a8f98, // lighter concrete disc at the spawn
    pylon: 0x22d3ee, // neon-cyan corner markers
    heroBody: 0x14b8a6, // teal jacket
    heroHead: 0xe8b88a, // skin tone
    heroHair: 0x1f2937, // dark hair
  },
  // --- Builder C (gameplay) additions — new keys only, scaffold keys untouched ---
  money: { start: 250, debt: 50000 },

  weapons: {
    pistol: { name: 'Pistol', damage: 34, magSize: 12, reserveMax: 120, range: 60, fireInterval: 0.28, reloadTime: 1.1, price: 0, ammoPrice: 100 },
    smg: { name: 'SMG', damage: 16, magSize: 30, reserveMax: 240, range: 55, fireInterval: 0.09, reloadTime: 1.4, price: 1500, ammoPrice: 150 },
  },

  // Named places the game reads everywhere (missions, shops, map, vehicle
  // spawns): the live place table, not a fallback — world.destinations is
  // built from the same coordinates.
  // Coordinates are inside the 1200x900 field (x -600..600, z -450..450).
  places: {
    plaza: { x: 0, z: 0, name: 'Plaza' },
    ricosBar: { x: 150, z: 100, name: "Rico's Bar" },
    northMarket: { x: -300, z: -300, name: 'North Market' },
    westDocks: { x: -500, z: 200, name: 'West Docks' },
    eastMarina: { x: 440, z: 150, name: 'East Marina' },
    marinaDock: { x: 465, z: 150, name: 'Marina Dock' },
    southBeach: { x: 100, z: 400, name: 'South Beach' },
    uptown: { x: -400, z: -350, name: 'Uptown' },
    downtown: { x: 300, z: -300, name: 'Downtown' },
    airport: { x: -100, z: -400, name: 'Airport' },
    warehouse: { x: -450, z: -100, name: 'Warehouse' },
    impound: { x: 350, z: 250, name: 'Police Impound' },
    yacht: { x: 440, z: 0, name: 'Yacht Dock' },
    gunShop: { x: -200, z: -200, name: 'Gun Shop' },
    clothShop: { x: 200, z: -100, name: 'Clothing' },
    bank: { x: 300, z: -280, name: 'Vice Bank' },
    safehouse: { x: -400, z: -330, name: 'Safehouse' },
  },

  // East-edge water strip where the boat lives (matches Builder B's
  // WATER_X0 = 470: water starts at x 470, beach sand 420..470).
  water: { x0: 470, x1: 600, z0: -450, z1: 450 },

  weather: {
    startHour: 21, // night by default — Vice Harbor is a night city
    dayLengthSec: 600, // one full game day = 10 min of game time
    rainChance: 0.25, // chance a light shower starts each game hour
  },

  wanted: { max: 3, decaySeconds: 25 },
};
