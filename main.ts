// Neon Vice — entry build (Node 22+, stdlib only).
//
// The playable game lives in game/ next to this file: plain static files
// (game/index.html plus ES modules and the vendored three.js) that a
// desktop browser opens offline with zero network requests. This program
// hands that folder in: it copies game/ and screenshots/ into the output
// directory and writes /output/dossier.json, the summary the judge reads,
// through the vendored make.fun helper.
//
// Local preview: `node serve.ts`, then open http://localhost:8080.
// Outside the grader container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const GAME_DIR = join(ROOT, 'game');
const SHOTS_DIR = join(ROOT, 'screenshots');
const MAX_SHOT_BYTES = 262144; // 256 KiB per screenshot, per the gate
const MAX_GAME_FILES = 993;
const MAX_GAME_BYTES = 50331648; // 48 MiB
const MAX_PATH_BYTES = 1000;

// --- Small helpers ---------------------------------------------------------

function die(message) {
  throw new Error(`Neon Vice build: ${message}`);
}

function shotNames() {
  if (!existsSync(SHOTS_DIR)) return [];
  return readdirSync(SHOTS_DIR)
    .filter((name) => !name.startsWith('.') && /\.(png|jpe?g)$/i.test(name))
    .sort();
}

function checkShots(names) {
  if (names.length === 0) return;
  if (names.length < 3 || names.length > 4) {
    die(`needs 3-4 screenshots, found ${names.length} in screenshots/`);
  }
  for (const name of names) {
    const size = statSync(join(SHOTS_DIR, name)).size;
    if (size > MAX_SHOT_BYTES) die(`screenshot ${name} is ${size} bytes (cap ${MAX_SHOT_BYTES})`);
  }
}

// Iterative walk (explicit stack, no recursion): counts files and bytes
// under a directory tree so the build log shows the entry size at a glance.
function measureTree(root) {
  let files = 0;
  let bytes = 0;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        files += 1;
        bytes += statSync(full).size;
      }
    }
  }
  return { files, bytes };
}

// --- Pre-flight gates (fail early, before any copy) ------------------------

if (!existsSync(join(GAME_DIR, 'index.html'))) die('missing game/index.html');
if (!existsSync(join(GAME_DIR, 'vendor', 'three.min.js'))) {
  die('missing game/vendor/three.min.js (vendored three.js, the 3D renderer needs it)');
}

const shots = shotNames();
checkShots(shots);

// --- Copy ------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
cpSync(GAME_DIR, join(OUT_DIR, 'game'), { recursive: true });
mkdirSync(join(OUT_DIR, 'screenshots'), { recursive: true });
if (existsSync(SHOTS_DIR)) cpSync(SHOTS_DIR, join(OUT_DIR, 'screenshots'), { recursive: true });

// --- Report + dossier ------------------------------------------------------

const gameSize = measureTree(GAME_DIR);
const mib = (gameSize.bytes / 1048576).toFixed(2);
console.log(
  `Neon Vice build: game/ ${gameSize.files} files, ${mib} MiB; ` +
  `screenshots: ${shots.join(', ') || '(none yet)'}`,
);

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes
// the bytes; the rest refuse an entry the scorer would refuse — more than
// 4 screenshots or one over 256 KiB; more than 993 files in game/ or
// 48 MiB of game files in all; or a path under game/ over 1000 bytes
// (game/ counts beside /output's own 1000-entry cap, its screenshots/
// and dossier.json).
const dossierOptions = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: MAX_SHOT_BYTES },
  game_max_files: MAX_GAME_FILES,
  game_max_bytes: MAX_GAME_BYTES,
  game_path_max_bytes: MAX_PATH_BYTES,
};

if (shots.length === 0) {
  // No dossier without screenshots (buildDossier refuses one) — but the
  // build itself must stay green so the game can still be tested locally.
  // (screenshots/ is no longer empty: 4 renders live there now, so this
  // branch only fires if they are ever deleted.)
  console.log('Neon Vice build: no screenshots yet — dossier.json skipped (add 3-4 renders in screenshots/ before submit).');
} else {
  writeFileSync(join(OUT_DIR, 'dossier.json'), buildDossier(OUT_DIR, dossierOptions));
  console.log('Neon Vice build: dossier.json written.');
}
