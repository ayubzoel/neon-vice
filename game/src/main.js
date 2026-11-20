// Neon Vice — scaffold v1: boot, render loop, third-person camera, HUD.
// The whole skeleton: renderer + scene + world + placeholder hero + input,
// a start panel with a working New Game button, and a minimal HUD (position
// and FPS). No city, missions, vehicles or audio yet — Builder B/C builds on
// this loop. Exposes window.NEON_VICE after the first frame so automated
// checks can confirm the game actually rendered (ready flag + hero position).

import { CONFIG } from './config.js';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createInput } from './input.js';

const canvas = document.getElementById('game');
const errorBox = document.getElementById('webglError');
const startPanel = document.getElementById('startScreen');
const hudPos = document.getElementById('hudPos');
const hudFps = document.getElementById('hudFps');
const hudState = document.getElementById('hudState');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (err) {
  errorBox.hidden = false;
  errorBox.textContent = `Neon Vice needs WebGL to run. (${err.message})`;
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  CONFIG.camera.fov,
  window.innerWidth / window.innerHeight,
  CONFIG.camera.near,
  CONFIG.camera.far,
);

const world = createWorld(scene);
const player = createPlayer(scene);
const input = createInput();
input.attach();

let state = 'title'; // 'title' | 'playing'
let frames = 0;
let fpsAccum = 0;
let fpsCount = 0;
let fpsShown = 0;

function placeCamera() {
  // Behind the hero along the heading, looking slightly down at the hero.
  const backX = -Math.sin(player.heading) * CONFIG.camera.distance;
  const backZ = -Math.cos(player.heading) * CONFIG.camera.distance;
  camera.position.set(
    player.group.position.x + backX,
    CONFIG.camera.height,
    player.group.position.z + backZ,
  );
  camera.lookAt(
    player.group.position.x,
    CONFIG.camera.lookHeight,
    player.group.position.z,
  );
}

function updateHud() {
  const p = player.group.position;
  hudPos.textContent = `x ${p.x.toFixed(0)} · z ${p.z.toFixed(0)} · ${player.speed.toFixed(1)} m/s`;
  hudFps.textContent = `${fpsShown} FPS`;
}

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05); // clamp: a hitch never teleports the hero
  if (state === 'playing') {
    player.update(dt, input.read(), world);
  }
  placeCamera();
  renderer.render(scene, camera);
  updateHud();

  // FPS as a 1-second rolling average, cheap and stable.
  fpsAccum += dt;
  fpsCount += 1;
  if (fpsAccum >= 1) {
    fpsShown = Math.round(fpsCount / fpsAccum);
    fpsAccum = 0;
    fpsCount = 0;
  }

  frames += 1;
  if (frames === 1) {
    window.NEON_VICE = {
      ready: true,
      title: CONFIG.title,
      hero: () => ({ x: player.group.position.x, z: player.group.position.z, heading: player.heading }),
      state: () => state,
    };
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

document.getElementById('btnNew').addEventListener('click', () => {
  player.reset();
  state = 'playing';
  startPanel.classList.add('hidden');
  hudState.textContent = 'Playing — WASD to move, Shift to run';
});

placeCamera();
updateHud();
frame();
