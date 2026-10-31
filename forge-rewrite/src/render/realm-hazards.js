// The Realm's and the planes' hazards (M10, render-28: moved out of realm-view.js): chaos hazard bursts, lava, deep
// water and wind, and the poison trails with their pools (the Green Slimes' trail layer too).

import { Container, Graphics, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { T } from '../data/tiles.js';
import { hash2 } from '../lib/noise.js';
import { PORTAL_COLOUR } from '../data/palette.js';
import { ROCK } from '../data/rock.js';
import { noise as ptVal } from '../lib/noise.js';
import { poolRaster } from './pool-raster.js';
import { openMask } from './plane-anim.js';
import { wallish, hexN, reduced, liveState, inSight, known, animate } from './realm-kit.js';
import { glowSprite } from './realm-life.js';

/** 1.7's poolFx for the islands whose pools bubble (chaos-preview-render.js:48, :67): fill, rim, highlight, sheen, ring. */
export const CHAOS_POOL_FX = {
  rot: [[0x3c8c5c, 0.5], [0x96e2a4, 0.8], [0xe2fad4, 0.9], [0xbfefc8, 1], [0xaae8b0, 0.3]],
  violet: [[0x705cbe, 0.5], [0xcabaff, 0.85], [0xf0e8ff, 0.95], [0xd6c6ff, 1], [0xd6c6ff, 0.3]],
};
const POISON_PARTS = [0xb7e07a, 0x6fa040, 0x4e7a2a];   // fx.js TRAIL.poison
const HAZARD_FX = new WeakMap();   // floor -> {ids: the patches already seen, parts: the bursts in flight}; outlives a rebuild
/**
 * chaos-enemy-art.js drawHazards: the poison patches (a Plague Bloat's vent, a Bile Spitter's or Brood Carrier's bile)
 * are chaos-hazard fields, drawn with every floor's fields (fields-view.js, M5: the pool at .92 and drawFieldMist).
 * What stays here: a new patch bursts as it lands (chaos-enemies.js:194 burst(x, y, 'poison', 3, .03) on each tile in
 * sight), three poison motes a tile, flung out and fading, not under reduced motion (fx.js particle).
 */
export function hazardBursts(floor, tile) {
  const W = floor.w, parts = new Graphics(), patches = () => (floor.fields ?? []).filter(r => r.kind === 'chaos-hazard');
  parts.blendMode = 'add';
  let fx = HAZARD_FX.get(floor);
  if (!fx) { fx = { ids: new Set(patches().map(h => h.id)), parts: [] }; HAZARD_FX.set(floor, fx); }   // a patch already down when the floor is drawn does not burst
  let key = null, last = performance.now();
  return animate(parts, now => {
    const hs = patches(), k = hs.map(h => h.id + ':' + h.cells.join('.')).join(',');
    if (k !== key) {
      key = k;
      // The burst: each patch this floor has not shown before, on its tiles in sight.
      for (const h of hs) {
        if (fx.ids.has(h.id)) continue;
        fx.ids.add(h.id);
        if (reduced()) continue;
        for (const t of h.cells.map(k => ({ x: k % W, y: (k / W) | 0 }))) {
          if (!inSight(floor, t.y * W + t.x)) continue;
          for (let n = 0; n < 3; n++) {
            const a = Math.random() * Math.PI * 2, sp = Math.random() * 0.03, life = 520 * (0.6 + Math.random() * 0.8);
            fx.parts.push({ x: t.x + 0.5, y: t.y + 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 0.01 * 4, life, max: life, col: POISON_PARTS[Math.floor(Math.random() * 3)], size: 2.6 * (0.7 + Math.random() * 0.8) });
          }
        }
      }
    }
    // The motes: fx.js moves them 0.06 x velocity a millisecond, shrinking to 0.35 and fading over their life.
    const ms = Math.min(64, performance.now() - last); last = performance.now();
    parts.clear();
    fx.parts = fx.parts.filter(q => (q.life -= ms) > 0);
    for (const q of fx.parts) {
      q.x += q.vx * ms * 0.06; q.y += q.vy * ms * 0.06;
      const lf = q.life / q.max, sz = q.size * (0.35 + 0.65 * lf) * tile / 48;
      parts.rect(q.x * tile - sz / 2, q.y * tile - sz / 2, sz, sz).fill({ color: q.col, alpha: Math.min(1, lf * 1.4) });
    }
  });
}
/** portals.js drawPortalTelegraphs: the open portal's swirl of 14 motes in the plane's colour. */
export function swirl(x, y, el, tile) {
  const col = hexN(PORTAL_COLOUR[el] ?? '#FFFFFF'), cx = (x + 0.5) * tile, cy = (y + 0.18) * tile, rx = tile * 0.42, ry = tile * 0.56;   // the 1.7-tile arch's opening
  const c = new Container(), core = glowSprite(cx, cy, rx * 1.2, ry * 1.2, col, 0.6), dots = new Graphics();
  c.addChild(core, dots);
  animate(dots, t => {
    core.alpha = 0.55 + 0.15 * Math.sin(t * 2.4);
    dots.clear();
    for (let i = 0; i < 14; i++) {
      const a = t * (1.6 + (i % 3) * 0.4) + i * 0.9, rr = (0.25 + 0.75 * ((i * 37 % 10) / 10)) * (1 - ((t * 0.6 + i * 0.13) % 1) * 0.6), s = Math.max(1.5, tile * 0.045);
      dots.rect(cx + Math.cos(a) * rx * rr - s / 2, cy + Math.sin(a) * ry * rr - s / 2, s, s).fill({ color: i % 3 === 0 ? 0xffffff : col, alpha: 0.95 });
    }
  });
  return c;
}
/** planesfwa.js fwaDrawLava: crust drifting on the flow and a soft heat over it. */
export function lava(floor, tile) {
  const W = floor.w, cells = [], isLava = (x, y) => x >= 0 && y >= 0 && x < W && y < floor.h && floor.tiles[y * W + x] === T.LAVA, M = ROCK.fire, rgb = a => (a[0] << 16) | (a[1] << 8) | a[2];
  for (let i = 0; i < floor.tiles.length; i++) if (floor.tiles[i] === T.LAVA) cells.push([i % W, (i / W) | 0]);
  if (!cells.length) return null;
  const c = new Container(), heat = cells.map(([x, y]) => { const s = glowSprite((x + 0.5) * tile, (y + 0.5) * tile, tile * 0.8, tile * 0.8, rgb(M.poolRim), 0.16); s.blendMode = 'add'; return s; }), crust = new Graphics();
  c.addChild(crust, ...heat);
  animate(crust, t => {
    crust.clear();
    cells.forEach(([x, y], n) => {
      const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => !isLava(x + dx, y + dy)).length;
      heat[n].alpha = (0.16 + 0.07 * Math.sin(t * 1.6 + x * 0.7 + y * 0.5)) * (open ? 1.5 : 1);
      if (open) return;
      for (let k = 0; k < 3; k++) {
        const h1 = hash2(x * 2 + k, y * 2, 911), h2 = hash2(x * 2 + k, y * 2 + 1, 913), ox = x * tile + ((h1 + t * 0.03 * (1 + k * 0.3)) % 1) * tile, oy = y * tile + h2 * tile * 0.7 + tile * 0.15;
        crust.ellipse(ox, oy, tile * (0.14 + h1 * 0.11), tile * (0.07 + h2 * 0.05)).fill({ color: rgb(M.topLo), alpha: 0.8 });
        crust.rect(Math.round(ox - tile * 0.1), Math.round(oy - tile * 0.09), Math.max(1, Math.round(tile * 0.2)), 1).fill({ color: rgb(M.poolEdge), alpha: 0.45 });
      }
    });
  });
  return c;
}
/** planesfwa.js fwaDrawDeep: the deep as overlapping circles, its waterline the wider ring, a slow band of light. */
export function deepWater(floor, tile) {
  const W = floor.w, D = floor.deep ?? [], cells = Array.isArray(D) ? D.map(i => (typeof i === 'number' ? [i % W, (i / W) | 0] : [i.x, i.y])) : [];
  if (!cells.length) return null;
  const M = ROCK.water, band = new Graphics(), c = new Container();
  // One path of circles filled once (canvas), so overlaps union instead of stacking.
  const x0 = Math.min(...cells.map(q => q[0])) - 1, y0 = Math.min(...cells.map(q => q[1])) - 1, x1 = Math.max(...cells.map(q => q[0])) + 2, y1 = Math.max(...cells.map(q => q[1])) + 2, P = 32;
  const cv = document.createElement('canvas'); cv.width = (x1 - x0) * P; cv.height = (y1 - y0) * P;
  const g = cv.getContext('2d'), ring = r => { const p = new Path2D(); for (const [x, y] of cells) { const cx = (x - x0 + 0.5) * P, cy = (y - y0 + 0.5) * P; p.moveTo(cx + r, cy); p.arc(cx, cy, r, 0, 6.2832); } return p; };
  g.globalAlpha = 0.3; g.fillStyle = `rgb(${M.poolRim})`; g.fill(ring(P * 0.84));
  g.globalAlpha = 0.42; g.fillStyle = `rgb(${M.pool})`; g.fill(ring(P * 0.74));
  const sp = new Sprite(Texture.from(cv)); sp.position.set(x0 * tile, y0 * tile); sp.width = (x1 - x0) * tile; sp.height = (y1 - y0) * tile;
  c.addChild(sp, band);
  animate(band, t => { band.clear(); for (const [x, y] of cells) { const sh = (t * 0.12 + hash2(x, y, 301)) % 1; if (sh >= 0.6) continue; band.ellipse((x + sh * 1.2) * tile, (y + 0.5) * tile, tile * 0.3, tile * 0.07).fill({ color: hexN(M.poolLight), alpha: 0.13 * Math.sin(sh / 0.6 * Math.PI) }); } });
  return c;
}
/** planesfwa.js fwaDrawWind: pale streaks drifting across the open floor of the Plane of Air. */
export function wind(floor, tile, seed) {
  let s = (seed ^ 0x5a17) >>> 0;
  const r = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const list = []; for (let i = 0; i < 90; i++) list.push({ x: r() * floor.w, y: r() * floor.h, ph: r(), sp: 0.25 + r() * 0.5, len: 0.7 + r() * 1.6, a: 0.25 + r() * 0.45 });
  const g = new Graphics(); g.blendMode = 'add';
  animate(g, t => {
    g.clear();
    if (reduced()) return;   // planesfwa.js:694: no streaks under reduced motion
    const ang = Math.sin(t * 0.07) * 0.6 - 0.35, dx = Math.cos(ang), dy = Math.sin(ang) * 0.55, st = liveState(floor);
    for (const w of list) {
      const travel = (t * w.sp + w.ph) % 1, wx = w.x + dx * (travel - 0.5) * 14, wy = w.y + dy * (travel - 0.5) * 14, cx = Math.floor(wx), cy = Math.floor(wy);
      if (cx < 0 || cy < 0 || cx >= floor.w || cy >= floor.h || wallish(floor.tiles[cy * floor.w + cx])) continue;
      if (st && !st.vis?.[cy * floor.w + cx]) continue;   // planesfwa.js:702: only where the streak's head cell is in sight
      const px = wx * tile, py = wy * tile, lx = dx * w.len * tile, ly = dy * w.len * tile;
      g.moveTo(px, py).quadraticCurveTo(px + lx * 0.5, py + ly * 0.5 - tile * 0.12, px + lx, py + ly).stroke({ color: 0xe8f4ff, width: Math.max(1, tile * 0.035), alpha: w.a * Math.sin(travel * Math.PI) * 0.45 });
    }
  });
  return g;
}


/**
 * The Plague Bloat's trail (its plague-trail field rows, one cell each; C10b), as 1.7's green-slime.js
 * draw() paints it: drawGroundMaterial('poison') over the known cells, one connected pool with a soft shore (cryptset.js
 * oozeRaster, poison material), each cell's patch fading with the most time left among its trail neighbours over 200
 * (1.7: expiresAt - now; now is floor.fieldNow, stamped by the rules each pulse). Off walls (plane-anim.js openMask). Redrawn when
 * the trail changes; the check runs on the shared clock.
 */
export function trailLayer(floor, tile) {
  const root = new Container(), W = floor.w, mask = openMask(floor, tile, (x, y) => wallish(floor.tiles[y * W + x]));
  let key = null, pic = null;
  // The mask joins the display list only while it masks something: on its own it would paint every open cell white.
  return animate(root, () => {
    const tr = trailCells(floor, 'plague-trail'), cells = Object.keys(tr).map(Number).filter(i => tr[i]?.known);
    const k = cells.map(i => i + ':' + tr[i].expiresAt).join(',');
    if (k === key) return;
    key = k; pic?.destroy(true); pic = null;
    if (mask.parent) root.removeChild(mask);
    if (!cells.length) return;
    const now = floor.fieldNow ?? 0;   // the rules stamp the world clock each pulse
    pic = poisonPool(floor, cells, tr, now, tile);
    root.addChild(pic, mask); pic.mask = mask;
  });
}
/**
 * EP1: a Green Slime's trail on an ordinary floor (slime-trail fields, chaos-ai.js), drawn as 1.7 green-slime.js draw() does:
 * the same poison pool as the Plague Bloat's, over the cells known and in sight or remembered (1.7 sceneVisibility ||
 * known && seen), each fading over its last 2 turns. Under the light map, so it is lit like the ground. EP29: a cell out
 * of sight is drawn at memA(.4) (cryptset.js drawGroundMaterial: opacity * (vis ? 1 : memA(.4))), full under the light
 * map, which shades it as memory, and .4 with Lighting off. The picture is made again only when a cell joins, leaves,
 * is inside its last 200 units, or (Lighting off) comes into or goes out of sight.
 * Item 146 (Justin 2026-10-18: "slime trails from slimes didn't seem to show on the ground consistently"): the map
 * called update only when the hero's sight changed, so a slime that moved while he stood, fought or waited left no
 * pool until his next step, and an old pool never faded. Given the map's clock, it looks again each frame on the last
 * state it was given (the map's one frame loop, C6) and is made again only when its key changes.
 */
export function slimeTrailLayer(clock = null) {
  const root = new Container();
  let key = null, pic = null, last = null;
  const layer = {
    root,
    update(state, tile, lighting = true) {
      last = [state, tile, lighting];
      const f = state.floor, tr = f ? trailCells(f, 'slime-trail') : {};
      const cells = Object.keys(tr).map(Number).filter(k => tr[k].known && (state.vis?.[k] || state.seen?.[k]));
      const now = f?.fieldNow ?? 0, mem = lighting ? 1 : 0.4;
      const dim = mem === 1 ? null : ck => (state.vis?.[ck] ? 1 : mem);
      let k = cells.length ? `${f.w}|${tile}|` + cells.map(i => i + ':' + Math.max(0, Math.min(200, tr[i].expiresAt - now))).join(',') : '';
      if (k && dim) {   // the pool's shore runs a cell past the trail: those cells' sight counts too
        const W = f.w, near = new Set();
        for (const i of cells) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) near.add(i + dy * W + dx);
        k += '|' + [...near].filter(i => state.vis?.[i]).join('.');
      }
      if (k === key && pic?.parent === root) return;
      key = k; pic?.destroy(true); pic = null;
      if (!cells.length) return;
      pic = poisonPool(f, cells, tr, now, tile, 1, dim);
      root.addChild(pic);
    },
  };
  clock?.onFrame(() => { if (last) layer.update(...last); }, { owner: root });
  return layer;
}
const trailCells = (floor, kind) => Object.fromEntries((floor.fields ?? []).filter(r => r.kind === kind).flatMap(r => r.cells.map(k => [k, { expiresAt: r.until, known: !!r.known }])));
function poisonPool(floor, cells, tr, now, tile, opacity = 1, dim = null) {
  const W = floor.w, set = new Set(cells), salt = 7, fade = new Map();
  const left = (x, y) => { let l = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const t = tr[(y + dy) * W + x + dx]; if (t && set.has((y + dy) * W + x + dx)) l = Math.max(l, t.expiresAt - now); } return Math.max(0, Math.min(1, l / 200)); };
  const pool = poolRaster(floor, cells, { salt, colour: ({ wx, wy, cx, cy, deep, shore, facing }) => {
    const ck = cy * W + cx; if (!fade.has(ck)) fade.set(ck, left(cx, cy) * (dim ? dim(ck) : 1));
    const op = fade.get(ck); if (!(op > 0)) return null;
    let col, a;
    if (shore) {
      const glint = ptVal(wx * 6.5, wy * 6.5, salt + 9), lit = facing() > 0.004 && glint > 0.62;
      col = lit ? [130, 196, 92] : glint < 0.3 ? [40, 96, 34] : [24, 70, 28]; a = lit ? 210 : glint < 0.3 ? 150 : 215;
      col = [col[0] * 0.6 + 14, col[1] * 0.66 + 12, col[2] * 0.55 + 10];
    } else { col = [37 + deep * 8, 70 + deep * 8, 34 + deep * 4]; a = Math.round(150 + 50 * deep); }
    a = Math.min(225, a + 12);
    const grain = (ptVal(wx * 19, wy * 19, salt + 23) - 0.5) * 22 * 0.45;
    return [Math.max(0, Math.min(255, col[0] + grain)), Math.max(0, Math.min(255, col[1] + grain)), Math.max(0, Math.min(255, col[2] + grain)), a * op * opacity];
  } });
  const sp = new Sprite(Texture.from(pool.canvas)); sp.position.set(pool.x0 * tile, pool.y0 * tile); sp.width = (pool.x1 - pool.x0 + 1) * tile; sp.height = (pool.y1 - pool.y0 + 1) * tile;
  return sp;
}
