// The Realm and planes view's shared helpers (M10, render-28: moved out of realm-view.js): scale constants, the floor's
// salts and live state (what is in sight, remembered, its fade), the shared frame clock and animate(), and the small
// canvas drawing helpers. A leaf: it imports none of the realm-* modules.

import { Ticker } from '../../../forge-godot/runtime/pixi.js';
import { loadGroup } from './art-store.js';
// The realm view's one way to the loaded sheets (render-26): its other modules read them through here.
export { sheet, hasSheet, loadSheet, alsoLoad } from './art-store.js';
import { isWallTile } from '../data/tiles.js';

export const R = 32;              // 1.7's scenery units a tile (chaos-preview-render.js R)
export const VP = 48;             // void canvas pixels a tile
export const VC = 12;             // void chunk, in tiles
export const RS = 128;            // raster samples a tile: 1.7's (environment-terrain.js S, planeterrain.js PT_R), painted once (WT7)
export const RC = 4;              // raster chunk, in tiles (a chunk at 128 is about a second in a worker; 1.7 painted single cells)
export const wallish = isWallTile;
export const hexN = h => parseInt(h.slice(1), 16);
// For tools (tools/mapgen/board/capture-realm.mjs): load the Realm's and planes' art groups into the page's loader.
if ((typeof __FORGE_PUBLIC__ === 'undefined' || !__FORGE_PUBLIC__) && typeof window !== 'undefined') window.forgeRealm = { loadGroups: names => Promise.all(names.map(n => loadGroup(n).catch(e => console.warn('group', n, e.message)))) };

// The raster's salt by floor, so the plane's glints catch the very crystals and veins the raster painted.
export const SALTS = new WeakMap(), motionSalt = f => SALTS.get(f) ?? 911;
export const STATES = new WeakMap();   // the game a floor was drawn for: the plane's motion reads its bodies (the Night Warden's shroud)

// ---- one shared clock for everything that moves here (portals, currents, lava, wind, swirls)
// The map's clock (map-view.js hands it over): reduced motion lives there (clock.js).
let realmClockRef = null;
/** map-view.js: the animation clock, for reduced motion. */
export function realmClock(clock) { realmClockRef = clock; }
export const reduced = () => !!realmClockRef?.reduced;
/** The game a floor was drawn for, while it is still on that floor (its sight: vis, seen); null for tools. */
export const liveState = floor => { const s = STATES.get(floor)?.state; return s && s.floor === floor ? s : null; };
/** Whether a cell is in sight now (true when no game is attached: the board captures show everything). */
export const inSight = (floor, i) => { const s = liveState(floor); return !s?.vis || !!s.vis[i]; };
export const known = (floor, i) => { const s = liveState(floor); return !s?.seen || !!s.seen[i]; };
/** 1.7 memA: remembered things keep full strength under the light map (it shades them), else fade to `fade`. */
export const memA = (floor, fade) => (STATES.get(floor)?.view?.lighting === false ? fade : 1);
/** A piece's cells, for `where` below. */
export const footprint = (floor, x, y, w = 1, h = 1) => { const out = []; for (let yy = Math.floor(y); yy < Math.ceil(y + h); yy++) for (let xx = Math.floor(x); xx < Math.ceil(x + w); xx++) if (xx >= 0 && yy >= 0 && xx < floor.w && yy < floor.h) out.push(yy * floor.w + xx); return out; };
const movers = new Set();
let ticking = false;
/**
 * Runs fn(seconds) every frame while obj is shown. With `where` ({floor, cells}), the Realm's motion as 1.7 holds it
 * (chaos-preview-render.js, chaos-current-render.js: t = 0 under ANIM.reduce or out of sight): fn(t, sight) gets t = 0
 * when motion is reduced or none of the cells is in sight, and sight 'in' | 'mem' | 'none' (in sight, remembered, never
 * seen); a held frame is drawn once, not every frame. It runs while hidden, so fn may hide or dim its own piece.
 */
export function animate(obj, fn, where = null) {
  movers.add({ obj, fn, where, last: null });
  if (!ticking) {
    ticking = true;
    const each = realmClockRef ? f => realmClockRef.onFrame((dt, ms) => f(ms)) : f => Ticker.shared.add(() => f(performance.now()));   // render-16: the map's frame clock; tools, Pixi's ticker
    each(ms => { const now = ms / 1000;
      for (const m of movers) {
        if (m.obj.destroyed) { movers.delete(m); continue; }
        if (!m.obj.parent) continue;
        if (!m.where) { if (m.obj.visible !== false) m.fn(now); continue; }
        const { floor, cells } = m.where;
        const sight = cells.some(i => inSight(floor, i)) ? 'in' : cells.some(i => known(floor, i)) ? 'mem' : 'none';
        const t = reduced() || sight !== 'in' ? 0 : now, key = t ? null : sight;
        if (key !== null && key === m.last) continue;   // held still: drawn once
        m.last = key; m.fn(t, sight);
      }
    });
  }
  return obj;
}

// ---------------------------------------------------------------------------------------------- terrain

// ---- the void (chaos-preview-render.js buildMixed, buildRot / buildCinder / buildViolet / build with mixedForeground)
export function noise(x, y, s) { let n = Math.imul(x + 31, 374761393) ^ Math.imul(y + 17, 668265263) ^ (s || 0); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
export const path = (g, pts) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
export const polygon = (g, pts, fill) => { g.fillStyle = fill; path(g, pts); g.fill(); };
const ellipse = (g, x, y, rx, ry, fill) => { g.fillStyle = fill; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); };
export const hexA = (hex, a) => { const n = hexN(hex); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
