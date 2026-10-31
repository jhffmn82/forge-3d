// The spells' kit: 1.7's js/presentation/effects/fx.js set pieces on Pixi (view.pieces). The soft pieces every great
// spell is laid from (flare, rise, swirl, sweep, cone, shard, glyph, ripple, beam, pillar), the hero's spell bolts (a glowing
// head, a trail of element sparks, a blast or a static jump where it lands), the sparks they throw, a body's shudder
// (quiver), the flourish of a proc on a struck body, embers off burning ground and the spell's light (the light layer's flash),
// and, since fx-layer.js went (consolidation C9, render-01), the rings, an area cast's struck surface and the screen shake:
// the one effects layer, on one clock that runs at the game's animation speed. Looks only: nothing here reads a roll or
// writes state.
//
// 1.7 painted these each frame on a 2D canvas; here each frame lays the same stamps from a pool of sprites, in the
// same order, sizes and blends, over the light (map-view puts the layer above light.root). Positions are tiles, as in
// 1.7 (x + 0.5 is a cell's centre); one tile is view.tile map pixels. Times are ms on the effects clock, which runs at
// the game's animation speed. A piece's `at` is a delay from now (1.7: a cast lets go 240 ms after it is chosen).

import { Container, Graphics, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { TRAIL } from '../data/palette.js';
import { createAuras } from './auras.js';
import { stampTexture } from './stamps.js';
import { hash2 } from '../lib/noise.js';

const trailOf = (type, fallback = 'phys') => (Object.hasOwn(TRAIL, type) ? TRAIL[type] : TRAIL[fallback]);


/** '#RRGGBB' or 'rgba(r,g,b,a)' as a colour number and an alpha. */
function colour(s) {
  if (typeof s === 'number') return { n: s, a: 1 };
  if (s[0] === '#') return { n: parseInt(s.slice(1), 16), a: 1 };
  const m = s.match(/[\d.]+/g).map(Number);
  return { n: (m[0] << 16) | (m[1] << 8) | m[2], a: m[3] ?? 1 };
}
const COLOURS = new Map();
const col = s => { let c = COLOURS.get(s); if (!c) { c = colour(s); COLOURS.set(s, c); } return c; };

const stamp = (name, c = '#FFFFFF') => ({ t: stampTexture(name), c: col(c).n });

/** A pool of sprites laid afresh each frame, in draw order. */
function spritePool(parent) {
  const list = []; let i = 0;
  return {
    begin() { i = 0; },
    next(tex) {
      let s = list[i];
      if (!s) { s = new Sprite(tex); parent.addChild(s); list.push(s); }
      i++; s.texture = tex; s.visible = true; return s;
    },
    end() { for (let k = i; k < list.length; k++) list[k].visible = false; },
    destroy() { for (const s of list) s.destroy(); list.length = 0; },
  };
}

/**
 * @param {any} view the map view (tile, lightLayer, seenTile)
 * @param {any} clock the animation clock (speed, reduced, onFrame)
 */
export function createPieces(view, clock) {
  const root = new Container(), below = new Container(), lines = new Graphics(), above = new Container(), rings = new Graphics();
  lines.blendMode = 'add';
  root.addChild(below, rings, lines, above);
  // WC5: what lies on the ground (the struck tiles of an area cast), under the bodies and the light (main.js places it).
  const under = new Container();
  under.eventMode = 'none';
  let ringList = [], shake = 0, shakeX = 0, shakeY = 0, carry = 0, shakeHooked = false;
  const STEP = 1000 / 30;   // 1.7's effects step: shake samples come at 30 a second
  const pool = spritePool(below), parts = spritePool(above);
  let pieces = [], particles = [], now = 0, quivers = [], emberCarry = 0;
  const reduced = () => !!clock.reduced;
  const auras = createAuras();   // FX29, FX30: the long buffs on the hero (auras.js)

  // ---- one frame's drawing: ctx.drawImage and fxLay (1.7 fx.js:810) on pooled sprites
  let P = pool, T = 64;
  const img = (st, x, y, w, h, a, add) => {
    if (!(a > 0.004) || !(w > 0) || !(h > 0)) return;
    const s = P.next(st.t);
    s.anchor.set(0, 0); s.rotation = 0; s.position.set(x, y); s.width = w; s.height = h;
    s.alpha = Math.min(1, a); s.tint = st.c; s.blendMode = add ? 'add' : 'normal';
  };
  const lay = (st, x, y, ang, len, wide, foot, a, add) => {
    if (!(a > 0.004) || !(len > 0) || !(wide > 0)) return;
    const s = P.next(st.t);
    s.anchor.set(0.5, foot ? 1 : 0.5); s.rotation = ang + Math.PI / 2; s.position.set(x, y); s.width = wide; s.height = len;
    s.alpha = Math.min(1, a); s.tint = st.c; s.blendMode = add ? 'add' : 'normal';
  };
  const seen = (x, y) => (view.seenTile ? view.seenTile(x, y) : true);

  // ---- particles (1.7 particle, burst, explosionFx, sparkleFx): squares that drift, shrink and fade
  function particle(x, y, o) {
    if (reduced()) return;
    if (particles.length > 900) particles.shift();
    const c = col(o.col || '#FFF');
    particles.push({ x, y, vx: o.vx || 0, vy: o.vy || 0, life: o.life || 400, max: o.life || 400, c: c.n, a: c.a, size: o.size || 2, grav: o.grav || 0, glow: !!o.glow, shrink: o.shrink !== false });
  }
  function burst(tx, ty, type, n = 14, spread = 0.06) {
    const t = trailOf(type);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * spread;
      particle(tx + 0.5, ty + 0.5, { vx: Math.cos(a) * s, vy: Math.sin(a) * s + (t.drift || 0) * 4, life: t.life * (0.6 + Math.random() * 0.8), col: t.col[Math.floor(Math.random() * t.col.length)], size: t.size * (0.7 + Math.random() * 0.8), glow: !!t.glow, grav: type === 'earth' ? 0.0006 : 0 });
    }
  }
  function explosion(x, y) {
    burst(x, y, 'fire', 46, 0.14); burst(x, y, 'earth', 18, 0.1);
    for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28; particle(x + 0.5, y + 0.5, { vx: Math.cos(a) * 0.03, vy: Math.sin(a) * 0.03 - 0.01, life: 900, col: 'rgba(60,55,50,0.7)', size: 6 + Math.random() * 6, shrink: false }); }
    fx.shake(10);
  }

  // ---- the pieces' painters, each a port of its branch of 1.7 drawFX (fx.js:298-668)
  const PAINT = {
    flare(f, p) {
      const cx = (f.x + 0.5) * T, cy = (f.y + 0.45) * T, size = T * (f.size || 0.6) * (7 + 10 * p) / 12;
      img(stamp('puff', f.col), cx - size, cy - size, size * 2, size * 2, 0.75 * (1 - p) * (1 - p), true);
      if (f.heart && p < 0.5) img(stamp('puff', '#FFF8E4'), cx - size * 0.45, cy - size * 0.45, size * 0.9, size * 0.9, 0.55 * (1 - p / 0.5), true);
    },
    rise(f, p, wave) {
      const cx = (f.x + 0.5) * T, cy = (f.y + 0.88) * T, mote = stamp('puff', f.col), pale = stamp('puff', '#FFF8E4'), wisp = stamp('wisp', f.col), span = f.spread * T, high = f.height * T, pool = span * (1.2 + 0.8 * Math.min(1, p * 3));
      img(mote, cx - pool, cy - pool * 0.4, pool * 2, pool * 0.8, 0.4 * Math.sin(Math.min(1, p * 1.35) * Math.PI), true);
      if (f.body) {
        const stand = Math.sin(Math.min(1, p * 1.12) * Math.PI), grow = 1 - Math.pow(1 - Math.min(1, p / 0.22), 2), n = Math.max(4, Math.ceil(high / (T * 0.28)));
        for (let b = 0; b < n; b++) {
          const at = (b + 0.5) / n, bw = span * f.body * (1.3 - 0.9 * at) * (1 + 0.2 * Math.sin(wave / 120 + b * 1.7 + f.seed)), sway = Math.sin(wave / 210 + b * 0.9 + f.seed) * T * 0.09 * at, by = cy - high * at * grow;
          img(mote, cx + sway - bw, by - bw * 1.3, bw * 2, bw * 2.6, 0.36 * stand * (1 - 0.55 * at), true);
          img(pale, cx + sway * 0.6 - bw * 0.4, by - bw, bw * 0.8, bw * 2, 0.3 * stand * (1 - at), true);
        }
      }
      for (let w = 0; w < f.wisps; w++) {
        const u = (p - 0.3 * hash2(w, f.seed, 441)) / 0.7; if (u <= 0 || u >= 1) continue;
        const wx = cx + (hash2(w, f.seed, 442) - 0.5) * span * 1.5 + Math.sin(wave / 520 + w * 2.2) * T * 0.05, ww = T * (0.2 + 0.14 * hash2(w, f.seed, 443));
        img(wisp, wx - ww / 2, cy - high * (0.15 + 0.7 * u) - ww * 1.7, ww, ww * 3.4, 0.36 * Math.sin(u * Math.PI), true);
      }
      for (let m = 0; m < f.n; m++) {
        const v = (p - 0.42 * hash2(m, f.seed, 444)) / 0.58; if (v <= 0 || v >= 1) continue;
        const up = 1 - Math.pow(1 - v, 1.8), ms = T * (0.11 + 0.14 * hash2(m, f.seed, 447)) * (1 - 0.4 * v);
        const mx = cx + (hash2(m, f.seed, 445) - 0.5) * span * 2 * (1 - 0.3 * up) + Math.sin(wave / 380 + m * 1.7) * T * 0.07 * up, my = cy - high * up * (0.55 + 0.45 * hash2(m, f.seed, 446));
        img(mote, mx - ms, my - ms, ms * 2, ms * 2, 0.8 * Math.min(1, v * 5) * (1 - v), true);
        if (m % 3 === 0) img(pale, mx - ms * 0.4, my - ms * 0.4, ms * 0.8, ms * 0.8, 0.7 * Math.min(1, v * 5) * (1 - v), true);
      }
    },
    swirl(f, p) {
      const cx = (f.x + 0.5) * T, cy = (f.y + 0.55) * T, mote = stamp('puff', f.col), pale = stamp('puff', '#FFF8E4'), tail = stamp('wisp', f.col), reach = f.r * T;
      const heart = f.inward ? p * p * Math.min(1, (1 - p) / 0.12) : (1 - p) * (1 - p) * Math.min(1, p / 0.06), glow = T * Math.min(1.1, 0.3 + 0.22 * f.r) * (f.inward ? 0.5 + 0.7 * p : 0.7 + 0.6 * p);
      img(mote, cx - glow, cy - glow * 0.8, glow * 2, glow * 1.6, 0.6 * heart, true);
      img(pale, cx - glow * 0.4, cy - glow * 0.32, glow * 0.8, glow * 0.64, 0.5 * heart, true);
      for (let m = 0; m < f.n; m++) {
        const u = (p - 0.35 * hash2(m, f.seed, 501)) / 0.65; if (u <= 0 || u >= 1) continue;
        const go = f.inward ? u * u : 1 - (1 - u) * (1 - u), bk = Math.max(0, go - 0.07), lane = reach * (0.55 + 0.45 * hash2(m, f.seed, 502)), spin = (0.7 + 0.4 * hash2(m, f.seed, 503)) * Math.PI * 2 * f.way, a0 = m / f.n * Math.PI * 2 + hash2(m, f.seed, 504);
        const r1 = lane * (f.inward ? 1 - 0.95 * go : 0.06 + 0.94 * go), r0 = lane * (f.inward ? 1 - 0.95 * bk : 0.06 + 0.94 * bk);
        const x1 = cx + Math.cos(a0 + spin * go) * r1, y1 = cy + Math.sin(a0 + spin * go) * r1 * 0.72, x0 = cx + Math.cos(a0 + spin * bk) * r0, y0 = cy + Math.sin(a0 + spin * bk) * r0 * 0.72;
        const show = f.inward ? Math.min(1, u * 4) * Math.min(1, (1 - u) * 5) : Math.min(1, u * 6) * (1 - u), sz = T * (0.1 + 0.1 * hash2(m, f.seed, 505));
        lay(tail, (x0 + x1) / 2, (y0 + y1) / 2, Math.atan2(y1 - y0, x1 - x0), Math.max(T * 0.3, Math.hypot(x1 - x0, y1 - y0) * 2.4), T * 0.13, false, 0.5 * show, true);
        img(m % 3 ? mote : pale, x1 - sz, y1 - sz, sz * 2, sz * 2, 0.9 * show, true);
      }
    },
    sweep(f, p, wave) {
      const ax = (f.ax + 0.5) * T, ay = (f.ay + 0.5) * T, bx = (f.bx + 0.5) * T, by = (f.by + 0.5) * T, ang = Math.atan2(by - ay, bx - ax), wide = f.w * T;
      const head = 1 - Math.pow(1 - Math.min(1, p / 0.55), 2.2), body = stamp('puff', f.col), line = stamp('wisp', f.col);
      let tail = Math.max(0, (p - 0.28) / 0.72); tail = tail * tail * (3 - 2 * tail);
      for (let k = 0; k < f.n; k++) {
        const at = (k + 0.5) / f.n; if (at > head) continue;
        const live = Math.max(0, Math.min(1, (at - tail) / 0.2)) * (0.4 + 0.6 * Math.max(0, 1 - (head - at) * 1.4)); if (live <= 0) continue;
        const side = (hash2(k, f.seed, 511) - 0.5) * wide * 0.5 + Math.sin(wave / 240 + k * 1.7) * wide * 0.08, sz = wide * (0.7 + 0.5 * hash2(k, f.seed, 512));
        img(body, ax + (bx - ax) * at - Math.sin(ang) * side - sz, ay + (by - ay) * at + Math.cos(ang) * side - sz, sz * 2, sz * 2, 0.36 * live, true);
      }
      const hx = ax + (bx - ax) * head, hy = ay + (by - ay) * head, glow = p < 0.55 ? 1 : Math.max(0, 1 - (p - 0.55) / 0.3), long = Math.min(T * 1.6, Math.hypot(bx - ax, by - ay) * head);
      if (long > 2) for (let s = 0; s < 3; s++) {
        const lag = long * (0.5 + s * 0.12), out = (s - 1) * wide * 0.22;
        lay(line, hx - Math.cos(ang) * lag - Math.sin(ang) * out, hy - Math.sin(ang) * lag + Math.cos(ang) * out, ang, long, Math.min(wide * 0.4, long * 0.5), false, 0.5 * glow * (1 - s * 0.2), true);
      }
      img(body, hx - wide * 0.9, hy - wide * 0.9, wide * 1.8, wide * 1.8, 0.8 * glow, true);
      img(stamp('puff', '#FFF8E4'), hx - wide * 0.35, hy - wide * 0.35, wide * 0.7, wide * 0.7, 0.7 * glow, true);
    },
    cone(f, p, wave) {
      const cx = (f.x + 0.5) * T, cy = (f.y + 0.55) * T, far = f.r * T * (1 - Math.pow(1 - Math.min(1, p / 0.72), 2.2)), mist = stamp('puff', f.col), pale = stamp('puff', '#FFFFFF'), streak = stamp('wisp', f.col);
      let fade = p < 0.5 ? 1 : Math.max(0, 1 - (p - 0.5) / 0.5); fade = fade * fade * (3 - 2 * fade);
      for (let row = 2; row >= 0; row--) {
        // row 0 is the crest, laid as light; the two behind it are the cloud, laid as substance and slower to follow
        const back = far * (1 - row * 0.3), arc = Math.max(3, Math.round((5 + f.r * 1.1) * (1 - row * 0.22)));
        for (let b = 0; b < arc; b++) {
          const turn = f.dir + f.spread * ((b + 0.5) / arc * 2 - 1) * 0.9 + (hash2(b, row + f.seed, 521) - 0.5) * 0.14, reach = back * (0.88 + 0.2 * hash2(b, row + f.seed, 522)) + Math.sin(wave / 330 + b * 1.3 + row) * T * 0.05;
          const size = Math.max(T * 0.26, back * f.spread / arc * 2) * (0.8 + 0.5 * hash2(b, row + f.seed, 523)), nx = cx + Math.cos(turn) * reach, ny = cy + Math.sin(turn) * reach;
          img(mist, nx - size, ny - size, size * 2, size * 2, (row ? 0.2 - row * 0.04 : 0.3) * fade * Math.min(1, p * 10), !row);
          if (!row && b % 3 === 1) img(pale, nx - size * 0.25, ny - size * 0.25, size * 0.5, size * 0.5, 0.45 * fade * Math.min(1, p * 10), true);
        }
      }
      for (let s = 0; s < 5; s++) {
        const sa = f.dir + f.spread * (s / 4 * 2 - 1) * 0.75 + (hash2(s, f.seed, 524) - 0.5) * 0.1, sl = far * (0.5 + 0.25 * hash2(s, f.seed, 525)), sd = far * (0.5 + 0.15 * hash2(s, f.seed, 526));
        lay(streak, cx + Math.cos(sa) * sd, cy + Math.sin(sa) * sd, sa, sl, Math.max(T * 0.14, sl * 0.2), false, 0.3 * fade * Math.min(1, far / (T * 0.6)), true);
      }
      if (p < 0.3) img(mist, cx + Math.cos(f.dir) * T * 0.3 - T * 0.5, cy + Math.sin(f.dir) * T * 0.3 - T * 0.5, T, T, 0.5 * (1 - p / 0.3), true);
    },
    shard(f, p) {
      const cx = (f.x + 0.5) * T, cy = (f.y + 0.66) * T, spike = stamp('shard', f.col), pale = stamp('shard', '#FFFFFF'), pool = f.r * T * (0.7 + 0.4 * Math.min(1, p * 3));
      img(stamp('puff', f.col), cx - pool, cy - pool * 0.6, pool * 2, pool * 1.2, 0.3 * Math.sin(Math.min(1, p * 1.3) * Math.PI), true);
      for (let s = 0; s < f.n; s++) {
        const wait = 0.26 * s / f.n + 0.06 * hash2(s, f.seed, 531), q = (p - wait) / (1 - wait); if (q <= 0) continue;
        const grow = q < 0.2 ? 1 - Math.pow(1 - q / 0.2, 3) : 1, sink = q < 0.58 ? 1 : Math.max(0, 1 - (q - 0.58) / 0.42);
        const turn = Math.PI + (s + 0.5) / f.n * Math.PI * 2 + (hash2(s, f.seed, 532) - 0.5) * 0.7, foot = f.r * T * (0.1 + 0.5 * hash2(s, f.seed, 533)), x0 = cx + Math.cos(turn) * foot, y0 = cy + Math.sin(turn) * foot * 0.6;
        // each leans out the way it lies and up off the floor; one that points at the eye is seen short
        const dx = Math.cos(turn), dy = Math.sin(turn) * 0.45 - 0.75, len = f.r * T * (0.34 + 0.4 * hash2(s, f.seed, 534)) * (0.5 + 0.4 * Math.hypot(dx, dy)) * grow * (0.7 + 0.3 * sink), wide = len * (0.26 + 0.14 * hash2(s, f.seed, 535));
        lay(spike, x0, y0, Math.atan2(dy, dx), len, wide, true, 0.88 * sink, false);
        if (s % 2 === 0 && q < 0.5) lay(pale, x0, y0, Math.atan2(dy, dx), len * 0.85, wide * 0.4, true, 0.6 * Math.sin(q / 0.5 * Math.PI), true);
      }
    },
    glyph(f, p, wave) {
      // a seal on the floor: tipped flat as the floor is seen (1.7 scaled the canvas to half height), so each stroke is
      // laid in the flat plane and its point squashed by half
      const cx = (f.x + 0.5) * T, cy = (f.y + 0.86) * T, size = f.size * T, open = 1 - Math.pow(1 - Math.min(1, p / 0.3), 2.6);
      let vis = p < 0.12 ? p / 0.12 : p < 0.62 ? 1 : Math.max(0, 1 - (p - 0.62) / 0.38); vis = vis * vis * (3 - 2 * vis);
      const stroke = stamp('wisp', f.col), pale = stamp('wisp', '#FFF8E4'), turn = (reduced() ? 0 : p) * 0.5 + f.seed;
      img(stamp('puff', f.col), cx - size * 1.25, cy - size * 0.625, size * 2.5, size * 1.25, 0.36 * vis, true);
      const flat = (x, y, ang, len, wide, a, st) => {
        // a stroke in the floor plane: its direction squashed, its length kept along that squashed direction
        const dx = Math.cos(ang), dy = Math.sin(ang) * 0.5, k = Math.hypot(dx, dy);
        lay(st, cx + x, cy + y * 0.5, Math.atan2(dy, dx), len * k, wide * (0.5 + 0.5 * Math.abs(dx) / (k || 1)), false, a, true);
      };
      for (let s = 0; s < 12; s++) {
        const a = turn + s / 12 * Math.PI * 2 + (hash2(s, f.seed, 541) - 0.5) * 0.16, long = size * open * (0.5 + 0.42 * hash2(s, f.seed, 542)) * (s % 3 ? 1 : 1.12), mid = size * 0.2 * open + long / 2;
        flat(Math.cos(a) * mid, Math.sin(a) * mid, a, long, size * (0.16 + 0.1 * hash2(s, f.seed, 543)), vis * (0.42 + 0.2 * Math.sin(wave / 260 + s * 1.9)), s % 4 ? stroke : pale);
      }
      for (let r = 0; r < 8; r++) {
        const b = r / 8 * Math.PI * 2 - turn * 1.6 + (hash2(r, f.seed, 544) - 0.5) * 0.3, at = size * open * (0.5 + 0.1 * hash2(r, f.seed, 545));
        flat(Math.cos(b) * at, Math.sin(b) * at, b + Math.PI / 2, size * 0.5 * open, size * 0.14, vis * 0.4, stroke);
      }
      for (let m = 0; m < 4; m++) {
        const up = (p * 1.3 + hash2(m, f.seed, 546)) % 1, ms = T * (0.06 + 0.03 * hash2(m, f.seed, 547));
        img(stamp('puff', '#FFF8E4'), cx + (hash2(m, f.seed, 548) - 0.5) * size * 1.5 - ms, cy - up * T * 0.75 - ms, ms * 2, ms * 2, 0.6 * vis * Math.sin(up * Math.PI), true);
      }
    },
    ripple(f, p) {
      // a swell of light, not a circle: a feathered band, and along its crest soft uneven pieces that drift. It lies on
      // ground the hero can see (a mask of the seen cells, made when it starts), so it ends where sight ends.
      const rx = (f.x + 0.5) * T, ry = (f.y + 0.6) * T, gap = 0.16, crest = stamp('puff', f.col), spark = stamp('puff', '#FFFFFF');
      for (let ring = 0; ring < f.rings; ring++) {
        const q = (p - ring * gap) / (1 - gap * (f.rings - 1)); if (q <= 0 || q >= 1) continue;
        const reach = f.r * T * (1 - Math.pow(1 - q, 2.4)), fade = (1 - q) * (ring ? 0.6 : 1), band = T * (1.3 * (1 - q) + 0.55), inner = Math.max(0, reach - band), outer = reach + band * 0.7;
        img(stamp('ring' + Math.min(9, Math.round(inner / outer * 10)), f.col), rx - outer, ry - outer, outer * 2, outer * 2, 0.3 * fade, true);
        const count = Math.min(44, Math.round(14 + reach / T * 4.5));
        for (let b = 0; b < count; b++) {
          const turnBy = b / count * Math.PI * 2 + ring * 0.7 + hash2(b, ring, 91) * 0.5, lift = reach * (1 + 0.05 * Math.sin(turnBy * 5 + now / 420 + ring * 2) + 0.035 * (hash2(b, ring, 92) - 0.5));
          const size = T * (0.34 + 0.42 * hash2(b, ring, 93)) * (1 - q * 0.35), bx = rx + Math.cos(turnBy) * lift, by = ry + Math.sin(turnBy) * lift;
          img(crest, bx - size, by - size, size * 2, size * 2, fade * (0.2 + 0.34 * hash2(b, ring, 94)), true);
          if (!f.plain && hash2(b, ring, 95) < 0.3) img(spark, bx - size * 0.22, by - size * 0.22, size * 0.44, size * 0.44, fade * 0.55, true);
        }
      }
    },
    beam(f, p, wave) {
      // 1.7 fx.js:633-660: one shaft of soft light along the aim, a glow on every struck cell in view and a bright heart
      // down the middle; it runs out from the caster's end, swells, then thins away from that end.
      const b = f.shape, glowS = stamp('puff', f.col), heartS = stamp('wisp', '#FFFBEA'), moteS = stamp('puff', '#FFFBEA');
      const slant = Math.atan2(b.uy, b.ux), live = t => Math.min(1, Math.max(0, (p - t * 0.26) / 0.16)) * Math.max(0, Math.min(1, (1 - p - (1 - t) * 0.14) / 0.42));
      for (let i = 0; i < f.tiles.length; i++) {
        const [tx, ty] = f.tiles[i]; if (!seen(tx, ty)) continue;
        const dx = tx - b.ox, dy = ty - b.oy, along = Math.max(0, Math.min(1, (dx * b.ux + dy * b.uy) / b.len)), across = Math.abs(dx * b.uy - dy * b.ux), l = live(along); if (l <= 0) continue;
        const bx = (tx + 0.5) * T, by = (ty + 0.5) * T, swell = 1 + 0.08 * Math.sin(wave / 110 + i * 1.3), wide = T * (1.25 + 0.25 * hash2(i, tx, ty)) * swell;
        lay(glowS, bx, by, slant, b.lone ? wide : T * 2.2, wide, false, 0.44 * l * (1 - 0.45 * Math.min(1, across / (b.half + 0.6))), true);
        const side = (hash2(i, tx, ty + 7) - 0.5) * T * 0.8, drift = p * T * (0.2 + 0.4 * hash2(i, 3, tx)), ms = T * (0.06 + 0.06 * hash2(4, i, ty));
        img(moteS, bx - Math.sin(slant) * side - ms, by + Math.cos(slant) * side - drift - ms, ms * 2, ms * 2, 0.6 * l * (0.5 + 0.5 * Math.sin(wave / 70 + i * 2.1)), true);
      }
      for (let s = b.first; s <= b.len + 0.3; s += 0.55) {
        const hx = b.ox + b.ux * s, hy = b.oy + b.uy * s, cx = Math.round(hx), cy = Math.round(hy);
        if (!b.cells.has(cx + ',' + cy) || !seen(cx, cy)) continue;
        const hl = live(Math.min(1, s / b.len)); if (hl <= 0) continue;
        const hw = T * (0.5 + 0.32 * b.half) * (1 + 0.1 * Math.sin(wave / 90 + s * 2.3) + 0.3 * (1 - Math.min(1, p / 0.2)));
        lay(glowS, (hx + 0.5) * T, (hy + 0.5) * T, slant, T * 1.5, hw * 1.5, false, 0.5 * hl, true);
        lay(heartS, (hx + 0.5) * T, (hy + 0.5) * T, slant, T * 1.7, hw, false, 0.95 * hl, true);
      }
    },
    bolt(f, p) {
      // 1.7 fx.js:589-632: a spell bolt eases in and out, an arrow or lightning flies straight; a trail of the element's
      // sparks, a soft glow round the head and a bright core
      const ease = f.arrow || f.type === 'lightning' ? p : p * p * (3 - 2 * p) * 0.35 + p * 0.65, cx = f.ax + (f.bx - f.ax) * ease, cy = f.ay + (f.by - f.ay) * ease, t = trailOf(f.type);
      if (f.arrow) {
        // FX6 (1.7 fx.js:595-615): a light streak behind the point, the drawn arrow along the flight, and pale motes shed
        const ang = Math.atan2(f.by - f.ay, f.bx - f.ax), hx = (cx + 0.5) * T, hy = (cy + 0.5) * T, tail = T * 1.25;
        lay(stamp('streak'), hx - Math.cos(ang) * tail / 2, hy - Math.sin(ang) * tail / 2, ang, tail, Math.max(1.5, T * 0.07), false, 1, true);
        const a = stamp('arrow'), L = T * 0.55;
        lay(a, hx, hy, ang, L, L * a.t.width / a.t.height, false, 1, false);
        f.emit += f.dt / 33.3 * 2;
        while (f.emit >= 1) { f.emit--; particle(cx + 0.5 - Math.cos(ang) * 0.25, cy + 0.5 - Math.sin(ang) * 0.25, { vx: -Math.cos(ang) * 0.01, vy: -Math.sin(ang) * 0.01, life: 150 + Math.random() * 90, col: 'rgba(255,244,210,.65)', size: 1.3, glow: true }); }
      } else if (f.type === 'lightning') { discharge(f, p, ease); f.emit += f.dt / 33.3 * 2; while (f.emit >= 1) { f.emit--; particle(cx + 0.5, cy + 0.5, { vx: (Math.random() - 0.5) * 0.03, vy: (Math.random() - 0.5) * 0.03, life: 160, col: '#FFE45C', size: 1.6, glow: true }); } }
      else {
        f.emit += f.dt / 33.3 * Math.ceil(t.rate * 2);
        while (f.emit >= 1) {
          f.emit--;
          particle(cx + 0.5 + (Math.random() - 0.5) * 0.15, cy + 0.5 + (Math.random() - 0.5) * 0.15, { vx: (Math.random() - 0.5) * 0.006, vy: (Math.random() - 0.5) * 0.006 + (t.drift || 0), life: t.life * (0.5 + Math.random() * 0.6), col: t.col[Math.floor(Math.random() * t.col.length)], size: t.size * (0.6 + Math.random() * 0.7), glow: !!t.glow });
        }
        const hx = (cx + 0.5) * T, hy = (cy + 0.5) * T, g = t.glow || t.col[0];
        img(stamp('glow', g), hx - T * 0.42, hy - T * 0.42, T * 0.84, T * 0.84, 0.9, true);
        img(stamp('dot', t.col[0]), hx - T * 0.09, hy - T * 0.09, T * 0.18, T * 0.18, 1, true);
      }
      // its light, from the moment it leaves; an arrow carries none (1.7 render.js:1563; item 138, Justin 2026-10-17: "arrows
      // make a flash of light when they hit")
      if (f.trail === undefined) f.trail = f.arrow ? null : view.lightLayer?.trail(f.glow) ?? null;
      f.trail?.move((cx + 0.5) * T, (cy + 0.5) * T);
    },
    arc(f, p) { discharge(f, p, 1); },
    pillar(f, p, wave) {
      // 1.7 fx.js:234-283: light called down from above the view onto a tile. A ray (Dawn) blooms in slowly, leans as
      // sunlight does, widens toward the ground and has dust drifting down it; a strike (Storm Form) falls in its first
      // fifth, stands and thins, soft pieces that sway with brighter wisps climbing it. Each leaves a pool where it lands.
      const cx = (f.x + 0.5) * T, base = (f.y + 0.92) * T, top = (view.camera?.y ?? base) - (view.screenH || 800) / 2 / (view.scale || 1) - T * 2;
      if (f.ray) {
        const lean = 0.13, warm = stamp('puff', f.col), cream = stamp('puff', '#FFF8E4'), span = Math.max(T, base - top), n = Math.max(4, Math.ceil(span / (T * 0.5)));
        let seen = p < 0.24 ? p / 0.24 : p < 0.68 ? 1 : Math.max(0, 1 - (p - 0.68) / 0.32); seen = seen * seen * (3 - 2 * seen);
        for (let k = 0; k < n; k++) {
          const y = base - (k + 0.5) * span / n, down = (y - top) / span, x = cx - (base - y) * lean, w = T * f.w * (0.5 + 0.62 * down) * (1 + 0.035 * Math.sin(wave / 1100 + k * 0.7));
          img(warm, x - w, y - w * 1.7, w * 2, w * 3.4, 0.15 * seen, true);
          img(cream, x - w * 0.5, y - w * 1.5, w, w * 3, 0.1 * seen, true);
        }
        for (let m = 0; m < 16; m++) {
          const drift = (wave / 3200 + m / 16 + hash2(m, f.x, 61)) % 1, my = top + span * drift, mw = T * f.w * (0.5 + 0.62 * (my - top) / span);
          const mx = cx - (base - my) * lean + (hash2(m, f.y, 62) - 0.5) * mw * 1.3 + Math.sin(wave / 1700 + m) * T * 0.04, ms = T * (0.05 + 0.06 * hash2(m, 3, 63));
          img(cream, mx - ms, my - ms, ms * 2, ms * 2, 0.7 * seen * Math.sin(drift * Math.PI), true);
        }
        const pool = T * f.w * 1.9;
        img(warm, cx - pool, base - pool * 0.45, pool * 2, pool * 0.9, 0.42 * seen, true);
        img(cream, cx - pool * 0.5, base - pool * 0.2, pool, pool * 0.4, 0.3 * seen, true);
        return;
      }
      const fall = Math.min(1, p / 0.18), stand = p < 0.6 ? 1 : Math.max(0, 1 - (p - 0.6) / 0.4), swell = Math.min(1, Math.max(0, (p - 0.08) / 0.18)), bottom = top + (base - top) * fall;
      const body = stamp('puff', f.col), core = stamp('puff', '#FFFFFF'), wisp = stamp('wisp', f.col), span = bottom - top, n = Math.max(3, Math.ceil(span / (T * 0.42)));
      for (let k = 0; k < n; k++) {
        const y = bottom - (k + 0.5) * span / n, sway = Math.sin(wave / 310 + k * 0.83 + f.x) * T * 0.06 * (1 + k * 0.05);
        const wide = T * f.w * (1.15 + 0.3 * Math.sin(wave / 230 + k * 1.9)) * (0.25 + 0.75 * swell) * (0.35 + 0.65 * stand);
        img(body, cx + sway - wide, y - wide * 1.5, wide * 2, wide * 3, 0.2 * stand, true);
        img(core, cx + sway * 0.6 - wide * 0.34, y - wide * 1.3, wide * 0.68, wide * 2.6, 0.34 * stand, true);
      }
      if (p > 0.12) {
        for (let s = 0; s < 7; s++) {
          const rise = (wave / 820 + s / 7 + hash2(s, f.x, 57)) % 1, sy = base - (base - top) * 0.75 * rise, sx = cx + Math.sin(wave / 400 + s * 2.4) * T * f.w * 0.3, sw = T * f.w * (0.34 + 0.2 * hash2(s, f.y, 58));
          img(wisp, sx - sw / 2, sy - sw * 1.9, sw, sw * 3.8, 0.5 * stand * Math.sin(rise * Math.PI), true);
        }
        const pool = T * (1.0 + 1.7 * swell);
        img(body, cx - pool, base - pool * 0.5, pool * 2, pool, 0.5 * stand, true);
        img(core, cx - pool * 0.45, base - pool * 0.22, pool * 0.9, pool * 0.44, 0.6 * stand, true);
      }
    },
    splash(f, p) {
      // 1.7 fx.js:523-541: drops leave the centre together, arc, and land as pools that spread a little and soak away
      const sx0 = (f.x + 0.5) * T, sy0 = (f.y + 0.6) * T, drop = stamp('puff', f.col), shine = stamp('puff', '#F1FFD8');
      if (p < 0.3) { const gush = T * (0.5 + 2.4 * p); img(drop, sx0 - gush, sy0 - gush * 0.7, gush * 2, gush * 1.4, 0.7 * (1 - p / 0.3), true); }
      for (let d = 0; d < 22; d++) {
        const aim = d / 22 * Math.PI * 2 + hash2(d, f.seed, 421) * 0.6, far = f.r * T * (0.35 + 0.65 * hash2(d, f.seed, 422)), flight = 0.3 + 0.16 * hash2(d, f.seed, 423);
        const lx = sx0 + Math.cos(aim) * far, ly = sy0 + Math.sin(aim) * far * 0.78, big = T * (0.16 + 0.2 * hash2(d, f.seed, 424));
        if (p < flight) {
          const u = p / flight, hx = sx0 + (lx - sx0) * u, hy = sy0 + (ly - sy0) * u - Math.sin(u * Math.PI) * T * (0.7 + 0.6 * hash2(d, f.seed, 425));
          img(drop, hx - big * 0.8, hy - big * 1.1, big * 1.6, big * 2.2, 0.9, false);
          img(shine, hx - big * 0.25, hy - big * 0.6, big * 0.5, big * 0.6, 0.5, false);
        } else {
          const rest = (p - flight) / (1 - flight), spread = big * (1.3 + 1.5 * Math.min(1, rest * 3));
          img(drop, lx - spread, ly - spread * 0.5, spread * 2, spread, 0.62 * (1 - rest) * (1 - rest * 0.3), false);
          if (rest < 0.25) img(shine, lx - spread * 0.5, ly - spread * 0.3, spread, spread * 0.5, 0.5 * (1 - rest / 0.25), false);
        }
      }
    },
    infuse(f, p) {
      // FX28 (1.7 fx.js:281-297): the room goes dark about the hero and stays lit only where he stands; his body takes
      // the element's light in pulses that come faster; then it breaks and the dark lifts. The pieces that fly in and
      // burst out are the kit's own, called when this one began (infuseBegin).
      const ix = (f.x + 0.5) * T, iy = (f.y + 0.45) * T;
      let dusk = p < 0.14 ? p / 0.14 : p < 0.56 ? 1 : Math.max(0, 1 - (p - 0.56) / 0.3); dusk = dusk * dusk * (3 - 2 * dusk);
      const side = T * (3.6 - 0.8 * dusk) * 16;
      img({ t: stampTexture('dusk'), c: 0x05040A }, ix - side / 2, iy - side / 2, side, side, 0.84 * dusk, false);
      if (p < 0.56) {
        const gather = p / 0.56, beat = 0.5 + 0.5 * Math.sin(gather * gather * Math.PI * 9 - Math.PI / 2), reach = T * (0.55 + 0.5 * gather + 0.16 * beat);
        img(stamp('puff', f.col), ix - reach, iy - reach * 1.15, reach * 2, reach * 2.3, (0.25 + 0.45 * gather) * (0.45 + 0.55 * beat), true);
        img(stamp('puff', '#FFFBEA'), ix - reach * 0.5, iy - reach * 0.7, reach, reach * 1.4, (0.1 + 0.5 * gather) * beat, true);
      }
    },
    proc(f, p, wave) {
      // 1.7 fx.js:306-386: the quarter-second flourish of a weapon trigger or a passive proc on the body it lands on.
      // Each element has its own gesture, not its own colour of the same spark.
      const ox = (f.x + 0.5) * T, oy = (f.y + 0.45) * T, pal = Object.hasOwn(TRAIL, f.type) ? TRAIL[f.type].col : f.type === 'blood' ? ['#E0404A', '#9A1A2A', '#5A0A18'] : TRAIL.phys.col;
      const c1 = pal[1] || pal[0], seen = Math.min(1, p * 6) * (1 - p), S = (name, c) => stamp(name, c);
      if (f.type === 'fire') {
        // a lick of flame: three tongues climb off the body and thin, the middle one hotter
        for (let k = 0; k < 3; k++) {
          const tall = T * (0.4 + 0.14 * hash2(k, f.seed, 481)) * (1 - 0.35 * p), tx = ox + (k - 1) * T * 0.1 + Math.sin(wave / 70 + k * 2.1) * T * 0.012, ty = oy + T * 0.2 - p * T * (0.2 + 0.08 * k);
          img(S('wisp', k === 1 ? pal[0] : c1), tx - tall * 0.17, ty - tall, tall * 0.34, tall, 0.75 * seen, true);
        }
        img(S('puff', c1), ox - T * 0.24, oy + T * 0.02, T * 0.48, T * 0.34, 0.5 * (1 - p) * (1 - p), true);
      } else if (f.type === 'ice') {
        // a frost bloom: needles of rime shoot out from the blow, stand for a breath and are gone
        const grow = 1 - Math.pow(1 - Math.min(1, p / 0.35), 3);
        for (let k = 0; k < 5; k++) {
          const ang = f.seed + k / 5 * Math.PI * 2 + (hash2(k, f.seed, 482) - 0.5) * 0.7, len = T * (0.2 + 0.16 * hash2(k, f.seed, 483)) * grow;
          lay(S('shard', k % 2 ? pal[0] : c1), ox + Math.cos(ang) * T * 0.05, oy + Math.sin(ang) * T * 0.05, ang, len, len * 0.3, true, 0.85 * (1 - p), true);
        }
        img(S('puff', pal[0]), ox - T * 0.16, oy - T * 0.16, T * 0.32, T * 0.32, 0.6 * (1 - p) * (1 - p), true);
      } else if (f.type === 'lightning') {
        // a snap of sparks: two threads one after the other in different places, a pinprick of white, three sparks thrown clear
        const beat = p < 0.45 ? 0 : 1, age = beat ? (p - 0.45) / 0.55 : p / 0.45, snap = f.seed * 7 + beat * 3.1, sl = T * (0.42 + 0.2 * hash2(beat, f.seed, 484)), sx = ox + Math.cos(snap) * T * 0.08, sy = oy + Math.sin(snap) * T * 0.08;
        lay(S('fork', c1), sx, sy, snap + 1.3, sl, sl * 0.36, false, 0.8 * (1 - age), true);
        lay(S('fork', pal[0]), sx, sy, snap + 1.3, sl, sl * 0.36, false, 0.9 * (1 - age) * (1 - age), true);
        img(S('puff', pal[0]), sx - T * 0.1, sy - T * 0.1, T * 0.2, T * 0.2, 0.7 * (1 - age), true);
        for (let k = 0; k < 3; k++) {
          const far = T * (0.1 + 0.3 * p) * (0.7 + 0.6 * hash2(k, f.seed, 485));
          img(S('puff', c1), ox + Math.cos(f.seed + k * 2.3) * far - T * 0.035, oy + Math.sin(f.seed + k * 2.3) * far - T * 0.035, T * 0.07, T * 0.07, 0.8 * (1 - p), true);
        }
      } else if (f.type === 'poison') {
        // a drip: three beads gather on the body and fall, each a little after the last, drawing out as they go
        for (let k = 0; k < 3; k++) {
          if (p < k * 0.14) continue;
          const du = Math.min(1, (p - k * 0.14) / 0.7), dx = ox + (hash2(k, f.seed, 486) - 0.5) * T * 0.36, dy = oy - T * 0.05 + du * du * T * 0.42, fat = T * (0.09 + 0.04 * hash2(k, f.seed, 487)) * (0.6 + 0.4 * Math.min(1, du * 5)), a = Math.min(1, (1 - du) * 4);
          img(S('puff', c1), dx - fat, dy - fat * (1.2 + 0.8 * du), fat * 2, fat * (2.4 + 1.6 * du), 0.9 * a, false);
          img(S('puff', pal[0]), dx - fat * 0.35, dy - fat * 0.9, fat * 0.7, fat * 0.8, 0.55 * a, false);
        }
      } else if (f.type === 'earth' || f.type === 'blood') {
        // grit knocked off a blow, or a spatter of blood: small soft bits thrown a short way, falling at once (blood one way)
        for (let k = 0; k < 6; k++) {
          const side = (f.type === 'blood' ? (f.seed % 2 ? 1 : -1) : (k % 2 ? 1 : -1)) * (0.25 + 0.75 * hash2(k, f.seed, 488)), hop = T * (0.1 + 0.16 * hash2(k, f.seed, 489)), bit = T * (0.07 + 0.07 * hash2(k, f.seed, 490));
          const bx = ox + side * T * 0.42 * p, by = oy + T * 0.05 - Math.sin(Math.min(1, p * 1.15) * Math.PI) * hop + p * p * T * 0.3;
          img(S('puff', pal[k % pal.length]), bx - bit, by - bit, bit * 2, bit * 2, 0.9 * Math.min(1, (1 - p) * 3), false);
        }
      } else if (f.type === 'light') {
        // a glint: a small four-pointed gleam that opens and closes, a little off true so it looks struck
        const gl = Math.sin(p * Math.PI), gx = ox + ((f.seed % 5) - 2) * T * 0.05, gy = oy - T * 0.08, gs = T * 0.62 * gl;
        lay(S('wisp', c1), gx, gy, 0.3 - Math.PI / 2, gs, gs * 0.2, false, 0.85 * gl, true);
        lay(S('wisp', c1), gx, gy, 0.3, gs * 0.7, gs * 0.16, false, 0.85 * gl, true);
        img(S('puff', pal[0]), gx - T * 0.11, gy - T * 0.11, T * 0.22, T * 0.22, 0.9 * gl, true);
      } else if (f.type === 'dark') {
        // a wisp of shadow peels off the body, curls away to one side and thins
        const way = f.seed % 2 ? 1 : -1;
        for (let k = 0; k < 2; k++) {
          const curl = T * (0.5 + 0.12 * k) * (0.7 + 0.5 * p);
          lay(S('wisp', k ? c1 : pal[0]), ox + way * T * (0.06 + 0.2 * p + 0.08 * k), oy - T * (0.1 + 0.3 * p), -Math.PI / 2 + way * (0.25 + 0.7 * p + 0.2 * k), curl, curl * 0.3, false, (k ? 0.6 : 0.8) * seen, true);
        }
        img(S('puff', c1), ox - T * 0.22, oy - T * 0.22, T * 0.44, T * 0.44, 0.4 * (1 - p), true);
      } else if (f.type === 'magic') {
        // a shimmer: motes of arcane light come and go about the body one after another, never all at once
        for (let k = 0; k < 5; k++) {
          const wink = 1 - Math.abs(p - (k + 0.7) / 6.2) / 0.26; if (wink <= 0) continue;
          const ms = T * (0.07 + 0.05 * hash2(k, f.seed, 493)) * (0.6 + 0.4 * wink);
          img(S('puff', k % 2 ? pal[0] : c1), ox + (hash2(k, f.seed, 491) - 0.5) * T * 0.6 - ms, oy + (hash2(k, f.seed, 492) - 0.5) * T * 0.6 - p * T * 0.06 - ms, ms * 2, ms * 2, 0.9 * wink, true);
        }
        img(S('puff', pal[2] || c1), ox - T * 0.34, oy - T * 0.34, T * 0.68, T * 0.68, 0.3 * seen, true);
      } else if (f.type === 'heal') {
        // a soft green lift: a few motes rise off the body with a pale thread of light among them
        for (let k = 0; k < 4; k++) {
          if (p < k * 0.1) continue;
          const lu = Math.min(1, (p - k * 0.1) / 0.7), ls = T * (0.08 + 0.04 * hash2(k, f.seed, 496));
          img(S('puff', k % 2 ? pal[0] : c1), ox + (hash2(k, f.seed, 494) - 0.5) * T * 0.44 + Math.sin(wave / 160 + k * 1.9) * T * 0.02 - ls, oy + T * 0.12 - lu * T * (0.34 + 0.14 * hash2(k, f.seed, 495)) - ls, ls * 2, ls * 2, 0.8 * Math.sin(lu * Math.PI), true);
        }
        img(S('wisp', c1), ox - T * 0.07, oy - T * (0.2 + 0.25 * p), T * 0.14, T * 0.5, 0.4 * seen, true);
      } else {
        // anything else: one small pale puff
        const dull = T * (0.16 + 0.2 * p);
        img(S('puff', pal[0]), ox - dull, oy - dull, dull * 2, dull * 2, 0.6 * (1 - p) * (1 - p), true);
      }
    },
  };

  // 1.7 fx.js:97-126: the static discharge, a jagged trunk with two forks; its path changes nine times a flight.
  const noise = (seed, phase, index) => { let n = Math.imul((seed || 1) ^ (phase * 374761393), 668265263) ^ Math.imul(index + 17, 1274126177); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  function discharge(f, p, reach) {
    const dx = (f.bx - f.ax) * reach, dy = (f.by - f.ay) * reach, length = Math.hypot(dx, dy), nx = length ? -dy / length : 0, ny = length ? dx / length : 1;
    const phase = reduced() ? 0 : Math.floor(p * 9), segments = Math.max(5, Math.ceil(length * 3)), trunk = [], forks = [];
    for (let i = 0; i <= segments; i++) {
      const q = i / segments, off = i && i < segments ? (noise(f.seed, phase, i) - 0.5) * 0.48 * Math.sin(q * Math.PI) : 0;
      trunk.push([f.ax + 0.5 + dx * q + nx * off, f.ay + 0.5 + dy * q + ny * off]);
    }
    if (!reduced()) for (let j = 0; j < 2; j++) {
      const at = Math.max(1, Math.min(segments - 1, Math.round(segments * (0.3 + j * 0.37)))), base = trunk[at], side = j ? 1 : -1;
      const spread = 0.2 + noise(f.seed, phase, segments + j) * 0.25, fwd = 0.1 + noise(f.seed, phase, segments + j + 2) * 0.16, L = length || 1;
      forks.push([base, [base[0] + nx * side * spread + dx / L * fwd, base[1] + ny * side * spread + dy / L * fwd], [base[0] + nx * side * spread * 0.6 + dx / L * fwd * 2, base[1] + ny * side * spread * 0.6 + dy / L * fwd * 2]]);
    }
    const fade = Math.min(1, (1 - p) * 1.5), flicker = reduced() ? 0.85 : 0.65 + 0.35 * noise(f.seed, phase, 91);
    const path = pts => { pts.forEach(([x, y], i) => (i ? lines.lineTo(x * T, y * T) : lines.moveTo(x * T, y * T))); };
    const stroke = (pts, color, width, alpha) => { path(pts); lines.stroke({ color, width, alpha, cap: 'round', join: 'round' }); };
    stroke(trunk, 0xC8DFFF, Math.max(3, T * 0.13), fade * 0.2);
    stroke(trunk, 0xF4EBA8, Math.max(1.4, T * 0.045), fade * flicker);
    stroke(trunk, 0xFFFFFF, Math.max(0.7, T * 0.016), fade * flicker);
    for (const fk of forks) stroke(fk, 0xD2E9FF, Math.max(0.7, T * 0.021), fade * flicker * 0.6);
  }

  // ---- ripples carry their own mask of the cells in sight
  function rippleLayer(f) {
    const c = new Container(), mask = new Graphics(), span = Math.ceil(f.r + 2), tx = Math.round(f.x), ty = Math.round(f.y);
    for (let y = ty - span; y <= ty + span; y++) for (let x = tx - span; x <= tx + span; x++) if (seen(x, y)) mask.rect(x * view.tile, y * view.tile, view.tile + 0.5, view.tile + 0.5);
    mask.fill({ color: 0xffffff });
    c.addChild(mask); c.mask = mask;
    below.addChild(c);
    f.layer = c; f.pool = spritePool(c);
  }

  clock.onFrame(dt => {
    const d = dt * (clock.speed || 1);
    now += d; T = view.tile;
    const wave = reduced() ? 0 : now;
    lines.clear(); pool.begin();
    // FX29, FX30 (1.7 drawFX, fx.js:213-219): the long buffs hang about the hero, laid first, under the timed pieces.
    // view.auraHero(): { actor, x, y } for a living hero in view (map-view.js), x, y its sprite root in map pixels.
    auras.paint(view.auraHero?.() ?? null, now, d, reduced(), { img, lay, stamp, T });
    const keep = [];
    for (const f of pieces) {
      // FX28: an infusion waits while the Forge's panel covers the map, then begins (1.7 drawFX f.waits, infuseBegin)
      if (f.waits) { if (f.waits()) { keep.push(f); continue; } infuseBegin(f); }
      const p = (now - f.t0) / f.dur;
      if (p >= 1) {
        if ((f.k === 'bolt' || f.k === 'arc') && !f.hit) {
          f.hit = true; f.trail?.end();
          if (f.explosion) explosion(f.bx, f.by); else burst(f.bx, f.by, f.type, f.type === 'phys' ? 6 : 18, 0.05);
          f.landed?.();
        }
        if (f.layer) { f.pool.destroy(); f.layer.destroy({ children: true }); }
        f.done?.();
        continue;
      }
      keep.push(f);
      if (p < 0) continue;
      if (f.arrive && p >= f.arrive) { f.arrive = 0; f.reached?.(); }
      f.dt = d;
      if (f.k === 'ripple') { if (!f.layer) rippleLayer(f); P = f.pool; P.begin(); PAINT.ripple(f, p, wave); P.end(); P = pool; continue; }
      PAINT[f.k](f, p, wave);
    }
    pieces = keep;
    pool.end();
    // FX3 (1.7 render.js:2313 emitFire, fx.js:55-59): burning ground in sight throws an ember now and then, each 30 Hz
    // step, that drifts up off the floor and fades. view.embers(): the burning cells in sight, as [x, y].
    const fires = view.embers?.();
    if (fires?.length && !reduced()) {
      emberCarry = Math.min(64, emberCarry + d);
      for (; emberCarry >= 1000 / 30; emberCarry -= 1000 / 30) for (const [x, y] of fires) {
        if (Math.random() < 0.25) particle(x + 0.3 + Math.random() * 0.4, y + 0.75, { vx: (Math.random() - 0.5) * 0.004, vy: -0.012 - Math.random() * 0.01, life: 500 + Math.random() * 300, col: Math.random() < 0.5 ? '#FFB040' : '#FF6A20', size: 1.6 + Math.random() * 1.6, glow: true });
      }
    } else emberCarry = 0;
    // particles (1.7 fx.js:672-686), on top of the pieces
    parts.begin(); P = parts;
    const k = T / 48;   // 1.7's sizes are canvas pixels at a 48 px tile (as 1.7's canvas)
    for (let j = particles.length - 1; j >= 0; j--) {
      const pt = particles[j];
      pt.life -= d; if (pt.life <= 0) { particles.splice(j, 1); continue; }
      pt.vy += pt.grav * d; pt.x += pt.vx * d * 0.06; pt.y += pt.vy * d * 0.06;
      // a spark is a square as 1.7 drew it; a blast's smoke (no shrink) is a soft puff, so a blast leaves no hard blocks
      const lf = pt.life / pt.max, sz = pt.size * k * (pt.shrink ? 0.35 + 0.65 * lf : 2.4), s = parts.next(pt.shrink ? Texture.WHITE : stampTexture('puff'));
      s.anchor.set(0.5); s.rotation = 0; s.position.set(pt.x * T, pt.y * T); s.width = s.height = sz;
      s.tint = pt.c; s.alpha = Math.min(1, lf * 1.4) * pt.a; s.blendMode = pt.glow ? 'add' : 'normal';
    }
    parts.end(); P = pool;
    // 1.7 ringFx: each ring opens to its radius while it fades (fx-layer.js before C9; now on the effects clock)
    rings.clear();
    ringList = ringList.filter(r => {
      const q = (now - r.t0) / r.dur;
      if (q >= 1) return false;
      if (q > 0) rings.circle(r.x * T, r.y * T, T * r.r * q).stroke({ color: r.col, width: r.w * k, alpha: (1 - q) * r.a });
      return true;
    });

    // bodies that shudder (1.7 game.js:139-150 quiverFx, entOffset): offset by the root's pivot, which no tween uses
    quivers = quivers.filter(q => {
      const r = q.sprite?.root;
      if (!r || r.destroyed) return false;
      const p = (now - q.t0) / q.dur;
      if (p >= 1) { r.pivot.set(0, 0); return false; }
      if (p >= 0) { const still = reduced() ? 0 : 1 - p, beat = q.beat; r.pivot.set(-Math.sin(now / 21 + beat) * T * q.amp * still, -Math.cos(now / 17 + beat) * T * q.amp * 0.45 * still); }
      return true;
    });
  });

  const seedOf = (x, y) => ((Math.floor(now) + Math.round((x || 0) * 131 + (y || 0) * 71)) % 977 + 977) % 977;   // 1.7 fxSeed
  const add = (f, o = {}) => { f.t0 = now + (o.at ?? 0); f.dur = Math.max(1, f.dur); pieces.push(f); return f; };
  const ends = f => new Promise(r => { f.done = r; });

  function infuseBegin(f) {
    const at = f.where?.(); f.waits = null;
    if (!at) { Object.assign(f, { k: 'flare', size: 0, t0: now, dur: 1 }); return; }
    const { x, y } = at; f.x = x; f.y = y;
    // reduced motion keeps its single bloom (1.7 infuseBegin)
    if (reduced()) { Object.assign(f, { k: 'flare', heart: true, size: 1.6, t0: now, dur: 500 }); return; }
    const o = 80, breaks = o + 2100 * 0.56;
    f.t0 = now + o;
    fx.swirl(x, y, f.col, 4.6, { inward: true, dur: 900, at: o + 120 });
    fx.swirl(x, y, f.pale, 2.2, { inward: true, dur: 700, at: o + 420 });
    fx.glyph(x, y, f.col, { size: 1.5, dur: 1500, at: o + 200 });
    fx.flare(x, y, f.pale, { size: 3.1, dur: 620, at: breaks });
    fx.rise(x, y, f.col, { n: 30, height: 3.4, spread: 0.7, dur: 1300, at: breaks - 40, body: 1 });
    fx.rise(x, y, f.pale, { n: 14, height: 2.4, spread: 0.4, dur: 1000, at: breaks + 60, body: 0.8 });
    fx.ripple(x, y, f.col, 7.5, { rings: 3, dur: 1300, at: breaks + 20 });
    fx.light(x, y, f.col, { r: 12, s: 1.25, flash: 1500, at: breaks });
  }

  const fx = {
    root,
    under,
    get now() { return now; },
    get reduced() { return reduced(); },
    get shaking() { return shake; },
    auras,
    burst, explosion, particle,
    /**
     * 1.7 SHAKE: the map jolts by up to amount px (the largest asked for wins), easing by x0.86 each 30 Hz step; never
     * under reduced motion. Its step joins the frame the first time anything shakes, after the map view's own, so the
     * jolt rides on the camera that frame placed.
     */
    shake(amount) {
      if (!(amount > 0)) return;
      shake = Math.max(shake, amount);
      if (shakeHooked) return;
      shakeHooked = true;
      clock.onFrame(dt => {
        if (shake > 0.5 && !reduced()) {
          carry += dt * (clock.speed || 1);
          const steps = Math.floor(carry / STEP);
          carry -= steps * STEP;
          if (steps) { let a = shake; for (let i = 0; i < steps; i++) { shakeX = (Math.random() - 0.5) * a; shakeY = (Math.random() - 0.5) * a; a *= 0.86; } shake *= Math.pow(0.86, steps); }
          view.root.x += Math.round(shakeX); view.root.y += Math.round(shakeY);
        } else { shake = 0; shakeX = shakeY = 0; carry = 0; }
      });
    },
    /** 1.7 ringFx(x, y, col, r, o): a ring opening to r tiles while it fades, 450 ms; o.at starts it later (FX32). */
    ring(x, y, c = '#FFFFFF', r = 2, o = {}) { ringList.push({ x: x + 0.5, y: y + 0.5, col: col(c).n, r, t0: now + (o.at ?? 0), dur: o.dur ?? 450, a: o.a ?? 0.8, w: o.w ?? 3 }); },
    /**
     * WC5, 1.7 drawLastCastSurface (beta-world.js:57): for 650 ms after an area cast its struck tiles in sight wash a
     * soft amber (255,200,100 at 0.18) with a thin pale gold outline 2 px inside each tile (255,220,145 at 0.8).
     */
    castSurface(tiles) {
      if (!tiles?.length) return;
      const tile = view.tile, px = v => v * tile / 48, g = new Graphics(), inset = px(2), w = Math.max(1, px(1));
      for (const t of tiles) g.rect(t.x * tile, t.y * tile, tile, tile).fill({ color: 0xffc864, alpha: 0.18 });
      for (const t of tiles) g.rect(t.x * tile + inset, t.y * tile + inset, tile - 2 * inset, tile - 2 * inset).stroke({ color: 0xffdc91, alpha: 0.8, width: w });
      under.addChild(g);
      clock.wait(650).then(() => g.destroy());
    },
    /** Runs fn after ms of map time (the search's glints walking outward). */
    after(ms, fn) { clock.wait(ms).then(fn); },
    sparkle: (x, y, type = 'heal', n = 18) => burst(x, y, type, n, 0.035),
    // 1.7 flareFx has a pale heart that goes out first; smiteFx (o.heart false) stays the one soft puff (fx.js:757-759, :797)
    flare: (x, y, c, o = {}) => ends(add({ k: 'flare', heart: o.heart !== false, x, y, col: c || '#FFF1C4', size: o.size || 0.6, dur: o.dur || 300 }, o)),
    rise(x, y, c, o = {}) { const n = Math.min(32, o.n || 10); return ends(add({ k: 'rise', x, y, col: c || '#7FD08A', n, wisps: Math.max(2, Math.round(n * 0.4)), height: o.height || 1.4, spread: o.spread || 0.45, body: o.body || 0, seed: seedOf(x, y), dur: o.dur || 800 }, o)); },
    swirl(x, y, c, r = 1.5, o = {}) { const seed = seedOf(x, y); return ends(add({ k: 'swirl', x, y, col: c || '#D9B8FF', r, n: Math.min(22, Math.round(10 + r * 5)), inward: !!o.inward, way: seed % 2 ? 1 : -1, seed, dur: o.dur || 700 }, o)); },
    sweep: (ax, ay, bx, by, c, o = {}) => ends(add({ k: 'sweep', ax, ay, bx, by, col: c || '#F2E8DC', w: o.width || 0.5, n: Math.min(20, Math.ceil(Math.hypot(bx - ax, by - ay) * 2.2) + 4), seed: seedOf(ax, ay), dur: o.dur || 380 }, o)),
    cone(x, y, dx, dy, c, r = 3, o = {}) { let spread = o.spread || 0.6; if (spread > Math.PI) spread *= Math.PI / 180; return ends(add({ k: 'cone', x, y, dir: Math.atan2(dy || 0, dx || 0), col: c || '#8FD3FF', r, spread, seed: seedOf(x, y), dur: o.dur || 650 }, o)); },
    shard: (x, y, c, r = 1.2, o = {}) => ends(add({ k: 'shard', x, y, col: c || '#8FD3FF', r, n: Math.min(28, o.n || 9), seed: seedOf(x, y), dur: o.dur || 700 }, o)),
    glyph: (x, y, c, o = {}) => ends(add({ k: 'glyph', x, y, col: c || '#D9B8FF', size: o.size || 1, seed: seedOf(x, y), dur: o.dur || 900 }, o)),
    ripple: (x, y, c, r = 6, o = {}) => ends(add({ k: 'ripple', x, y, col: c || '#FFF', r, rings: o.rings || 3, plain: !!o.plain, dur: o.dur || 1100 }, o)),
    /** A beam along its cells (1.7 beamFx and fxBeamShape); from is the caster's cell. */
    beam(tiles, type, o = {}) {
      const t = trailOf(type, 'magic'), from = o.from ?? { x: tiles[0][0], y: tiles[0][1] }, cells = new Set();
      let sx = 0, sy = 0, len = 0, half = 0;
      for (const [x, y] of tiles) { sx += x - from.x; sy += y - from.y; cells.add(x + ',' + y); }
      const reach = Math.hypot(sx, sy), ux = reach ? sx / reach : 1, uy = reach ? sy / reach : 0;
      for (const [x, y] of tiles) { const dx = x - from.x, dy = y - from.y; len = Math.max(len, dx * ux + dy * uy); half = Math.max(half, Math.abs(dx * uy - dy * ux)); }
      const shape = { ox: from.x, oy: from.y, ux, uy, len: Math.max(0.5, len), half, cells, lone: !reach, first: o.from ? 0.6 : 0 };
      return ends(add({ k: 'beam', tiles: tiles.map(c => c.slice()), shape, col: o.col || t.glow || t.col[0], dur: o.dur || (reduced() ? 180 : type === 'light' ? 520 : 320) }, o));
    },
    /**
     * A bolt from tile a to tile b (1.7 boltFx): resolves when its hit should show (85% of the flight, as 1.7's fxAt
     * hold), and bursts where it lands. o.explosion: a blast instead of the burst. o.staticDischarge: a lightning jump.
     */
    bolt(ax, ay, bx, by, type, o = {}) {
      const d = Math.max(1, Math.max(Math.abs(bx - ax), Math.abs(by - ay))), arrow = !!o.arrow, arc = type === 'lightning' && !!o.staticDischarge && !arrow;
      // 1.7 fx.js:71-72: an arrow is loosed, not lobbed: about a third of a spell bolt's flight time
      const dur = arc ? (reduced() ? 180 : 260) : arrow ? 45 + 18 * d : 110 + 55 * d, t = trailOf(type);
      const glow = col(t.glow || t.col[0]).n;
      const f = add({ k: arc ? 'arc' : 'bolt', ax, ay, bx, by, type, arrow, explosion: !!o.explosion, dur, seed: Math.floor(Math.random() * 2147483647), emit: 0, glow, arrive: arc ? 0 : 0.85 }, o);
      // A spell flashes where it lands (sandbox SB1, Justin 2026-10-16); an arrow does not (item 138, 1.7 lights no arrow).
      f.landed = () => { if (!arrow) view.lightLayer?.flash((bx + 0.5) * view.tile, (by + 0.5) * view.tile, glow); o.onLand?.(); };
      // o.whole: resolve when it has landed (a creature's shot holds the turn its whole flight, as fx-layer.js had it)
      return new Promise(r => { if (arc || o.whole) f.done = r; else { f.reached = r; f.done = r; } });
    },
    /** A body shudders (1.7 quiverFx); sprite is a map sprite. */
    quiver(sprite, o = {}) { if (sprite) quivers.push({ sprite, t0: now + (o.at ?? 0), dur: o.dur || 700, amp: o.amp || 0.07, beat: quivers.length * 1.7 + Math.random() * 3 }); },
    /** The light a spell leaves (1.7 spellLight): here the light layer's flash, swelling and dying over o.flash ms. */
    light(x, y, c, o = {}) {
      const go = () => view.lightLayer?.flash((x + 0.5) * view.tile, (y + 0.5) * view.tile, col(c).n, (o.r || 8) * 0.55, Math.min(0.85, 0.55 * (o.s || 1)), (o.flash || 900) / (clock.speed || 1));
      if (o.at) add({ k: 'flare', x, y, col: c, size: 0, dur: 1, done: go }, o); else go();
    },
    /** 1.7 pillarFx: light called down onto a tile from above the view; o.ray a sunbeam (Dawn), else a strike. */
    pillar: (x, y, c, o = {}) => ends(add({ k: 'pillar', ray: !!o.ray, x, y, col: c || '#FFF1C4', w: o.w || 0.9, dur: o.dur || 900 }, o)),
    /** 1.7 splashFx: a burst of liquid, soft drops thrown out in arcs that land as pools and soak away. */
    splash: (x, y, c, r = 3, o = {}) => ends(add({ k: 'splash', x, y, col: c || '#8FC45A', r, seed: seedOf(x, y), dur: o.dur || 1150 }, o)),
    /**
     * FX28 (1.7 infuseFx, fx.js:775-794): an element fused into the hero. The room darkens to a pool of light on him,
     * the element is drawn in, his body pulses faster, then it breaks: a bloom, a column through him, a swell over the
     * floor and the room lit in its colour, about two seconds. o.waits(): true while a panel covers the map; several
     * fused in one visit are one moment, in the colour of the last. o.at(): the hero's tile when it begins.
     */
    infuse(c, pale, o = {}) {
      const queued = pieces.find(f => f.k === 'infuse' && f.waits);
      if (queued) { queued.col = c; queued.pale = pale || '#FFFFFF'; return Promise.resolve(); }
      return ends(add({ k: 'infuse', col: c, pale: pale || '#FFFFFF', where: o.at, waits: o.waits ?? (() => false), x: 0, y: 0, dur: 2100 }));
    },
    /** 1.7 procFx: the 260 ms flourish of a trigger or proc on a body, in its type's own gesture (o.at: a later start). */
    proc: (x, y, type = 'phys', o = {}) => ends(add({ k: 'proc', x, y, type, seed: seedOf(x, y), dur: 260 }, o)),
    /** Waits ms on the effects clock. */
    wait: ms => (ms > 0 ? ends(add({ k: 'flare', x: 0, y: 0, col: '#000', size: 0, dur: ms })) : Promise.resolve()),
    clear() { for (const f of pieces) { f.trail?.end(); if (f.layer) { f.pool.destroy(); f.layer.destroy({ children: true }); } f.done?.(); } pieces = []; particles = []; for (const q of quivers) q.sprite?.root && !q.sprite.root.destroyed && q.sprite.root.pivot.set(0, 0); quivers = []; },
  };
  return fx;
}
