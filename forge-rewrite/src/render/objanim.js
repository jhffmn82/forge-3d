// Small animations on map objects, as 1.7 draws them (js/presentation/render/objanim.js @3c8b312): a flickering halo
// on each painted flame (torch stands, candelabras, soul braziers), a flickering glow on a candle table, a slow glow on
// glow plates, rune stones and glow mushrooms, twinkles on crystals. Each effect finds its anchors by reading the
// art once (the hottest pixels are the flames, the brightest the glints and the glow's centre and colour), so a
// picture gets the right placement without hand measuring. Drawn additively over the light; still under reduced motion.
// RB29: every piece the map draws is matched by its art's name, as 1.7 matched o.nm: props, door and stair tiles, chests
// and the Crypt's and the planes' pieces. RB30: a glint is 1.7's soft four-point star (planeterrain.js ptStar).

import { Container, Graphics, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { hash2 } from '../lib/noise.js';
import { propSprite } from './structures.js';
import { star } from './plane-anim.js';
import props from '../../data/props.json' with { type: 'json' };

const RULES = [
  [/^table-candle$/, ['flicker']],
  [/^(torch-stand|soul-brazier|candelabra)$/, ['flames']],
  [/^kobold-campfire$/, ['flicker', 'embers']],
  [/^(elemental-lock|chest-crystal|chest-elemental|ice-block)$/, ['twinkle']],
  // The Caverns' pieces (1.7 OBJ_FX_RULES): glowing mushrooms breathe and shed spores, moss and small mushrooms glow,
  // crystals, geodes and pearls twinkle, pylons crackle, the glowing pools glint.
  [/^(giant-mushroom|mushroom-pair)/, ['glow', 'spores']],
  [/^(cl-small-mushrooms|cl-glow-moss)/, ['glow']],
  [/^(cl-crystal-shards|geode|cl-cave-pearls|door-crystal|sigil-crystal)/, ['twinkle']],
  [/^pylon/, ['glow', 'arcs']],
  [/^(rune-stone-|glow-mushrooms$|plate-glow$)/, ['glow']],
  [/^candles-/, ['flames']],
  // The Crypt's and the planes' pieces (1.7 OBJ_FX_RULES, 2026-09-19): the rune tomb glows and its painted flames
  // flicker, the wall plaque breathes, painted candles on tombs, sarcophagi, coffins, the wide stairs and the urn
  // groups flicker where they burn; crystals and the Light, Shadow and Earth stalagmites glint.
  [/^tomb-rune$/, ['glow', 'flames']],
  [/^wall-plaque$/, ['glow']],
  [/^(tomb-|dais-sarcophagus|grave-monument|grave-post|grave-pillar|sarcophagus|coffin|stairs-wide|urn-groups-)/, ['flames']],
  [/^crystal-/, ['twinkle']],
  [/^stalagmite-(light|shadow|earth)$/, ['twinkle']],
  // The Underdark's pieces (deeprender.js OBJ_FX_RULES): drow candles and the stairway flicker, the lava forge
  // flickers, embers, the blood font, the active ritual circle and the obelisk glow.
  [/^(candelabra-tall|stairs-down-drow|drow-altar)/, ['flicker']],
  [/^lava-forge$/, ['flicker', 'embers']],
  [/^(basalt-embers-\d|blood-font|ritual-circle-active|drow-obelisk)$/, ['glow']],
];
export const fxFor = id => RULES.find(([re]) => re.test(id))?.[1] ?? null;
// 1.7 surface.js FLAME_AT and propFlame (audit RL1): a lit brazier and a torch stand burn a moving
// pixel flame at this point of their art (share of the drawn box), this tall (tiles) and this wide.
// (1.7's table-candle row is left out: this candle table's candle stands left of centre, and its painted flame flickers.)
// (Only the brazier, as the latest 1.7: torch stands paint their own flames, Justin's render plan Q9, 2026-09-27.)
const FLAME_AT = { 'brazier-lit': { ax: 0.49, ay: 0.26, size: 0.46, wide: 1.5 } };
const CINDER_FLAMES = {
  'grave-pillar': { ax: 0.5, ay: 0.1, size: 0.48, wide: 0.85 },
  'torch-stand': { ax: 0.5, ay: 0.12, size: 0.48, wide: 0.85 },
  'brazier-unlit': FLAME_AT['brazier-lit'],
};
const FIRE = [0x8E2A12, 0xE2622B, 0xFFA040, 0xFFE08A];
const BOWL_FLAME = props.rows['brazier-unlit'].offeringFlame;
const LOCK_COL = { fire: 0xE2622B, water: 0x62A8D8, air: 0xE8D27A, earth: 0x7FA05A, light: 0xF6E7B0, shadow: 0x8A6FB0 };   // 1.7 AFF_COL
const LOCK_ORB = props.rows['elemental-lock'].orb;

/** 1.7 surface.js drawPixelFlame: rows of art pixels narrowing to a swaying, licking tip, and now and then a spark. */
function pixelFlame(g, bx, by, H, wide, u, t, seed, now, palette = FIRE, spark = 0xFFD070) {
  g.clear();
  const rows = Math.max(4, Math.round(H / u)), half = Math.max(2, Math.round(H * 0.28 * wide / u));
  for (let r = 0; r < rows; r++) {
    const q = r / rows, sway = Math.sin(t * 7 + seed + q * 3.2) * q * 1.6 + Math.sin(t * 13 + seed * 1.7 + q * 6) * q * 0.8;
    const lick = 0.85 + 0.15 * Math.sin(t * 11 + seed + r * 0.9), hw = half * (q < 0.25 ? 0.75 + q : Math.pow(1 - (q - 0.25) / 0.75, 1.3)) * lick;
    if (hw < 0.45) continue;
    for (let c = -Math.ceil(hw); c <= Math.ceil(hw); c++) {
      const e = Math.abs(c) / Math.max(0.5, hw); if (e > 1) continue;
      let k = e > 0.72 || q > 0.8 ? 1 : e > 0.4 || q > 0.55 ? 2 : 3;
      if (q < 0.12 && e > 0.6) k = 0;
      g.rect(Math.round(bx + (c + sway) * u - u / 2), Math.round(by - r * u - u), u, u).fill({ color: palette[k] });
    }
  }
  const ph = (now / 900 + seed * 0.37) % 1;
  g.rect(Math.round(bx + Math.sin(seed + now / 300) * half * u * 0.8), Math.round(by - H - ph * H * 0.8), u, u).fill({ color: spark, alpha: 1 - ph });
}

const infos = new Map();
/** The art read once: flame points, glints, and the glow's centre, colour and share (objanim.js objFxInfo). */
function infoOf(tex) {
  const key = tex.source.uid + ':' + tex.frame.x + ',' + tex.frame.y;
  if (infos.has(key)) return infos.get(key);
  const info = { flames: [], bright: [], glow: null, warm: null };
  try {
    const W = Math.max(1, tex.frame.width | 0), H = Math.max(1, tex.frame.height | 0), c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(tex.source.resource, tex.frame.x, tex.frame.y, W, H, 0, 0, W, H);
    const D = g.getImageData(0, 0, W, H).data, cand = [], fl = [];
    let sr = 0, sg = 0, sb = 0, sw = 0, wx = 0, wn = 0, wtop = H;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4, r = D[p], gg = D[p + 1], b = D[p + 2];
      if (D[p + 3] < 160) continue;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx ? (mx - mn) / mx : 0;
      if (mx > 170 && (sat > 0.35 || mx > 225)) { cand.push([x, y, mx]); sr += r * mx; sg += gg * mx; sb += b * mx; sw += mx; }
      if (r > 200 && gg > 110 && b < 120 && r > b + 80) { wx += x; wn++; if (y < wtop) wtop = y; }   // the warm part (embers rise from it)
      if (r > 235 && gg > 170 && b < 150 && r > b + 100) fl.push([x, y, 'w', r + gg]);
      else if (gg > 190 && gg > r + 70 && gg > b + 50) fl.push([x, y, 'g', gg * 2]);
    }
    const res = W / 64 > 1.5 ? 2 : 1;   // 128 px art measures its spacing in its own pixels
    fl.sort((a, b) => b[3] - a[3]);
    for (const f of fl) { if (info.flames.length >= 10) break; if (info.flames.every(e => Math.abs(e[0] * W - f[0]) + Math.abs(e[1] * H - f[1]) >= 7 * res)) info.flames.push([f[0] / W, f[1] / H, f[2]]); }
    cand.sort((a, b) => b[2] - a[2]);
    for (const q of cand) { if (info.bright.length >= 7) break; if (info.bright.every(e => Math.abs(e[0] * W - q[0]) + Math.abs(e[1] * H - q[1]) >= 4 * res)) info.bright.push([q[0] / W, q[1] / H]); }
    if (sw) { let mxs = 0, mys = 0; for (const q of cand) { mxs += q[0] * q[2]; mys += q[1] * q[2]; } info.glow = { x: mxs / sw / W, y: mys / sw / H, col: [sr / sw, sg / sw, sb / sw].map(Math.round), n: cand.length / (W * H) }; }
    if (wn) info.warm = { x: wx / wn / W, y: wtop / H };
  } catch { /* unreadable art: no effect */ }
  infos.set(key, info);
  return info;
}

const radials = new Map();
function radial(rgb) {
  if (radials.has(rgb)) return radials.get(rgb);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = Texture.from(c); radials.set(rgb, t); return t;
}

/** A sheet picture's own name ('props/tomb-h' -> 'tomb-h'). */
const artName = tex => String(tex?.label ?? '').split('/').pop();

/**
 * A crystal's glint (item 216, Justin 2026-10-19: "not enough sparkles from crystals"; RB30 kept 1.7's three points at
 * half strength every 2.9 s): four points, each flashing (sin cubed) over 1 / 1.8 of a 2 s cycle, up to 0.85 alpha and
 * round(u (1 + 2.2 a)) radius.
 */
export const TWINKLE = { points: 4, cycle: 2, on: 1 / 1.8, alpha: 0.85, grow: 2.2, halo: 0.18 };
/** The glint's strength 0-1 at time t (seconds) for point i of a piece seeded `seed`. */
export function twinkleAt(t, i, seed) {
  const ph = ((t / TWINKLE.cycle + hash2(i, seed | 0, 5)) % 1) / TWINKLE.on;
  return ph > 1 ? 0 : Math.pow(Math.sin(Math.PI * ph), 3);
}

/**
 * RB29: the built pieces objanim animates, each with its art's names, its drawn box, the cell that shows it and, for
 * an outcrop's part, where it is drawn (its seed). Exported for the tests.
 */
export function fxPieces(sprites, tile) {
  const pieces = [];
  // RB29 (cryptpack.js packDrawOutcrop): a plane outcrop is a group of pack parts, each drawn through packDraw and so
  // through objFxDraw by its own art's name; the group marks itself fxParts and its parts are taken one by one.
  const flat = [];
  for (const s of sprites) {
    if (s && !(s instanceof Sprite) && s.fxParts && !s.destroyed && s.alpha > 0.5) { for (const c of s.children) if (c instanceof Sprite) flat.push([c, s]); }
    else flat.push([s, null]);
  }
  for (const [s, grp] of flat) {
    // 1.7 objFxDraw: only a piece drawn at more than half strength; loot is not a piece
    if (!(s instanceof Sprite) || s.destroyed || !s.texture || !(s.alpha > 0.5) || s.item || s.loot) continue;
    const tw = s.texture.orig?.width ?? s.texture.frame.width, th = s.texture.orig?.height ?? s.texture.frame.height;
    const w = Math.abs(s.scale.x) * tw, h = Math.abs(s.scale.y) * th, flip = s.scale.x < 0;
    const ox = grp ? grp.x : 0, oy = grp ? grp.y : 0;
    const left = ox + (flip ? s.x - (1 - s.anchor.x) * w : s.x - s.anchor.x * w), top = oy + s.y - s.anchor.y * h;
    // the cell that shows it: its prop's, else its foot row (its depth) under its middle
    // RB13: a door or stairs tile's piece carries its tile (the drow stairway stands tall over the passage behind it).
    // RB29: an outcrop's parts show with the outcrop's own cell, and seed by where each is drawn (1.7 objFxDraw).
    const at = grp ? grp.fxCell : s.prop ?? s.cell;
    const cx = at ? at.x : Math.floor((left + w / 2) / tile), cy = at ? at.y : s.zIndex >= 0 ? Math.round((s.zIndex + 1) / tile) - 1 : Math.floor((top + h / 2) / tile);
    const seedAt = grp ? [Math.round(left / tile), Math.round(top / tile)] : null;
    pieces.push({ s, names: [s.prop?.id, artName(s.texture)].filter(Boolean), w, h, flip, left, top, cx, cy, seedAt, keep: true });
  }
  return pieces;
}

/**
 * Effects for every animated piece on the floor. `sprites`: the map's built pieces (structures.js buildStructures),
 * matched by their prop's id or their art's name; without them, the floor's props are fitted afresh. `update(state)`
 * follows sight; `tick(now, reduced)` animates.
 */
export function buildObjAnim(floor, tile, sprites = null) {
  const root = new Container(), fx = [];
  if (typeof document === 'undefined') return { root, update() {}, tick() {} };
  root.blendMode = 'add';
  const solid = new Container(); solid.blendMode = 'normal'; root.addChild(solid);   // the pixel flames and the glints are paint, not light
  const pieces = [];
  if (sprites) {
    pieces.push(...fxPieces(sprites, tile));
  } else for (const p of floor.props ?? []) {
    const s = propSprite(p, tile); if (!s) continue;
    const w = Math.abs(s.width), h = s.height, flip = s.scale.x < 0;
    pieces.push({ s, names: [p.id], w, h, flip, left: flip ? s.x - w : s.x, top: s.y, cx: p.x, cy: p.y, keep: false });
  }
  // RC25, RC44 (1.7 render.js props pass): the offering bowl's green flame; an unopened elemental lock's pulsing orb.
  for (const q of floor.props ?? []) {
    if (q.offeringBowl) {
      // Item 348: the same moving flame as a lit brazier, seated in this bowl's painted rim.
      const piece = pieces.find(p => p.names.includes(q.id) && p.cx === q.x && p.cy === q.y);
      if (!piece) continue;
      const { left, top, w, h, flip } = piece, F = BOWL_FLAME, [aw, ah] = F.artSize, [ax, ay] = F.rim;
      const g = new Graphics(); solid.addChild(g);
      fx.push({ p: q, k: 'pixelflame', g, seed: q.x * 7 + q.y * 13, bx: left + (flip ? 1 - ax / aw : ax / aw) * w,
        by: top + ay / ah * h, H: F.height / ah * h, wide: F.wide, u: Math.max(1, Math.round(tile / 64)), palette: F.palette, spark: F.spark });
    }
    if (q.id === 'elemental-lock' && !q.opened && LOCK_COL[q.element]) {
      // Item 323: each orb sits on its own painted socket, following the drawn art's position, scale and facing.
      const piece = pieces.find(p => p.names.includes(q.id) && p.cx === q.x && p.cy === q.y);
      if (!piece) continue;
      const [ax, ay] = LOCK_ORB.sockets[q.element], [aw, ah] = LOCK_ORB.artSize;
      const { left, top, w, h, flip } = piece;
      const g = new Graphics().circle(left + (flip ? 1 - ax / aw : ax / aw) * w, top + ay / ah * h, w / 9).fill({ color: LOCK_COL[q.element] });
      solid.addChild(g); fx.push({ p: q, k: 'orb', g });
    }
  }
  for (const { s, names, w, h, flip, left: dx, top: dy, cx, cy, seedAt, keep } of pieces) {
    const cinder = floor.chaos?.regions?.[floor.chaos.regionOf?.[cy * floor.w + cx]]?.palette === 'cinder';
    const flameAt = n => FLAME_AT[n] ?? (cinder ? CINDER_FLAMES[n] : null);
    const id = names.find(n => flameAt(n) || fxFor(n)), tex = s.texture;
    if (!keep) s.destroy();
    if (!id) continue;
    const kinds = flameAt(id) ? [...(fxFor(id) ?? []), 'pixelflame'] : fxFor(id), I = infoOf(tex), p = { x: cx, y: cy };
    const X = f => dx + (flip ? 1 - f : f) * w, Y = f => dy + f * h, seed = hash2(seedAt?.[0] ?? p.x, seedAt?.[1] ?? p.y, 77) * 100;
    for (const k of kinds) {
      if ((k === 'glow' || k === 'flicker') && I.glow) {
        const r = Math.max(w, h) * (0.35 + Math.min(0.4, I.glow.n * 3)), g = new Sprite(radial(I.glow.col.join(',')));
        g.position.set(X(I.glow.x) - r, Y(I.glow.y) - r); g.width = g.height = r * 2; root.addChild(g);
        fx.push({ p, k, g, seed });
      }
      if (k === 'pixelflame') {
        const F = flameAt(id), g = new Graphics(); solid.addChild(g);
        fx.push({ p, k, g, seed: p.x * 7 + p.y * 13, bx: X(F.ax), by: Y(F.ay), H: tile * F.size, wide: F.wide, u: Math.max(1, Math.round(tile / 64)) });
      }
      if (k === 'flames') I.flames.forEach((f, i) => {
        const fr = tile * (/^candles-\d$/.test(id) ? 0.08 : 0.2), g = new Sprite(radial(f[2] === 'g' ? '120,255,150' : '255,190,90'));
        g.position.set(X(f[0]) - fr, Y(f[1]) - fr); g.width = g.height = fr * 2; root.addChild(g);
        const u = tile / 64, spark = new Sprite(Texture.WHITE); spark.tint = f[2] === 'g' ? 0xe0fff0 : 0xfff4c8;
        spark.position.set(Math.round(X(f[0]) - u), Math.round(Y(f[1]) - u * 2)); spark.width = spark.height = Math.max(1, u * 2); root.addChild(spark);
        fx.push({ p, k, g, spark, i, seed });
      });
      // Embers and spores: three motes rising from the warm part or the glow, swaying (1.7 objFxDraw).
      if (k === 'embers' || k === 'spores') {
        const src = k === 'embers' ? (I.warm ?? I.glow) : I.glow;
        if (src) for (let i = 0; i < 3; i++) {
          const m = new Sprite(Texture.WHITE), u = Math.max(1, tile / 32);
          m.width = m.height = u; m.tint = k === 'embers' ? 0xffb050 : I.glow ? (I.glow.col[0] << 16) | (I.glow.col[1] << 8) | I.glow.col[2] : 0xccffff;
          root.addChild(m);
          fx.push({ p, k, g: m, i, seed, x0: X(src.x), y0: Y(src.y), w, h });
        }
      }
      // Arcs: now and then a crackle between two of the brightest points (the pylons).
      if (k === 'arcs' && I.bright.length >= 2) {
        const g = new Graphics(); root.addChild(g);
        fx.push({ p, k, g, seed, pts: I.bright.map(b => [X(b[0]), Y(b[1])]), u: Math.max(1, tile / 32) });
      }
      // RB30 (objanim.js:126-139, objGlintsFlush, planeterrain.js ptStar): the brightest points glint in turn, each a
      // soft radial halo, a tapered four-point star necked at the middle and a bright core, drawn at unit radius 10 and
      // scaled as it flashes (TWINKLE); painted over the light (source-over).
      if (k === 'twinkle') I.bright.slice(0, TWINKLE.points).forEach((b, i) => {
        const glint = new Container(), halo = new Sprite(radial('255,255,255')), shape = new Graphics();
        halo.anchor.set(0.5); halo.width = halo.height = 15; halo.alpha = TWINKLE.halo;
        star(shape, 0, 0, 10, 1, 0xffffff, false);
        glint.addChild(halo, shape); glint.position.set(Math.round(X(b[0])), Math.round(Y(b[1]))); glint.alpha = 0; solid.addChild(glint);
        fx.push({ p, k, g: glint, i, seed, u: Math.max(1, Math.round(tile / 32)) });
      });
    }
  }
  return {
    root,
    update(state) { const W = state.floor.w; for (const e of fx) e.on = !!state.vis?.[e.p.y * W + e.p.x]; },
    tick(now, reduced) {
      const t = now / 1000;
      for (const e of fx) {
        if (e.k === 'orb') { e.g.visible = e.on; e.g.alpha = 0.6 + (reduced ? 0 : 0.3 * Math.sin(now / 300)); continue; }
        if (e.k === 'pixelflame') { e.g.visible = e.on; if (e.on && !(now - (e.last ?? -1e9) < 66)) e.last = now, pixelFlame(e.g, e.bx, e.by, e.H, e.wide, e.u, reduced ? 0 : t, e.seed, reduced ? 0 : now, e.palette, e.spark); continue; }
        if (!e.on || reduced) { e.g.alpha = 0; if (e.spark) e.spark.alpha = 0; continue; }
        if (e.k === 'glow' || e.k === 'flicker') {
          const puls = e.k === 'flicker' ? 0.55 + 0.25 * Math.sin(t * 9 + e.seed) + 0.2 * Math.sin(t * 23 + e.seed * 2) : 0.6 + 0.4 * Math.sin(t * 1.7 + e.seed);
          e.g.alpha = 0.28 * puls;
        } else if (e.k === 'flames') {
          const fk = 0.6 + 0.25 * Math.sin(t * (8 + e.i % 3) + e.seed + e.i * 1.7) + 0.15 * Math.sin(t * 21 + e.seed * 2 + e.i);
          e.g.alpha = 0.34 * fk;
          e.spark.alpha = fk > 0.72 ? (fk - 0.72) * 2.2 : 0;
        } else if (e.k === 'twinkle') {
          const a = twinkleAt(t, e.i, e.seed);
          e.g.alpha = a < 0.05 ? 0 : a * TWINKLE.alpha; e.g.scale.set(Math.round(e.u * (1 + TWINKLE.grow * a)) / 10);
        } else if (e.k === 'embers' || e.k === 'spores') {
          const ph = (t * 0.5 + e.i / 3 + e.seed * 0.013) % 1;
          e.g.position.set(Math.round(e.x0 + Math.sin(t * 1.3 + e.i * 2.1 + e.seed) * e.w * 0.12), Math.round(e.y0 - ph * e.h * 0.8));
          e.g.alpha = (1 - ph) * 0.8;
        } else if (e.k === 'arcs') {
          e.g.clear();
          if ((t * 2.2 + e.seed) % 1 < 0.35) {
            const [x0, y0] = e.pts[0], [x1, y1] = e.pts[1 + (Math.floor(t * 7) % (e.pts.length - 1))], j = Math.floor(t * 20);
            e.g.moveTo(x0, y0);
            for (let s2 = 1; s2 < 5; s2++) { const f = s2 / 5; e.g.lineTo(x0 + (x1 - x0) * f + (hash2(s2, j, 9) - 0.5) * e.u * 6, y0 + (y1 - y0) * f + (hash2(s2, j, 11) - 0.5) * e.u * 6); }
            e.g.lineTo(x1, y1).stroke({ color: 0xf4f8ff, width: e.u, alpha: 0.9 });
          }
          e.g.alpha = 1;
        }
      }
    },
  };
}
