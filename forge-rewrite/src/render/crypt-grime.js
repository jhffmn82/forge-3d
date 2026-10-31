// The Crypt's ground stains (M10, render-28: moved out of crypt-look.js): the ooze pools and the grime under the walls,
// each painted once per floor as one picture.

import { Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { hash2, noise } from '../lib/noise.js';
import { isWallTile, isOpaqueTile } from '../data/tiles.js';
import { poolRaster } from './pool-raster.js';
import { tex, cachedPicture, wallLineKey } from './crypt-art.js';


/**
 * Grave ooze (1.7 oozeRaster, cryptset.js:58-100): one picture of every pool on the floor, worked out per pixel from a
 * soft field round each ooze cell: a dark lip at the shore with a lit, wet edge facing the upper left in places, a
 * translucent green body with broad sheen and a few glints. Drawn under the bodies; null when the floor has none.
 */
export function cryptOoze(floor, tile, salt = 7) {
  const cells = floor.ooze ?? [];
  if (!cells.length) return null;
  const pic = cachedPicture(floor, 'ooze', `${cells.join(',')}|${wallLineKey(floor)}`, () => paintOoze(floor, cells, salt));
  const sp = new Sprite(pic.tex);
  sp.position.set(pic.x0 * tile, pic.y0 * tile); sp.width = (pic.x1 - pic.x0 + 1) * tile; sp.height = (pic.y1 - pic.y0 + 1) * tile;
  return sp;
}

function paintOoze(floor, cells, salt) {
  const W = floor.w;
  // Only on open ground, as 1.7 (drawOoze skips wall tiles): a pool runs up to the wall, never onto it.
  const skip = (cx, cy) => { const tt = floor.tiles[cy * W + cx]; return tt === undefined || isOpaqueTile(tt); };
  const pool = poolRaster(floor, cells, { salt, skip, colour: ({ wx, wy, deep, shore, facing }) => {
    let col, a;
    if (shore) {
      const glint = noise(wx * 6.5, wy * 6.5, salt + 9);
      if (facing() > 0.004 && glint > 0.62) { col = [130, 196, 92]; a = 210; } else if (glint < 0.3) { col = [40, 96, 34]; a = 150; } else { col = [24, 70, 28]; a = 215; }
    } else {
      col = [30 + (1 - deep) * 16, 78 + (1 - deep) * 26, 34 + (1 - deep) * 6]; a = Math.round(150 + 50 * deep);
      if (noise(wx * 2.6 + 3, wy * 2.6, salt + 11) > 0.78 && deep > 0.35) col = [col[0] + 18, col[1] + 26, col[2] + 10];
      // 1.7's single-pixel wet glints are left out: at this resolution they read as specks (Justin: bubbles, not specks).
    }
    return [col[0], col[1], col[2], a];
  } });
  return { tex: Texture.from({ resource: pool.canvas, scaleMode: 'linear' }), x0: pool.x0, y0: pool.y0, x1: pool.x1, y1: pool.y1 };
}

const mossNoise = (wx, wy, sl) => {
  const x = Math.floor(wx), y = Math.floor(wy); let fx = wx - x, fy = wy - y;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(x, y, sl), b = hash2(x + 1, y, sl), c = hash2(x, y + 1, sl), d = hash2(x + 1, y + 1, sl);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
};
const mossEdge = (v, t0, w) => { const t = Math.max(0, Math.min(1, (v - t0) / w)); return t * t * (3 - 2 * t); };

/**
 * Grime (1.7 grimeRaster, cryptset.js:168-207): green-brown blotches and moss worked into the Crypt's floor, denser
 * against walls, round ooze and in corners, thin in the open; the same tile always gets the same stain. One picture
 * for the whole floor at 32 px a tile.
 */
export function cryptGrime(floor, tile, salt) {
  const pic = cachedPicture(floor, 'grime', `${salt}|${(floor.ooze ?? []).length}|${wallLineKey(floor)}`, () => paintGrime(floor, salt));
  const sp = new Sprite(pic.tex);
  sp.width = floor.w * tile; sp.height = floor.h * tile;
  return sp;
}

/** The grime picture at 16 px a tile (a soft stain; C13 halves 1.7's resolution again for the phone). */
function paintGrime(floor, salt) {
  const W = floor.w, H = floor.h, R = 16, t = floor.tiles, ooze = new Set(floor.ooze ?? []);
  const wallish = (x, y) => x < 0 || y < 0 || x >= W || y >= H || isWallTile(t[y * W + x]);
  const level = (x, y) => {
    let near = 0, oz = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && wallish(x + dx, y + dy)) near++;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) if (ooze.has((y + oy) * W + x + ox)) oz++;
    return Math.min(1, 0.12 + near * 0.09 + oz * 0.06);
  };
  const blobsAt = new Map();
  const blobs = (cx, cy) => {
    const k = cy * W + cx;
    if (blobsAt.has(k)) return blobsAt.get(k);
    let out = [];
    if (!wallish(cx, cy)) {
      const lvl = level(cx, cy);
      if (hash2(cx, cy, salt) <= 0.35 + lvl * 0.65) {
        const nb = 1 + Math.floor(hash2(cx, cy, salt + 1) * 3);
        for (let i = 0; i < nb; i++) out.push([cx + hash2(cx, cy, salt + 10 + i), cy + hash2(cx, cy, salt + 20 + i), 0.22 + 0.4 * hash2(cx, cy, salt + 30 + i) * (0.6 + lvl)]);
      }
    }
    blobsAt.set(k, out);
    return out;
  };
  const c = document.createElement('canvas');
  c.width = W * R; c.height = H * R;
  const g = c.getContext('2d'), im = g.createImageData(W * R, H * R), D = im.data;
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
    if (wallish(tx, ty)) continue;
    const bl = [];
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (tx + ox >= 0 && ty + oy >= 0 && tx + ox < W && ty + oy < H) bl.push(...blobs(tx + ox, ty + oy));
    if (!bl.length) continue;
    for (let v = 0; v < R; v++) for (let u = 0; u < R; u++) {
      const wx = tx + (u + 0.5) / R, wy = ty + (v + 0.5) / R;
      let f = 0;
      for (const [bx, by, br] of bl) { const d = Math.hypot(wx - bx, wy - by) / br; if (d < 1) f += 1 - d; }
      if (f <= 0) continue;
      const grain = mossNoise(wx * 48, wy * 48, salt + 40), clump = noise(wx * 3.2, wy * 3.2, salt + 41);
      const val = f * 0.85 + (grain - 0.5) * 0.18 + (clump - 0.5) * 0.4;
      if (val <= 0.3) continue;
      const p = ((ty * R + v) * W * R + tx * R + u) * 4, fleck = mossEdge(grain, 0.6, 0.25);
      const detail = (hash2(Math.floor(wx * 64), Math.floor(wy * 64), salt + 42) - 0.5) * 8;
      D[p] = 44 + grain * 14 + 16 * fleck + detail; D[p + 1] = 62 + grain * 18 + 30 * fleck + detail; D[p + 2] = 30 + 8 * fleck + detail * 0.5;
      D[p + 3] = Math.round(Math.min(150, (val - 0.3) * 260) * (0.8 + 0.2 * fleck));
    }
  }
  g.putImageData(im, 0, 0);
  return { tex: Texture.from({ resource: c, scaleMode: 'linear' }) };
}
