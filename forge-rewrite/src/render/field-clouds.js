// 1.7's poison clouds, spore clouds and static field over the map (M10, render-28: moved out of fields-view.js, which
// builds this layer and hands it the field rows): billowing puffs, slow mists, the static field's glow and sparks.

import { Graphics, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import tuning from '../../data/tuning.json' with { type: 'json' };
import { radialTexture } from './stamps.js';

const TURN = tuning.rows.clock.unitsPerGameTurn;

export const softTexture = () => radialTexture('soft-55', [[0, 1], [0.45, 0.55], [1, 0]]);   // stamps.js (render-13)

let rayTex = null;
/** Holy Ground's fine ray (balance-rulings.js:113-115): clear at the top, 0.23 at 0.65 down, 0.65 at its foot. */
function rayTexture() {
  if (rayTex) return rayTex;
  const c = document.createElement('canvas'); c.width = 2; c.height = 64;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.65, 'rgba(255,255,255,0.23)'); gr.addColorStop(1, 'rgba(255,255,255,0.65)');
  g.fillStyle = gr; g.fillRect(0, 0, 2, 64);
  return (rayTex = Texture.from({ resource: c, scaleMode: 'linear' }));
}

// ---------------------------------------------------------------- 1.7's poison clouds and static field
// crypt.js:103-172 (cloudPuff, drawFieldMist, the cloud pass of drawCryptTelegraphs) and cavernmobs.js:292-322
// (drawShockCloudTelegraphs): billowing puffs that drift over the cells' edges; the static field's slow glow, mist
// and flickering sparks. Hashes and noise are this file's own; the look is 1.7's.
export const fh = (x, y, k) => { let v = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(k | 0, 1274126177); v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
function valueNoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = fh(x0, y0, seed), b = fh(x0 + 1, y0, seed), c = fh(x0, y0 + 1, seed), d = fh(x0 + 1, y0 + 1, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
const puffTex = {};
/** 1.7 cloudPuff: a round puff torn into wisps by two octaves of noise; 'gas' keeps 1.7's greens, 'white' is tinted. */
export function puffTexture(kind) {
  if (puffTex[kind]) return puffTex[kind];
  const R = 128, c = document.createElement('canvas'); c.width = c.height = R;
  const g = c.getContext('2d'), im = g.createImageData(R, R), D = im.data;
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
    const nx = (x + 0.5) / R, ny = (y + 0.5) / R, r = Math.hypot((nx - 0.5) * 2, (ny - 0.5) * 2);
    const w = valueNoise(nx * 5, ny * 5, 771) * 0.65 + valueNoise(nx * 13, ny * 13, 772) * 0.35;
    const a = Math.max(0, 1 - r) * Math.max(0, (w - 0.18) * 1.55), p = (y * R + x) * 4;
    if (kind === 'gas') { D[p] = 153 + w * 32; D[p + 1] = 198 + w * 27; D[p + 2] = 89 + w * 24; } else D[p] = D[p + 1] = D[p + 2] = 255;
    D[p + 3] = Math.min(255, a * 290);
  }
  g.putImageData(im, 0, 0);
  return (puffTex[kind] = Texture.from({ resource: c, scaleMode: 'linear' }));
}
let warnTexture = null;
/** 1.7 drawGroundWarning's pool: solid to 0.55 of the way from 0.05 to 0.75 of a tile, then gone at 0.75. */
function warnPool() {
  if (warnTexture) return warnTexture;
  const R = 48, c = document.createElement('canvas'); c.width = c.height = R * 2;
  const g = c.getContext('2d'), gr = g.createRadialGradient(R, R, R * 0.05 / 0.75, R, R, R);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, '#ffffff'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, R * 2, R * 2);
  return (warnTexture = Texture.from({ resource: c, scaleMode: 'linear' }));
}
/** The clouds' and static fields' drawing: built in set(), moved every frame in tick(). */
export function createCloudLayer(root) {
  const puffs = [], mists = [], pools = [], sparks = [], holy = [];
  let gfx = null, tile = 64;
  const sprite = (tex, blend = 'normal') => { const s = new Sprite(tex); s.anchor.set(0.5); s.blendMode = blend; root.addChild(s); return s; };
  return {
    clear() { puffs.length = mists.length = pools.length = sparks.length = holy.length = 0; gfx = null; },
    /**
     * CR16, 1.7 drawFieldMist (crypt.js:118-134): two drifting puffs of the colour on each cell in sight (and on
     * remembered cells when asked), at the opacity given; `late` shifts the drift (smoke's lighter billow, +1700 ms).
     */
    mist(state, cells, color, opacity, { remembered = false, late = 0, blend = 'normal' } = {}, size) {
      if (size) tile = size;
      if (!(opacity > 0)) return;
      const f = state.floor;
      for (const k of cells) {
        if (!state.vis?.[k] && !(remembered && state.seen?.[k])) continue;
        const x = k % f.w, y = (k / f.w) | 0;
        for (let m = 0; m < 2; m++) { const s = sprite(puffTexture('white'), blend); s.tint = color; mists.push({ s, x, y, h: fh(x, y, m + 719), op: opacity, late }); }
      }
    },
    /**
     * Holy Ground (1.7 balance-rulings.js drawSanctuarySurface): light falling on the stone. A soft breathing pool on
     * each cell in sight and two fine shafts with a mote rising up each, over a faint warm mist.
     */
    holyGround(state, r, size) {
      tile = size;
      const f = state.floor, cells = r.cells.filter(k => state.vis?.[k]);
      this.mist(state, cells, 0xfff5dc, 0.12, { blend: 'add' });
      for (const k of cells) {
        const x = k % f.w, y = (k / f.w) | 0, pool = sprite(softTexture(), 'add');
        pool.tint = 0xfffceb;
        const beams = [0, 1].map(b => {
          const salt = b * 31, halo = sprite(softTexture(), 'add'), ray = sprite(rayTexture(), 'add'), mote = root.addChild(new Graphics().circle(0, 0, 1).fill({ color: 0xfffdf1 }));
          halo.tint = 0xfff6d4; ray.tint = 0xfffdf0; ray.anchor.set(0.5, 1); mote.blendMode = 'add';
          return { halo, ray, mote, dx: (b - 0.5) * 0.38 + (fh(x, y, 919 + salt) - 0.5) * 0.18, dy: 0.04 + fh(x, y, 921 + salt) * 0.1, h: 0.5 + fh(x, y, 923 + salt) * 0.4, w: 0.045 + fh(x, y, 927 + salt) * 0.04, rise: fh(x, y, 929 + salt) };
        });
        holy.push({ x, y, pool, beams, seed: fh(x, y, 911) });
      }
    },
    /** A gas or spore cloud (1.7 addCloud): three puffs a cell on every cell ever seen, fading over its last 2 turns. */
    cloud(state, r, size) {
      tile = size;
      const f = state.floor, left = r.until === null ? Infinity : r.until - (state.now ?? 0), fade = Math.max(0, Math.min(1, left / (2 * TURN)));
      for (const k of r.cells) {
        if (!state.seen?.[k] && !state.vis?.[k]) continue;
        const x = k % f.w, y = (k / f.w) | 0, mem = !state.vis?.[k];   // remembered cells show their cloud dimmed
        for (let n = 0; n < 3; n++) puffs.push({ s: sprite(puffTexture('gas')), x, y, n, h1: fh(x, y, n * 3 + 1), h2: fh(x, y, n * 3 + 2), h3: fh(x, y, n * 3 + 3), fade: fade * (mem ? 0.4 : 1) });
      }
    },
    /** A Storm Beetle's static field: the slow warning glow, a thin mist and sparks, on the cells in sight. */
    staticField(state, r, size) {
      tile = size;
      const f = state.floor;
      r.cells.forEach((k, n) => {
        if (!state.vis?.[k]) return;
        const x = k % f.w, y = (k / f.w) | 0;
        const glow = sprite(warnPool()); glow.tint = 0x82c9f5; glow.width = glow.height = tile * 1.5; glow.position.set((x + 0.5) * tile, (y + 0.5) * tile);
        const dot = root.addChild(new Graphics().circle(0, 0, tile * 0.12).fill({ color: 0xffffff })); dot.position.copyFrom(glow.position);
        pools.push({ glow, dot, x, y });
        this.mist(state, [k], 0xbadfff, 0.16);
        if (n % 2 === 0) sparks.push({ k, n, x, y });
      });
      if (sparks.length) { gfx?.destroy(); gfx = root.addChild(new Graphics()); }   // the sparks over the glow and mist
    },
    get live() { return puffs.length + pools.length + mists.length + holy.length > 0; },
    tick(now, reduced) {
      const t = reduced ? 0 : now / 1000, T = tile, px = v => v * T / 48;
      for (const p of puffs) {
        const sp = t * (0.25 + p.h3 * 0.3);
        const r = T * (0.62 + p.h3 * 0.3) * (1 + 0.06 * Math.sin(sp * 1.7 + p.n));
        p.s.position.set((p.x + 0.5 + (p.h1 - 0.5) * 0.6 + Math.sin(sp + p.h2 * 6.28) * 0.12) * T, (p.y + 0.5 + (p.h2 - 0.5) * 0.6 + Math.cos(sp * 0.8 + p.h1 * 6.28) * 0.1) * T);
        p.s.width = p.s.height = r * 2;
        p.s.alpha = (0.34 + 0.08 * Math.sin(sp * 1.3 + p.h1 * 6)) * p.fade;
      }
      // The field's glow breathes five times slower than a warning, at 0.55 strength (cavernmobs.js:305).
      for (const w of pools) {
        const pulse = reduced ? 0.6 : 0.45 + 0.3 * Math.sin(t * 0.2 * 8 + w.x + w.y);
        w.glow.alpha = pulse * 0.55 * 0.55; w.dot.alpha = pulse * 0.55 * 0.35;
      }
      for (const m of mists) {
        const ph = (reduced ? 0 : t + m.late / 1000) * 0.25 + m.h * 6.28, r = T * (0.64 + m.h * 0.16);
        m.s.position.set((m.x + 0.5 + Math.sin(ph) * 0.14) * T, (m.y + 0.55 + Math.cos(ph * 0.8) * 0.12) * T);
        m.s.width = r * 2; m.s.height = r * 1.3;
        m.s.alpha = m.op * (0.88 + 0.12 * Math.sin(ph));
      }
      for (const c of holy) {
        const breath = reduced ? 0.82 : 0.8 + 0.12 * Math.sin(t * 0.8 + c.seed * 6.28), cx = (c.x + 0.5) * T, cy = (c.y + 0.6) * T;
        c.pool.position.set(cx, cy); c.pool.width = T * 1.56; c.pool.height = T * 1.56 * 0.62; c.pool.alpha = 0.3 * breath;
        for (const b of c.beams) {
          const sx = cx + b.dx * T, sy = cy + b.dy * T, h = b.h * T, w = b.w * T;
          b.halo.position.set(sx, sy - h * 0.33); b.halo.width = w * 2; b.halo.height = h * 1.2; b.halo.alpha = 0.26 * breath;
          b.ray.position.set(sx, sy); b.ray.width = Math.max(0.9, T * 0.017); b.ray.height = h; b.ray.alpha = breath;
          const rise = reduced ? 0.35 : (t * 0.18 + b.rise) % 1;
          b.mote.position.set(sx, sy - h * rise); b.mote.scale.set(Math.max(0.65, T * 0.014)); b.mote.alpha = breath * (0.45 + 0.35 * Math.sin(rise * Math.PI));
        }
      }
      if (!gfx || gfx.destroyed) return;
      gfx.clear();
      for (const s of sparks) {
        const tick = reduced ? 0 : now + fh(s.k, s.n, 821) * 620, beat = Math.floor(tick / 620), age = (tick % 620) / 620;
        const x = (s.x + 0.28 + fh(s.k, beat, 823) * 0.44) * T, y = (s.y + 0.42 + fh(s.k, beat, 827) * 0.3) * T;
        const ang = fh(s.k, beat, 829) * Math.PI * 2, dx = Math.cos(ang) * T * 0.72, dy = Math.sin(ang) * T * 0.4;
        const a = reduced ? 0.8 : 0.48 + 0.42 * Math.pow(1 - age, 2);
        const path = () => {
          gfx.moveTo(x - dx * 0.5, y - dy * 0.5).lineTo(x - dx * 0.12 + dy * 0.2, y - dy * 0.12 - dx * 0.14).lineTo(x + dx * 0.14 - dy * 0.2, y + dy * 0.14 + dx * 0.12).lineTo(x + dx * 0.5, y + dy * 0.5);
          gfx.moveTo(x + dx * 0.14 - dy * 0.2, y + dy * 0.14 + dx * 0.12).lineTo(x + dx * 0.08 - dy * 0.35, y + dy * 0.08 + dx * 0.29);
        };
        path(); gfx.stroke({ color: 0x5badea, width: Math.max(px(2.5), T * 0.055), alpha: a * 0.4, cap: 'round', join: 'round' });
        path(); gfx.stroke({ color: 0xe2f6ff, width: Math.max(px(0.9), T * 0.018), alpha: a, cap: 'round', join: 'round' });
        // The air palette survives only as a few warm pinpricks at the discharge tips.
        if (s.n % 6 === 0) gfx.circle(x + dx * 0.5, y + dy * 0.5, Math.max(px(0.65), T * 0.012)).fill({ color: 0xfff1a0, alpha: a * 0.45 });
      }
    },
  };
}
