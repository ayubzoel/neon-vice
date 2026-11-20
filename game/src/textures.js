// Neon Vice — procedural canvas textures (Builder B). No external assets:
// every surface in Vice Harbor is drawn on a canvas at load time.

function canvasTexture(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function speckle(ctx, w, h, n, color, maxSize = 2) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * maxSize, 1 + Math.random() * maxSize);
  }
}

// Dark night ground: asphalt-grey with speckle + a faint 30 m grid line per edge.
export function makeGroundTexture() {
  const tex = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#3a3e47';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 1400, 'rgba(255,255,255,0.035)');
    speckle(ctx, w, h, 500, 'rgba(0,0,0,0.25)');
    ctx.strokeStyle = '#3a3f48';
    ctx.lineWidth = 3;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 30); // one tile = 30 m
  return tex;
}

// Road tile: 6 m of length (u) x full road width (v). Centre dashed line +
// solid edge lines. UV u is scaled by length/6 at build time.
export function makeAsphaltTexture() {
  const tex = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#2b2f38';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 260, 'rgba(255,255,255,0.05)');
    speckle(ctx, w, h, 160, 'rgba(0,0,0,0.35)');
    // Edge lines (solid, pale).
    ctx.fillStyle = 'rgba(226,232,240,0.75)';
    ctx.fillRect(0, 4, w, 3);
    ctx.fillRect(0, h - 7, w, 3);
    // Centre dashed line (amber).
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(14, h / 2 - 3, w - 28, 6);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// Sidewalk tile: 6 m of length (u) x 3 m wide (v). Curb edge near the road.
export function makeSidewalkTexture() {
  const tex = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#7a7e89';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 320, 'rgba(255,255,255,0.06)');
    speckle(ctx, w, h, 200, 'rgba(0,0,0,0.22)');
    // Expansion joints every 2 m.
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (let x = 0; x <= w; x += 43) ctx.fillRect(x, 0, 2, h);
    // Curb face at the road edge (v = 0 side).
    ctx.fillStyle = '#3c4048';
    ctx.fillRect(0, 0, w, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(0, 10, w, 2);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// Zebra tile: white bars across the road width (u), 3 m deep (v).
export function makeZebraTexture() {
  const tex = canvasTexture(128, 32, (ctx, w, h) => {
    ctx.fillStyle = '#1b1e24';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(240,244,248,0.92)';
    for (let x = 0; x < w; x += 16) ctx.fillRect(x, 1, 9, h - 2);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function makeSandTexture() {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8a7648';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 900, 'rgba(255,240,200,0.10)');
    speckle(ctx, w, h, 700, 'rgba(60,45,20,0.20)');
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 28);
  return tex;
}

export function makeConcreteTexture() {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#45484f';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 800, 'rgba(255,255,255,0.05)');
    speckle(ctx, w, h, 500, 'rgba(0,0,0,0.25)');
    ctx.strokeStyle = 'rgba(0,0,0,0.30)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(w, i * 64); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, h); ctx.stroke();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 18);
  return tex;
}

export function makeGrassTexture() {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#1d3320';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 1200, 'rgba(120,200,120,0.10)');
    speckle(ctx, w, h, 600, 'rgba(0,0,0,0.30)');
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  return tex;
}

// Facade with lit windows. kind: 'tower' | 'mid' | 'house' | 'warehouse' |
// 'worship' | 'vital-hospital' | 'vital-police'. The same canvas is used as
// map + emissiveMap, so lit windows glow at night while the facade stays dark.
export function makeBuildingTexture(kind) {
  const base = {
    tower: '#232a36',
    mid: '#2a2622',
    house: '#33302a',
    warehouse: '#2e2a26',
    worship: '#3a2f26',
    'vital-hospital': '#3c4148',
    'vital-police': '#232c3e',
  }[kind] ?? '#2a2a2a';
  const cols = kind === 'warehouse' ? 5 : kind === 'house' ? 4 : 7;
  const rows = kind === 'tower' ? 14 : kind === 'house' ? 2 : kind === 'warehouse' ? 2 : 9;
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    // Subtle vertical panel shading.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let x = 0; x < w; x += 36) ctx.fillRect(x, 0, 2, h);
    // Dark ground-floor band.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, h - 18, w, 18);
    const cw = w / cols;
    const ch = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw + cw * 0.22;
        const y = r * ch + ch * 0.22;
        const ww = cw * 0.56;
        const wh = ch * 0.56;
        const lit = Math.random() < 0.62;
        if (kind === 'worship' && r < rows - 1) {
          // Tall arched windows: warm, mostly lit.
          ctx.fillStyle = Math.random() < 0.8 ? '#ffca6a' : '#10151d';
          ctx.fillRect(x, y - ch * 0.2, ww, wh + ch * 0.4);
          continue;
        }
        ctx.fillStyle = lit
          ? ['#ffd28a', '#ffb347', '#ffe9b0', '#f9a8d4'][Math.floor(Math.random() * 4)]
          : '#0d1219';
        ctx.fillRect(x, y, ww, wh);
      }
    }
    if (kind === 'vital-hospital') {
      // Red cross band near the top.
      ctx.fillStyle = '#c2272f';
      ctx.fillRect(w * 0.32, 8, w * 0.36, 26);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(w * 0.47, 12, w * 0.06, 18);
      ctx.fillRect(w * 0.40, 17, w * 0.20, 8);
    }
    if (kind === 'vital-police') {
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(0, 8, w, 24);
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('POLICE', w / 2, 26);
    }
    if (kind === 'worship') {
      ctx.fillStyle = '#ffd28a';
      ctx.fillRect(w / 2 - 2, 4, 4, 22);
      ctx.fillRect(w / 2 - 8, 10, 16, 4);
    }
  });
}
