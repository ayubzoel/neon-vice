// Neon Vice — Builder C: weather + game clock.
// The game clock runs on fixed-timestep game time (main.js advances it by
// 1/60 s per substep). One full day = CONFIG.weather.dayLengthSec of game
// time. Day/night drives sky colour, fog, sun/moon light and street lamps
// (emissive materials registered by the world). Rain is a Points particle
// system that falls around the player; while it rains the ground darkens.
// Default: night (21:00) with occasional light showers.

import { CONFIG } from './config.js';

const DAY_SKY = new THREE.Color(0x8ec9ee);
const NIGHT_SKY = new THREE.Color(0x0b1026);
const DUSK_SKY = new THREE.Color(0x2b1e4a);
const DAY_FOG = new THREE.Color(0x9fc6e2);
const NIGHT_FOG = new THREE.Color(0x0d1226);

export function createWeather(scene, opts = {}) {
  let hour = CONFIG.weather.startHour; // 0..24
  let rain = 0; // 0 none, 1 full
  let rainTarget = 0;
  let nextRainCheck = 30; // seconds of game time
  let lamps = [];

  const hemi = scene.children.find((c) => c.isHemisphereLight) || null;
  const sun = scene.children.find((c) => c.isDirectionalLight) || null;

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

  function apply(px, pz) {
    const dl = daylight(hour);
    const dusk = hour >= 17 && hour < 19 ? 1 - Math.abs(hour - 18) : 0;
    const sky = NIGHT_SKY.clone().lerp(DAY_SKY, dl).lerp(DUSK_SKY, dusk * 0.5);
    scene.background = sky;
    if (scene.fog) {
      scene.fog.color.copy(NIGHT_FOG.clone().lerp(DAY_FOG, dl));
      scene.fog.near = 250 + dl * 250;
      scene.fog.far = 1200 + dl * 600;
    }
    if (hemi) hemi.intensity = 0.25 + dl * 0.65;
    if (sun) {
      sun.intensity = 0.15 + dl * 1.0;
      const ang = ((hour - 6) / 12) * Math.PI;
      sun.position.set(Math.cos(ang) * 200, Math.max(30, Math.sin(ang) * 220), 60);
      sun.color.setHex(dl > 0.4 ? 0xfff2d9 : 0x8fa8ff);
    }
    const lampOn = dl < 0.35;
    for (const lamp of lamps) {
      if (lamp.material && lamp.material.emissive) {
        lamp.material.emissiveIntensity = lampOn ? 1.2 : 0.05;
      }
    }
    rainPoints.visible = rain > 0.02;
    rainMat.opacity = 0.55 * rain;
    rainPoints.position.set(px, 0, pz);
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
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    },
    isNight() { return daylight(hour) < 0.35; },
    registerLamps(meshes) { lamps = meshes || []; },
    setRain(on) { rainTarget = on ? 1 : 0; },
    setHour(h) { hour = ((h % 24) + 24) % 24; apply(0, 0); },
    update(dt, px, pz) {
      hour = (hour + (dt / CONFIG.weather.dayLengthSec) * 24) % 24;
      nextRainCheck -= dt;
      if (nextRainCheck <= 0) {
        nextRainCheck = 45 + Math.random() * 60;
        // Light showers only at night by default; rain is random otherwise.
        if (Math.random() < CONFIG.weather.rainChance) rainTarget = 1;
        else if (rainTarget > 0 && Math.random() < 0.6) rainTarget = 0;
      }
      rain += (rainTarget - rain) * Math.min(1, dt * 0.5);
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
