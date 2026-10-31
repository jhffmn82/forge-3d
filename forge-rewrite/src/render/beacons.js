// What glows over the map as 1.7 draws it (js/presentation/render/render.js drawMapBeacons, drawMapBeacon,
// mapBeaconGlow @3c8b312):
// - beacons: a soft additive glow on the stairs, the exit, the forge, a shrine and a gold chest (floor.lights entries
//   of kind 'beacon'); a way out also sends up a breathing column of light, so it reads from across a dark room
//   (Justin, 2026-10-14). The glow is dimmer on a tile only remembered, and not drawn on one never seen;
// - no glints on water (item 203, Justin 2026-10-19: "can we drop these weird marks in the water").
// Built once per floor; `update` follows sight; `tick` animates.

import { Container, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { T } from '../data/tiles.js';
import { beaconPropColour, floorLights } from './lights.js';

const glows = new Map();
function glowTexture(colour) {
  if (glows.has(colour)) return glows.get(colour);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), n = parseInt(colour.slice(1), 16), rgb = `${n >> 16 & 255},${n >> 8 & 255},${n & 255}`;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${rgb},1)`); grad.addColorStop(0.35, `rgba(${rgb},0.5)`); grad.addColorStop(0.72, `rgba(${rgb},0.09)`); grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = Texture.from(c);
  glows.set(colour, t);
  return t;
}

/** @param {any} floor @param {number} tile */
export function buildBeacons(floor, tile) {
  const root = new Container(), items = [];
  if (typeof document === 'undefined') return { root, update() {}, tick() {} };
  root.blendMode = 'add';
  const T_ = tile, W = floor.w;
  const addBeacon = l => {
    if (l.kind !== 'beacon') return;
    const t = floor.tiles[Math.floor(l.y) * W + Math.floor(l.x)], way = t === T.STAIRS || t === T.EXIT || !!l.way;   // l.way: a way on that is not stairs (a Chaos island's portal on, realm-view.js)
    const scale = t === T.FORGE ? 1.8 : t === T.SHRINE ? 1.6 : way ? 2.2 : 1;
    const tex = glowTexture(l.colour), cx = (l.x + 0.5) * T_, cy = (l.y + 1 - 0.42) * T_;
    const pool = new Sprite(tex);
    pool.position.set(cx - T_ * 0.58 * scale, cy - T_ * 0.52 * scale); pool.width = T_ * 1.16 * scale; pool.height = T_ * 1.04 * scale;
    root.addChild(pool);
    let column = null;
    if (way) { column = new Sprite(tex); root.addChild(column); }
    items.push({ l, t, pool, column, cx, cy, scale, admit: 0 });
  };
  for (const l of floorLights(floor)) addBeacon(l);
  // RC22: a live interactive prop (a cleansing shrine, an altar with a reward, a prisoner, a sealed elemental lock, an
  // unpulled lever) keeps a soft pool like a beacon's while it is live (1.7 drawMapBeacons, render.js:2116-2122).
  const propPools = new Map();
  const syncPropPools = state => {
    const live = new Set();
    for (const pr of state.floor.props ?? []) {
      if (pr.part) continue;
      const colour = beaconPropColour(state, pr);
      if (!colour) continue;
      const key = pr.x + ',' + pr.y;
      live.add(key);
      let b = propPools.get(key);
      if (!b || b.colour !== colour) {
        b?.pool.destroy();
        const scale = pr.cleansingShrine ? 1.25 : 1, pool = new Sprite(glowTexture(colour));
        const cx = (pr.x + 0.5) * T_, cy = (pr.y + 1 - 0.42) * T_;
        pool.position.set(cx - T_ * 0.58 * scale, cy - T_ * 0.52 * scale); pool.width = T_ * 1.16 * scale; pool.height = T_ * 1.04 * scale;
        root.addChild(pool);
        b = { pool, colour, l: { x: pr.x, y: pr.y }, admit: 0 };
        propPools.set(key, b);
      }
      const k = pr.y * W + pr.x;
      b.admit = state.vis?.[k] ? 1 : state.seen?.[k] ? 0.35 : 0;
    }
    for (const [key, b] of propPools) if (!live.has(key)) { b.pool.destroy(); propPools.delete(key); }
  };
  return {
    root,
    /** Follows sight: in view full, remembered 0.35, never seen nothing. */
    update(state) {
      // A boss can create the way out while this floor is already being drawn.
      const exit = state.floor.caveExit;
      if (exit && !items.some(b => b.l.x === exit.x && b.l.y === exit.y)) {
        addBeacon(floorLights(state.floor).find(l => l.kind === 'beacon' && l.x === exit.x && l.y === exit.y));
      }
      const vis = state.vis, seen = state.seen;
      syncPropPools(state);
      for (const b of items) { const k = Math.floor(b.l.y) * W + Math.floor(b.l.x); b.admit = vis?.[k] ? 1 : seen?.[k] ? (b.l.way ? 0.8 : 0.35) : 0; }   // a Chaos way on keeps glowing once seen (Justin's pick, 2026-10-16)
      // A gold chest's pool goes out once it is opened (1.7 render.js:2033-2036 reads the live chest tile; audit RC23).
      for (const b of items) if ((state.floor.chests ?? []).some(c => c.open && c.x === b.l.x && c.y === b.l.y)) b.admit = 0;
      // A way's column stands down while a body stands in it or on the two tiles above (1.7 render.js:2107-2113; audit RC47).
      for (const b of items) b.down = !!b.column && (state.order ?? []).some(id => {
        const a = state.actors[id];
        return a?.hp > 0 && a.x === b.l.x && a.y <= b.l.y && a.y >= b.l.y - 2 && (id === state.playerId || (!!vis?.[a.y * W + a.x] && !a.hidden && a.kind !== 'mawlimb'));
      });
      // the exit's look once it opens
      for (const b of items) if (b.l.exit && state.floor.exitOpen && b.l.open && !b.opened) { b.opened = true; b.pool.texture = glowTexture(b.l.open.colour); if (b.column) b.column.texture = b.pool.texture; }
    },
    tick(now, reduced) {
      for (const b of propPools.values()) b.pool.alpha = Math.min(1, b.admit * (reduced || b.admit < 1 ? 1 : 0.84 + 0.16 * Math.sin(now / 720 + b.l.x * 1.3 + b.l.y * 0.7)) * 0.14);
      for (const b of items) {
        const up = b.column && !b.down, open = b.t === T.STAIRS || b.opened || !!b.l.way, strength = up ? (open ? 2.6 : 1.8) : 1, rise = up ? (open ? 2.2 : 1.6) : 0;
        const pulse = reduced || b.admit < (b.l.way ? 0.8 : 1) ? 1 : 0.84 + 0.16 * Math.sin(now / 720 + b.l.x * 1.3 + b.l.y * 0.7);
        b.pool.alpha = Math.min(1, b.admit * pulse * 0.14 * strength);
        if (b.column) {
          const breath = reduced || b.admit < (b.l.way ? 0.8 : 1) ? 1 : 0.72 + 0.28 * Math.sin(now / 1100 + b.l.x * 0.9 + b.l.y * 1.7);
          b.column.position.set(b.cx - T_ * 0.42, b.cy - T_ * rise); b.column.width = T_ * 0.84; b.column.height = T_ * (rise + 0.5);
          b.column.alpha = up ? Math.min(1, b.admit * breath * 0.16 * strength) : 0;
        }
      }
    },
  };
}
