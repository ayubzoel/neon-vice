// Neon Vice — sky, clock and rain.
//
// Game time advances in fixed 1/60 s substeps from main.js. A full day
// costs CONFIG.weather.dayLengthSec of game time. The time of day steers
// sky colour, fog, sun and moon light and the street lamps, whose glow
// materials the world registers here. Rain is a Points cloud that falls
// around the player; while it rains the ground darkens. The game opens
// at 07:00 in the morning, so the first mission plays out in daylight
// and all four phases appear within the first minutes.
//
// The day is four phases — Pagi / Siang / Sore / Malam — keyed as stops
// across the 24 h clock. Each stop holds sky, fog, hemisphere and sun
// strength and colour, ambient lift, lamp and window glow, star and moon
// opacity; apply() blends between the two stops around the current hour,
// so light drifts smoothly instead of jumping between day and night.
// The sun climbs from low in the east at 06:00 to overhead at noon and
// down low in the west by 18:00; outside that window the same light is
// parked at the moon's place and reads as moonlight. Showers may begin
// in any phase.

import { CONFIG as CFG } from "./config.js";

// One stop per key hour: [h, sky, fog, hemi, sun, sunC, amb, lamp, win, stars, moon].
// lamp/win run 0..1 (1 = fully lit night city); stars/moon are opacities.
// Fog distances are derived from lamp (dayness = 1 - lamp) inside apply().
const STOP_ROWS = [
  [0, 0x0B1026, 0x0D1226, 0.25, 0.35, 0x8FA8FF, 0.55, 1.0, 1.0, 0.85, 1.0],
  [5, 0x0B1026, 0x0D1226, 0.25, 0.35, 0x8FA8FF, 0.55, 1.0, 1.0, 0.85, 1.0],
  [6, 0x8A6F8E, 0x7D6F88, 0.4, 0.55, 0xFFB37A, 0.5, 0.7, 0.7, 0.3, 0.7],
  [7, 0xA9C9E8, 0xA9C2D6, 0.75, 0.95, 0xFFE0AE, 0.45, 0.25, 0.15, 0.0, 0.15],
  [9, 0x8EC9EE, 0x9FC6E2, 0.9, 1.15, 0xFFF2D9, 0.4, 0.05, 0.05, 0.0, 0.0],
  [12, 0x6FB3EC, 0xA8D0EA, 1.0, 1.3, 0xFFFFFF, 0.35, 0.0, 0.03, 0.0, 0.0],
  [15, 0x7FB8E8, 0x9CC0DC, 0.95, 1.2, 0xFFF0C8, 0.38, 0.0, 0.04, 0.0, 0.0],
  [17, 0xE8A35C, 0xD89A6A, 0.7, 0.9, 0xFF9A3D, 0.45, 0.35, 0.35, 0.0, 0.1],
  [18, 0x7A4A6A, 0x6A4A5E, 0.45, 0.4, 0xFF7A4D, 0.5, 0.8, 0.8, 0.25, 0.5],
  [19, 0x0B1026, 0x0D1226, 0.25, 0.35, 0x8FA8FF, 0.55, 1.0, 1.0, 0.85, 1.0],
  [24, 0x0B1026, 0x0D1226, 0.25, 0.35, 0x8FA8FF, 0.55, 1.0, 1.0, 0.85, 1.0],
];
const STOPS = STOP_ROWS.map(([h, sky, fog, hemi, sun, sunC, amb, lamp, win, stars, moon]) => ({
  h, sky, fog, hemi, sun, sunC, amb, lamp, win, stars, moon,
  skyC: new THREE.Color(sky),
  fogC: new THREE.Color(fog),
  sunCC: new THREE.Color(sunC),
}));

const LAMP_DAY = new THREE.Color(0x6B6257); // lamp head by day, unlit grey
const LAMP_NIGHT = new THREE.Color(0xFFD9A0); // lamp head by night, warm lit

const PHASES = [[5, "Pagi"], [10, "Siang"], [16, "Sore"], [19, "Malam"]];
const NUM_KEYS = ["hemi", "sun", "amb", "lamp", "win", "stars", "moon"];

function createWeather(scene, opts = {}) {
  let hour = CFG.weather.startHour, rain = 0, rainTarget = 0;
  let nextRainCheck = 30; // game-time seconds until the next shower roll
  let lamps = [], windowMats = [];
  // Phase-driven materials the world hands over (see registerWorld):
  // window entries [{mat, base}], the lamp-head material, moon/glow/star
  // meshes. Everything is optional — the sky and light cycle run fine
  // without any of them registered.
  let lampHeadMat = null, skyMoon = null, skyGlow = null, skyStars = null;

  const pick = (test) => scene.children.find(test) || null;
  const hemi = pick((c) => c.isHemisphereLight);
  const sun = pick((c) => c.isDirectionalLight);
  const ambient = pick((c) => c.isAmbientLight);

  // Drop counts follow graphics quality: low quality simulates and draws
  // only ~300 of the 900 drops, sparing a per-frame buffer rewrite where
  // FPS is scarcest. The caller may pass quality in; otherwise the same
  // software-renderer probe main.js uses for its default decides it
  // (SwiftShader/llvmpipe => 'low').
  function softwareRenderer() {
    let soft = false;
    try {
      const probe = document.createElement("canvas").getContext("webgl");
      const ext = probe && probe.getExtension("WEBGL_debug_renderer_info");
      const name = ext ? probe.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "";
      if (probe) probe.getExtension("WEBGL_lose_context")?.loseContext();
      soft = String(name).match(/swiftshader|llvmpipe|software|basic render/i) !== null;
    } catch (ignored) {
      soft = false;
    }
    return soft;
  }
  const quality = opts.quality ?? (softwareRenderer() ? "low" : "high");
  // 900 rain points in a 60x30x60 box around the player (300 on low).
  const RAIN_COUNT = quality === "low" ? 300 : 900;
  const rainGeo = new THREE.BufferGeometry(); // positions rewritten per frame
  const rainPos = new Float32Array(3 * RAIN_COUNT);
  for (let i = RAIN_COUNT - 1; i >= 0; i--) {
    rainPos[3 * i] = Math.random() * 60 - 30;
    rainPos[3 * i + 1] = Math.random() * 30;
    rainPos[3 * i + 2] = Math.random() * 60 - 30;
  }
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.PointsMaterial({ color: 0x9DB8D6, size: 0.14, transparent: true, opacity: 0.55, depthWrite: false });
  const rainPoints = new THREE.Points(rainGeo, rainMat); // one draw call
  Object.assign(rainPoints, { visible: false, frustumCulled: false });
  scene.add(rainPoints); // the cloud follows the player in apply()

  function dayFactor(h) {
    // Darkness 0, noon 1, eased with a cosine across 06:00-18:00.
    const t = (h - 6) / 12; // maps 06:00 -> 0, 18:00 -> 1
    return t <= 0 || t >= 1 ? 0 : Math.sin(t * Math.PI);
  }

  // Blended phase values at hour h, between the two surrounding stops.
  const _sky = new THREE.Color(), _fog = new THREE.Color(), _sunC = new THREE.Color();
  function blendAt(h) {
    let idx = 0;
    while (idx < STOPS.length - 2 && h > STOPS[idx + 1].h) idx++;
    const a = STOPS[idx];
    const b = STOPS[idx + 1];
    const span = b.h - a.h || 0.0001;
    const raw = (h - a.h) / span;
    const clamped = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    const lerp = (x, y) => x + (y - x) * clamped;
    const nums = {};
    for (const key of NUM_KEYS) nums[key] = lerp(a[key], b[key]);
    return {
      sky: _sky.copy(a.skyC).lerp(b.skyC, clamped),
      fog: _fog.copy(a.fogC).lerp(b.fogC, clamped),
      sunC: _sunC.copy(a.sunCC).lerp(b.sunCC, clamped),
      ...nums,
    };
  }

  function fade(mesh, value) {
    if (mesh && mesh.material) mesh.material.opacity = value;
  }

  function apply(px, pz) { // push the blended phase into the scene
    const p = blendAt(hour);
    scene.background = p.sky; // sky follows the phase
    if (scene.fog) { // haze colour + range
      scene.fog.color.copy(p.fog); // haze tint
      scene.fog.near = 200 + (1 - p.lamp) * 300;
      scene.fog.far = 1100 + (1 - p.lamp) * 700;
    }
    if (hemi) {
      hemi.intensity = p.hemi;
    }
    if (ambient) {
      ambient.intensity = p.amb;
    }
    if (sun) { // directional sun/moon light
      sun.intensity = p.sun; // phase strength
      sun.color.copy(p.sunC); // phase tint
      if (hour >= 6 && hour <= 18) { // daytime arc
        // Sunrise low east, noon overhead, sunset low west.
        const ang = (hour - 6) * Math.PI / 12;
        const sx = Math.cos(ang) * 260;
        const sy = Math.max(25, Math.sin(ang) * 280);
        sun.position.set(sx, sy, 80);
      } else {
        // Moon spot: the same light reads as moonlight after dark.
        sun.position.set(-160, 300, -140); // parked moon position
      }
    }
    // Street lamps: emissive-registered lamps (old API) plus the instanced
    // lamp-head material — bright warm after dark, dim grey by day.
    lamps.forEach((lamp) => {
      if (lamp.material?.emissive) {
        const mat = lamp.material;
        mat.emissiveIntensity = 0.05 + p.lamp * 1.15;
      }
    });
    if (lampHeadMat) {
      lampHeadMat.color.copy(LAMP_DAY).lerp(LAMP_NIGHT, p.lamp);
    }
    // Windows glow at night and stay near-dark by day, since daylight
    // does the lighting work for the facades.
    windowMats.forEach((entry) => {
      entry.mat.emissiveIntensity = entry.base * (0.03 + 0.97 * p.win);
    });
    // Moon and stars wash out in daylight; the glow hugs the moon.
    fade(skyMoon, p.moon);
    fade(skyGlow, 0.14 * p.moon);
    fade(skyStars, 0.85 * p.stars);
    Object.assign(rainPoints, { visible: rain > 0.02 });
    rainMat.opacity = rain * 0.55;
    rainPoints.position.set(px, 0, pz); // cloud centred on the player
  }

  function phaseName(h = hour) { // Pagi / Siang / Sore / Malam
    let name = "Malam";
    for (const [bound, label] of PHASES) {
      if (h >= bound) name = label;
    }
    return name;
  }

  function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  return {
    get hour() { return hour; }, get raining() { return rain > 0.3; },
    get rainAmount() { return rain; }, get quality() { return quality; },
    get rainCount() { return RAIN_COUNT; }, // drops simulated per frame
    clockText() { // "07:00 · Pagi"
      const h = Math.floor(hour % 24);
      const m = Math.floor(hour * 60) % 60;
      return `${pad2(h)}:${pad2(m)} · ${phaseName()}`;
    },
    phaseName() {
      return phaseName();
    },
    isNight() {
      return dayFactor(hour) < 0.35;
    },
    registerLamps(meshes) {
      lamps = meshes || [];
    },
    // World hookup: windowMats is [{mat, base}], lampHeadMat the
    // instanced lamp-head material, skyMeshes {moon, glow, stars}.
    // Moon/glow materials turn transparent here so their opacity can
    // fade along with the phase.
    registerWorld(world) { // world hands over its glow materials
      if (!world) {
        return;
      }
      const { windowMats: wm = [], lampHeadMat: lhm = null, skyMeshes: sm = {} } = world;
      windowMats = wm;
      lampHeadMat = lhm;
      skyMoon = sm.moon ?? null;
      skyGlow = sm.glow ?? null;
      skyStars = sm.stars ?? null;
      for (const m of [skyMoon, skyGlow]) { // make them fadeable
        if (m?.material) m.material.transparent = true;
      }
      apply(0, 0); // refresh now
    },
    setRain(on) {
      rainTarget = on ? 1 : 0;
    },
    setHour(h) {
      hour = ((h % 24) + 24) % 24;
      apply(0, 0); // refresh now
    },
    update(dt, px, pz) { // advance clock, rain, drops
      hour = (hour + (dt * 24) / CFG.weather.dayLengthSec) % 24;
      nextRainCheck = nextRainCheck - dt;
      if (nextRainCheck <= 0) { // time to roll for a shower
        nextRainCheck = Math.random() * 60 + 45;
        // Showers are light and may begin in any phase; otherwise random.
        if (Math.random() < CFG.weather.rainChance) rainTarget = 1;
        else if (rainTarget > 0 && Math.random() < 0.6) {
          rainTarget = 0;
        }
      }
      // Fade rate 1.0/s of game time: drops are visibly falling ~0.35 s
      // after the toggle, even at ~2 FPS under SwiftShader, where the
      // old 0.5 rate needed ~2.6 s real to cross the raining threshold.
      rain = rain + (rainTarget - rain) * Math.min(1, dt);
      if (rain > 0.02) { // drops only fall while it rains
        const pos = rainGeo.attributes.position.array; // live drop heights
        let i = 0; // drop index
        while (i < RAIN_COUNT) {
          pos[3 * i + 1] = pos[3 * i + 1] - 28 * dt;
          if (pos[3 * i + 1] < 0) pos[3 * i + 1] = 30;
          i++;
        }
        rainGeo.attributes.position.needsUpdate = true; // push to GPU
      }
      apply(px, pz); // repaint the sky for the new hour
    },
  };
}

export { createWeather };
