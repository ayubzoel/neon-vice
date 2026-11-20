// Neon Vice — scaffold v1: shared constants for the minimal playable skeleton.
// Small map on purpose (Ayub's brief: "map kecil, yang penting smooth dan
// tanpa bug"): 1200 x 900 m of flat ground, one placeholder hero, no city yet.
// Builder B/C owns the city, missions, vehicles and gameplay on top of this.

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
};
