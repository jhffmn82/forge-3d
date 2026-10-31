// The map overlay, as 1.7's (js/presentation/ui/automap.js @3c8b312, css/painted-ui.css:467-468): the Map button or
// M shows a faded outline of everything explored over the game view: a light veil, the walls that border explored
// ground, faint floor, water and chasm, door, lock, chest and found-trap dots, allies and foes in sight, and the hero's
// pulsing square. Stairs, the shrine, the Forge, portals and the exit get a symbol (with a short leader line when it
// had to move off its tile to clear another symbol or the HUD); selecting one walks there safely and closes the map.
// It never shows what the hero has not seen, and a hidden door not yet found still draws as wall.

import { Container, Graphics, Ticker } from '../../../../forge-godot/runtime/pixi.js';
import { T, tileAt } from '../../data/tiles.js';
import { travelPath } from '../../engine/travel.js';
import { litAt, seenAt } from '../../engine/reads.js';
import { color } from '../core/widgets.js';
import { icon } from '../core/icons.js';
import { itemArtName } from '../core/art.js';

// 1.7 AUTOMAP_SYMBOLS: a 24 px line drawing and its colour for each landmark.
export const LANDMARKS = {
  down: { label: 'Stairs down', color: 0xf2cf68, path: 'M3 19h6v-5h5V9h7 M5 3v7m-3-3 3 3 3-3' },
  up: { label: 'Stairs up', color: 0xf2cf68, path: 'M3 19h6v-5h5V9h7 M5 10V3m-3 3 3-3 3 3' },
  shrine: { label: 'Shrine', color: 0xccacff, path: 'M4 20h16M6 17h12M8 17v-5h8v5M5 12h14M12 2l2 4-2 4-2-4z' },
  forge: { label: 'Forge', color: 0xffad63, path: 'M3 7h18l-3 5h-5v5h4v3H7v-3h3v-5H6zM7 3l2 2m8-2-2 2' },
  portal: { label: 'Portal', color: 0x80ddda, path: 'M5 21V10a7 7 0 0 1 14 0v11M3 21h18M14 8c-5-2-7 6-3 8 3 2 6-3 2-4' },
  exit: { label: 'Exit', color: 0xf2cf68, path: 'M5 21V3h13v18M3 21h18M8 6h7v15M12 13h1' },
};
const KIND = { [T.STAIRS]: 'down', [T.STAIRS_UP]: 'up', [T.SHRINE]: 'shrine', [T.FORGE]: 'forge', [T.PORTAL]: 'portal', [T.EXIT]: 'exit' };
const DOORS = [T.DOOR, T.OPEN_DOOR, T.LOCKED, T.SEALED, T.ICE_DOOR, T.THORNS, T.TOLL];
const isWall = t => t === T.WALL || t === T.SECRET;

const known = seenAt;
/** 1.7 automapWallEdge: a wall shows only where it borders explored open ground (an outline, not a block). */
function wallEdge(s, x, y) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (known(s, x + dx, y + dy) && !isWall(tileAt(s.floor, x + dx, y + dy))) return true;
  return false;
}

/** 1.7 automapFrame: the explored outline fitted into the middle of the view with smaller tiles. */
export function mapFrame(s, W, H) {
  const p = s.actors[s.playerId], f = s.floor;
  let left = p.x, right = p.x, top = p.y, bottom = p.y;
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    if (!known(s, x, y) || (isWall(tileAt(f, x, y)) && !wallEdge(s, x, y))) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  const cell = Math.min(18, (W * 0.64) / (right - left + 1), (H * 0.64) / (bottom - top + 1));
  return { cell, ox: W / 2 - ((left + right + 1) * cell) / 2, oy: H / 2 - ((top + bottom + 1) * cell) / 2 };
}

/** The landmarks the hero has seen: one per stairs, shrine, Forge and exit, one per portal however many tiles it spans. */
export function landmarksOf(s) {
  const f = s.floor, out = [];
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const kind = KIND[tileAt(f, x, y)];
    if (!kind || !known(s, x, y)) continue;
    const joined = kind === 'portal' && out.find(q => q.kind === 'portal' && x >= q.x - 1 && x <= q.x + q.w && y >= q.y - 1 && y <= q.y + q.h);
    if (joined) { const r = Math.max(joined.x + joined.w, x + 1), b = Math.max(joined.y + joined.h, y + 1); joined.x = Math.min(joined.x, x); joined.y = Math.min(joined.y, y); joined.w = r - joined.x; joined.h = b - joined.y; continue; }
    out.push({ kind, x, y, w: 1, h: 1 });
  }
  for (const q of out) q.id = `${q.kind}:${q.x}:${q.y}`;
  // H03, 1.7 drawBaseAutomap: the Crucible's Forge of the Elements (rules/unmaker.js trueForgeAt) gets the Forge symbol
  // once any tile of its footprint has been seen.
  const tf = f.crucible?.trueForge;
  if (tf) {
    let seen = false;
    for (let y = tf.y; y < tf.y + tf.h && !seen; y++) for (let x = tf.x; x < tf.x + tf.w; x++) if (known(s, x, y)) { seen = true; break; }
    if (seen) out.push({ id: 'forge:final', kind: 'forge', label: 'Forge of the Elements', x: tf.x, y: tf.y, w: tf.w, h: tf.h });
  }
  return out;
}

/**
 * 1.7 automapWalkTo: a safe route next to the landmark (Explore's rules: no traps, hazards or portals on the way), or
 * 'near' when the hero is already beside it, or null when there is none.
 */
export function routeTo(s, q) {
  const p = s.actors[s.playerId];
  if (Math.max(Math.max(q.x - p.x, 0, p.x - (q.x + q.w - 1)), Math.max(q.y - p.y, 0, p.y - (q.y + q.h - 1))) <= 1) return 'near';
  if (q.w === 1 && q.h === 1) return travelPath(s, q.x, q.y, { explore: true, stopAdjacent: true });
  let best = null;
  for (let y = q.y - 1; y <= q.y + q.h; y++) for (let x = q.x - 1; x <= q.x + q.w; x++) {
    if ((x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h) || !known(s, x, y)) continue;
    const r = travelPath(s, x, y, { explore: true });
    if (r && (!best || r.length < best.length)) best = r;
  }
  return best;
}

const clear = (r, W, H, blocked) => r.left >= 0 && r.top >= 0 && r.right <= W && r.bottom <= H && blocked.every(b => r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom);

/** 1.7 automapPlaceLandmarks: each symbol on its tile, or the nearest free spot on rings around it. */
export function placeLandmarks(points, frame, W, H, size, blocked = []) {
  const placed = [], half = size / 2;
  const apart = (x, y) => placed.every(q => Math.abs(x - q.cx) >= size + 2 || Math.abs(y - q.cy) >= size + 2);
  for (const p of points) {
    const ax = frame.ox + (p.x + p.w / 2) * frame.cell, ay = frame.oy + (p.y + p.h / 2) * frame.cell;
    let chosen = null;
    for (let ring = 0; ring <= 8 && !chosen; ring++) for (let step = 0; step < (ring ? 8 * ring : 1); step++) {
      const a = (step * Math.PI * 2) / (8 * ring || 1), r = ring * (size / 2 + 2);
      const x = Math.max(half, Math.min(W - half, ax + Math.cos(a) * r)), y = Math.max(half, Math.min(H - half, ay + Math.sin(a) * r));
      if (clear({ left: x - half, top: y - half, right: x + half, bottom: y + half }, W, H, blocked) && apart(x, y)) { chosen = { cx: x, cy: y }; break; }
    }
    for (let y = half; y <= H - half && !chosen; y += size + 2) for (let x = half; x <= W - half; x += size + 2) {
      if (clear({ left: x - half, top: y - half, right: x + half, bottom: y + half }, W, H, blocked) && apart(x, y)) { chosen = { cx: x, cy: y }; break; }
    }
    placed.push({ ...(chosen ?? { cx: ax, cy: ay }), ax, ay, point: p });
  }
  return placed;
}

const svgOf = (path, hex) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${path}" fill="none" stroke="${hex}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const hexOf = n => '#' + n.toString(16).padStart(6, '0');

/**
 * @param {ReturnType<import('../core/widgets.js').createKit>} kit
 * @param {import('../core/stage.js').Stage} stage
 * @param {{blocked:()=>{left:number,top:number,right:number,bottom:number}[], walk:(path:object[])=>void, close:()=>void,
 *   say:(w:string)=>void, reduced:()=>boolean}} acts
 */
export function buildAutomap(kit, stage, acts) {
  const root = new Container();
  root.label = 'automap';
  root.eventMode = 'passive';   // only the symbols take taps; the map under it keeps its own
  const W = stage.w, H = stage.h, size = stage.touch ? 44 : 36, pad = stage.touch ? 9 : 6;
  const base = new Graphics(), hero = new Graphics(), lines = new Graphics(), marks = new Container(), drops = new Container();
  base.eventMode = hero.eventMode = lines.eventMode = 'none';
  drops.eventMode = 'none';
  root.addChild(base, lines, drops, hero, marks);
  let game = null, frame = null, key = '';

  // 1.7 #automapTag in the house style (painted-ui.css:467): ash words on #0b0c0ecc, square, Spectral, small.
  const tag = new Container();
  const words = kit.text(stage.touch ? 'Tap a symbol to walk' : 'Map · select a symbol to walk nearby', { size: 13, fill: color.ash });
  const tagBg = new Graphics().rect(0, 0, Math.ceil(words.width) + 16, Math.ceil(words.height) + 4).fill({ color: 0x0b0c0e, alpha: 0.8 });
  words.position.set(8, 2);
  tag.addChild(tagBg, words);
  tag.eventMode = 'none';
  root.addChild(tag);

  /** 1.7 positionAutomapHint: lower left first, then lower right, then centred, a row higher each time. */
  function placeTag(blocked) {
    const w = tagBg.width, h = tagBg.height;
    for (let y = H - h - 8; y >= 8; y -= h + 8) for (const x of [10, W - w - 10, (W - w) / 2]) {
      const box = { left: x, top: y, right: x + w, bottom: y + h };
      if (clear(box, W, H, blocked)) { tag.position.set(Math.round(x), Math.round(y)); tag.visible = true; blocked.push({ left: x - 4, top: y - 4, right: x + w + 4, bottom: y + h + 4 }); return; }
    }
    tag.visible = false;
  }

  function landmarkButton(at) {
    const p = at.point, art = LANDMARKS[p.kind], c = new Container();
    const face = new Graphics(), pic = new Graphics().svg(svgOf(art.path, hexOf(art.color)));
    pic.scale.set((size - pad * 2) / 24);
    pic.position.set(-size / 2 + pad, -size / 2 + pad);
    const shade = new Graphics().svg(svgOf(art.path, '#000000'));   // 1.7 drop-shadow(0 1px 2px #000)
    shade.scale.copyFrom(pic.scale); shade.position.set(pic.x, pic.y + 1); shade.alpha = 0.7;
    const paint = on => { face.clear(); if (on) face.circle(0, 0, size / 2).fill({ color: 0x2a2d31 }); };
    c.addChild(face, shade, pic);
    c.position.set(Math.round(at.cx), Math.round(at.cy));
    c.hitArea = { contains: (x, y) => x * x + y * y <= (size / 2) * (size / 2) };
    c.label = 'map-' + p.kind;
    c.on('pointerover', e => { if (e.pointerType === 'mouse') paint(true); });
    c.on('pointerout', () => paint(false));
    kit.details(c, { title: p.label ?? art.label, lines: ['Select to walk nearby.'] });
    return kit.control(c, () => walkTo(p));
  }

  function walkTo(p) {
    if (!game) return;
    const r = routeTo(game, p);
    if (r === 'near') { acts.close(); return; }
    if (!r) { acts.say('No safe route to that landmark.'); return; }
    acts.close();
    acts.walk(r);
  }

  function draw() {
    const s = game;
    base.clear(); lines.clear();
    drops.removeChildren().forEach(c => c.destroy());
    if (!s?.floor || !s.seen) return;
    base.rect(0, 0, W, H).fill({ color: 0x080605, alpha: 0.38 });   // a light veil so the outline reads over the lit dungeon
    frame = mapFrame(s, W, H);
    const { cell, ox, oy } = frame, f = s.floor, dots = [];
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      if (!known(s, x, y)) continue;
      const t = tileAt(f, x, y), px = ox + x * cell, py = oy + y * cell;
      if (isWall(t)) { if (wallEdge(s, x, y)) base.rect(px, py, cell, cell).fill({ color: 0xd6c4a0, alpha: 0.62 }); continue; }
      if (t === T.WATER) base.rect(px, py, cell, cell).fill({ color: 0x508cbe, alpha: 0.35 });
      else if (t === T.CHASM) base.rect(px, py, cell, cell).fill({ color: 0x0a0808, alpha: 0.6 });
      else if (t === T.LAVA) base.rect(px, py, cell, cell).fill({ color: 0xff6e28, alpha: 0.55 });   // RB23 (1.7 deeprender.js:661 drawAutomapLava)
      else base.rect(px, py, cell, cell).fill({ color: 0x96876e, alpha: 0.16 });
      if (DOORS.includes(t)) dots.push([px, py, t === T.LOCKED || t === T.SEALED ? 0xc9a0ff : 0xe0874a, 0.8]);
      else if (t === T.CHEST) dots.push([px, py, 0xe8b44a, 0.7]);
    }
    for (const q of f.traps ?? []) if (q.found && known(s, q.x, q.y)) dots.push([ox + q.x * cell, oy + q.y * cell, 0xd0605a, 0.6]);
    for (const [px, py, c, k] of dots) { const z = Math.max(2, Math.round(cell * k)); base.rect(px + (cell - z) / 2, py + (cell - z) / 2, z, z).fill({ color: c }); }
    for (const q of f.items ?? []) {
      const it = q.item;
      if (!known(s, q.x, q.y) || (it.kind !== 'key' && it.kind !== 'core')) continue;
      const z = Math.max(12, Math.min(20, cell * 1.2)), pic = icon(itemArtName(s, it), z);   // item 325: the floor's own picture
      if (!pic) continue;
      pic.x += ox + (q.x + 0.5) * cell - z / 2;
      pic.y += oy + (q.y + 0.5) * cell - z / 2;
      drops.addChild(pic);
    }
    // Allies and foes in sight.
    for (const id of s.order) {
      const a = s.actors[id];
      if (!a || id === s.playerId || a.hp <= 0 || a.hidden || !litAt(s, a.x, a.y)) continue;
      const z = Math.max(2, Math.round(cell * 0.6));
      base.rect(ox + a.x * cell + (cell - z) / 2, oy + a.y * cell + (cell - z) / 2, z, z).fill({ color: a.side === 'ally' ? 0x7fd08a : 0xe0564a });
    }
    // The symbols, kept clear of the HUD and of each other.
    const points = landmarksOf(s), k = [W, H, size, cell, ox, oy, ...points.map(q => q.id)].join(':');
    if (k !== key) {
      key = k;
      const blocked = acts.blocked();
      placeTag(blocked);
      marks.removeChildren().forEach(c => c.destroy({ children: true }));
      for (const at of placeLandmarks(points, frame, W, H, size, blocked)) {
        marks.addChild(landmarkButton(at));
        marks.children.at(-1).leader = at;
      }
    }
    for (const m of marks.children) {
      const at = m.leader;
      if (Math.hypot(at.cx - at.ax, at.cy - at.ay) < 3) continue;
      lines.moveTo(at.ax, at.ay).lineTo(at.cx, at.cy).stroke({ color: 0xebd5aa, width: 1, alpha: 0.75 });
      lines.rect(at.ax - 1, at.ay - 1, 2, 2).fill({ color: 0xebd5aa });
    }
    pulse();
  }

  /** The hero's square, pulsing (still under reduced motion). */
  function pulse() {
    hero.clear();
    if (!game || !frame) return;
    const p = game.actors[game.playerId], { cell, ox, oy } = frame, z = Math.max(3, Math.round(cell * 1.1));
    const a = acts.reduced() ? 1 : 0.75 + 0.25 * Math.sin(performance.now() / 220);
    hero.rect(ox + p.x * cell + (cell - z) / 2, oy + p.y * cell + (cell - z) / 2, z, z).fill({ color: 0xffffff, alpha: a });
  }
  Ticker.shared.add(pulse);
  root.on('destroyed', () => Ticker.shared.remove(pulse));

  return {
    root,
    /** Draws the map for this state (after every command). */
    set(s) { game = s; draw(); },
  };
}
