// Neon Vice — Builder C: weather + game clock.
// The game clock runs on fixed-timestep game time (main.js advances it by
// 1/60 s per substep). One full day = CONFIG.weather.dayLengthSec of game
// time. Day/night drives sky colour, fog, sun/moon light and street lamps
// (emissive materials registered by the world). Rain is a Points particle
// system that falls around the player; while it rains the ground darkens.
// Default: morning (07:00) — the first mission starts in daylight so the
// four phases are visible within the first minutes of play.
//
// v4: full four-phase cycle — Pagi / Siang / Sore / Malam — as keyframed
// stops over the 24 h clock. Every stop carries sky, fog, hemisphere and
// sun intensity + colour, ambient lift, lamp glow, window glow, star and
// moon opacity; apply() lerps between the bracketing stops, so the light
// changes continuously as the clock runs instead of snapping day/night.
// The sun tracks east (low, morning) -> overhead (noon) -> west (low,
// evening); outside 06:00-18:00 the same directional light sits at the
// moon position and reads as moonlight. Rain can start in any phase.

import { CONFIG } from './config.js';

// One stop per key hour. lamp/win are 0..1 glow factors (1 = fully lit
// night city); stars/moon are opacities. Fog near/far derive from lamp
// (dayness = 1 - lamp) in apply().
const STOPS = [
  // h,    sky,       fog,       hemi, sun,  sun colour, amb,  lamp, win,  stars, moon
  { h: 0,  sky: 0x0b1026, fog: 0x0d1226, hemi: 0.25, sun: 0.35, sunC: 0x8fa8ff, amb: 0.55, lamp: 1.00, win: 1.00, stars: 0.85, moon: 1.00 },
  { h: 5,  sky: 0x0b1026, fog: 0x0d1226, hemi: 0.25, sun: 0.35, sunC: 0x8fa8ff, amb: 0.55, lamp: 1.00, win: 1.00, stars: 0.85, moon: 1.00 },
  { h: 6,  sky: 0x8a6f8e, fog: 0x7d6f88, hemi: 0.40, sun: 0.55, sunC: 0xffb37a, amb: 0.50, lamp: 0.70, win: 0.70, stars: 0.30, moon: 0.70 },
  { h: 7,  sky: 0xa9c9e8, fog: 0xa9c2d6, hemi: 0.75, sun: 0.95, sunC: 0xffe0ae, amb: 0.45, lamp: 0.25, win: 0.15, stars: 0.00, moon: 0.15 },
  { h: 9,  sky: 0x8ec9ee, fog: 0x9fc6e2, hemi: 0.90, sun: 1.15, sunC: 0xfff2d9, amb: 0.40, lamp: 0.05, win: 0.05, stars: 0.00, moon: 0.00 },
  { h: 12, sky: 0x6fb3ec, fog: 0xa8d0ea, hemi: 1.00, sun: 1.30, sunC: 0xffffff, amb: 0.35, lamp: 0.00, win: 0.03, stars: 0.00, moon: 0.00 },
  { h: 15, sky: 0x7fb8e8, fog: 0x9cc0dc, hemi: 0.95, sun: 1.20, sunC: 0xfff0c8, amb: 0.38, lamp: 0.00, win: 0.04, stars: 0.00, moon: 0.00 },
  { h: 17, sky: 0xe8a35c, fog: 0xd89a6a, hemi: 0.70, sun: 0.90, sunC: 0xff9a3d, amb: 0.45, lamp: 0.35, win: 0.35, stars: 0.00, moon: 0.10 },
  { h: 18, sky: 0x7a4a6a, fog: 0x6a4a5e, hemi: 0.45, sun: 0.40, sunC: 0xff7a4d, amb: 0.50, lamp: 0.80, win: 0.80, stars: 0.25, moon: 0.50 },
  { h: 19, sky: 0x0b1026, fog: 0x0d1226, hemi: 0.25, sun: 0.35, sunC: 0x8fa8ff, amb: 0.55, lamp: 1.00, win: 1.00, stars: 0.85, moon: 1.00 },
  { h: 24, sky: 0x0b1026, fog: 0x0d1226, hemi: 0.25, sun: 0.35, sunC: 0x8fa8ff, amb: 0.55, lamp: 1.00, win: 1.00, stars: 0.85, moon: 1.00 },
];
for (const s of STOPS) {
  s.skyC = new THREE.Color(s.sky);
  s.fogC = new THREE.Color(s.fog);
  s.sunCC = new THREE.Color(s.sunC);
}

const LAMP_DAY = new THREE.Color(0x6b6257); // unlit lamp head, daytime
const LAMP_NIGHT = new THREE.Color(0xffd9a0); // lit lamp head, night

export function createWeather(scene, opts = {}) {
  let hour = CONFIG.weather.startHour; // 0..24
  let rain = 0; // 0 none, 1 full
  let rainTarget = 0;
  let nextRainCheck = 30; // seconds of game time
  let lamps = [];
  // World-registered phase-driven materials (see registerWorld): building
  // window materials [{mat, base}], the lamp-head material, moon/glow/
  // stars meshes. All optional — the sky/light cycle works without them.
  let windowMats = [];
  let lampHeadMat = null;
  let skyMoon = null;
  let skyGlow = null;
  let skyStars = null;

  const hemi = scene.children.find((c) => c.isHemisphereLight) || null;
  const sun = scene.children.find((c) => c.isDirectionalLight) || null;
  const ambient = scene.children.find((c) => c.isAmbientLight) || null;

  // Rain particle count follows graphics quality: on low quality only ~300
  // of the 900 drops are simulated and drawn, which saves a per-frame buffer
  // rewrite where FPS is scarcest. Quality comes from the caller when given;
  // otherwise the same software-renderer probe main.js uses for its default
  // quality decides (SwiftShader/llvmpipe => 'low').
  function isSoftwareGL() {
    try {
      const probe = document.createElement('canvas').getContext('webgl');
      const ext = probe && probe.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? probe.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
      if (probe) probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /swiftshader|llvmpipe|software|basic render/i.test(String(name));
    } catch { return false; }
  }
  const quality = opts.quality ?? (isSoftwareGL() ? 'low' : 'high');
  // Rain particles: 900 points in a 60x30x60 box around the player
  // (300 on low quality).
  const RAIN_COUNT = quality === 'low' ? 300 : 900;
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(RAIN_COUNT * 3);
  for (let i = 0; i < RAIN_COUNT; i += 1) {
    rainPos[i * 3] = (Math.random() - 0.5) * 60;
    rainPos[i * 3 + 1] = Math.random() * 30;
    rainPos[i * 3 + 2] = (Math.random() - 0.5) * 60;
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.PointsMaterial({
    color: 0x9db8d6, size: 0.14, transparent: true, opacity: 0.55, depthWrite: false,
  });
  const rainPoints = new THREE.Points(rainGeo, rainMat);
  rainPoints.visible = false;
  rainPoints.frustumCulled = false;
  scene.add(rainPoints);

  function daylight(h) {
    // 0 at night, 1 at noon; smooth via cosine over 06:00-18:00.
    const t = (h - 6) / 12; // 0 at 06:00, 1 at 18:00
    if (t <= 0 || t >= 1) return 0;
    return Math.sin(t * Math.PI);
  }

  // Interpolated phase values at hour h: lerp between bracketing stops.
  const _sky = new THREE.Color();
  const _fog = new THREE.Color();
  const _sunC = new THREE.Color();
  function phaseAt(h) {
    let a = STOPS[0];
    let b = STOPS[STOPS.length - 1];
    for (let i = 0; i < STOPS.length - 1; i += 1) {
      if (h >= STOPS[i].h && h <= STOPS[i + 1].h) { a = STOPS[i]; b = STOPS[i + 1]; break; }
    }
    const span = Math.max(0.0001, b.h - a.h);
    const t = Math.max(0, Math.min(1, (h - a.h) / span));
    const lerp = (x, y) => x + (y - x) * t;
    return {
      sky: _sky.copy(a.skyC).lerp(b.skyC, t),
      fog: _fog.copy(a.fogC).lerp(b.fogC, t),
      hemi: lerp(a.hemi, b.hemi),
      sun: lerp(a.sun, b.sun),
      sunC: _sunC.copy(a.sunCC).lerp(b.sunCC, t),
      amb: lerp(a.amb, b.amb),
      lamp: lerp(a.lamp, b.lamp),
      win: lerp(a.win, b.win),
      stars: lerp(a.stars, b.stars),
      moon: lerp(a.moon, b.moon),
    };
  }

  function apply(px, pz) {
    const p = phaseAt(hour);
    scene.background = p.sky;
    if (scene.fog) {
      scene.fog.color.copy(p.fog);
      const dayness = 1 - p.lamp;
      scene.fog.near = 200 + dayness * 300;
      scene.fog.far = 1100 + dayness * 700;
    }
    if (hemi) hemi.intensity = p.hemi;
    if (ambient) ambient.intensity = p.amb;
    if (sun) {
      sun.intensity = p.sun;
      sun.color.copy(p.sunC);
      if (hour >= 6 && hour <= 18) {
        // Sun path: low in the east at 06:00, overhead at noon, low in
        // the west at 18:00.
        const ang = ((hour - 6) / 12) * Math.PI;
        sun.position.set(Math.cos(ang) * 260, Math.max(25, Math.sin(ang) * 280), 80);
      } else {
        // Moon position: the same light reads as moonlight at night.
        sun.position.set(-160, 300, -140);
      }
    }
    // Street lamps: emissive-registered lamps (old API) + the instanced
    // lamp-head material (bright warm at night, dim grey by day).
    for (const lamp of lamps) {
      if (lamp.material && lamp.material.emissive) {
        lamp.material.emissiveIntensity = 0.05 + p.lamp * 1.15;
      }
    }
    if (lampHeadMat) lampHeadMat.color.copy(LAMP_DAY).lerp(LAMP_NIGHT, p.lamp);
    // Building windows glow at night, nearly dark by day (facades are lit
    // by the sun instead).
    for (const w of windowMats) w.mat.emissiveIntensity = w.base * (0.03 + 0.97 * p.win);
    // Moon + stars fade out by day; the glow tracks the moon.
    if (skyMoon && skyMoon.material) skyMoon.material.opacity = p.moon;
    if (skyGlow && skyGlow.material) skyGlow.material.opacity = 0.14 * p.moon;
    if (skyStars && skyStars.material) skyStars.material.opacity = 0.85 * p.stars;
    rainPoints.visible = rain > 0.02;
    rainMat.opacity = 0.55 * rain;
    rainPoints.position.set(px, 0, pz);
  }

  function phaseName(h = hour) {
    if (h >= 5 && h < 10) return 'Pagi';
    if (h >= 10 && h < 16) return 'Siang';
    if (h >= 16 && h < 19) return 'Sore';
    return 'Malam';
  }

  return {
    get hour() { return hour; },
    get raining() { return rain > 0.3; },
    get rainAmount() { return rain; },
    get quality() { return quality; },
    get rainCount() { return RAIN_COUNT; },
    clockText() {
      const h = Math.floor(hour) % 24;
      const m = Math.floor((hour % 1) * 60);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} · ${phaseName()}`;
    },
    phaseName() { return phaseName(); },
    isNight() { return daylight(hour) < 0.35; },
    registerLamps(meshes) { lamps = meshes || []; },
    // World hookup for the phase-driven materials: windowMats is
    // [{mat, base}], lampHeadMat the instanced lamp-head material, and
    // skyMeshes {moon, glow, stars}. Moon/glow materials are made
    // transparent here so their opacity can fade with the phase.
    registerWorld(world) {
      if (!world) return;
      windowMats = world.windowMats || [];
      lampHeadMat = world.lampHeadMat || null;
      const sm = world.skyMeshes || {};
      skyMoon = sm.moon || null;
      skyGlow = sm.glow || null;
      skyStars = sm.stars || null;
      for (const m of [skyMoon, skyGlow]) {
        if (m && m.material) m.material.transparent = true;
      }
      apply(0, 0);
    },
    setRain(on) { rainTarget = on ? 1 : 0; },
    setHour(h) { hour = ((h % 24) + 24) % 24; apply(0, 0); },
    update(dt, px, pz) {
      hour = (hour + (dt / CONFIG.weather.dayLengthSec) * 24) % 24;
      nextRainCheck -= dt;
      if (nextRainCheck <= 0) {
        nextRainCheck = 45 + Math.random() * 60;
        // Light showers in any phase; rain is random otherwise.
        if (Math.random() < CONFIG.weather.rainChance) rainTarget = 1;
        else if (rainTarget > 0 && Math.random() < 0.6) rainTarget = 0;
      }
      // Ramp rate 1.0/s of game time: rain is visibly falling ~0.35 s
      // after the toggle. (Was 0.5: at ~2 FPS under SwiftShader the
      // game-time ratio is ~0.27, so the old ramp needed ~2.6 s real to
      // cross the raining threshold and the weather playtest's 2 s
      // window flaked. The fade is still gradual, just no longer
      // borderline at low FPS.)
      rain += (rainTarget - rain) * Math.min(1, dt * 1.0);
      if (rain > 0.02) {
        const pos = rainGeo.attributes.position.array;
        for (let i = 0; i < RAIN_COUNT; i += 1) {
          pos[i * 3 + 1] -= 28 * dt;
          if (pos[i * 3 + 1] < 0) pos[i * 3 + 1] = 30;
        }
        rainGeo.attributes.position.needsUpdate = true;
      }
      apply(px, pz);
    },
  };
}
