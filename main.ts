// Neon Vice — build (Node 22+, standard library only): the game is this
// directory's game/ folder, plain static files a desktop browser loads
// offline (game/index.html and its ES modules plus the vendored three.js, no
// network request), and the program hands it in. It copies game/ and
// screenshots/ from beside this file to /output and writes
// /output/dossier.json, the summary the judge reads, with the vendored
// make.fun library. screenshots/ holds 4 renders (1-start, 2-play, 3-chase,
// 4-map, each at most 256 KiB); the gate below fails the build early if that
// breaks instead of letting buildDossier refuse the entry after the copy.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The game must open at game/index.html, or there is nothing to hand in.
if (!existsSync(join(here, 'game', 'index.html'))) {
  throw new Error('Neon Vice is missing game/index.html');
}

// The 3D renderer needs the vendored three.js — without it the game cannot start.
if (!existsSync(join(here, 'game', 'vendor', 'three.min.js'))) {
  throw new Error('Neon Vice 3D is missing game/vendor/three.min.js (vendored three.js)');
}

const shotsDir = join(here, 'screenshots');
const shotFiles = existsSync(shotsDir)
  ? readdirSync(shotsDir).filter((f) => !f.startsWith('.') && /\.(png|jpe?g)$/i.test(f))
  : [];
// Fail early when screenshots/ breaks the gate (RULES.txt: 3-4 images, each at
// most 256 KiB) instead of letting buildDossier refuse the entry after the copy.
if (shotFiles.length > 0) {
  if (shotFiles.length < 3 || shotFiles.length > 4) {
    throw new Error(`Neon Vice needs 3-4 screenshots, found ${shotFiles.length} in screenshots/`);
  }
  for (const f of shotFiles) {
    const bytes = statSync(join(shotsDir, f)).size;
    if (bytes > 262144) throw new Error(`Screenshot ${f} is ${bytes} bytes (gate cap 256 KiB)`);
  }
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// Build stats on stdout: game file count + bytes and the screenshot list, so
// a builder sees at a glance whether the entry fits the gate (game: at most
// 993 files / 48 MiB; screenshots: 3-4, at most 256 KiB each).
function countTree(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = countTree(p);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += statSync(p).size;
    }
  }
  return { files, bytes };
}
const gameStats = countTree(join(here, 'game'));
console.log(`Neon Vice build: game/ ${gameStats.files} files, ${(gameStats.bytes / 1048576).toFixed(2)} MiB; screenshots: ${shotFiles.join(', ') || '(none yet)'}`);

if (shotFiles.length === 0) {
  // No dossier without screenshots (buildDossier refuses one) — but the
  // build itself must stay green so the game can still be tested locally.
  // (screenshots/ is no longer empty: 4 renders live there now, so this
  // branch only fires if they are ever deleted.)
  console.log('Neon Vice build: no screenshots yet — dossier.json skipped (add 3-4 renders in screenshots/ before submit).');
} else {
  // The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
  // scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
  // files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
  // screenshots/ and dossier.json).
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, {
      text_max_bytes: 163840,
      screenshots: { max: 4, max_bytes: 262144 },
      game_max_files: 993,
      game_max_bytes: 50331648,
      game_path_max_bytes: 1000,
    }),
  );
  console.log('Neon Vice build: dossier.json written.');
}
