// The pictures structures.js's pieces are drawn with that are made, not read from a sheet (M10, render-28: moved out of
// structures.js): the loot's mipmapped copy, the crisp shelf, Upheaval's bare rock, the traps' spikes, leak and bell
// and the thorn door's vines.

import { Graphics, Rectangle, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { hash2 } from '../lib/noise.js';
import { anyArt, objSprite, trimmed } from './art.js';


// RC61 (1.7 render.js:201-213, 251-261, the loot copy): loot is painted at 120 px (64 on the older sheet) and lies on the
// floor at a third to a half of that, more on a phone, so the item sheets shrink through mipmaps and stay crisp and
// steady at every screen density instead of sparkling as they bob. A sheet already on the GPU without them gives up
// that copy once, and the next draw uploads it again with its mipmaps.
export function smoothLoot(tex) {
  const src = tex?.source;
  if (src && !src.autoGenerateMipmaps) { src.autoGenerateMipmaps = true; src.unload?.(); }
  return tex;
}

/**
 * 1.7 surface.js:293 drawStoneProp draws the bookshelf with smoothing off (sandbox lead 2026-10-18: soft at 4x); every
 * other prop 1.7 smooths when it is drawn smaller than its art (render.js:250 drawObjectSprite: s < 1), as the sheets'
 * linear filtering does. The shelf shares its sheet, so it draws from a copy of its frame on a nearest source of its own
 * (1.7 records it with no hand normal, so the copy needs none).
 */
const crisps = new Map();
export const crisp = tex => {
  if (!tex || typeof document === 'undefined' || !tex.source?.resource) return tex;
  let t = crisps.get(tex);
  if (!t) {
    const f = tex.frame, r = tex.source.resolution ?? 1, c = document.createElement('canvas');
    c.width = Math.round(f.width * r); c.height = Math.round(f.height * r);
    c.getContext('2d').drawImage(tex.source.resource, f.x * r, f.y * r, f.width * r, f.height * r, 0, 0, c.width, c.height);
    t = Texture.from({ resource: c, scaleMode: 'nearest', resolution: r }); t.label = tex.label; crisps.set(tex, t);
  }
  return t;
};

/**
 * WT5 (1.7 environment-props.js bareRock, cryptpack.js:158-161; Justin 2026-10-12: "go with rock A"): Upheaval's rock is
 * the mossy boulder with its moss regraded to the stone under it. A pixel is moss by its hue (yellow-green to green) and
 * how much colour it carries, fading in at a patch's edge; it keeps its own light and dark and takes the rock's tone at
 * that depth of shade (three measured tones: shadow, body, lit face). Alpha and every stone pixel are untouched. Made
 * once per picture; a picture that cannot be read back (no canvas) keeps its moss.
 */
const bare = new Map(), ROCK_TONES = [[0.0863, 0.0902, 0.1059, 0.0902], [0.2745, 0.2314, 0.2314, 0.2427], [0.649, 0.5137, 0.4039, 0.5406]];
export function bareRock(tex) {
  if (!tex || typeof document === 'undefined') return tex;
  if (bare.has(tex)) return bare.get(tex);
  let out = tex;
  try {
    const f = tex.frame, c = document.createElement('canvas'); c.width = f.width; c.height = f.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(tex.source.resource, f.x, f.y, f.width, f.height, 0, 0, f.width, f.height);
    const image = g.getImageData(0, 0, f.width, f.height), d = image.data, [lo, mid, hi] = ROCK_TONES, clamp = v => Math.max(0, Math.min(1, v));
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const r = d[i] / 255, gr = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, gr, b), span = mx - Math.min(r, gr, b);
      if (span < 1e-6) continue;
      let hue = mx === r ? (gr - b) / span : mx === gr ? 2 + (b - r) / span : 4 + (r - gr) / span; hue = ((hue * 60) % 360 + 360) % 360;
      const moss = clamp((hue - 42) / 14) * clamp((175 - hue) / 20) * clamp((span / mx - 0.16) / 0.14);
      if (moss <= 0) continue;
      const light = (0.299 * r + 0.587 * gr + 0.114 * b) * 0.8, a = light < mid[3] ? lo : mid, z = light < mid[3] ? mid : hi;
      const t = clamp((light - a[3]) / (z[3] - a[3])), gain = light > hi[3] ? light / hi[3] : light < lo[3] ? light / lo[3] : 1;
      for (let ch = 0; ch < 3; ch++) d[i + ch] = Math.round(d[i + ch] * (1 - moss) + Math.min(1, (a[ch] + (z[ch] - a[ch]) * t) * gain) * 255 * moss);
    }
    g.putImageData(image, 0, 0);
    out = Texture.from(c);
  } catch { out = tex; }
  bare.set(tex, out);
  return out;
}
/**
 * WT5 (1.7 environment-props.js fit, renderer.js:82-92): Upheaval's rock fills its tile and overlaps its neighbours, 1.38
 * of its natural size around a point 0.96 of the tile down (its foot), so a row reads as one ridge. tex: the boulder's
 * picture (the props sheet's, or the planes' own). map-view.js heaves it up out of the floor as the cast lets go.
 */
export function upheavalRock(p, tile, tex = anyArt('mossy-boulder')) {
  return tex ? objSprite(bareRock(trimmed(tex)), p.x, p.y, tile, { feet: true, fit: 0.97, scale: 1.38, anchor: 0.96 }) : null;
}

/**
 * 1.7 js/world/puzzles.js drawTrap for spikes (audit P1; the spike gauntlet and the bone gauntlet): five metal spikes
 * at hashed spots, each on a dark contact shadow, shaded dark-light-dark across, with a pale edge stroke.
 */
export function spikeTrap(t, TS) {
  const g = new Graphics(), px = t.x * TS, py = t.y * TS;
  for (let i = 0; i < 5; i++) {
    const sx = px + TS * (0.2 + 0.6 * hash2(t.x, t.y, 701 + i)), sy = py + TS * (0.25 + 0.55 * hash2(t.x, t.y, 711 + i)), h = TS * (0.12 + 0.07 * hash2(t.x, t.y, 721 + i)), w = TS * 0.045;
    g.ellipse(sx, sy, w * 1.7, w * 0.7).fill({ color: 0x151210, alpha: 0.8 });
    const tip = [sx + TS * 0.015, sy - h];
    g.poly([sx - w, sy, ...tip, sx, sy]).fill({ color: 0x8C8880 });         // 1.7's gradient #514E4B -> #C7C1B2 -> #77746C,
    g.poly([sx, sy, ...tip, sx + w, sy]).fill({ color: 0x9F9A8F });         // in two shaded halves
    g.moveTo(sx, sy - h * 0.86).lineTo(sx - w * 0.2, sy - h * 0.12).stroke({ color: 0xDED7C8, width: Math.max(0.5, TS * 0.008) });
  }
  return g;
}

/** 1.7 render.js drawCoveredTrapEmission, in a 32 px tile's units: what a trap under a prop leaks, redrawn as it pulses. */
export function trapLeak(g, now, reduced) {
  const { kind: k, x: tx, y: ty, tile: TS } = g.trapFx, u = TS / 32, px = tx * TS, py = ty * TS, t = reduced ? 0 : now / 1000;
  const H = i => hash2(tx, ty, 600 + i), pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + tx + ty * 1.7);
  const dot = (x, y, r, col, a) => { for (let s = 3; s >= 1; s--) g.circle(px + x * u, py + y * u, (r * u * s) / 3).fill({ color: col, alpha: a / 3 }); };
  g.clear();
  if (k === 'fire' || k === 'gas' || k === 'frost') {
    const col = k === 'fire' ? 0xFF7A30 : k === 'gas' ? 0x7FC05A : 0x9FD8FF;
    dot(16, 16, 9, col, 0.25 + 0.2 * pulse);
    if (!reduced) for (let w = 0; w < 3; w++) {
      const ph = (t * 0.6 + H(w)) % 1, wx = 11 + H(w + 5) * 10 + Math.sin(t * 2 + w) * 1.5, wy = 16 - ph * 14;
      g.rect(Math.round(px + wx * u), Math.round(py + wy * u), Math.ceil(2 * u), Math.ceil(2 * u)).fill({ color: k === 'frost' ? 0xE6F6FF : col, alpha: (1 - ph) * 0.8 });
    }
  } else if (k === 'spark') {
    const pts = [[17, 10], [15, 13], [18, 14], [14, 18], [16, 21]];
    g.moveTo(px + pts[0][0] * u, py + pts[0][1] * u);
    for (const [x, y] of pts.slice(1)) g.lineTo(px + x * u, py + y * u);
    g.stroke({ color: pulse > 0.75 ? 0xFFF1A8 : 0xE8B44A, width: Math.max(1.5, 1.6 * u) });
    dot(16, 16, 8, 0xE8B44A, 0.15 + 0.25 * pulse);
  } else if (k === 'dart') {
    // 2026-09-28 (Justin): a dart trap under a bush showed nothing; the steel tips of its darts glint at the prop's feet.
    for (const [bx, by, qx, qy] of [[4, 31, 2.5, 27], [9, 31.5, 8, 27.5], [23, 31.5, 24, 27.5], [28, 31, 29.5, 27]]) {
      g.ellipse(px + bx * u, py + by * u, 1.4 * u, 0.8 * u).fill({ color: 0x0C0908, alpha: 0.8 });
      g.moveTo(px + bx * u, py + (by - 0.3) * u).lineTo(px + qx * u, py + qy * u).stroke({ color: 0xA49C8E, width: Math.max(1.5, 1.4 * u), cap: 'round' });
      g.rect(px + (qx - 0.6) * u, py + (qy - 0.6) * u, 1.2 * u, 1.2 * u).fill({ color: pulse > 0.7 ? 0xFFF8EA : 0xD9D0BE });
    }
  }
}

/** 1.7 render.js drawTrapArtwork, the alarm: its hanging bell cut from the wire and posts, swaying 0.8 px of a 32 px tile. */
export function alarmBell(tex, t, tile) {
  const base = objSprite(tex, t.x, t.y, tile, { fit: 0.8, alpha: 0.9 }), cut = trimmed(tex), f = cut.frame;
  const bx = 0.405, by = 0.445, bw = 0.185, W = base.width, Hh = base.height, out = [];
  const piece = (fx, fy, fw, fh) => {
    const s = new Sprite(new Texture({ source: cut.source, frame: new Rectangle(f.x + fx * f.width, f.y + fy * f.height, fw * f.width, fh * f.height) }));
    s.position.set(base.x + fx * W, base.y + fy * Hh); s.width = fw * W; s.height = fh * Hh; s.alpha = 0.9; out.push(s);
    return s;
  };
  piece(0, 0, bx, 1); piece(bx + bw, 0, 1 - bx - bw, 1); piece(bx, 0, bw, by);
  const bell = piece(bx, by, bw, 1 - by);
  bell.bell = { x0: bell.x, u: tile / 32 };
  base.destroy();
  return out;
}

/** 1.7 render.js drawVines (audit RC50): four curling thorny stems from near the centre, leaves set along each, stirring. */
export function drawVines(g, now, reduced) {
  const { x, y, tile: TS } = g.vines, px = x * TS, py = y * TS, t = reduced ? 0 : now / 1000;
  const H = k => { let h = (x * 73856093) ^ (y * 19349663) ^ (k * 83492791); h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };   // 1.7 grassHash
  g.clear();
  for (let v = 0; v < 4; v++) {
    const ax = px + TS * (0.42 + 0.12 * H(v)), ay = py + TS * (0.48 + 0.12 * H(v + 10)), bx = px + TS * (0.05 + 0.9 * H(v + 20)), by = py + TS * (0.1 + 0.8 * H(v + 30));
    const mx = (ax + bx) / 2 + (H(v + 40) - 0.5) * TS * 0.6 + Math.sin(t * 0.8 + v) * TS * 0.02, my = (ay + by) / 2 + (H(v + 50) - 0.5) * TS * 0.6;
    g.moveTo(ax, ay).quadraticCurveTo(mx, my, bx, by).stroke({ color: 0x263021, width: Math.max(1, TS * 0.028), cap: 'round' });
    g.moveTo(ax, ay).quadraticCurveTo(mx, my, bx, by).stroke({ color: 0x556043, width: Math.max(0.5, TS * 0.012), cap: 'round' });
    for (let k = 1; k < 8; k++) {
      const q = k / 8, qx = (1 - q) * (1 - q) * ax + 2 * (1 - q) * q * mx + q * q * bx, qy = (1 - q) * (1 - q) * ay + 2 * (1 - q) * q * my + q * q * by;
      if (H(v * 10 + k + 60) < 0.85) {
        const la = Math.atan2((1 - q) * (my - ay) + q * (by - my), (1 - q) * (mx - ax) + q * (bx - mx)) + (k % 2 ? 1 : -1) * 0.9, lr = TS * (0.032 + H(v * 10 + k + 70) * 0.025);
        const cx = qx + Math.cos(la) * lr * 0.8, cy = qy + Math.sin(la) * lr * 0.8, ca = Math.cos(la), sa = Math.sin(la), pts = [];
        for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, ex = Math.cos(a) * lr, ey = Math.sin(a) * lr * 0.45; pts.push(cx + ex * ca - ey * sa, cy + ex * sa + ey * ca); }
        g.poly(pts).fill({ color: H(v * 10 + k + 80) < 0.5 ? 0x667044 : 0x46573A });
      } else {
        const th = Math.max(0.5, TS * 0.014);
        g.rect(qx - th / 2, qy - th * 1.6, th, th * 1.4).fill({ color: 0x8B8861 });
      }
    }
  }
}
