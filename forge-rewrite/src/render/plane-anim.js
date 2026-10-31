// What moves on an elemental plane, as 1.7 draws it (@3c8b312 js/world/planes/planeterrain.js):
// - ptPoolBubbles: on every pool cell a slow sheen drifting across, a ripple ring now and then (not on Shadow), and on
//   about one cell in three a bubble that swells and pops (Justin 2026-09-19: the still pools read as splotches);
// - drawVeinGlints: brief catches of light on the mineral veins in the rock near the open floor;
// - drawCrystalFaceGlints: a four-point star on the crystals growing out of the cliff faces, now and then;
// - ptSparkle: the same stars on the outcrops (pt-outcrop; a wall formation drawn from the pack has none, PT13);
// - ptGrassBlades: grass on a plane with moss colours (not the Earth plane's: its grass is the vegetation pack's) as
//   thin swaying blades;
// - drawMoonboundOverlay (portals.js:583-602, Justin 2026-09-20: "I'm not sure what he was doing"): the Night Warden
//   wears a dark shroud out of the crystals' light, where it cannot be hurt, and glows inside it.
// As 1.7: only on cells explored (glints, stars, grass) or in sight (pools); with reduced motion the glints and stars
// are off and the pools and grass hold still (planeterrain.js ANIM.reduce).
// Presentation only. realm-view.js stands it among the bodies on a plane (one line); its clock is realm-view's.

import { Container, Graphics, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { T, G } from '../data/tiles.js';
import { hash2 } from '../lib/noise.js';
import { veinAt, crystalAt } from './realm-raster.js';
import { ROCK } from '../data/rock.js';
import { radialTexture } from './stamps.js';
import { litByPlaneLight } from '../engine/reads.js';   // C17: the rules' answers through the engine (PLAN section 2)

// planeterrain.js PT_POOL_FX: bubble fill, bubble rim, highlight, sheen, ripple ring ([colour, alpha]). The Plane of
// Light has none: its pools are still water with the raster's painted caustic specks (planeterrain.js:402).
const FX = {
  shadow: [[0x6e46be, 0.55], [0xc8aaff, 0.85], [0xf0e4ff, 0.95], [0xd8c4ff, 1], null],
  earth: [[0x467846, 0.55], [0xaadc96, 0.8], [0xe6fad7, 0.9], [0xcdebb8, 1], [0xbee6aa, 0.35]],
  fire: [[0xff6e1e, 0.6], [0xffcc70, 0.9], [0xfff8dc, 0.95], [0xffb066, 1], [0xffa03c, 0.35]],
  water: [[0x5abedc, 0.5], [0xccf6ff, 0.85], [0xffffff, 0.95], [0xbfefff, 1], [0xbef0ff, 0.4]],
  air: [[0x96c8f0, 0.45], [0xdef0ff, 0.8], [0xffffff, 0.9], [0xe2f0ff, 1], [0xdef0ff, 0.35]],
};
const rgb = a => (a[0] << 16) | (a[1] << 8) | a[2];
/** The Night Warden's shroud out of the crystals' light (item 250): its colour, and its opacity over the body's middle. */
export const SHROUD = { color: 0x120e1e, alpha: 0.2 };

/**
 * Item 214 (Justin 2026-10-19: "weird blotches in water again, this should be sparkling"): a plane's water catches the
 * light in crisp four-point glints on its surface, one a pool cell, each flashing for a fifth of a second every 2 to 4 s
 * (in sight, not with reduced motion), on a plane whose pools sparkle (item 251, Justin 2026-10-20: "let's not have water
 * do both": planes.json terrainPalette.poolMotion, 'sparkle' or 'bubble'); never on lava. The ground's soft shimmer is
 * off on planes (lighting.js shimmerStrength).
 */
export function poolSparkles(floor, pool) {
  if (ROCK[floor.plane]?.poolMotion !== 'sparkle') return [];
  return [...pool].filter(i => floor.tiles[i] !== T.LAVA).map(i => {
    const x = i % floor.w, y = (i / floor.w) | 0;
    return { x, y, px: x + 0.15 + hash2(x, y, 300) * 0.7, py: y + 0.2 + hash2(x, y, 310) * 0.6, ph: hash2(x, y, 320), sp: 0.25 + hash2(x, y, 330) * 0.25 };
  });
}
const hex = h => parseInt(h.slice(1), 16);

/**
 * A four-point star (planeterrain.js ptStar) at (cx, cy), radius r, strength a. halo: false, the caller lays a soft one
 * (objanim.js); a function, called (x, y, radius, alpha, colour) to lay 1.7's radial glow (PT8); true, a flat disc.
 */
export function star(g, cx, cy, r, a, col, halo = true) {
  if (typeof halo === 'function') halo(cx, cy, r * 0.75, a * 0.13, col);
  else if (halo) g.circle(cx, cy, r * 0.75).fill({ color: col, alpha: a * 0.13 });
  const n = Math.max(0.45, r * 0.075);
  g.poly([cx, cy - r, cx + n, cy - n, cx + r * 0.7, cy, cx + n, cy + n, cx, cy + r, cx - n, cy + n, cx - r * 0.7, cy, cx - n, cy - n]).fill({ color: col, alpha: a * 0.72 });
  g.circle(cx, cy, Math.max(0.55, r * 0.09)).fill({ color: col, alpha: a });
}

/**
 * A mask of the open floor (every cell that is not wall), one rectangle per run of a row: whatever it masks never
 * lies on a wall (Justin 2026-10-16: "make sure they aren't painting liquids on to walls"). Put it beside the masked
 * object in the same container.
 * @param {{w:number,h:number}} floor @param {number} tile @param {(x:number,y:number)=>boolean} wall
 */
export function openMask(floor, tile, wall) {
  const g = new Graphics();
  for (let y = 0; y < floor.h; y++) for (let x = 0; x < floor.w; x++) {
    if (wall(x, y)) continue;
    let e = x;
    while (e + 1 < floor.w && !wall(e + 1, y)) e++;
    g.rect(x * tile, y * tile, (e - x + 1) * tile, tile);
    x = e;
  }
  return g.fill({ color: 0xffffff });
}

// PT10 (planeterrain.js:1290 ctx.ellipse(..., -0.25)): the pool sheen is a streak tilted a quarter radian up to the right.
const SLANT = -0.25, SC = Math.cos(SLANT), SS = Math.sin(SLANT);
function slant(g, cx, cy, rx, ry) {
  const pts = [];
  for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry; pts.push(cx + x * SC - y * SS, cy + x * SS + y * SC); }
  return g.poly(pts);
}

/**
 * planeterrain.js ptPoolBubbles for any pool: on each cell a sheen drifting across, a ripple ring now and then (when
 * `fx[4]` is given) and on about one cell in three a bubble that swells and pops. Shared: the planes, and the Crypt's
 * and the Chaos islands' pools can call it with their own cells and colours (FX has 1.7's per plane).
 * @param {{x:number,y:number}[]} cells @param {Array<[number, number]|null>} fx [fill, rim, highlight, sheen,
 *   ring|null], each [colour, alpha] @param {number} tile @param {Function} animate (obj, fn(seconds)) runner, e.g.
 *   realm-view's clock @param {Graphics} [mask] openMask(...): keeps it off walls
 * @param {{shown?: (x:number, y:number) => boolean, still?: () => boolean}} [opt] shown: whether a cell is drawn this
 *   frame (1.7 ptPoolBubbles: in sight); still: motion reduced, the clock held at 0
 * @returns {Container}
 */
export function poolLayer(cells, fx, tile, animate, mask = null, opt = {}) {
  const pools = cells.map(c => ({
    ...c, sh: hash2(c.x, c.y, 141), sy: 0.35 + 0.3 * hash2(c.x, c.y, 143), ring: !!fx[4] && hash2(c.x, c.y, 151) < 0.25, rph: hash2(c.x, c.y, 153) * 5,
    bub: hash2(c.x, c.y, 149) < 0.3, bph: hash2(c.x, c.y, 131) * 7, bx: 0.2 + 0.6 * hash2(c.x, c.y, 111), by: 0.2 + 0.6 * hash2(c.x, c.y, 121),
  }));
  const root = new Container(), g = new Graphics(), lw = Math.max(1, tile / 32);
  root.addChild(g);
  if (mask) { root.addChild(mask); g.mask = mask; }
  animate(root, now => {
    g.clear();
    const t = opt.still?.() ? 0 : now;
    for (const c of pools) {
      if (opt.shown && !opt.shown(c.x, c.y)) continue;
      const sh = (t * 0.1 + c.sh) % 1;
      if (sh < 0.7) slant(g, (c.x + sh * 1.2) * tile, (c.y + c.sy) * tile, tile * 0.24, tile * 0.05).fill({ color: fx[3][0], alpha: 0.12 * Math.sin(sh / 0.7 * Math.PI) });   // PT10: 1.7's sheen lies at -0.25
      if (c.ring) {
        const rp = ((t * 0.2 + c.rph) % 1) * 2.5;
        if (rp < 1) g.ellipse((c.x + 0.5) * tile, (c.y + 0.5) * tile, tile * (0.08 + 0.4 * rp), tile * (0.04 + 0.2 * rp)).stroke({ color: fx[4][0], alpha: fx[4][1] * (1 - rp), width: lw });
      }
      if (!c.bub) continue;
      const ph = ((t * 0.3 + c.bph) % 1) * 2;
      if (ph > 1) continue;
      const r = tile * 0.075 * Math.sin(ph * Math.PI), bx = (c.x + c.bx) * tile, by = (c.y + c.by) * tile;
      if (r < 0.8) continue;
      g.circle(bx, by, r).fill({ color: fx[0][0], alpha: fx[0][1] }).stroke({ color: fx[1][0], alpha: fx[1][1], width: lw });
      g.rect(bx - r * 0.45, by - r * 0.55, Math.max(1, r * 0.4), Math.max(1, r * 0.4)).fill({ color: fx[2][0], alpha: fx[2][1] });
    }
  });
  return root;
}

/**
 * Where a plane's minerals sit, for a weak light of their own (Justin 2026-10-16: "the mineral veins ... are supposed
 * to radiate light weakly"): the vein spots in the rock within 2 of open floor (drawVeinGlints' ptGlints) in the
 * material's vein colour, and the crystals growing from the cliff faces (the raster's ptCrystalAt) in its crystal
 * light. The open floor's own vein paint reaches the light through realm-view's accentField.
 * @param {any} floor @param {number} salt the raster's salt (realm-view.js planeSalt(floor))
 * @returns {{x:number,y:number,colour:string,kind:'vein'|'crystal'}[]} tile coordinates (fractional)
 */
export function planeVeinSources(floor, salt) {
  const M = ROCK[floor?.plane];
  if (!M) return [];
  const css = a => '#' + a.map(v => v.toString(16).padStart(2, '0')).join(''), out = [], spots = planeSpots(floor, salt);
  for (const [x, y] of spots.veins) out.push({ x: x + 0.2 + hash2(x, y, salt + 62) * 0.6, y: y + 0.25 + hash2(x, y, salt + 63) * 0.5, colour: css(M.vein), kind: 'vein' });
  for (const [x, y] of spots.crystals) out.push({ x: x + 0.5, y: y + 0.66, colour: M.crystalLight ?? M.crystal[1], kind: 'crystal' });
  return out;
}

/**
 * render-31: a plane's vein glints (rock within 2 of its open floor, realm-raster.js veinAt) and its cliff crystals
 * (rock over open ground, crystalAt; none on a plane without face crystals), as cells [x, y], once a floor and salt.
 */
const spotsOf = new WeakMap();
function planeSpots(floor, salt) {
  const kept = spotsOf.get(floor);
  if (kept?.salt === salt) return kept;
  const M = ROCK[floor.plane], W = floor.w, H = floor.h, wall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || floor.tiles[y * W + x] === T.WALL;
  const near = (x, y) => { for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) if (!wall(x + ox, y + oy)) return true; return false; };
  const veins = [], crystals = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (wall(x, y) && near(x, y) && veinAt(x, y, salt)) veins.push([x, y]);
  if (M?.faceCrystals !== false && M?.crystal) for (let y = 0; y < H - 1; y++) for (let x = 0; x < W; x++) if (wall(x, y) && !wall(x, y + 1) && crystalAt(x, y, salt)) crystals.push([x, y]);
  const out = { salt, veins, crystals };
  spotsOf.set(floor, out);
  return out;
}

let wardenGlowTex = null;
/** A white radial gradient from the centre out to nothing (planeterrain.js's glint and star glows, tinted); null off a page. */
const softDot = () => (typeof document === 'undefined' ? null : radialTexture('dot-1', [[0, 1], [1, 0]]));   // stamps.js (render-13)
/** portals.js drawMoonboundOverlay's glow: a radial gradient from a tenth of its radius out to nothing (white, tinted). */
function wardenGlow() {
  if (wardenGlowTex) return wardenGlowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return (wardenGlowTex = Texture.from(c));
}

/**
 * The plane's motion layer, or null off a plane. `animate(obj, fn)` is realm-view's shared clock (fn gets seconds);
 * `game()` the {state, view} the floor was drawn for (or null): the bodies, their sprites for the shroud, and the sight
 * (seen, vis) that picks the cells drawn, so nothing moves over unexplored black. `reduced()`: motion is reduced.
 * @param {any} floor @param {number} tile @param {number} salt the raster's salt (realm-view.js) @param {Function} animate
 * @param {() => any} [game] @param {() => boolean} [reduced]
 */
export function planeMotion(floor, tile, salt, animate, game = () => null, reduced = () => false) {
  const el = floor?.plane, M = ROCK[el];
  if (!M) return null;
  const W = floor.w, H = floor.h, wall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || floor.tiles[y * W + x] === T.WALL, spots = planeSpots(floor, salt);
  const fx = FX[el];
  // The game's sight while it is on this floor; with no game attached (the board captures) everything shows.
  const live = () => { const s = game()?.state; return s && s.floor === floor ? s : null; };
  const cellOf = (x, y) => Math.min(H - 1, Math.max(0, Math.floor(y))) * W + Math.min(W - 1, Math.max(0, Math.floor(x)));
  const seenAt = (s, x, y) => !s?.seen || !!s.seen[cellOf(x, y)];
  const visAt = (s, x, y) => !s?.vis || !!s.vis[cellOf(x, y)];
  // planeterrain.js ptPoolMask: the pool field, the water and the lava.
  const pool = new Set(floor.poolField ?? []);
  floor.tiles.forEach((t, i) => { if (t === T.WATER || t === T.LAVA) pool.add(i); });
  // Rock within 2 of the open floor (ptCellDist), where a vein region runs: ptGlints.
  const glints = [];
  for (const [x, y] of spots.veins) {
    glints.push({ x: x + 0.2 + hash2(x, y, salt + 62) * 0.6, y: y + 0.25 + hash2(x, y, salt + 63) * 0.5, ph: hash2(x, y, salt + 64), sp: 0.07 + hash2(x, y, salt + 65) * 0.1 });
  }
  // The cliff crystals the raster paints (realm-raster.js crystal): the first shard's tip catches the light.
  const faces = [];
  for (const [x, y] of spots.crystals) {
    const n = 1 + Math.floor(hash2(x, y, salt + 52) * 2), bx = 8 + hash2(x, y, salt + 53) * 16, by = Math.round(32 * 0.66);
    const ox = bx - (n - 1) / 2 * 3, oy = by + (hash2(x, y, salt + 95) - 0.5) * 3, h = 7 + hash2(x, y, salt + 60) * 8, lean = (hash2(x, y, salt + 80) - 0.5) * 4;
    faces.push({ x, y, px: x + (ox + lean) / 32, py: y + (oy - h + 1) / 32, ph: hash2(x, y, salt + 71), sp: 0.09 + hash2(x, y, salt + 72) * 0.1 });
  }
  // Formations and outcrops (ptSparkle): 4 stars on an outcrop, 2 on a big cluster, 1 on a small one; shown with the
  // piece, once its foot cell has been seen.
  const sparks = [];
  for (const p of floor.props ?? []) {
    // PT13 (planeterrain.js:1169): a wall formation drawn from the pack (always, on these six planes) has no stars of its
    // own: its crystal glints by its art (objanim.js), a stalagmite not at all. Outcrops keep theirs.
    if (p.part || p.id !== 'pt-outcrop') continue;
    const w = p.w ?? 1, h = p.h ?? 1, seed = (p.seed || 0) + p.x * 31 + p.y * 17, n = p.id === 'pt-outcrop' ? 4 : (p.size ?? 1) >= 1 ? 2 : 1;
    const bw = w * 0.7 * (p.id === 'pt-outcrop' ? 1.1 : 1), bh = p.id === 'pt-outcrop' ? 1.9 : (p.size ?? 1) >= 1 ? 1.4 : 0.7;
    const X = p.x + (w - bw) / 2, Y = p.y + h - bh;
    for (let k = 0; k < n; k++) sparks.push({ fx: p.x, fy: p.y + h - 1, x: X + bw * (0.2 + hash2(seed, k, 7) * 0.6), y: Y + bh * (0.18 + hash2(seed, k, 8) * 0.45), ph: hash2(seed, k, 5), sp: 0.1 + hash2(seed, k, 6) * 0.14, r: Math.max(3 / tile, 0.16 + 0.1 * hash2(seed, k, 9)) });
  }
  const crystalCol = hex(M.crystal?.[3] ?? '#FFFFFF');
  // Grass (ptGrassBlades): 5-8 blades a grass cell, each bending on its own beat. Not on the Earth plane: its grass is
  // the vegetation pack's Earth tufts (vegart.js vegSet, ground-view.js), as 1.7's drawGrassTile picks.
  const blades = [];
  if (M.moss && el !== 'earth') for (let i = 0; i < W * H; i++) {
    if (floor.ground?.[i] !== G.GRASS) continue;
    const x = i % W, y = (i / W) | 0, n = 5 + Math.floor(hash2(x, y, 41) * 4);
    for (let k = 0; k < n; k++) blades.push({ x, y, px: x + 0.12 + hash2(x, y, 50 + k) * 0.76, py: y + 0.55 + hash2(x, y, 60 + k) * 0.42, h: 0.3 + hash2(x, y, 70 + k) * 0.34, ph: hash2(x, y, 80 + k) * 6.28 + x * 0.6 + y * 0.35, col: rgb(M.moss[Math.floor(hash2(x, y, 90 + k) * M.moss.length)]), tip: k % 3 === 0 });
  }

  const root = new Container(), under = new Graphics(), over = new Graphics();
  over.blendMode = 'add';
  // PT7, PT8 (planeterrain.js:1145-1150, :1157-1160): the vein glints' and the stars' glows are soft radial gradients,
  // laid as tinted sprites from a pool under the stars' shapes, added on as 1.7's 'lighter'.
  const glows = new Container(), pool_ = [];
  let used = 0;
  const glow = (x, y, r, alpha, col) => {
    const tex = softDot(); if (!tex || !(alpha > 0)) return;
    let s = pool_[used];
    if (!s) { s = new Sprite(tex); s.anchor.set(0.5); s.blendMode = 'add'; glows.addChild(s); pool_.push(s); }
    used++; s.visible = true; s.position.set(x, y); s.width = s.height = r * 2; s.alpha = Math.min(1, alpha); s.tint = col;
  };
  if (fx && M.poolMotion === 'bubble') root.addChild(poolLayer([...pool].map(i => ({ x: i % W, y: (i / W) | 0 })), fx, tile, animate, openMask(floor, tile, wall), { shown: (x, y) => visAt(live(), x, y), still: reduced }));
  root.addChild(under, glows, over);
  const sparkles = poolSparkles(floor, pool);
  const shrouds = new Map();   // body id -> the Container on its sprite (1.7 draws the shroud after the body, over it)
  const hot = rgb(M.veinHot);
  animate(root, now => {
    under.clear(); over.clear(); used = 0;
    const s = live(), still = reduced(), t = still ? 0 : now;
    for (const b of blades) {
      if (!seenAt(s, b.x, b.y)) continue;
      const sway = Math.sin(t * 1.1 + b.ph) * tile * 0.11, px = b.px * tile, py = b.py * tile, h = b.h * tile;
      under.moveTo(px, py).quadraticCurveTo(px + sway * 0.4, py - h * 0.6, px + sway, py - h).stroke({ color: b.col, width: Math.max(1, tile * 0.045), cap: 'round' });
      if (b.tip) under.moveTo(px + sway * 0.5, py - h * 0.55).lineTo(px + sway, py - h).stroke({ color: 0xdcf0b4, alpha: 0.5, width: Math.max(1, tile * 0.02) });
    }
    // Glints and stars are off with reduced motion, as 1.7's.
    for (const g of still ? [] : glints) {
      if (!seenAt(s, g.x, g.y)) continue;
      const ph = (t * g.sp + g.ph) % 1;
      if (ph > 0.16) continue;   // a brief catch of light, then dark for a while
      const k = Math.sin(ph / 0.16 * Math.PI), px = g.x * tile, py = g.y * tile;
      glow(px, py, tile * 0.16, 0.45 * k, hot);   // veinHot at 0.45 in the middle, to nothing at the edge
      over.rect(px - 0.5, py - 0.5, Math.max(1, tile * 0.04), Math.max(1, tile * 0.04)).fill({ color: 0xfffcf0, alpha: 0.45 * k });
    }
    for (const c of still ? [] : faces) {
      if (!seenAt(s, c.x, c.y)) continue;
      const cyc = (t * c.sp + c.ph) % 1;
      if (cyc > 0.14) continue;
      star(over, Math.round(c.px * tile), Math.round(c.py * tile), Math.max(3, Math.round(tile * 0.13)), 0.6 * Math.sin(cyc / 0.14 * Math.PI), 0xffffff, glow);
    }
    const { state: st, view } = game() ?? {};
    if (st?.floor === floor && view?.sprite) for (const id of st.order ?? []) {
      const a = st.actors[id];
      if (!a || a.kind !== 'nightwarden') continue;
      const spr = view.sprite(id);
      let g = shrouds.get(id);
      if (!spr?.root || spr.root.destroyed) { shrouds.delete(id); continue; }
      if (!g || g.destroyed || g.parent !== spr.root) {
        // The shroud and the glow (portals.js:594's radial gradient, added on): one shows at a time. Item 250 (Justin
        // 2026-10-20: "shroud on nightwarden is too much"): the shroud is a faint veil, SHROUD.alpha over the body's middle
        // fading to nothing at its edge, so the Warden shows through it. Colour only: the light passes take neither.
        g = new Container(); g.twins = false;
        g.shroud = new Sprite(softDot()); g.shroud.anchor.set(0.5); g.shroud.tint = SHROUD.color; g.shroud.alpha = SHROUD.alpha;
        g.shroud.position.set(0, -tile * 0.5); g.shroud.width = tile * 1.1; g.shroud.height = tile * 1.2;
        g.glow = new Sprite(wardenGlow()); g.glow.anchor.set(0.5); g.glow.tint = 0xc9b2ff; g.glow.blendMode = 'normal';
        g.addChild(g.shroud, g.glow); spr.root.addChild(g); shrouds.set(id, g);
      }
      g.visible = a.hp > 0;
      if (a.hp <= 0) continue;
      // The sprite stands on its feet at the bottom of its tile: 1.7's centre, 0.55 of a tile down from the tile's top,
      // is 0.45 up from the feet, and the gradient runs out to 0.8 of a tile. Item 252 (Justin 2026-10-20: "showing when
      // he isn't immune"): lit where his sprite is drawn, as the rules judged the hit now playing there; his state is a
      // step ahead (a teleport into the dark right after a hit in the light).
      const lit = litByPlaneLight(floor, view.tileOf(spr));
      g.shroud.visible = !lit; g.glow.visible = lit;
      if (lit) { g.glow.position.set(0, -tile * 0.45); g.glow.width = g.glow.height = tile * 1.6; g.glow.alpha = 0.12 + 0.04 * Math.sin(t * 1000 / 260); }
    }
    for (const w of still ? [] : sparkles) {
      if (!visAt(s, w.x, w.y)) continue;
      const cyc = (t * w.sp + w.ph) % 1;
      if (cyc < 0.06) star(over, Math.round(w.px * tile), Math.round(w.py * tile), Math.max(2, Math.round(tile * 0.09)), 0.9 * Math.sin(cyc / 0.06 * Math.PI), 0xffffff, glow);
    }
    for (const sp of still ? [] : sparks) {
      if (!seenAt(s, sp.fx, sp.fy)) continue;
      const cyc = (t * sp.sp + sp.ph) % 1;
      if (cyc > 0.2) continue;   // brief, and rarely two at once
      const f = Math.sin(cyc / 0.2 * Math.PI), r = Math.max(3, Math.round(tile * sp.r));
      star(over, Math.round(sp.x * tile), Math.round(sp.y * tile), r, 0.75 * f, 0xffffff, glow);
      star(over, Math.round(sp.x * tile), Math.round(sp.y * tile), Math.round(r * 0.6), 0.5 * f, crystalCol, glow);
    }
    for (let i = used; i < pool_.length; i++) pool_[i].visible = false;
  });
  return root;
}
