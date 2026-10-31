// The Crypt's painted stone (1.7 cryptprops.js @3c8b312, "one consistent Crypt prop set", 2026-09-17): sarcophagi
// two cells long (intact, cracked, open, lying either way), pedestals (bare or carrying a skull), and the tomb set
// pieces, all drawn pixel by pixel from one recipe at 32 px a cell in a weathered grey-violet palette lit from the
// upper left, with a 1 px dark outline. A port of csRect, csChip, csWeather, csFinish, csMotif, cpSarcophagus and
// cpPedestal, number for number; each picture is made once per kind, way and seed, and kept.

import { Texture } from '../../../forge-godot/runtime/pixi.js';
import { noise as ptValG } from '../lib/noise.js';
import { stream, next } from '../lib/rng.js';
import { mixRgb as mix } from '../lib/colour.js';

/** 1.7's mulberry32, which lib/rng.js's stream is: a draw function on its own stream. */
const mulberry32 = seed => { const st = stream(seed); return () => next(st); };

const CS = {
  edge: [64, 54, 78], gap: [24, 19, 32], cavity: [18, 14, 26], cavityLo: [32, 26, 42],
  lidTop: [134, 126, 152], lidHi: [172, 164, 190], lidLo: [102, 94, 120], recess: [112, 104, 130], relief: [162, 154, 180], reliefLo: [82, 74, 100],
  lidFront: [112, 104, 130], face: [88, 80, 104], faceLo: [66, 60, 82], plinth: [74, 68, 90], plinthLo: [56, 50, 70],
  broken: [150, 140, 160], moss: [78, 104, 52], moss2: [98, 124, 62], bone: [206, 198, 176], boneLo: [150, 142, 126],
};
const CACHE = new Map();

const buf = (W, H) => ({ W, H, c: new Array(W * H), a: new Uint8Array(W * H) });
function set(B, x, y, col) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= B.W || y >= B.H) return; B.c[y * B.W + x] = col; B.a[y * B.W + x] = 1; }
function clear(B, x, y) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= B.W || y >= B.H) return; B.a[y * B.W + x] = 0; }
const get = (B, x, y) => (x < 0 || y < 0 || x >= B.W || y >= B.H ? 0 : B.a[y * B.W + x]);
const stain = (x, y, seed) => (ptValG(x / 9, y / 9, seed) - 0.5) * 16;
const tone = (col, x, y, seed) => { const k = stain(x, y, seed); return [col[0] + k, col[1] + k, col[2] + k * 1.1]; };

/** A rectangle with worn (clipped) corners. */
function rect(B, x0, y0, w, h, colFn, wear) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const dx = Math.min(x - x0, x0 + w - 1 - x), dy = Math.min(y - y0, y0 + h - 1 - y);
    if (wear && dx + dy < wear) continue;
    set(B, x, y, colFn(x, y, x - x0, y - y0, w, h));
  }
}
/** A broad chip: a triangular bite out of an edge, its broken face catching light. */
function chip(B, cx, cy, r, dirx, diry) {
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if (Math.abs(x - cx) + Math.abs(y - cy) > r) continue;
    if ((x - cx) * dirx + (y - cy) * diry < -r * 0.2) continue;
    clear(B, x, y);
  }
  for (let y2 = cy - r - 1; y2 <= cy + r + 1; y2++) for (let x2 = cx - r - 1; x2 <= cx + r + 1; x2++) {
    if (!get(B, x2, y2)) continue;
    if (!get(B, x2 - dirx, y2 - diry) && Math.abs(x2 - cx) + Math.abs(y2 - cy) <= r + 1) set(B, x2, y2, CS.broken);
  }
}
/** Grime where water and dirt collect: under lid overhangs, in cracks and chips, along the bottom edge; moss where wettest. */
function weather(B, seed, amountK) {
  const GRIME = [54, 52, 48], MOSS = [72, 98, 50], MOSSD = [52, 74, 40];
  const W = B.W, H = B.H, wet = new Float32Array(W * H);
  const clean = new Set([CS.lidHi, CS.lidTop, CS.relief, CS.reliefLo, CS.recess, CS.bone, CS.boneLo, CS.gap, CS.cavity, CS.cavityLo]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!B.a[i]) continue;
    const here = B.c[i];
    if (y > 0 && B.a[i - W] && B.c[i - W] === CS.gap && here !== CS.gap) {
      const len = 1 + Math.floor(ptValG(x / 2.5, 3, seed + 40) * 3.2) + (ptValG(x / 1.3, 7, seed + 41) > 0.78 ? 3 + Math.floor(ptValG(x, 9, seed + 42) * 3) : 0);
      for (let k = 0; k < len && y + k < H; k++) { const j = i + k * W; if (!B.a[j] || B.c[j] === CS.gap) break; wet[j] = Math.max(wet[j], (1 - k / (len + 1)) * (0.55 + 0.45 * ptValG(x / 3, y / 3, seed + 43))); }
    }
    if (!get(B, x, y + 1) || !get(B, x, y + 2)) {
      const up = 1 + Math.floor(ptValG(x / 3, 1, seed + 44) * 3.5);
      for (let k2 = 0; k2 < up && y - k2 >= 0; k2++) { const j2 = i - k2 * W; if (!B.a[j2]) break; wet[j2] = Math.max(wet[j2], (1 - k2 / (up + 1)) * 0.8); }
    }
    if (here === CS.broken) wet[i] = Math.max(wet[i], 0.5);
  }
  for (let y2 = 0; y2 < H; y2++) for (let x2 = 0; x2 < W; x2++) {
    const i2 = y2 * W + x2;
    let w = wet[i2] * amountK;
    if (!B.a[i2] || w < 0.12) continue;
    let col = B.c[i2];
    if (col === CS.gap || col === CS.cavity || col === CS.bone || col === CS.boneLo) continue;
    if (clean.has(col) && y2 < H * 0.5) w *= 0.25;
    const k3 = Math.min(0.6, w * 0.7);
    col = [col[0] + (GRIME[0] - col[0]) * k3, col[1] + (GRIME[1] - col[1]) * k3, col[2] + (GRIME[2] - col[2]) * k3];
    if (w > 0.62 && ptValG(x2 / 2.2, y2 / 2.2, seed + 45) > 0.5) col = ptValG(x2 / 1.4, y2 / 1.4, seed + 46) > 0.5 ? MOSS : MOSSD;
    B.c[i2] = col;
  }
}
/** Outline, then pixels; a soft drop shadow down and to the right inside the box. */
function finish(B, shadow) {
  const c = document.createElement('canvas'); c.width = B.W; c.height = B.H;
  const g = c.getContext('2d'), im = g.createImageData(B.W, B.H), D = im.data;
  for (let y = 0; y < B.H; y++) for (let x = 0; x < B.W; x++) {
    const i = y * B.W + x, p = i * 4;
    if (B.a[i]) {
      let col = B.c[i];
      const out = !get(B, x - 1, y) || !get(B, x + 1, y) || !get(B, x, y - 1) || !get(B, x, y + 1);
      if (out && col !== CS.gap && col !== CS.cavity) col = CS.edge;
      D[p] = col[0]; D[p + 1] = col[1]; D[p + 2] = col[2]; D[p + 3] = 255;
    } else if (shadow && y >= shadow.y0 && y <= shadow.y1 && x >= shadow.x0 && x <= shadow.x1 && (get(B, x - 2, y - 1) || get(B, x - 1, y - 2))) {
      D[p] = 10; D[p + 1] = 8; D[p + 2] = 16; D[p + 3] = 80;
    }
  }
  g.putImageData(im, 0, 0);
  return c;
}
function motif(B, cx, cy, kind, horiz) {
  if (kind === 'cross') {
    const L = horiz ? 7 : 9, A = 3;
    if (horiz) { for (let k = -L; k <= L; k++) { set(B, cx + k, cy, CS.relief); set(B, cx + k, cy + 1, CS.reliefLo); } for (let j = -A; j <= A; j++) { set(B, cx - 3, cy + j, CS.relief); set(B, cx - 2, cy + j, CS.reliefLo); } }
    else { for (let k = -L; k <= L; k++) { set(B, cx, cy + k, CS.relief); set(B, cx + 1, cy + k, CS.reliefLo); } for (let j = -A; j <= A; j++) { set(B, cx + j, cy - 3, CS.relief); set(B, cx + j, cy - 2, CS.reliefLo); } }
  } else if (kind === 'skull') {
    for (let y = -3; y <= 2; y++) for (let x = -3; x <= 3; x++) { if (x * x / 9 + y * y / (y < 0 ? 9 : 5) > 1) continue; set(B, cx + x, cy + y, x < 0 && y < 0 ? CS.relief : mix(CS.relief, CS.recess, 0.4)); }
    set(B, cx - 1, cy, CS.reliefLo); set(B, cx + 1, cy, CS.reliefLo); set(B, cx, cy + 2, CS.reliefLo);
  } else if (kind === 'ring') {
    for (let t = 0; t < 24; t++) { const an = t / 24 * Math.PI * 2; set(B, cx + Math.round(Math.cos(an) * 4), cy + Math.round(Math.sin(an) * 3), Math.sin(an) < 0 ? CS.relief : CS.reliefLo); }
    set(B, cx, cy, CS.relief);
  }
}

/** A sarcophagus: kind intact | cracked | open; horiz east-west (2x1) or north-south (1x2). Canvas + `lift` in tiles. */
function sarcophagus(kind, horiz, seed) {
  const r = mulberry32(seed * 9973 + 17), W = horiz ? 64 : 32, H = horiz ? 44 : 74, B = buf(W, H);
  const shrink = Math.floor(r() * 4), lidT = 3 + Math.floor(r() * 2);
  const lx0 = horiz ? 3 + shrink : 3, lx1 = horiz ? 60 - shrink : 28;
  const ly0 = 8, ly1 = horiz ? 26 : 56 + (shrink > 2 ? -2 : 0);
  const faceH = 12, fx0 = lx0 + 2, fx1 = lx1 - 2, fy0 = ly1 + lidT, fy1 = fy0 + faceH;
  rect(B, fx0 - 2, fy1 - 2, fx1 - fx0 + 5, 5, (x, y, ex, ey) => tone(ey < 1 ? CS.plinth : CS.plinthLo, x, y, seed + 1), 2);
  rect(B, fx0, fy0, fx1 - fx0 + 1, faceH, (x, y, ex, ey, w, h) => { let c = mix(CS.face, CS.faceLo, ey / h); if (ex >= w - 3) c = mix(c, CS.faceLo, 0.6); return tone(c, x, y, seed + 2); }, 0);
  if (kind !== 'open') {
    for (let gx = fx0; gx <= fx1; gx++) set(B, gx, fy0, CS.gap);
    rect(B, lx0, ly1, lx1 - lx0 + 1, lidT, (x, y, ex, ey, w) => { let c = ey === 0 ? CS.lidHi : CS.lidFront; if (ex >= w - 3) c = mix(c, CS.lidLo, 0.5); return tone(c, x, y, seed + 3); }, 1);
    const rim = 4;
    rect(B, lx0, ly0, lx1 - lx0 + 1, ly1 - ly0, (x, y, ex, ey, w, h) => {
      let c = CS.lidTop;
      const inRim = ex < rim || ey < rim || ex >= w - rim || ey >= h - rim;
      if (inRim) c = ex < 2 || ey < 2 ? CS.lidHi : ex >= w - 2 || ey >= h - 2 ? CS.lidLo : CS.lidTop;
      else c = ex === rim || ey === rim ? CS.lidLo : ex === w - rim - 1 || ey === h - rim - 1 ? CS.lidHi : CS.recess;
      return tone(c, x, y, seed + 4);
    }, 3);
    motif(B, Math.round((lx0 + lx1) / 2), Math.round((ly0 + ly1) / 2), ['cross', 'skull', 'ring', 'cross'][Math.floor(r() * 4)], horiz);
    const nch = 1 + Math.floor(r() * 2) + (kind === 'cracked' ? 2 : 0);
    for (let i = 0; i < nch; i++) {
      const side = Math.floor(r() * 4), rr = 2 + Math.floor(r() * 2) + (kind === 'cracked' ? 1 : 0);
      let cx, cy, dx = 0, dy = 0;
      if (side === 0) { cx = lx0 + 4 + Math.floor(r() * (lx1 - lx0 - 8)); cy = ly0; dy = 1; }
      else if (side === 1) { cx = lx1; cy = ly0 + 4 + Math.floor(r() * (ly1 - ly0 - 8)); dx = -1; }
      else if (side === 2) { cx = lx0; cy = ly0 + 4 + Math.floor(r() * (ly1 - ly0 - 8)); dx = 1; }
      else { cx = lx0 + 4 + Math.floor(r() * (lx1 - lx0 - 8)); cy = ly1 + lidT - 1; dy = -1; }
      chip(B, cx, cy, rr, dx, dy);
    }
    if (kind === 'cracked') {
      let x = Math.round(lx0 + (lx1 - lx0) * (0.55 + r() * 0.15)), y = ly0 + 1;
      const steps = ly1 - ly0 + lidT - 1;
      for (let s2 = 0; s2 < steps; s2++) { set(B, x, y, CS.gap); set(B, x + 1, y, CS.lidHi); y++; if (r() < 0.35) x += r() < 0.5 ? 1 : -1; }
    }
  } else {
    rect(B, lx0, ly0, lx1 - lx0 + 1, ly1 - ly0 + lidT, (x, y, ex, ey, w, h) => {
      const rimW = 4, inRim = ex < rimW || ey < rimW || ex >= w - rimW || ey >= h - rimW;
      if (inRim) return tone(ex < 2 || ey < 2 ? CS.lidHi : ex >= w - 2 || ey >= h - 2 ? CS.lidLo : CS.lidTop, x, y, seed + 5);
      const depth = (ey - rimW) / (h - 2 * rimW);
      return ey === rimW || ex === rimW ? CS.cavity : mix(CS.cavity, CS.cavityLo, depth * 0.8);
    }, 3);
    const bx = Math.round(lx0 + (lx1 - lx0) * 0.35), by = Math.round(ly0 + (ly1 - ly0) * 0.55);
    if (horiz) { for (let k = 0; k < 8; k++) set(B, bx + k, by, CS.boneLo); set(B, bx - 1, by - 1, CS.bone); set(B, bx + 8, by + 1, CS.bone); set(B, bx + 3, by - 1, CS.bone); }
    else { for (let k = 0; k < 10; k++) set(B, bx, by - 5 + k, CS.boneLo); set(B, bx - 1, by - 6, CS.bone); set(B, bx + 1, by + 5, CS.bone); }
    chip(B, lx0, Math.round((ly0 + ly1) / 2), 2, 1, 0);
    const sx0 = horiz ? Math.round(lx0 + (lx1 - lx0) * 0.45) : lx0 + 5, sy0 = horiz ? ly0 - 5 : Math.round(ly0 + (ly1 - ly0) * 0.45), sy1 = horiz ? ly1 - 4 : ly1 + 2;
    let sx1 = horiz ? lx1 + 2 : lx1 + 3;
    if (sx1 >= W) sx1 = W - 1;
    for (let gx2 = sx0 + 1; gx2 <= sx1; gx2++) set(B, gx2, sy1 + lidT, CS.gap);
    rect(B, sx0, sy1, sx1 - sx0 + 1, lidT, (x, y, ex, ey) => tone(ey === 0 ? CS.lidHi : CS.lidFront, x, y, seed + 6), 1);
    rect(B, sx0, sy0, sx1 - sx0 + 1, sy1 - sy0, (x, y, ex, ey, w, h) => tone(ex < 2 || ey < 2 ? CS.lidHi : ex >= w - 2 || ey >= h - 2 ? CS.lidLo : CS.lidTop, x, y, seed + 7), 2);
    chip(B, sx0, sy0 + 2, 2, 1, 1);
  }
  // Coffin taper: narrow at the head, widest at the shoulders, narrowing to the foot.
  const prof = t => (t < 0.26 ? 0.74 + 0.26 * (t / 0.26) : 1 - 0.3 * ((t - 0.26) / 0.74));
  if (!horiz) {
    const cxm = (lx0 + lx1) / 2, half = (lx1 - lx0) / 2 + 2;
    for (let y3 = 0; y3 < H; y3++) { const t3 = Math.max(0, Math.min(1, (y3 - ly0) / Math.max(1, fy1 - ly0))), hw = half * prof(t3); for (let x3 = 0; x3 < W; x3++) if (Math.abs(x3 + 0.5 - cxm) > hw) clear(B, x3, y3); }
  } else {
    const span = ly1 - ly0;
    for (let x4 = 0; x4 < W; x4++) { const t4 = Math.max(0, Math.min(1, (x4 - lx0) / Math.max(1, lx1 - lx0))), inset = Math.round((1 - prof(t4)) * span * 0.9); for (let y4 = 0; y4 < ly0 + inset && y4 < H; y4++) clear(B, x4, y4); }
  }
  weather(B, seed, kind === 'intact' ? 0.8 : 1.2);
  const c = finish(B, { x0: 0, x1: W - 1, y0: 0, y1: H - 1 });
  c.lift = horiz ? 12 / 32 : 10 / 32;
  return c;
}

/** A pedestal: a plinth, a shaft with a recessed panel, a thick bevelled cap; top 'skull' or 'none'. */
function pedestal(top, seed) {
  const r = mulberry32(seed * 7919 + 3), W = 32, H = 48, B = buf(W, H);
  rect(B, 6, 40, 20, 6, (x, y, ex, ey) => tone(ey < 2 ? CS.lidTop : CS.plinth, x, y, seed), 2);
  rect(B, 9, 20, 14, 21, (x, y, ex, ey) => { let c = ex < 5 ? CS.lidFront : ex < 10 ? CS.face : CS.faceLo; if (ex >= 4 && ex <= 9 && ey >= 6 && ey <= 14) c = ey === 6 || ex === 4 ? CS.gap : mix(CS.faceLo, CS.face, 0.3); return tone(c, x, y, seed + 1); }, 1);
  rect(B, 6, 17, 20, 4, (x, y, ex, ey) => tone(ey === 0 ? CS.lidHi : CS.lidFront, x, y, seed + 2), 1);
  rect(B, 6, 11, 20, 6, (x, y, ex, ey, w, h) => tone(ex < 2 || ey < 2 ? CS.lidHi : ex >= w - 2 || ey >= h - 2 ? CS.lidLo : CS.lidTop, x, y, seed + 3), 2);
  for (let gx = 9; gx <= 22; gx++) set(B, gx, 21, CS.gap);
  chip(B, 6 + Math.floor(r() * 18), 11, 2, 0, 1);
  if (r() < 0.6) chip(B, 25, 30 + Math.floor(r() * 8), 2, -1, 0);
  if (top === 'skull') {
    const sx = 16, sy = 8;
    for (let y = -4; y <= 3; y++) for (let x = -4; x <= 4; x++) { if (x * x / 16 + y * y / (y < 0 ? 14 : 8) > 1) continue; set(B, sx + x, sy + y, x <= 0 && y < 0 ? CS.bone : CS.boneLo); }
    set(B, sx - 2, sy, CS.gap); set(B, sx - 1, sy, CS.gap); set(B, sx + 1, sy, CS.gap); set(B, sx + 2, sy, CS.gap); set(B, sx, sy + 2, CS.faceLo);
    for (let t = -2; t <= 2; t++) set(B, sx + t, sy + 3, t % 2 ? CS.faceLo : CS.boneLo);
  }
  weather(B, seed, 0.9);
  const c = finish(B, { x0: 0, x1: W - 1, y0: 0, y1: H - 1 });
  c.lift = 0.5;
  return c;
}

/** 1.7 CP_TOMB: the tomb set pieces drawn with the same recipe, seeded by their tile. */
const TOMBS = { 'tomb-v': ['intact', false], 'tomb-h': ['intact', true], 'tomb-rune': ['intact', false], 'tomb-crumbled-v': ['cracked', false], 'tomb-crumbled-h': ['cracked', true], 'tomb-open-h': ['open', true] };

/**
 * The painted picture for a Crypt stone piece, or null when 1.7 does not paint this prop:
 * { tex, cw, ch, lift } (footprint in cells; lift: how far the picture rises above the footprint's top, in tiles).
 */
export function cryptStone(p) {
  if (typeof document === 'undefined') return null;
  let key, make, cw = 1, ch = 1;
  if (p.id === 'sarc') { const kind = p.kind || 'intact', h = !!p.horiz; key = `S${kind}${h ? 'h' : 'v'}${p.seed || 0}`; make = () => sarcophagus(kind, h, p.seed || 0); cw = h ? 2 : 1; ch = h ? 1 : 2; }
  else if (TOMBS[p.id]) { const [kind, h] = TOMBS[p.id], seed = (p.x * 7 + p.y * 3) % 97; key = `S${kind}${h ? 'h' : 'v'}${seed}`; make = () => sarcophagus(kind, h, seed); cw = h ? 2 : 1; ch = h ? 1 : 2; }
  else if (p.id === 'pedestal') { const top = p.top || 'none'; key = `P${top}${p.seed || 0}`; make = () => pedestal(top, p.seed || 0); }
  else return null;
  let hit = CACHE.get(key);
  if (!hit) { const c = make(); hit = { tex: Texture.from({ resource: c, scaleMode: 'nearest' }), lift: c.lift ?? 0 }; CACHE.set(key, hit); }
  return { tex: hit.tex, cw, ch, lift: hit.lift };
}

