// One ground-paint chunk (M10, render-28: moved out of ground-paint.js, which caches and shows the chunks): moss
// patches, water, the vegetation's moss bed and the other marks of CHUNK x CHUNK tiles, painted into a canvas.

import { T, G, WEAR } from '../data/tiles.js';
import { hash2, noise } from '../lib/noise.js';
import { CHUNK } from './terrain.js';
import { PX, MX, MOSS_PX, WATER_TONE, gh, mossNoise, edge, puddlePixels, CHASM_TINT, chasmRaster, mawSkirtRaster, scorchRaster } from './ground-marks.js';
import { alsoLoad, hasSheet, sheet } from './art-store.js';

const WEB_ART = 'images/effects/web-ground.webp';   // sync writes the vendored PNG as WebP; the manifest lists this
alsoLoad('play', WEB_ART);

/** Paints chunk (cx, cy) of floor f: a canvas (with .moss, .pixels and .bones), or null when nothing is on it. */
export function paintGroundChunk(f, cx, cy, { W, H, wallish, fluid, salt }) {
  const cave = f.biome === 'caverns';   // the Caverns' surface paints its own pools and moss (cave-surface.js)
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? T.WALL : f.tiles[y * W + x]);
  const gAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : f.ground[y * W + x]);
  const x0 = cx * CHUNK, y0 = cy * CHUNK, x1 = Math.min(W, x0 + CHUNK), y1 = Math.min(H, y0 + CHUNK);
  const c = document.createElement('canvas'); c.width = CHUNK * PX; c.height = CHUNK * PX;
  const g = c.getContext('2d'), mc = document.createElement('canvas'); mc.width = CHUNK * MX; mc.height = CHUNK * MX;
  const mg = mc.getContext('2d');
  let any = false;
  // Item 207: the Dungeon floor's wear (floor.wear) under every mark: damp floor is a soft darkening, deeper beside the
  // water. No worn-path lanes (Justin 2026-10-19: "get rid of the trails").
  const wAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : f.wear?.[y * W + x] ?? 0);
  if (f.wear) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (wAt(x, y) !== WEAR.DAMP) continue;
    const px = (x - x0 + 0.5) * PX, py = (y - y0 + 0.5) * PX, wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx, y + dy) === T.WATER);
    const gr = g.createRadialGradient(px, py, 0, px, py, PX * 0.8);
    gr.addColorStop(0, `rgba(18,22,26,${wet ? 0.3 : 0.17})`); gr.addColorStop(1, 'rgba(18,22,26,0)');
    g.fillStyle = gr; g.fillRect(px - PX * 0.8, py - PX * 0.8, PX * 1.6, PX * 1.6); any = true;
  }
  // Moss (surface.js mossRaster): seeds on moss cells and in 30% of inner corners, a noisy patch round each. Worked
  // out per tile at MOSS_PX, as 1.7 works it out at 128 a tile, so its leaf grain shows (Crypt look pass 2026-10-17:
  // at 16 a tile, drawn smoothed, it read as a green blur next to 1.7's clumps); a chunk's mossy tiles share one atlas.
  const mossTiles = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const t = at(x, y);
    if (cave || wallish(t) || t === T.CHASM || t === T.WATER) continue;
    const seeds = [];
    for (let yy = y - 2; yy <= y + 2; yy++) for (let xx = x - 2; xx <= x + 2; xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || wallish(at(xx, yy))) continue;
      // Use the same textured moss beneath the Crypt's standing and trampled mushrooms.
      const gv = gAt(xx, yy);
      if (gv === G.MOSS || (f.biome === 'crypt' && (gv === G.GRASS || gv === G.SHORT))) seeds.push({ x: xx + 0.5 + (hash2(xx, yy, salt + 41) - 0.5) * 0.5, y: yy + 0.5 + (hash2(xx, yy, salt + 42) - 0.5) * 0.5, r: 0.7 + 0.35 * hash2(xx, yy, salt + 43) });
      const wn = wallish(at(xx, yy - 1)), ws = wallish(at(xx, yy + 1)), ww = wallish(at(xx - 1, yy)), we = wallish(at(xx + 1, yy));
      // No green corner moss in the Underdark (deeprender.js: "no dungeon moss down here").
      if ((wn || ws) && (ww || we) && f.biome !== 'underdark' && hash2(xx, yy, salt + 44) < 0.3) seeds.push({ x: xx + (ww ? 0.05 : 0.95), y: yy + (wn ? 0.05 : 0.95), r: 0.75 + 0.35 * hash2(xx, yy, salt + 45) });
    }
    // only the seeds whose patch reaches this tile
    const near = seeds.filter(s => Math.hypot(Math.max(x, Math.min(x + 1, s.x)) - s.x, Math.max(y, Math.min(y + 1, s.y)) - s.y) < s.r);
    if (!near.length) continue;
    let px = null;
    for (let v = 0; v < MOSS_PX; v++) for (let u = 0; u < MOSS_PX; u++) {
      const wx = x + (u + 0.5) / MOSS_PX, wy = y + (v + 0.5) / MOSS_PX;
      let d = 0;
      for (const s of near) { const dd = Math.hypot(wx - s.x, wy - s.y) / s.r; if (dd < 1) d = Math.max(d, 1 - dd); }
      if (d <= 0) continue;
      const val = d * 1.1 + (mossNoise(wx * 6, wy * 6, salt + 51) - 0.5) * 0.55 + (mossNoise(wx * 16, wy * 16, salt + 50) - 0.5) * 0.18;
      if (val <= 0.57) continue;
      const dense = Math.min(1, (val - 0.62) * 2.6), leaf = mossNoise(wx * 48, wy * 48, salt + 52), grain = (hash2(Math.floor(wx * 128), Math.floor(wy * 128), salt + 53) - 0.5) * 10;
      const p = (v * MOSS_PX + u) * 4;
      px ??= new Uint8ClampedArray(MOSS_PX * MOSS_PX * 4);
      px[p] = 54 + 42 * leaf + grain; px[p + 1] = 65 + 47 * leaf + grain; px[p + 2] = 29 + 21 * leaf + grain * 0.5;
      px[p + 3] = Math.round((205 + 40 * Math.max(0, dense)) * edge(val, 0.57, 0.1));
    }
    if (px) mossTiles.push({ x, y, px });
  }
  let moss = null;
  if (mossTiles.length) {
    const n = Math.ceil(Math.sqrt(mossTiles.length)), mca = document.createElement('canvas');
    mca.width = mca.height = n * MOSS_PX;
    const ga = mca.getContext('2d');
    mossTiles.forEach((m, i) => { m.u = (i % n) * MOSS_PX; m.v = Math.floor(i / n) * MOSS_PX; ga.putImageData(new ImageData(m.px, MOSS_PX, MOSS_PX), m.u, m.v); delete m.px; });
    moss = { canvas: mca, tiles: mossTiles };
  }
  // Water (surface.js waterRaster): a soft field around each water tile, its shore wobbling in slow lobes, a pale rim
  // where it meets the stone and darker the deeper in; drawn over the floor, which shows a little through the rim.
  const water = (x, y) => !cave && x >= 0 && y >= 0 && x < W && y < H && f.tiles[y * W + x] === T.WATER;
  const wc = document.createElement('canvas'); wc.width = CHUNK * PX; wc.height = CHUNK * PX;
  const wg = wc.getContext('2d'), wim = wg.createImageData(wc.width, wc.height), WD = wim.data;
  let wany = false;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (wallish(at(x, y)) && !water(x, y)) continue;
    const cells = [];
    for (let yy = y - 2; yy <= y + 2; yy++) for (let xx = x - 2; xx <= x + 2; xx++) if (water(xx, yy)) cells.push([xx + 0.5, yy + 0.5]);
    if (!cells.length) continue;
    for (let v = 0; v < PX; v++) for (let u = 0; u < PX; u++) {
      const wx = x + (u + 0.5) / PX, wy = y + (v + 0.5) / PX;
      let fsum = 0;
      for (const [cx2, cy2] of cells) { const d = Math.hypot(wx - cx2, wy - cy2) / 1.4; if (d < 1) fsum += (1 - d) * (1 - d); }
      const lx = wx * 1.7, ly = wy * 1.7, ix = Math.floor(lx), iy = Math.floor(ly), fx = lx - ix, fy = ly - iy;
      const lobe = (hash2(ix, iy, salt + 92) * (1 - fx) + hash2(ix + 1, iy, salt + 92) * fx) * (1 - fy) + (hash2(ix, iy + 1, salt + 92) * (1 - fx) + hash2(ix + 1, iy + 1, salt + 92) * fx) * fy - 0.5;
      const val = fsum + lobe * 0.16 + (hash2(Math.floor(wx * 12), Math.floor(wy * 12), salt + 90) - 0.5) * 0.03;
      if (val < 0.2) continue;
      const p = (((y - y0) * PX + v) * CHUNK * PX + (x - x0) * PX + u) * 4, deep = Math.min(1, (val - 0.2) * 2.2), rim = val < 0.27;
      const gr = fluid ? (fluid.red[((((y * 128 + v * 4) % fluid.h) + fluid.h) % fluid.h) * fluid.w + ((((x * 128 + u * 4) % fluid.w) + fluid.w) % fluid.w)] - 128) * 0.12 : 0;
      // 1.7's raster colours, toned per channel: measured lit, tile by tile, against 1.7's pools (1.7's fluid pass
      // shades the pool darker than its raw raster).
      WD[p] = ((rim ? 96 : 36 + (1 - deep) * 22) + gr) * WATER_TONE[0]; WD[p + 1] = ((rim ? 132 : 66 + (1 - deep) * 24) + gr) * WATER_TONE[1]; WD[p + 2] = ((rim ? 146 : 86 + (1 - deep) * 20) + gr) * WATER_TONE[2];
      WD[p + 3] = rim ? 170 : Math.round(185 + 45 * deep); wany = true;
    }
  }
  if (wany) { wg.putImageData(wim, 0, 0); g.drawImage(wc, 0, 0); any = true; }
  // The vegetation's moss bed (vegart.js vegMossRaster): a green wash under and around grass and plant spots.
  const spots = new Set((f.spots ?? []).map(p => p.y * W + p.x));
  const grassy = (x, y) => { if (f.biome === 'underdark') return false;   // 1.7 beds moss in the Dungeon's sets only (vegart.js drawVegMoss)
    if (x < 0 || y < 0 || x >= W || y >= H || wallish(at(x, y))) return false; const gv = f.ground[y * W + x]; return gv === G.GRASS || gv === G.SHORT || spots.has(y * W + x); };
  const vs = salt + 140, vim = mg.createImageData(mc.width, mc.height), V = vim.data;
  let vany = false;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (cave || wallish(at(x, y))) continue;   // no moss bed under cave grass (1.7 drawVegMoss: the Dungeon's set only)
    const cells = [];
    for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (grassy(xx, yy)) cells.push([xx + 0.5, yy + 0.5]);
    if (!cells.length) continue;
    for (let v = 0; v < MX; v++) for (let u = 0; u < MX; u++) {
      const wx = x + (u + 0.5) / MX, wy = y + (v + 0.5) / MX;
      let fsum = 0;
      for (const [cx2, cy2] of cells) { const d = Math.hypot(wx - cx2, wy - cy2) / 1.25; if (d < 1) fsum += (1 - d) * (1 - d); }
      if (fsum < 0.05) continue;
      const val = fsum + (noise(wx * 2.2, wy * 2.2, vs) - 0.5) * 0.35 + (mossNoise(wx * 16, wy * 16, vs + 1) - 0.5) * 0.1;
      if (val < 0.28) continue;
      const dense = Math.min(1, (val - 0.28) * 1.8), fleck = edge(mossNoise(wx * 16, wy * 16, vs + 2), 0.68, 0.08);
      const p = (((y - y0) * MX + v) * CHUNK * MX + (x - x0) * MX + u) * 4;
      if (f.biome === 'crypt') {
        // The Crypt's bed under its mushrooms (1.7 cryptMossRaster, cryptset.js:513-532; Justin 2026-10-16, C15): pale flecks
        // and a violet cast picked up from the caps.
        const n = mossNoise(wx * 48, wy * 48, vs + 2), cf = edge(n, 0.6, 0.25), violet = edge(mossNoise(wx * 9, wy * 9, vs + 3), 0.66, 0.22);
        const grain = (hash2(Math.floor(wx * 128), Math.floor(wy * 128), vs + 4) - 0.5) * 8;
        V[p] = 48 + 18 * dense + 32 * cf + 22 * violet + grain; V[p + 1] = 72 + 16 * dense + 35 * cf - 14 * violet + grain; V[p + 2] = 38 + 14 * cf + 50 * violet + grain * 0.5;
        V[p + 3] = Math.round((58 + 40 * cf + 92 * dense) * edge(val, 0.28, 0.1)); vany = true;
        continue;
      }
      V[p] = 58 + 18 * dense + (46 - 18 * dense) * fleck; V[p + 1] = 82 + 16 * dense + (46 - 16 * dense) * fleck; V[p + 2] = 40 + 22 * fleck;
      V[p + 3] = Math.round((34 + 36 * fleck + 62 * dense) * edge(val, 0.28, 0.06)); vany = true;
    }
  }
  g.imageSmoothingEnabled = true;
  if (vany) { mg.clearRect(0, 0, mc.width, mc.height); mg.putImageData(vim, 0, 0); g.drawImage(mc, 0, 0, c.width, c.height); any = true; }
  // The other marks, drawn as 1.7 draws them, in tile units scaled to the canvas.
  const bones = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const gv = gAt(x, y); if (!gv || gv === G.GRASS || gv === G.SHORT || gv === G.MOSS) continue;
    const TS = PX, px = (x - x0) * PX, py = (y - y0) * PX, Hh = k => gh(x, y, k);
    g.save(); any = true;
    if (gv === G.PUDDLE) {
      // drawn as pixels (puddlePixels), on the chunk's sharp layer
    } else if (gv === G.BLOOD) {
      for (let i = 0; i < 6; i++) {
        let cx2 = px + TS * (0.3 + 0.4 * Hh(i)), cy2 = py + TS * (0.3 + 0.4 * Hh(i + 10));
        const r = TS * (i < 2 ? 0.12 + 0.08 * Hh(i + 20) : 0.03 + 0.04 * Hh(i + 20));
        if (i >= 2) { cx2 += (Hh(i + 30) - 0.5) * TS * 0.5; cy2 += (Hh(i + 40) - 0.5) * TS * 0.5; }
        g.fillStyle = i < 2 ? 'rgba(96,18,20,.75)' : 'rgba(120,24,24,.7)'; g.beginPath(); g.ellipse(cx2, cy2, r * 1.2, r, Hh(i) * 3, 0, Math.PI * 2); g.fill();
      }
    } else if (gv === G.SCORCH || gv === G.ASH) {
      // RL21, RC54 (1.7 surface.js scorchRaster): one ragged burnt stain that joins burnt neighbours, grey ash with pale
      // flecks, spilling a quarter tile past its cell but only onto open ground (never walls or chasm).
      const stain = scorchRaster(gAt, x, y, gv === G.ASH, salt + 1701);
      g.save(); g.beginPath();
      for (let sy = -1; sy <= 1; sy++) for (let sx = -1; sx <= 1; sx++) {
        const nx = x + sx, ny = y + sy, ng = gAt(nx, ny), nt = at(nx, ny);
        if ((sx || sy) && (ng === G.SCORCH || ng === G.ASH)) continue;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && nt !== T.CHASM && !wallish(nt)) g.rect(px + sx * TS, py + sy * TS, TS, TS);
      }
      g.clip(); g.imageSmoothingEnabled = true; g.drawImage(stain, px - TS * 0.25, py - TS * 0.25, TS * 1.5, TS * 1.5); g.restore();
      if (gv === G.ASH) { g.fillStyle = 'rgba(226,98,43,.35)'; g.fillRect(px + TS * (0.3 + 0.4 * Hh(90)), py + TS * (0.3 + 0.4 * Hh(91)), Math.max(1, TS * 0.04), Math.max(1, TS * 0.04)); }
    } else if (gv === G.ICE) {
      g.fillStyle = 'rgba(150,205,235,.28)'; g.beginPath(); g.ellipse(px + TS / 2, py + TS / 2, TS * 0.46, TS * 0.4, Hh(7), 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(230,248,255,.55)'; g.lineWidth = 1;
      for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(px + TS * Hh(i), py + TS * Hh(i + 5)); g.lineTo(px + TS * Hh(i + 10), py + TS * Hh(i + 15)); g.stroke(); }
    } else if (gv === G.TELL) {
      g.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        g.strokeStyle = 'rgba(15,12,10,.45)'; g.lineWidth = Math.max(1, TS * 0.03);
        const cx2 = px + TS * (0.2 + 0.6 * Hh(i)), cy2 = py + TS * (0.2 + 0.6 * Hh(i + 10));
        g.beginPath(); g.moveTo(cx2, cy2); g.lineTo(cx2 + TS * 0.18 * (Hh(i + 20) - 0.3), cy2 + TS * 0.14); g.lineTo(cx2 + TS * 0.22, cy2 + TS * 0.1 * (Hh(i + 30) - 0.5)); g.stroke();
      }
    } else if (gv === G.WEB) {
      const image = hasSheet(WEB_ART) && sheet(WEB_ART).source.resource;
      if (image) g.drawImage(image, px, py, TS, TS);   // The painted silk already carries its transparency.
    } else if (gv === G.BONES) {
      // bonesRaster: one of the ground-bones pictures (variant 3 rare), 0.7 of a tile, turned up to 0.35 rad; listed for
      // ground-paint.js to show from its sheet, as painting it at PX a tile blurred it (Justin 2026-10-19: "why is the bone
      // art so bad?")
      const sample = hash2(x, y, salt + 60), variant = sample < 0.06 ? 3 : [0, 1, 2, 4][Math.min(3, Math.floor((sample - 0.06) / 0.94 * 4))];
      bones.push({ x, y, frame: `props/ground-bones-${variant}`, turn: (hash2(x, y, salt + 61) - 0.5) * 0.7 });
    }
    g.restore();
  }
  c.moss = moss; c.bones = bones;
  if (moss) any = true;
  // CV1, CV2: chasm edges, over every cell next to a chasm (not on the planes or in the Realm, which draw their own).
  const tint = !f.plane && !f.chaos && CHASM_TINT[f.biome ?? 'dungeon'];
  if (tint) {
    const isVoid = (x, y) => { const t = at(x, y); return x >= 0 && y >= 0 && x < W && y < H && (t === T.CHASM || t === T.BRIDGE); };
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      let near = false;
      for (let oy = -1; oy <= 1 && !near; oy++) for (let ox = -1; ox <= 1; ox++) if (isVoid(x + ox, y + oy)) { near = true; break; }
      if (!near || (wallish(at(x, y)) && !isVoid(x, y))) continue;
      const r = chasmRaster(isVoid, x, y, tint, salt + 600);
      if (r) { g.imageSmoothingEnabled = true; g.drawImage(r, (x - x0) * PX, (y - y0) * PX, PX, PX); any = true; }
    }
  }
  // CV4: the Maw's burrow mounds heaved out of the floor (each skirt drawn into every chunk it touches, clipped there).
  if (cave) for (const p of f.props ?? []) {
    if (!/^worm-burrow/.test(p.id) || p.part || p.x + 3 < x0 || p.x - 1 >= x1 || p.y + 3 < y0 || p.y - 1 >= y1) continue;
    g.imageSmoothingEnabled = true;
    g.drawImage(mawSkirtRaster(p.x - 1, p.y - 1, salt + 880), (p.x - 1 - x0) * PX, (p.y - 1 - y0) * PX, PX * 4, PX * 4); any = true;
  }
  c.pixels = puddlePixels(gAt, x0, y0, x1, y1);
  return any || c.pixels ? c : null;
}
