// A tiny static server for game/ (Node 22+, standard library only), so an entry
// can be played locally without a build step: `node serve.ts` serves game/ on
// http://localhost:8080 (or --port <port>). `--host <addr>` picks the bind
// address (default 127.0.0.1); `--host 0.0.0.0` exposes it on the LAN so a
// phone on the same Wi-Fi can open the game. It sends the MIME types a browser
// game needs, refuses any path outside game/, and otherwise does nothing
// clever: this is a development convenience, not a web server for the internet.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./game', import.meta.url)));
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const requested = portIndex === -1 ? 8080 : Number(args[portIndex + 1]);
const port = Number.isInteger(requested) && requested > 0 && requested < 65536 ? requested : 8080;
const hostIndex = args.indexOf('--host');
const host = hostIndex === -1 || !args[hostIndex + 1] ? '127.0.0.1' : args[hostIndex + 1];

// Refuse to start when the entrypoint or the vendored three.js is missing — a
// server that answers 404 for the game itself only wastes a test run.
for (const required of ['index.html', join('vendor', 'three.min.js')]) {
  if (!existsSync(join(root, required))) {
    console.error(`Neon Vice serve: missing game/${required} — refusing to start.`);
    process.exit(1);
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end('bad request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = resolve(join(root, normalize(pathname)));
  if (file !== root && !file.startsWith(root + sep)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  let size: number;
  try {
    const stats = statSync(file);
    if (!stats.isFile()) throw new Error('not a file');
    size = stats.size;
  } catch {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': size,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  // HEAD answers with headers only (used by uptime/health checks); GET streams the file.
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}).listen(port, host, () => {
  console.log(`Neon Vice — open http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`);
});
